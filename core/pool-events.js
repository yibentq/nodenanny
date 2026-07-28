'use strict';

// 流量池检测事件日志——跟 store.js 的自建节点事件(events数组,上限200条)完全独立、
// 单独存一个文件(data/pool-events.json),不共用、不占用自建节点的事件名额。
//
// 背景:流量池每轮刷新可能同时测几十个候选节点，如果每个候选的失败都往store.js的
// events数组里塞一条，很快会把自建节点真正重要的down/恢复/重启事件顶掉——这是
// 不能接受的，所以单开一份存储。
//
// 存的是"轮次"(round)而不是拍平的单条记录：一次 fetchFromXxx() 调用（一个来源一轮
// 检测）算一轮，轮内包含这一轮所有候选节点的检测结果。这样面板展示时能按"这一轮、
// 这个来源"分组，不用自己再拼。
//
// 出于隐私/体积考虑，不存完整节点链接(里面带UUID/密码这类凭证)，只存协议类型+
// host+port这三个足够定位问题、又不泄露凭证的字段(用proxy-parse.js解析得到，
// 跟pool-checker.js检测节点时用的是同一个解析器，结果一定对得上)。

const fs = require('fs');
const path = require('path');
const { parseProxyLink } = require('./proxy-parse');
const kbManager = require('./kb-manager');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'pool-events.json');

// 30轮的上限是权衡后的默认值：一次refreshPool()通常会产生"1个legacy aggregator +
// N个GitHub发现来源 + M个手动来源"这么多轮，30轮大概能覆盖最近1~2次完整刷新，
// 够排查用，又不会让文件无限增长。
const MAX_ROUNDS = 30;

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    writeRounds([]);
  }
}

function readRounds() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.rounds) ? data.rounds : [];
  } catch (err) {
    // 文件损坏不该影响流量池主流程(检测/刷新)，重置成干净的空数组，跟store.js
    // 处理store.json损坏时的思路一致——事件日志坏了不该拖累主功能。
    console.error('[pool-events] 数据文件解析失败，已重置：', err.message);
    writeRounds([]);
    return [];
  }
}

function writeRounds(rounds) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify({ rounds }, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

// 从候选链接里提取"协议+host+port"这三个不涉及凭证的字段，用于展示。
// 解析失败(比如这个协议proxy-parse.js都识别不了)时返回null字段，前端显示"未知"，
// 不抛异常影响记录流程。
function describeLink(link) {
  try {
    const parsed = parseProxyLink(link);
    if (!parsed || !parsed.outbound) {
      return { protocol: null, host: null, port: null };
    }
    return {
      protocol: parsed.type || null,
      host: parsed.outbound.server || null,
      port: parsed.outbound.server_port || null
    };
  } catch (err) {
    return { protocol: null, host: null, port: null };
  }
}

// 给一个错误code查知识库，返回精简后的条目数组(id/title/explanation/fixCommands/riskLevel)，
// 取舍逻辑、字段跟checker.js里的matchKbForEvent保持一致(只留前端实际会用到的字段)。
// title同样转发完整的多语言对象，理由跟checker.js那边一致。
// contextKey用"轮次时间+候选序号"拼出来，保证同一轮里几十个候选即使code相同也不会
// 被kb-manager.matchCode那个为"高频重复触发"设计的60秒防刷缓存互相挤掉。
async function matchKbForResult(code, contextKey) {
  if (!code) return [];
  try {
    const hits = await kbManager.matchCode(code, { contextKey });
    return hits.map((entry) => ({ id: entry.id, title: entry.title, explanation: entry.explanation, fixCommands: entry.fixCommands, riskLevel: entry.riskLevel }));
  } catch (err) {
    console.error('[pool-events] 知识库匹配失败，本条不带建议：', err.message);
    return [];
  }
}

// 记录一轮检测。candidates 和 checkResults 是同一批、一一对应的两个数组
// (跟 pool.js 里 checkNodes(candidates, ...) 调用后立刻能拿到的两份数据完全对应，
// 调用方不需要额外加工)。
//
// 只有 outcome 不是 'ok' 的候选才会存detail全文(down/check_error/unsupported这几种
// 通常才是用户想排查的)；'ok' 的候选只存精简结果(不存detail)，减少文件体积——
// 一轮里大多数免费节点是失败的，'ok'的通常只有个位数，这个精简换来的空间不大，
// 但聚沙成塔，尤其是候选数多的来源。
//
// 本轮补上真实缺口(复查发现,不是新需求):此前这里只存detail,从没调用过
// kb-manager做知识库匹配，但public/pool-events.html前端早就假设每条非ok结果
// 自带r.kb字段直接渲染——前后端没对上，导致这个页面点开任何记录都只会显示
// "无匹配词条"。改成async函数，对每条非ok结果调用matchKbForResult，做法、
// 取舍跟checker.js的checkUsabilityAndLog完全一致。调用方(pool.js三处)需要
// 相应地加上await，已同步修改。
async function recordRound(sourceId, candidates, checkResults) {
  if (!Array.isArray(candidates) || !Array.isArray(checkResults)) return;
  if (candidates.length === 0) return;

  const at = new Date().toISOString();
  const results = await Promise.all(candidates.map(async (link, i) => {
    const r = checkResults[i] || {};
    const desc = describeLink(link);
    const base = { index: i, protocol: desc.protocol, host: desc.host, port: desc.port, outcome: r.outcome || 'unknown', code: r.code || null };
    if (r.outcome !== 'ok') {
      base.detail = r.detail || null;
      base.kb = await matchKbForResult(r.code, `pool-events:${at}:${i}`);
    }
    return base;
  }));

  const passedCount = results.filter((r) => r.outcome === 'ok').length;

  const rounds = readRounds();
  rounds.unshift({ at, sourceId, candidateCount: candidates.length, passedCount, results });
  if (rounds.length > MAX_ROUNDS) {
    rounds.length = MAX_ROUNDS;
  }
  writeRounds(rounds);
}

// 供面板调用：返回最近若干轮（默认全部，最多MAX_ROUNDS轮），最新的在前面。
function getRecentRounds(limit) {
  const rounds = readRounds();
  return typeof limit === 'number' ? rounds.slice(0, limit) : rounds;
}

module.exports = {
  recordRound,
  getRecentRounds,
  _internal: { describeLink, MAX_ROUNDS, DATA_FILE }
};
