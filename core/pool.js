'use strict';

// 流量池模块（应急安全气囊）。
//
// 定位跟历次文档说的一样：正常状态完全不启用，只在后台无感刷新本地节点池；
// 自建节点异常时才切换过去临时应急，恢复后自动切回、流量池停用。
//
// 批次三重大改造（改造抓取方式，founder本轮拍板确认）：
// 旧版本只有一条抓取路径——调用本地已装好的 wzdnzd/aggregator，整包抓、不分来源。
// 现在改成"多来源"模式：
//   1. legacy aggregator（旧的整包抓取方式）继续保留，作为一个固定权重的来源
//      （config.pool.sourceWeighting.aggregatorWeight，默认1.0，相当于"老来源默认信任"），
//      不是砍掉旧功能，是把它也纳入"来源"这个统一概念里，跟新的GitHub发现来源同场竞技。
//   2. 新增：discovery-runner.js 定期缓存的GitHub候选来源列表，每个来源单独用
//      repo-fetch.js 抓取、单独送检、单独喂给 source-trust.js 记录通过率，
//      按 source-trust.js 给出的权重参与最终"进池子"的加权抽取。
// config.pool.discovery.enabled = false（默认值）时，行为跟v15完全一致，
// 只走legacy aggregator这一条路径——这是为了不影响现有生产配置的默认行为。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { checkNodes } = require('./pool-checker');
const { parseProxyLink } = require('./proxy-parse');
const poolEvents = require('./pool-events');
const discoveryRunner = require('./discovery-runner');
const repoFetch = require('./repo-fetch');
const sourceTrust = require('./source-trust');
const nodeLabelI18n = require('./node-label-i18n');
const geoip = require('./geoip');
const starLayout = require('./star-layout');
const telegramFetch = require('./telegram-fetch');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POOL_FILE = path.join(DATA_DIR, 'pool.json');
const FETCH_SCRIPT = path.join(__dirname, '..', 'scripts', 'pool-fetch.sh');
const AGGREGATOR_SOURCE_ID = 'aggregator-default';
// 本轮新增(founder拍板的架构调整,交接文档有完整记录):Telegram频道消息里作者
// 原文直接贴的原始节点链接(不是订阅链接,本身就能用),汇总进这一个共享、固定
// 命名的池子,来源身份是这个常量本身,不是某个具体频道——因为这些节点严格来说
// 不"属于"任何一个manualSources条目,是所有TG频道来源共同贡献的一个混合池。
// 特意跟legacy的AGGREGATOR_SOURCE_ID('aggregator-default')区分开、不复用/不合并
// ——founder已经证实legacy aggregator这条老路径基本没有产出(截图显示0/14通过率),
// 新的telegram-raw-pool不应该被那边拖累,是一个全新的、独立的来源。
// 这个池子走跟GitHub发现来源/manualSources完全相同的试用期/权重/拉黑状态机
// (source-trust.js),不是fixed:true的绿色通道——原文贴出来的节点不代表可靠，
// 依然需要持续观察实测通过率。
const TELEGRAM_RAW_POOL_SOURCE_ID = 'telegram-raw-pool';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 本轮新增(第五批·第一步,GeoIP国家码接入):从一条分享链接里提取服务器地址(IP或域名),
// 优先复用 proxy-parse.js 已经写好的、逐协议的严格解析逻辑(parseProxyLink),这样地址
// 提取的准确性跟checker/订阅生成用的是同一套解析代码,不会出现"这里提取的地址跟实际
// 连接用的地址不一致"这种偏差。parseProxyLink 解析失败时(比如极少数不支持的协议),
// 退回一个宽松的正则兜底(抓 "@host:port" 这种常见形态),兜底失败就返回null——
// 查不出地址就查不出国家码,不強求。
function extractHostFromLink(link) {
  if (!link || typeof link !== 'string') return null;
  try {
    const parsed = parseProxyLink(link);
    if (parsed && parsed.outbound && parsed.outbound.server) return parsed.outbound.server;
  } catch (err) {
    // parseProxyLink 本身已经吞了各协议内部的异常，这里只是多一层保险，不重复记录日志。
  }
  const m = link.match(/@([^:/?#]+)/);
  return m ? m[1] : null;
}

// 本轮修复(真实bug,复查发现):候选去重此前只按"原始分享链接字符串"做 Set 去重
// (原来是 fetchFromAggregator 里的 Array.from(new Set(lines)),discovered/manual
// 两条路径此前甚至完全没有去重这一步)。同一个节点如果被不同聚合源/仓库重复收录、
// 备注名或参数顺序不同,字符串层面就不算同一行,会被当成不同候选逐个塞进三层检测——
// 既浪费本就紧张的检测资源(2H2G机器),也正是交接文档里"11598个源只测出2个有效
// 节点、还共享同一UUID"这个案例没被去重逻辑拦住的原因之一。
// 改成解析后按 协议类型+服务器地址+端口+身份标识(uuid/password) 去重,混杂的无关
// 字符串差异不再产生假的"新候选"。解析失败(冷门/不支持协议)的链接退回按原始字符串
// 去重,不强行归并,后面 checkNode 该报 unsupported 还是报 unsupported,行为不变。
// 注意:这里只影响"送去检测之前"的候选去重,不影响 detectAnomaly()——那个函数是在
// 检测通过之后专门用来发现"同一身份出现在不同server上"这种可疑信号的,两者数据
// 来源不同(一个是去重前的候选,一个是去重后又测过关的通过节点),互不冲突。
function dedupeCandidateLinks(links) {
  const seen = new Set();
  const result = [];
  for (const link of links) {
    let key = link;
    try {
      const parsed = parseProxyLink(link);
      if (parsed && parsed.outbound) {
        const ob = parsed.outbound;
        const identity = ob.uuid || ob.password || '';
        key = `${ob.type || ''}:${ob.server || ''}:${ob.server_port || ''}:${identity}`;
      }
    } catch (err) {
      // 解析异常,退回按原始字符串去重,不影响后面 checkNode 里再走一次同样的解析
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

// 给一批节点对象(带link字段)并发查询国家码,写入 countryCode 字段。查不出来就是null，
// 不影响节点本身是否可用——这是纯展示层面的锦上添花信息，geoip.resolveCountryCode
// 自身已经承诺不抛异常，这里不需要额外try/catch包裹每一个。
async function attachCountryCodes(nodes) {
  await Promise.all(nodes.map(async (node) => {
    const host = extractHostFromLink(node.link);
    node.countryCode = host ? await geoip.resolveCountryCode(host) : null;
  }));
  return nodes;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readPool() {
  ensureDataDir();
  if (!fs.existsSync(POOL_FILE)) {
    return { updatedAt: null, count: 0, nodes: [], lastError: null };
  }
  try {
    return JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8'));
  } catch (err) {
    return { updatedAt: null, count: 0, nodes: [], lastError: '本地池文件损坏：' + err.message };
  }
}

function writePool(data) {
  ensureDataDir();
  const tmp = POOL_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, POOL_FILE);
}

// 本轮修复(排查流量池主体功能卡住的问题时发现):此前用Node的exec()跑pool-fetch.sh，
// 超时机制只会杀最外层那个bash进程，脚本内部eval出的aggregator子进程杀不掉，会变成
// 孤儿继续跑——跟发现29(usability-check.js里的孤儿xray进程)是同一类问题，只是这次
// 因为aggregator自己后来正常跑完退出了，没有真的留下常驻孤儿，但完全可能重演。
// 改用spawn({shell:true, detached:true})拉起，这样子进程会成为一个独立进程组的组长，
// 超时或者正常结束时都用process.kill(-pid)整个进程组一起收拾干净，不留漏网的。
function runShell(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch (err) {
        // 进程可能已经退出，忽略
      }
    }, timeoutMs);

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ok = !timedOut && exitCode === 0;
      const error = ok ? null : new Error(
        timedOut
          ? `Command timed out after ${timeoutMs}ms: ${command}`
          : `Command failed with exit code ${exitCode}: ${command}`
      );
      resolve({ ok, stdout, stderr, error });
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, error: err });
    });
    child.on('close', (exitCode) => finish(exitCode));
  });
}

// 从抓取脚本的原始输出里解析出一行行节点分享链接（legacy aggregator专用，逻辑不变）。
function parseNodeLines(raw) {
  const text = (raw || '').trim();
  if (!text) return [];

  const tryLines = (s) =>
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^(vless|vmess|ss|ssr|trojan|hysteria2?|hy2|tuic):\/\//i.test(l));

  let lines = tryLines(text);
  if (lines.length > 0) return lines;

  try {
    const decoded = Buffer.from(text, 'base64').toString('utf-8');
    lines = tryLines(decoded);
  } catch (err) {
    // 不是合法 base64，忽略
  }
  return lines;
}

// 从一条已经三层检测通过的分享链接里提取"身份标识字段"（uuid或password），
// 用于批次三新增的异常检测：同一个来源这一轮产出的节点里，如果有2个以上
// server地址不同、但身份标识字段完全相同的节点，基本可以判断是同一个可疑
// 来源批量灌的低质量/蜜罐节点（呼应发现27的教训，这里把这个判断规则从
// "人工事后核查"变成"抓取时自动检测"）。
function extractIdentity(link) {
  const parsed = parseProxyLink(link);
  if (!parsed || !parsed.outbound) return null;
  return parsed.outbound.uuid || parsed.outbound.password || null;
}

function detectAnomaly(links) {
  const byIdentity = new Map();
  for (const link of links) {
    const identity = extractIdentity(link);
    if (!identity) continue;
    const parsed = parseProxyLink(link);
    const server = parsed && parsed.outbound ? parsed.outbound.server : null;
    if (!byIdentity.has(identity)) byIdentity.set(identity, new Set());
    if (server) byIdentity.get(identity).add(server);
  }
  for (const servers of byIdentity.values()) {
    if (servers.size >= 2) return true; // 同一身份标识，出现在2个以上不同server上
  }
  return false;
}

// legacy aggregator抓取路径（原有逻辑，保持不变，只是把"送检+写pool.json"这两步
// 拆出去给上层统一处理，这里只负责"抓+解析+送检+返回一批候选"）。
// 诊断用:目前 checkNodes() 返回的每层细节(alive/speed/authentic 各自的
// outcome/detail)只有"通过"的候选会被存进 passedNodes.lastCheck，没通过的
// 候选，具体是卡在哪一层、什么原因，此前完全没有落地到任何日志或文件里——
// 出现"这一批一个都没过"的情况时，用户和开发者都只能看到一个总数，
// 完全没法判断到底是"检测目标本身在这台服务器网络环境下就连不上"（环境问题），
// 还是"抓来的节点确实大多是废的"（数据源质量问题），还是判定逻辑本身有 bug。
// 这里把每一层的失败原因做个汇总，各层各挑1条真实报错样本，方便直接从
// pm2 logs 里看出眉目，不用再登服务器translate猜。
function summarizeCheckFailures(checkResults) {
  const breakdown = { alive: 0, speed: 0, authentic: 0, check_error: 0, unsupported: 0 };
  const sampleDetail = {};
  for (const r of checkResults) {
    if (r.outcome === 'ok') continue;
    if (r.outcome === 'unsupported') { breakdown.unsupported += 1; continue; }
    if (r.outcome === 'check_error' && (!r.layers || !r.layers.alive || r.layers.alive.outcome !== 'down')) {
      breakdown.check_error += 1;
      if (!sampleDetail.check_error) sampleDetail.check_error = r.detail;
      continue;
    }
    const layers = r.layers || {};
    if (layers.authentic && layers.authentic.outcome === 'down') {
      breakdown.authentic += 1;
      if (!sampleDetail.authentic) sampleDetail.authentic = layers.authentic.detail;
    } else if (layers.speed && layers.speed.outcome === 'down') {
      breakdown.speed += 1;
      if (!sampleDetail.speed) sampleDetail.speed = layers.speed.detail;
    } else if (layers.alive && layers.alive.outcome === 'down') {
      breakdown.alive += 1;
      if (!sampleDetail.alive) sampleDetail.alive = layers.alive.detail;
    }
  }
  const parts = Object.keys(breakdown)
    .filter((k) => breakdown[k] > 0)
    .map((k) => `${k}=${breakdown[k]}${sampleDetail[k] ? `(例: ${sampleDetail[k]})` : ''}`);
  return parts.length ? parts.join(', ') : '(全部通过或无候选)';
}

async function fetchFromAggregator(poolConfig, checkerConfig) {
  const aggDir = poolConfig.aggregatorDir || '';
  const fetchCmd = poolConfig.fetchCommand || 'python3 subscribe/collect.py -s';
  const outFile = poolConfig.outputFile || 'data/v2ray.txt';
  const candidateLimit = poolConfig.checkCandidateLimit || Math.max((poolConfig.maxNodes || 50) * 5, 50);
  const concurrency = checkerConfig.concurrency || 3;

  // 本轮修复:原来硬编码20分钟，比真机实测耗时(23~25分钟，11598个源)短，导致抓取
  // 明明快跑完了却被误判超时失败。改成可配置字段，默认45分钟，留足余量。
  const fetchTimeoutMs = poolConfig.aggregatorFetchTimeoutMs || 45 * 60 * 1000;
  const cmd = `bash "${FETCH_SCRIPT}" "${aggDir}" ${JSON.stringify(fetchCmd)} ${JSON.stringify(outFile)}`;
  const result = await runShell(cmd, fetchTimeoutMs);

  if (!result.ok && !result.stdout.trim()) {
    const errMsg = (result.stderr || String(result.error) || 'Unknown error').toString().slice(0, 300);
    return { sourceId: AGGREGATOR_SOURCE_ID, ok: false, error: errMsg, passedNodes: [], candidateCount: 0 };
  }

  const lines = parseNodeLines(result.stdout);
  if (lines.length === 0) {
    return {
      sourceId: AGGREGATOR_SOURCE_ID, ok: false,
      error: 'Fetch script completed, but no valid node links were parsed from the output', passedNodes: [], candidateCount: 0
    };
  }

  const unique = dedupeCandidateLinks(lines);

  if (checkerConfig.enabled === false) {
    const now = new Date().toISOString();
    const raw = unique.slice(0, poolConfig.maxNodes || 50).map((link) => ({
      link, addedAt: now, lastCheck: null, sourceId: AGGREGATOR_SOURCE_ID
    }));
    return { sourceId: AGGREGATOR_SOURCE_ID, ok: true, passedNodes: raw, candidateCount: raw.length, checked: false };
  }

  const candidates = unique.slice(0, candidateLimit);
  const checkResults = await checkNodes(candidates, checkerConfig, concurrency);
  console.log(`[pool] aggregator-default: ${checkResults.filter((r) => r.outcome === 'ok').length}/${candidates.length} 通过。失败层级分布: ${summarizeCheckFailures(checkResults)}`);
  await poolEvents.recordRound(AGGREGATOR_SOURCE_ID, candidates, checkResults);
  const now = new Date().toISOString();
  const passedLinks = [];
  const passedNodes = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = checkResults[i];
    if (r.outcome === 'ok') {
      passedLinks.push(candidates[i]);
      passedNodes.push({
        link: candidates[i], addedAt: now,
        lastCheck: { outcome: r.outcome, checkedAt: now, layers: r.layers },
        sourceId: AGGREGATOR_SOURCE_ID
      });
    }
  }

  return {
    sourceId: AGGREGATOR_SOURCE_ID, ok: true, passedNodes,
    candidateCount: candidates.length,
    totalChecked: candidates.length, passed: passedLinks.length,
    anomalyDetected: detectAnomaly(passedLinks),
    checked: true
  };
}

// 批次三新增：单个GitHub发现来源的抓取+送检+记录通过率。
async function fetchFromDiscoveredSource(sourceRecord, discoveryConfig, checkerConfig, githubHeaders) {
  const sourceId = sourceRecord.repoFullName;
  let fetchResult;
  try {
    fetchResult = await repoFetch.fetchCandidatesForSource(sourceRecord, discoveryConfig, githubHeaders);
  } catch (err) {
    // 抓取本身抛异常(GitHub API临时故障、网络问题等)是基础设施层面的问题,不是
    // 这个来源本身的信号,跟下面check_error不计入分母是同一个原则——这里不调用
    // recordCheckResult,避免一次网络抖动就打断这个来源已积累的连续达标计数。
    const state = sourceTrust.getSourceState(sourceId);
    return { sourceId, passedNodes: [], error: err.message, weight: state ? state.weight : 0, status: state ? state.status : 'unknown' };
  }

  const candidateLimit = discoveryConfig.candidateLimitPerSource || 20;
  const candidates = dedupeCandidateLinks(fetchResult.links).slice(0, candidateLimit);

  if (candidates.length === 0) {
    // 这里跟上面catch分支不同:抓取本身成功,只是这一轮真的一条候选节点都没有
    // (比如topic命中的仓库根本不是节点订阅仓库)。按18.8.5节的设计意图,这种
    // 情况该被试用期机制当"不合格"逐步推向拉黑,不能无限期挂在trial里不处理——
    // 记totalChecked:1、passed:0(而不是0:0),才能真正触发source-trust.js
    // "连续N轮0通过率"的拉黑判断(它要求totalChecked>0才会累计零通过轮数)。
    const state = sourceTrust.recordCheckResult(sourceId, { totalChecked: 1, passed: 0 });
    return { sourceId, passedNodes: [], candidateCount: 0, filesFound: fetchResult.filesFound, weight: state ? state.weight : 0, status: state ? state.status : 'unknown' };
  }

  const concurrency = checkerConfig.concurrency || 3;
  const checkResults = await checkNodes(candidates, checkerConfig, concurrency);
  console.log(`[pool] ${sourceId}: ${checkResults.filter((r) => r.outcome === 'ok').length}/${candidates.length} 通过。失败层级分布: ${summarizeCheckFailures(checkResults)}`);
  await poolEvents.recordRound(sourceId, candidates, checkResults);
  const now = new Date().toISOString();
  const passedLinks = [];
  const passedNodes = [];
  // 关键区分(测试阶段发现的真实问题,当场修正,不是原方案就有的设计):
  // outcome==='check_error' 意味着"检测器本身没能完成测量"(比如sing-box二进制
  // 缺失、临时崩溃),不代表"这个节点被测过、而且不合格"。如果把check_error也
  // 计进totalChecked的分母,一旦本地检测环境临时出故障,所有来源都会被记成
  // "这一轮0通过率",连续几次就会被source-trust.js误判拉黑——这不是来源的问题,
  // 是"测不了"和"测了不合格"被混为一谈。这里只把outcome是'ok'或'down'的候选
  // (真正完成了测量的)计入喂给source-trust.js的totalChecked,'check_error'和
  // 'unsupported'(协议不支持,同样没有真正测量)不计入分母,避免误伤。
  let measuredCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const r = checkResults[i];
    if (r.outcome === 'ok' || r.outcome === 'down') measuredCount += 1;
    if (r.outcome === 'ok') {
      passedLinks.push(candidates[i]);
      passedNodes.push({
        link: candidates[i], addedAt: now,
        lastCheck: { outcome: r.outcome, checkedAt: now, layers: r.layers },
        sourceId
      });
    }
  }

  const anomalyDetected = detectAnomaly(passedLinks);
  // 这一轮如果一个节点都没有真正被测量到(比如全部是check_error/unsupported),
  // 就不喂给source-trust.js记录——记一次"totalChecked=0"跟"完全没抓到候选"是
  // 同一种情况,不应该被当成"抓到了但通过率是0"处理。
  const state = measuredCount > 0
    ? sourceTrust.recordCheckResult(sourceId, {
        totalChecked: measuredCount,
        passed: passedLinks.length,
        anomalyDetected
      })
    : sourceTrust.getSourceState(sourceId);

  return {
    sourceId, passedNodes,
    candidateCount: candidates.length,
    totalChecked: measuredCount,
    passed: passedLinks.length,
    anomalyDetected,
    weight: state ? state.weight : 0,
    status: state ? state.status : 'unknown',
    filesFound: fetchResult.filesFound,
    errors: fetchResult.errors
  };
}

// 手动种子来源(2026-07-14新增,创始人拍板):创始人自己找到、验证过的第三方订阅链接
// (比如某个专人持续维护的免费节点订阅,不是GitHub仓库,也不是legacy aggregator那份
// 通用固定列表)。跟GitHub发现来源共用同一套试用期/信任状态机,不给"人工挑选"开绿色
// 通道直接判永久信任——虽然是创始人手动验证过的,但运营者是谁、会不会哪天变质,我们
// 依然无法验证,应该跟其它陌生来源一样接受同一套持续监控(呼应7.3.6节的陌生节点风险)。
// sourceId用"manual:"前缀区分,不会跟GitHub来源的"owner/repo"格式或legacy aggregator
// 的固定id("aggregator-default")冲突。
// 本轮新增(创始人拍板,针对"旺财"节点提出的需求):手动订阅源支持"固定"标记——
// config.pool.manualSources里对应条目加 fixed:true(可选配fixedWeight覆盖默认权重),
// 就能让这个来源完全跳过source-trust.js那套为"陌生自动发现来源"设计的trial/拉黑
// 状态机:不会因为某几轮实测通过率低、或者触发了detectAnomaly异常检测就被判永久
// 拉黑,权重也不再跟着实测通过率浮动,固定为fixedWeight(不填默认1.0，等同legacy
// aggregator的默认权重档位)。用途:创始人自己手动验证过、长期稳定使用的订阅源，
// 不该被"防陌生来源作恶"这套机制误伤——"旺财"就吃过这个亏(sources.json里能看到
// 历史上被拉黑又复活的记录，此前打的那些"战绩保护"补丁本质上都是在缓解同一个问题，
// 这次直接从根上解决:不再让这类来源进入该状态机)。不影响其它没标fixed的
// manualSources条目(EdNovas小站/shz.al/ybth/FreeSub/nodebuf)，那些依然走原有
// trial/拉黑/权重浮动逻辑，行为不变；也不修改source-trust.js本身，被标记fixed的
// 来源此前如果已经在sources.json里有记录，那份记录从此不再被读写，会按
// cleanupStaleTrusted/cleanupStaleTrials的既有规则自然过期清理，不需要手动清。
function resolveManualSourceTrust(manualSource, sourceId, recordArgs) {
  if (manualSource.fixed === true) {
    const weight = manualSource.fixedWeight != null ? manualSource.fixedWeight : 1;
    return { weight, status: 'trusted' };
  }
  return recordArgs ? sourceTrust.recordCheckResult(sourceId, recordArgs) : sourceTrust.getSourceState(sourceId);
}

// 从一个URL里提取域名(host),用作"跨天延续的信任身份"——见下面fetchFromManualSource
// 里的说明。解析失败(极少数畸形URL)就返回null,调用方需要自行兜底。
function extractUrlDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return null;
  }
}

async function fetchFromManualSource(manualSource, checkerConfig, requestTimeoutMs) {
  const sourceId = `manual:${manualSource.id}`;
  const timeoutMs = requestTimeoutMs || 8000;
  // trustSourceId:真正喂给source-trust.js(试用期/权重/拉黑判断)的身份标识。
  // 默认等于sourceId(跟频道/配置条目本身绑定),下面Telegram频道分支会按情况改写。
  // sourceId本身继续用于展示/分桶(星图、面板里节点归属哪个来源看的是这个),
  // 两者从这一轮起可以不是同一个值——见下方大段说明。
  let trustSourceId = sourceId;
  // rawNodeLinks:这条手动源如果背后是Telegram频道,顺带从同一份频道页面里提取出的
  // "原文直接贴的原始节点链接"(不是订阅链接,本身就是能用的节点)。非Telegram来源
  // 恒为空数组。交给调用方(doRefreshPool)汇总进共享的telegram-raw-pool,这里只负责
  // 提取,不在这个函数内部处理检测/试用期(那些节点不属于这一个manualSource,是
  // 所有Telegram来源共用的一个池子)。
  let rawNodeLinks = [];

  // 2026-07-30新增:如果这条手动源的url本身是一个Telegram频道链接(t.me/频道名 或
  // t.me/s/频道名),不是具体的订阅/节点文件直链,先用telegram-fetch.js去频道公开
  // 预览页找"最新一条带文件附件或链接"的消息,解析出今天真实的文件URL,再交给下面
  // 原有的repoFetch.fetchText流程按普通URL处理——对下游(parseSubscriptionContent/
  // 去重/三层检测/试用期状态机)完全透明,它们不需要知道这条来源背后是个TG频道。
  // telegram-fetch.js的fetchText参数需要"给URL返回Promise<string>",这里用一个
  // 小适配器包一层repoFetch.fetchText的真实签名(返回{ok,status,text},HTTP非200
  // 不抛异常),不新写一套HTTP客户端。
  // 解析失败(频道改版/被限制预览/今天没有消息带链接等)按跟下面"网络层错误"完全
  // 一致的原则处理:不喂给source-trust.js,不打断这个来源已经积累的连续达标计数
  // (跟fetchFromDiscoveredSource/下面HTTP非200分支的既有原则保持一致)。
  let effectiveUrl = manualSource.url;
  if (telegramFetch.isTelegramChannelUrl(manualSource.url)) {
    const resolved = await telegramFetch.fetchLatestFileUrl(manualSource.url, {
      fetchText: async (url) => {
        const r = await repoFetch.fetchText(url, timeoutMs);
        if (!r.ok) throw new Error(`HTTP status ${r.status}`);
        return r.text;
      }
    });
    // 本轮新增:不管有没有找到订阅链接,只要页面本身抓成功了(resolved.rawHtml存在),
    // 就顺手把里面原文贴的原始节点提取出来——这是两件独立的事,订阅链接没找到
    // 不代表这个频道这次就完全没有可用信号。
    if (resolved.rawHtml) {
      try {
        rawNodeLinks = telegramFetch.extractRawNodeLinks(resolved.rawHtml);
      } catch (err) {
        console.error(`[pool] ${sourceId}(手动订阅源,Telegram频道) 提取原始节点链接出错(不影响订阅链接抓取): ${err.message}`);
      }
    }
    if (!resolved.ok) {
      console.error(`[pool] ${sourceId}(手动订阅源,Telegram频道) 找不到今天的文件链接: ${resolved.error}`);
      const state = resolveManualSourceTrust(manualSource, trustSourceId, null);
      return { sourceId, passedNodes: [], candidateCount: 0, error: `telegram_resolve_failed: ${resolved.error}`, weight: state ? state.weight : 0, status: state ? state.status : 'unknown', rawNodeLinks };
    }
    effectiveUrl = resolved.url;

    // 本轮新增(founder拍板的架构调整,交接文档有完整记录):此前这里的信任/拉黑身份
    // 一直是sourceId(即"manual:频道名"本身)——意味着"同一身份出现在多个服务器"
    // 这类异常检测一旦触发,拉黑的是整个频道配置条目,下次刷新这个manualSource
    // 直接被跳过,哪怕频道当天换了个完全不同、干净的订阅链接也没用。
    // founder明确的方向:频道本身要从检测/拉黑判断里"隔离"出来,真正进入检测、
    // 可能被拉黑的应该是频道里选出来的那条订阅链接自己的身份,不是频道这个配置条目。
    // 但订阅链接的完整URL本身通常带会员token(fq5211/zdyz2这几个真实来源都是这样,
    // 每天甚至每次请求都会换一个新token),如果直接拿完整URL当身份,信任状态每天
    // 都从零开始,试用期永远攒不满——所以改用"这条订阅链接所在的域名"当身份
    // (比如app.sublink.works、dingyue.bbec.cc),同一个服务商每天发的不同token链接
    // 依然会被认成同一个来源,历史战绩能累积下去。
    // 加"manual-tg-sub:"前缀是为了跟其它两类已有的sourceId命名空间(GitHub来源的
    // "owner/repo"格式、legacy aggregator的"aggregator-default"、以及未走这条分支的
    // manualSources本身的"manual:id"格式)明确区分开,避免不同性质的信任记录意外
    // 撞到同一个key上。
    const domain = extractUrlDomain(effectiveUrl);
    if (domain) {
      trustSourceId = `manual-tg-sub:${domain}`;
    }
    // domain解析失败(理论上不该发生,resolved.url来自fetchLatestFileUrl已经是个
    // 看起来合法的URL,但畸形数据不能完全排除)时trustSourceId保持等于sourceId
    // (退回旧行为),不因为一个边缘情况让整个来源彻底失去信任身份。
  }

  let fetchResult;
  try {
    fetchResult = await repoFetch.fetchText(effectiveUrl, timeoutMs);
  } catch (err) {
    // 网络层面的问题(超时/DNS失败等),不是这个来源本身的信号,不喂给source-trust.js，
    // 避免一次网络抖动就打断这个来源已经积累的连续达标计数(跟fetchFromDiscoveredSource
    // 里对应分支的处理原则一致)。
    // 本轮修复:这三个失败分支(这里/下面HTTP非200/下面0候选)之前只return不打印任何
    // 日志——只有"抓到候选、进入检测"这条路径会打console.log，导致手动订阅源哪怕
    // 完全没抓到东西也在pm2 logs里悄无声息，创始人没法判断这个来源到底有没有在跑，
    // 还是配置本身就没生效。这里补上，跟aggregator/discovery来源的日志可见度对齐。
    console.error(`[pool] ${sourceId}(手动订阅源) 请求失败: ${err.message}`);
    const state = resolveManualSourceTrust(manualSource, trustSourceId, null);
    return { sourceId, passedNodes: [], candidateCount: 0, error: err.message, weight: state ? state.weight : 0, status: state ? state.status : 'unknown', rawNodeLinks };
  }
  if (!fetchResult.ok) {
    console.error(`[pool] ${sourceId}(手动订阅源) 请求失败: HTTP状态${fetchResult.status}`);
    const state = resolveManualSourceTrust(manualSource, trustSourceId, null);
    return { sourceId, passedNodes: [], candidateCount: 0, error: `Subscription request failed, HTTP status ${fetchResult.status}`, weight: state ? state.weight : 0, status: state ? state.status : 'unknown', rawNodeLinks };
  }

  const parsed = repoFetch.parseSubscriptionContent(fetchResult.text);
  const candidateLimit = manualSource.candidateLimit || 50;
  const candidates = dedupeCandidateLinks(parsed.links).slice(0, candidateLimit);

  if (candidates.length === 0) {
    // 请求成功但解析不出节点(订阅暂时空了/格式变了),按跟GitHub来源一致的原则
    // 记totalChecked:1、passed:0，让试用期机制能感知到"这一轮不合格"，不是
    // 无限期挂在"抓取成功但没数据"这个中间态里不被判断。
    // 打印识别到的格式(unrecognized/empty等)和原始内容长度，方便判断是"内容真的
    // 是空的"还是"抓到的是一个不认识的格式(比如没带UA被重定向到了一个说明页)"。
    console.log(`[pool] ${sourceId}(手动订阅源): 请求成功但没解析出候选节点(格式识别为 ${parsed.format}，原始内容长度 ${(fetchResult.text || '').length} 字符)`);
    const state = resolveManualSourceTrust(manualSource, trustSourceId, { totalChecked: 1, passed: 0 });
    return { sourceId, passedNodes: [], candidateCount: 0, format: parsed.format, weight: state ? state.weight : 0, status: state ? state.status : 'unknown', rawNodeLinks };
  }

  const concurrency = checkerConfig.concurrency || 3;
  const checkResults = await checkNodes(candidates, checkerConfig, concurrency);
  console.log(`[pool] ${sourceId}(手动订阅源): ${checkResults.filter((r) => r.outcome === 'ok').length}/${candidates.length} 通过。失败层级分布: ${summarizeCheckFailures(checkResults)}`);
  await poolEvents.recordRound(sourceId, candidates, checkResults);
  const now = new Date().toISOString();
  const passedLinks = [];
  const passedNodes = [];
  let measuredCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const r = checkResults[i];
    if (r.outcome === 'ok' || r.outcome === 'down') measuredCount += 1;
    if (r.outcome === 'ok') {
      passedLinks.push(candidates[i]);
      passedNodes.push({
        link: candidates[i], addedAt: now,
        lastCheck: { outcome: r.outcome, checkedAt: now, layers: r.layers },
        sourceId
      });
    }
  }

  const anomalyDetected = detectAnomaly(passedLinks);
  // 本轮AI默认选择(founder当时确认"没问题可以开始了"、但没有对这一条明确表态,
  // 已经在这轮回复文字里向founder说清楚这是个默认选择,不是既定共识——见交接
  // 记录):对trustSourceId是"manual-tg-sub:"命名空间(即TG频道解析出的订阅链接)
  // 的来源,不再把anomalyDetected喂给resolveManualSourceTrust去触发拉黑——一个
  // 正规的多地区订阅服务,同一账号身份出现在不同服务器上是完全正常的设计
  // (fq5211那次真实验证过的案例:同一UUID分别在新加坡/美国服务器),不应该被这条
  // 为"陌生单节点来源伪造身份"设计的规则误伤。检测结果依然计算、依然记录进
  // poolEvents/返回值里(anomalyDetected字段不变,面板/日志都还看得到),只是不再
  // 影响这个来源自己的试用期/拉黑判断。非TG来源(trustSourceId还是普通的
  // "manual:id")行为完全不变,anomalyDetected该拉黑还是拉黑。
  const isTgSubTrust = trustSourceId.startsWith('manual-tg-sub:');
  const anomalyForTrust = isTgSubTrust ? false : anomalyDetected;
  const state = measuredCount > 0
    ? resolveManualSourceTrust(manualSource, trustSourceId, {
        totalChecked: measuredCount,
        passed: passedLinks.length,
        anomalyDetected: anomalyForTrust
      })
    : resolveManualSourceTrust(manualSource, trustSourceId, null);

  return {
    sourceId, passedNodes,
    candidateCount: candidates.length,
    totalChecked: measuredCount,
    passed: passedLinks.length,
    anomalyDetected,
    rawNodeLinks,
    weight: state ? state.weight : 0,
    status: state ? state.status : 'unknown',
    format: parsed.format
  };
}


//
// 本轮修复(复查发现的问题1):旧实现用"归一化权重"算配额——quota_i = maxNodes * weight_i / totalWeight,
// totalWeight只累加"这一轮真的有供给"的来源。这样一来,如果legacy aggregator这一轮抓取失败
// (totalWeight里就不再包含它那份weight=1),剩下的试用期来源(weight本应≤0.05)在"归一化"之后
// 反而会分到接近100%的份额——试用期来源"最大影响锁在5%"这条安全设计,在aggregator失效时
// 反而完全失效,而且没有任何提示。
// 新实现改用"绝对配额":quota_i = maxNodes * weight_i,不跟其他来源的weight做归一化——
// 这样即使某个来源这一轮没有供给,试用期来源的配额依然锁定在它自己weight对应的绝对值附近,
// 不会"继承"别人的份额。只有当"各来源期望配额加起来超过池子容量"(供给充足的正常情况)时,
// 才按比例整体收缩——这跟归一化效果一致,但只在真正供给过剩时触发,不会被"某来源没供给"误触发。
function weightedSelect(buckets, maxNodes) {
  const usable = buckets.filter((b) => b.weight > 0 && b.nodes.length > 0);
  if (usable.length === 0) return [];

  const shuffled = usable.map((b) => ({
    ...b,
    nodes: [...b.nodes].sort(() => Math.random() - 0.5)
  }));

  const withRawQuota = shuffled.map((b) => ({
    ...b,
    rawQuota: maxNodes * b.weight
  }));

  const totalRawQuota = withRawQuota.reduce((sum, b) => sum + b.rawQuota, 0);
  const scale = totalRawQuota > maxNodes ? maxNodes / totalRawQuota : 1;

  const allocations = withRawQuota.map((b) => ({
    sourceId: b.sourceId,
    weight: b.weight,
    nodes: b.nodes,
    quota: Math.min(b.nodes.length, Math.floor(b.rawQuota * scale))
  }));

  let selected = [];
  for (const a of allocations) {
    selected = selected.concat(a.nodes.slice(0, a.quota));
  }

  // 补位:名额没填满时(通常是floor()取整损耗,或者高权重来源候选节点本身不够),
  // 按"权重从高到低"补——试用期来源权重天然≤0.05,补位时排在最后面,不会因为
  // "候选节点数量恰好多"就抢到本不该属于它的份额(这是复查发现的问题1的第二部分)。
  let remaining = maxNodes - selected.length;
  if (remaining > 0) {
    const sorted = [...allocations].sort((a, b) => b.weight - a.weight || b.nodes.length - a.nodes.length);
    for (const a of sorted) {
      if (remaining <= 0) break;
      const extra = a.nodes.slice(a.quota, a.quota + remaining);
      selected = selected.concat(extra);
      remaining -= extra.length;
    }
  }

  return selected.slice(0, maxNodes);
}

// 主入口：跑一次完整的流量池刷新（legacy aggregator + 批次三新增的多来源发现）。
async function doRefreshPool(config) {
  const poolConfig = (config && config.pool) || {};
  if (!poolConfig.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  // v21修复(真实bug):cleanupBlacklisted()/cleanupStaleTrials()/cleanupStaleTrusted()
  // 这三个滚动清理函数此前只挂在discovery-runner.js每周一次的GitHub扫描定时任务上——
  // 如果用户关闭了discovery功能(discoveryConfig.enabled=false)、只用手动订阅源
  // (manualSources)，这三个清理函数永远不会被调用，manual来源被拉黑之后连"30天后
  // 自动清理重来"这条路都没有。这里改成每轮流量池刷新都顺手清理一次(清理本身很轻量，
  // 只是遍历sources.json做时间判断，不会有实际性能影响)，不再依赖discovery是否开启。
  try {
    sourceTrust.cleanupBlacklisted();
    sourceTrust.cleanupStaleTrials();
    sourceTrust.cleanupStaleTrusted();
  } catch (err) {
    console.error('[pool] 来源记录清理失败(不影响本轮抓取):', err.message);
  }


  const checkerConfig = poolConfig.checker || {};
  const maxNodes = poolConfig.maxNodes || 50;
  const discoveryConfig = poolConfig.discovery || {};
  const weighting = poolConfig.sourceWeighting || {};
  const aggregatorWeight = weighting.aggregatorWeight != null ? weighting.aggregatorWeight : 1;

  const prev = readPool();
  const buckets = [];
  const sourceSummaries = [];
  let anyOk = false;
  let lastError = null;

  if (poolConfig.aggregatorDir) {
    const aggResult = await fetchFromAggregator(poolConfig, checkerConfig);
    sourceSummaries.push({
      sourceId: AGGREGATOR_SOURCE_ID, ok: aggResult.ok, error: aggResult.error || null,
      candidateCount: aggResult.candidateCount || 0, passed: aggResult.passedNodes.length
    });
    if (aggResult.ok) {
      // v21修复:此前这里只要 aggResult.ok(抓取脚本本身跑成功、解析出候选链接)就
      // 把 anyOk 设为true,即使这一轮实际0个节点通过三层检测(aggResult.passedNodes
      // 为空)。后果:进到 weightedSelect() 时这个桶因为nodes.length===0会被过滤掉，
      // 但anyOk已经是true了，最终走到"weighted selection picked none (all source
      // weights may be 0)"这条容易让人误以为是权重配置问题的错误提示——实际上根本
      // 原因是"这一轮所有来源都没有节点通过检测"，跟weightedSelect的权重逻辑关系不大，
      // 是被这里的anyOk误判成了不同的错误分支。改成只有真的有通过检测的节点时才算
      // anyOk，桶本身nodes为空时也不再放入buckets(反正weightedSelect也会把它过滤掉，
      // 不放入更清晰)。
      if (aggResult.passedNodes.length > 0) {
        anyOk = true;
        buckets.push({ sourceId: AGGREGATOR_SOURCE_ID, weight: aggregatorWeight, nodes: aggResult.passedNodes });
      }
    } else {
      lastError = aggResult.error;
    }
  }

  if (discoveryConfig.enabled) {
    let activeSources = [];
    try {
      const discovered = await discoveryRunner.getActiveSources(discoveryConfig);
      activeSources = discovered.sources || [];
    } catch (err) {
      lastError = lastError || `候选来源发现失败：${err.message}`;
    }

    const githubHeaders = repoFetch.buildHeaders(discoveryConfig.githubToken);

    // 复查发现问题4修复:来源数量会随每周扫描持续增长(discovery-runner.js每周新增
    // 一批候选),如果每轮刷新都要把全部活跃来源挨个抓一遍,耗时和GitHub API请求量
    // 会跟着无限膨胀——这正是文档7.3.6节提出过、但代码里一直没有兜底的资源风险。
    // 这里加一个"每轮最多处理多少个来源"的上限,按"最久没被真正抓取过的来源优先"
    // 排序(没有记录的新来源天然排最前面)——保证新来源、长期轮不上的来源最终
    // 都会被处理到,不会因为排序固定就让列表尾部的来源永远排不上队。
    // 本轮修复:此前这里读的是maxSourcesPerCycle，但config.example.json/write-config.js
    // 写的字段名是maxSourcesPerRun，两边对不上——用户改config.json里这个值一直不会生效，
    // 静默用回硬编码30。现在字段名对齐。
    const maxSourcesPerCycle = discoveryConfig.maxSourcesPerRun || 30;
    const eligible = activeSources.filter((src) => {
      const state = sourceTrust.getSourceState(src.repoFullName);
      return !(state && state.status === 'blacklisted'); // 已拉黑，不再浪费资源抓取
    });
    const sourcesThisCycle = eligible
      .map((src) => {
        const state = sourceTrust.getSourceState(src.repoFullName);
        const lastCheckedMs = state && state.lastUpdated ? new Date(state.lastUpdated).getTime() : 0;
        return { src, lastCheckedMs };
      })
      .sort((a, b) => a.lastCheckedMs - b.lastCheckedMs)
      .map((x) => x.src)
      .slice(0, maxSourcesPerCycle);
    const skippedCount = eligible.length - sourcesThisCycle.length;
    if (skippedCount > 0) {
      console.log(`[pool] 本轮活跃来源数(${eligible.length})超过maxSourcesPerCycle(${maxSourcesPerCycle})，跳过了${skippedCount}个（排在后面的下一轮会优先处理）`);
    }

    // 本轮修复:sourceThrottleMs此前只是write-config.js写进config.json的一个字段，
    // 全代码库没有任何地方真正读取使用，来源之间抓取完全没有节流。这里接上，
    // 第一个来源不用等，之后每个来源之间按配置的间隔睡一下，减轻对GitHub API的冲击。
    const sourceThrottleMs = discoveryConfig.sourceThrottleMs != null ? discoveryConfig.sourceThrottleMs : 500;
    let isFirstSource = true;
    for (const src of sourcesThisCycle) {
      if (!isFirstSource && sourceThrottleMs > 0) {
        await sleep(sourceThrottleMs);
      }
      isFirstSource = false;
      const result = await fetchFromDiscoveredSource(src, discoveryConfig, checkerConfig, githubHeaders);
      sourceSummaries.push({
        sourceId: result.sourceId, ok: !result.error, error: result.error || null,
        candidateCount: result.candidateCount || 0, passed: result.passedNodes.length,
        weight: result.weight, status: result.status
      });
      if (result.passedNodes.length > 0) {
        anyOk = true;
        buckets.push({ sourceId: result.sourceId, weight: result.weight || 0, nodes: result.passedNodes });
      }
    }
  }

  // 手动种子来源(2026-07-14新增):创始人自己挑的第三方订阅链接,跟GitHub发现来源
  // 用同一套节流/超时配置(discoveryConfig里的requestTimeoutMs/sourceThrottleMs),
  // 不单独开一份配置——没必要为了一个新增的小功能多加一层配置面。默认空数组，
  // 不影响没配置这个字段的现有部署。
  const manualSources = poolConfig.manualSources || [];
  // 本轮新增:汇总所有TG频道来源这一轮各自提取出的"原文原始节点链接",跨频道合并
  // 到一起,循环结束后统一去重+送检+记信任状态(见下方telegram-raw-pool处理块)。
  const collectedRawNodeLinks = [];
  if (manualSources.length > 0) {
    const manualThrottleMs = discoveryConfig.sourceThrottleMs != null ? discoveryConfig.sourceThrottleMs : 500;
    const manualTimeoutMs = discoveryConfig.requestTimeoutMs || 8000;
    let isFirstManual = true;
    for (const manualSource of manualSources) {
      if (!manualSource || !manualSource.id || !manualSource.url) continue; // 配置不完整就跳过这一条,不让整轮刷新失败
      if (!isFirstManual && manualThrottleMs > 0) {
        await sleep(manualThrottleMs);
      }
      isFirstManual = false;
      const result = await fetchFromManualSource(manualSource, checkerConfig, manualTimeoutMs);
      sourceSummaries.push({
        sourceId: result.sourceId, ok: !result.error, error: result.error || null,
        candidateCount: result.candidateCount || 0, passed: result.passedNodes.length,
        weight: result.weight, status: result.status
      });
      if (result.passedNodes.length > 0) {
        anyOk = true;
        buckets.push({ sourceId: result.sourceId, weight: result.weight || 0, nodes: result.passedNodes });
      }
      if (Array.isArray(result.rawNodeLinks) && result.rawNodeLinks.length > 0) {
        collectedRawNodeLinks.push(...result.rawNodeLinks);
      }
    }
  }

  // telegram-raw-pool:上面各TG频道原文贴出的原始节点,跨频道去重后统一送检,
  // 走标准的试用期/权重状态机(source-trust.js,不是fixed:true那种绿色通道)——
  // 权重完全由实测通过率决定,新池子从0开始慢慢爬升,不预设任何初始信任度，
  // 这里没有额外加一个"固定权重"配置项(founder没提出这个需求,不额外加面)。
  if (collectedRawNodeLinks.length > 0) {
    const rawPoolCandidateLimit = poolConfig.telegramRawPoolCandidateLimit || 50;
    const rawCandidates = dedupeCandidateLinks(collectedRawNodeLinks).slice(0, rawPoolCandidateLimit);
    if (rawCandidates.length > 0) {
      const concurrency = checkerConfig.concurrency || 3;
      const checkResults = await checkNodes(rawCandidates, checkerConfig, concurrency);
      console.log(`[pool] ${TELEGRAM_RAW_POOL_SOURCE_ID}: ${checkResults.filter((r) => r.outcome === 'ok').length}/${rawCandidates.length} 通过。失败层级分布: ${summarizeCheckFailures(checkResults)}`);
      await poolEvents.recordRound(TELEGRAM_RAW_POOL_SOURCE_ID, rawCandidates, checkResults);
      const now = new Date().toISOString();
      const passedLinks = [];
      const passedNodes = [];
      let measuredCount = 0;
      for (let i = 0; i < rawCandidates.length; i++) {
        const r = checkResults[i];
        if (r.outcome === 'ok' || r.outcome === 'down') measuredCount += 1;
        if (r.outcome === 'ok') {
          passedLinks.push(rawCandidates[i]);
          passedNodes.push({
            link: rawCandidates[i], addedAt: now,
            lastCheck: { outcome: r.outcome, checkedAt: now, layers: r.layers },
            sourceId: TELEGRAM_RAW_POOL_SOURCE_ID
          });
        }
      }
      // 这里的异常检测(同一身份多服务器)不做前面manual-tg-sub那样的特殊豁免——
      // 原始节点直接来自不同频道的原文粘贴,身份重合更可能是真的可疑信号(不像
      // 订阅服务那样有"多地区正常设计"这个已知的良性解释),按标准规则处理，
      // 该拉黑就拉黑。
      const anomalyDetected = detectAnomaly(passedLinks);
      const state = measuredCount > 0
        ? sourceTrust.recordCheckResult(TELEGRAM_RAW_POOL_SOURCE_ID, {
            totalChecked: measuredCount,
            passed: passedLinks.length,
            anomalyDetected
          })
        : sourceTrust.getSourceState(TELEGRAM_RAW_POOL_SOURCE_ID);
      const weight = state ? state.weight : 0;
      sourceSummaries.push({
        sourceId: TELEGRAM_RAW_POOL_SOURCE_ID, ok: true, error: null,
        candidateCount: rawCandidates.length, passed: passedNodes.length,
        weight, status: state ? state.status : 'unknown'
      });
      if (passedNodes.length > 0) {
        anyOk = true;
        buckets.push({ sourceId: TELEGRAM_RAW_POOL_SOURCE_ID, weight, nodes: passedNodes });
      }
    }
  }

  if (!anyOk) {
    const errMsg = lastError || 'None of the sources produced any nodes that passed checks this round (keeping the previous pool data)';
    // 复查发现问题8修复:sourceSummaries此前只是返回给调用方,从不落盘，面板API拿不到、
    // 只能靠手动登服务器看data/sources.json。现在把它一并写进pool.json，getPool()/
    // 面板/api/status就能把"每个来源这一轮的状态"展示给用户，不再是个黑盒。
    writePool({ ...prev, lastError: errMsg, sources: sourceSummaries });
    return { ok: false, error: errMsg, count: prev.nodes.length, sources: sourceSummaries };
  }

  const selected = weightedSelect(buckets, maxNodes);
  const now = new Date().toISOString();

  if (selected.length === 0) {
    const errMsg = 'Candidate nodes were fetched this round, but weighted selection picked none (all source weights may be 0; keeping the previous pool data)';
    writePool({ ...prev, lastError: errMsg, sources: sourceSummaries });
    return { ok: false, error: errMsg, count: prev.nodes.length, sources: sourceSummaries };
  }

  // 本轮新增(第五批·第一步):给最终入选的节点查国家码。特意放在"加权抽取之后"而不是
  // "候选节点阶段"——只需要给真正会展示给用户的这几十个节点查,不用给成百上千个候选节点
  // 都查一遍,省DNS解析和查询开销,也避免拖慢刷新流程。查询失败/查不出来的节点，
  // countryCode就是null，不影响节点本身是否进池子、是否可用。
  await attachCountryCodes(selected);
  // 顺手给每个来源摘要也标一个"代表国家"(取这个来源贡献的第一个入选节点的国家码)，
  // 星图/名册按来源展示时可以直接用，不用前端再去反查一遍。一个来源没有节点入选
  // (比如全部被淘汰、或者这一轮没有产出)时，sampleCountryCode就是null。
  for (const summary of sourceSummaries) {
    const firstNode = selected.find((n) => n.sourceId === summary.sourceId);
    summary.sampleCountryCode = firstNode ? firstNode.countryCode : null;
  }

  writePool({ updatedAt: now, count: selected.length, nodes: selected, lastError: null, sources: sourceSummaries });
  return { ok: true, count: selected.length, sources: sourceSummaries };
}

// v21新增(真实bug修复,对应创始人真机复现的情况):手动跑 collect.py 之后 wc -l
// 发现文件又变回0行——排查下来最可能的原因是"手动触发的抓取"和"nodenanny-pool
// 自己定时轮询触发的抓取"前后脚撞在了一起，两边同时在写同一份aggregator输出文件，
// 后写完的那次(这次很可能是自动定时那次，upstream暂时性失败产出为空)把先写完的
// 那次(手动跑出的11个真实节点)覆盖掉了。
// refreshPool() 会被两个完全独立的操作系统进程调用——nodenanny-pool(定时轮询)
// 和 nodenanny-panel(面板上手动点"立即刷新"按钮，见panel-server.js的
// /api/pool/refresh)。这两个是不同进程，没法用一个内存里的布尔变量互斥，
// 必须借助一份两边都能看到的文件来"占坑"。
// 做法:开始抓取前，检查 data/pool-refresh.lock 是否存在且足够新(在
// LOCK_STALE_MS 之内)——是的话说明另一边正在跑，直接跳过这一轮，不重复抓取、
// 不产生撞车；不是的话(没有锁文件，或者锁文件太旧，大概率是上次进程异常退出忘了
// 删)，正常抓取，抓取前落一个新锁，抓取结束(不管成功失败)在finally里删掉。
// LOCK_STALE_MS 设成比 aggregatorFetchTimeoutMs 默认值(45分钟)更宽松的60分钟，
// 避免一次正常但比较慢的抓取还没跑完，就被误判成"锁过期了、可以抢"。
const POOL_LOCK_FILE = path.join(DATA_DIR, 'pool-refresh.lock');
const POOL_LOCK_STALE_MS = 60 * 60 * 1000;

async function refreshPool(config) {
  const poolConfig = (config && config.pool) || {};
  if (!poolConfig.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  ensureDataDir();
  if (fs.existsSync(POOL_LOCK_FILE)) {
    try {
      const lock = JSON.parse(fs.readFileSync(POOL_LOCK_FILE, 'utf-8'));
      const age = Date.now() - (lock.startedAt || 0);
      if (age < POOL_LOCK_STALE_MS) {
        return { ok: false, skipped: true, reason: 'already_running', lockAgeMs: age };
      }
      // 锁文件太旧了，大概率是上次运行崩溃/被杀死没来得及清理，不再等它，直接抢占。
    } catch (err) {
      // 锁文件损坏/读不出来，当作没有锁处理，不阻塞正常抓取。
    }
  }

  fs.writeFileSync(POOL_LOCK_FILE, JSON.stringify({ startedAt: Date.now(), pid: process.pid }));
  try {
    return await doRefreshPool(config);
  } finally {
    try {
      fs.unlinkSync(POOL_LOCK_FILE);
    } catch (err) {
      // 文件可能已经不存在了，忽略
    }
  }
}

function getPool() {
  return readPool();
}

// 批次五·第二批新增(创始人明确要求):备用节点的名字不再沿用节点自己带的那个
// (免费节点的名字经常是发布者随便起的、甚至故意误导，比如自称"英国"实际IP在新加坡)，
// 统一改成"备用节点-协议名"这种直白格式，可信度判断交给面板上的来源/试用期展示，
// 不再指望订阅里的节点名称本身传达这些信息。
// 只做最基础的scheme识别，不追求覆盖所有冷门协议——识别不出来时给一个"未知协议"兜底，
// 不抛异常、不影响这条节点本身能不能用。
const PROTOCOL_DISPLAY_NAMES = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  ss: 'Shadowsocks',
  ssr: 'ShadowsocksR',
  hysteria2: 'Hysteria2',
  hy2: 'Hysteria2',
  tuic: 'TUIC',
  socks: 'SOCKS',
  http: 'HTTP',
  https: 'HTTPS'
};

function detectProtocolName(link, lang) {
  const match = /^([a-zA-Z0-9]+):\/\//.exec(link || '');
  const scheme = match ? match[1].toLowerCase() : '';
  if (PROTOCOL_DISPLAY_NAMES[scheme]) return PROTOCOL_DISPLAY_NAMES[scheme];
  if (scheme) return scheme.toUpperCase();
  return nodeLabelI18n.getProtocolUnknownText(lang);
}

// 批次五·第三批新增(创始人明确要求):把节点已有的countryCode（GeoIP查出来的两字母
// 国家码，比如"JP"，查不到时是null，见attachCountryCodes）转成国旗emoji，拼进备用
// 节点的名字里。用的是Unicode区域指示符号(Regional Indicator Symbol)这个标准做法——
// 两个大写字母各自加0x1F1A5的偏移量，拼成一对代理对字符，客户端（Shadowrocket/
// Clash/v2rayN等）普遍能正常显示，免费节点列表这个圈子里很常见的写法。
// countryCode格式不对（比如不是两位字母、是小写、是null/undefined）时返回空字符串，
// 不拼进名字里，不抛异常——查不到国家不影响这条节点能不能用。
function countryCodeToFlagEmoji(countryCode) {
  if (typeof countryCode !== 'string' || !/^[A-Z]{2}$/.test(countryCode)) return '';
  const codePoints = [...countryCode].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}


// 真实bug修复(排查"vmess老式格式节点改名不生效"发现的根因):下面buildPoolSubscription/
// buildMainNodeSubscription原来统一按"把名字拼进#片段"处理改名——这对vless/trojan/ss/
// hysteria2/tuic等协议是对的(客户端确实读URL的#片段当名字)，但老式vmess://base64(JSON)
// 格式根本没有#片段这一说，节点名字存在解码后JSON的ps字段里，客户端(v2rayN等)读的是ps，
// 不是#后面的内容。之前的代码往vmess链接末尾拼"#新名字"，v2rayN之类客户端完全不认，
// 显示的还是抓取来源自己起的原名——改名操作看起来跑了(代码不报错)，但对vmess节点
// 实际不生效，用户感知到的现象是"备用节点名字没变成NodeNanny那套标准命名"。
// 这里按协议分开处理：vmess解码JSON、改ps字段、重新编码；其它协议维持原来拼#片段的做法。
function applyNodeLabel(link, label) {
  if (/^vmess:\/\//i.test(link)) {
    try {
      const b64 = link.slice('vmess://'.length).split('#')[0];
      const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
      const jsonStr = Buffer.from(normalized, 'base64').toString('utf-8');
      const cfg = JSON.parse(jsonStr);
      cfg.ps = label;
      const newB64 = Buffer.from(JSON.stringify(cfg), 'utf-8').toString('base64');
      return `vmess://${newB64}`;
    } catch (err) {
      // 解码/解析失败(遇到不认识的变种格式)时退回旧的拼#做法，好过直接丢掉这条节点
      return `${link}#${encodeURIComponent(label)}`;
    }
  }
  const hashIdx = link.indexOf('#');
  const base = hashIdx >= 0 ? link.slice(0, hashIdx) : link;
  return `${base}#${encodeURIComponent(label)}`;
}

// lang: 用户部署时选择的界面语言（config.language，来自install.sh的NN_LANG），
// 决定备用节点标注文字用哪种语言，不是面板网页那套浏览器语言切换（见交接文档7.3.5节、
// node-label-i18n.js顶部注释）。不传时退回中文，兼容旧调用方式。
// 批次五·第二批改动(创始人明确要求)：不再沿用节点自带的原始名字、也不再按
// 长期/试用期来源区分文案(那部分改由面板的"当前接替的备用节点"这行展示，见
// getActiveNodesSummary)，统一简化成"备用节点-协议名"，同一批里出现多个节点时
// 加序号区分(比如"备用节点-VMess 1"、"备用节点-VMess 2")，避免客户端里出现
// 好几个完全同名的条目分不清谁是谁。
// 批次五·第三批改动(创始人明确要求)：备用节点名字在"备用节点-协议"后面再加国家
// (国旗emoji，查不到国家就不加这一段，不显示"未知"这种占位文字，见countryCodeToFlagEmoji)。
// 多个节点时序号照旧加在最后，不管有没有国家信息都加，避免"同协议同国家"这种边界情况
// 下序号被省略、导致客户端里出现完全同名条目分不清谁是谁。
function buildPoolSubscription(lang) {
  const pool = readPool();
  const backupWord = nodeLabelI18n.getBackupNodeWord(lang);
  const total = pool.nodes.length;
  const lines = pool.nodes.map((node, idx) => {
    const link = typeof node === 'string' ? node : node.link;
    const countryCode = typeof node === 'string' ? null : (node.countryCode || null);
    const hashIdx = link.indexOf('#');
    const base = hashIdx >= 0 ? link.slice(0, hashIdx) : link;
    const protocol = detectProtocolName(base, lang);
    const flag = countryCodeToFlagEmoji(countryCode);
    const namePart = flag ? `${backupWord}-${protocol}-${flag}` : `${backupWord}-${protocol}`;
    const label = total > 1 ? `${namePart} ${idx + 1}` : namePart;
    return applyNodeLabel(link, label);
  });
  return Buffer.from(lines.join('\n'), 'utf-8').toString('base64');
}

// 批次五·第一批新增(交接文档40.7/40.8节):给自建主节点的订阅链接加品牌标注。
// link: config.node.subscriptionUrl里存的那条裸链接（vless://xxx#标签 或者没有标签）。
// lang: 同buildPoolSubscription，跟随部署时选择的语言，不传时回退中文。
// 传入空字符串/undefined时直接返回空字符串，不拼任何东西，调用方按原有逻辑判断是否404。
// 批次五·第三批改动(创始人明确要求):不再"追加后缀"到原有标签上，改成不管链接自带
// 什么名字，一律整个替换成固定品牌文案(五语言，见node-label-i18n.js的mainNodeDefaultName)。
// 理由:免费/自建节点原来的名字是装机时Xray随手起的，价值不大，不如让客户端里看到的
// 名字直接、清楚地传达"这是NodeNanny的智能节点、带自愈功能"这个信息。
function buildMainNodeSubscription(link, lang) {
  if (!link) return '';
  const label = nodeLabelI18n.getMainNodeDefaultName(lang);
  const finalLink = applyNodeLabel(link, label);
  return Buffer.from(finalLink, 'utf-8').toString('base64');
}

// 批次五·第一批新增:给面板"当前是哪个/哪些备用节点接替了主节点"这行展示用的数据。
// 只在流量池被激活当前订阅内容时才有意义，但这里不判断activeSource（那是store.js管的
// 运行时状态，pool.js不掺和），单纯把"眼下pool.json里实际会被塞进订阅的这些节点"按
// 来源去重、标好等级和国家码，调用方（panel-server.js）自己决定activeSource是不是
// 'pool'、要不要展示这份数据——这样职责分明，不用重复实现一遍"是不是在用流量池"的判断。
function getActiveNodesSummary() {
  const pool = readPool();
  const seen = new Set();
  const result = [];
  for (const node of pool.nodes || []) {
    const sourceId = typeof node === 'string' ? AGGREGATOR_SOURCE_ID : (node.sourceId || AGGREGATOR_SOURCE_ID);
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const countryCode = typeof node === 'string' ? null : (node.countryCode || null);
    result.push({ sourceId, tier: resolveNodeTier(sourceId), countryCode });
  }
  return result;
}


// 之前在订阅文案里统一标成"应急-陌生服务器"；但"刚发现、还在试用期"的来源，
// 可信度还完全没有被source-trust.js的试用期机制测量验证过，跟"不能暗示这个节点
// 是安全的"这条底线(7.3.6节)不太对得上——这里单独区分出一个'trial'标注档位,
// 让用户至少能分辨"这是刚发现、还在观察期的陌生来源",而不是被笼统一句话带过。
function resolveNodeTier(sourceId) {
  if (!sourceId || sourceId === AGGREGATOR_SOURCE_ID) return 'default';
  const state = sourceTrust.getSourceState(sourceId);
  return state && state.status === 'trial' ? 'trial' : 'default';
}

// 复查时发现的遗漏(本轮修复,不是原方案设计):panel-server.js里问题8的修复调用了
// pool.getSourceTrustSummary(config)，但pool.js此前从未定义、也没导出过这个函数——
// 面板/api/status只要pool.enabled=true就会直接抛TypeError，是个会导致面板报错的真bug，
// 不是设计层面的问题。这里补上：直接读pool.json里已经落盘的sources字段(refreshPool
// 每次都会写入这份数据，详见上面的writePool调用)，不重新计算，是getPool()读的同一份数据。
// 保留config形参只是为了跟调用方的函数签名对齐，当前实现用不到它。
function getSourceTrustSummary() {
  const data = readPool();
  return data.sources || [];
}

// 星图第三步·后端数据接口(交接文档三十六.6/36.8节):把pool.json里落盘的
// sources摘要(getSourceTrustSummary读的同一份数据)整理成star-layout.js
// layoutStars()能直接吃的格式，算出坐标后原样返回给面板API。
//
// 状态映射说明(不是凭空定的,呼应现有代码里已经存在的判断逻辑):
// - legacy aggregator(sourceId===AGGREGATOR_SOURCE_ID)：一直被当作"长期来源"
//   看待——面板此前(三十二节真机验证)显示的"流量池节点来自:1个长期来源"
//   这句文案就是把它算作established，这里保持一致，不是本函数新发明的规则。
// - GitHub发现来源：source-trust.js的status是'trial'|'trusted'|'blacklisted'
//   三种(见core/source-trust.js第82行)，跟star-layout.js期待的'established'|
//   'trial'|'blacklisted'不完全对应，这里做一次映射：trusted→established，
//   其余原样传递。没有status字段的（比如旧数据、legacy来源本身的摘要项没有
//   这个字段）按trial处理，不擅自当作长期来源，避免夸大信任程度。
//
// canvasWidth/canvasHeight：不传时退回跟pool-starchart-v2.html demo一致的
// 420x320默认值，方便前端第一版直接照抄demo的画布尺寸而不用关心后端细节；
// 以后如果面板要做响应式、传不同尺寸进来，这里也支持。
//
// harborArea：主节点"港口"图标的固定位置，同样为了跟demo视觉一致，按demo里
// 硬编码的比例换算（demo:420x320画布下harborArea是{38,52,258,280}）。
function getStarmapData(canvasWidth, canvasHeight) {
  const width = canvasWidth || 420;
  const height = canvasHeight || 320;
  const harborArea = {
    xMin: width * (38 / 420),
    xMax: width * (52 / 420),
    yMin: height * (258 / 320),
    yMax: height * (280 / 320)
  };

  const summaries = getSourceTrustSummary();
  const metaBySourceId = {};

  const layoutInput = summaries
    .filter((s) => s && s.sourceId)
    .map((s) => {
      let status;
      if (s.sourceId === AGGREGATOR_SOURCE_ID) {
        status = 'established';
      } else if (s.status === 'trusted') {
        status = 'established';
      } else if (s.status === 'blacklisted') {
        status = 'blacklisted';
      } else {
        status = 'trial';
      }
      const weight = s.weight != null ? s.weight : (s.sourceId === AGGREGATOR_SOURCE_ID ? 1 : 0);
      metaBySourceId[s.sourceId] = {
        passed: s.passed || 0,
        candidateCount: s.candidateCount || 0,
        countryCode: s.sampleCountryCode || null,
        ok: s.ok !== false
      };
      return { sourceId: s.sourceId, status, weight };
    });

  const layout = starLayout.layoutStars(layoutInput, width, height, harborArea);

  // layoutStars()只返回坐标+status+weight(职责单一,不掺渲染用的元数据)，
  // 这里把国家码/通过率这些名册要用的信息按sourceId merge回去，前端不用
  // 再自己拼两份数据。
  const stars = layout.stars.map((star) => Object.assign({}, star, metaBySourceId[star.sourceId] || {}));

  const poolData = readPool();

  return {
    canvasWidth: width,
    canvasHeight: height,
    harborArea,
    stars,
    overflowCount: layout.overflowCount,
    blacklistOverflowCount: layout.blacklistOverflowCount,
    updatedAt: poolData.updatedAt || null
  };
}

module.exports = {
  refreshPool,
  getPool,
  buildPoolSubscription,
  buildMainNodeSubscription,
  getActiveNodesSummary,
  getSourceTrustSummary,
  getStarmapData,
  _internal: { weightedSelect, detectAnomaly, extractIdentity, resolveNodeTier, runShell, extractHostFromLink, attachCountryCodes, detectProtocolName, countryCodeToFlagEmoji, parseNodeLines, fetchFromManualSource, extractUrlDomain }
};
