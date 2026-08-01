'use strict';

// 官方节点来源列表远程同步(v39新增)。
//
// 跟已有的 kb-sync.js / wiki-sync.js 走完全一样的三步流程:
//   1) checkForUpdate()  —— 只读,抓远程列表,跟本地 config.json 的 pool.manualSources 比对,
//                           把结果落地成一份 staging 文件,不改动 config.json。
//   2) diffStagingAgainstCurrent() —— 面板前端调这个拿完整diff展示给founder看,
//                           每次都用config.json的"当下最新状态"重新算一遍diff,
//                           不是简单读check()那一刻缓存的旧结果(万一founder
//                           在check之后、点确认之前手动改过config.json)。
//   3) applyStaging({acceptedIds}) —— 人工在面板上勾选接受哪些之后,才会真的
//                           改动config.json,这是本模块里唯一会写config.json的入口。
//
// 关键安全设计(2026-07-30测试时抓到的真实bug,这里是修复后的版本):
// 远程官方列表里的id,有可能刚好跟founder自己手动加的来源(比如wangcai)撞车。
// 早期实现是"id存在就当成更新,直接覆盖"——这样会把founder手动设的 fixed:true
// 标记冲掉,等于把一个免检测的可信源,变成要重新跑一遍试用期的普通源,
// 而且founder自己都不知道发生了这件事。
// 修复方式:本模块自己维护一份"managedIds"名单(data/source-list-sync-state.json),
// 只记录"历史上由本同步机制自己写进config.json的那些id"。
// 判定规则:远程某个id在config.json里已经存在,但不在managedIds名单里
// ——说明这是founder自己手动加的(不是我们写的),一律当冲突处理,
// 直接跳过、不合并、不覆盖,只在diff里报告"有冲突,你自己看着办",
// 绝不静默覆盖。只有"本地存在且id在managedIds名单里"的,才允许被当成
// "更新"去覆盖(因为那本来就是远程同步自己写进去的东西)。
//
// 依赖:复用已有的 core/repo-fetch.js 的 fetchText() 去抓远程内容,
// 不重新写一套HTTP抓取逻辑(项目里流量池抓源已经在用这一套,理由见
// core/pool.js 的 fetchFromManualSource 那部分注释)。远程内容约定是一个
// JSON数组,每条形如 { id, name, url, candidateLimit? } —— 特意不认远程内容里
// 任何自带的 "fixed" 字段:是否免检测是founder自己在本地做的信任判断,
// 不能由一份远程文件替founder决定,所以这里无论远程数据写没写fixed,
// 落地时一律强制不带fixed字段(等于false/走正常试用期)。
//
// 2026-07-30二次修订:拿到core/pool.js真实源码后确认,repoFetch.fetchText()真实
// 签名是 fetchText(url, timeoutMs) => Promise<{ok, status, text}>,不是本文件
// 最初假设的 fetchText(url) => Promise<string>。区别:
//   - 网络层失败(DNS/超时等)才会真的throw,需要catch
//   - HTTP非200不会throw,而是返回 {ok:false, status},需要显式检查
//   - 拿到的正文在 .text 字段里,不是直接返回值本身
// 下面checkForUpdate()已按这个真实签名改写,不再是猜测。

const fs = require('fs');
const path = require('path');

let repoFetch;
try {
  // 复用已有抓取模块;真实签名已用core/pool.js的调用方式核实过,见上方注释。
  repoFetch = require('./repo-fetch');
} catch (err) {
  repoFetch = null;
}

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');
const DATA_DIR = path.join(__dirname, '..', 'data');
const STAGING_PATH = path.join(DATA_DIR, 'source-list-sync-staging.json');
const STATE_PATH = path.join(DATA_DIR, 'source-list-sync-state.json');
const DEFAULT_REQUEST_TIMEOUT_MS = 8000; // 跟pool.js里manualSources抓取的默认超时对齐

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    // staging/state文件读坏了不应该拖垮整个面板,退回fallback,等下次check/apply自然重新生成。
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// 写config.json前先打一份时间戳备份,跟wangcai那次手动修复时用的做法一致,
// 防止apply逻辑本身有bug时founder没有退路。
function backupConfig() {
  const backupPath = `${CONFIG_PATH}.bak-${Date.now()}`;
  fs.copyFileSync(CONFIG_PATH, backupPath);
  return backupPath;
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadState() {
  return readJsonSafe(STATE_PATH, { managedIds: [], lastAppliedAt: null });
}

function saveState(state) {
  writeJsonSafe(STATE_PATH, state);
}

// 校验单条远程来源条目的基本字段,格式不对的直接丢弃(不让一条脏数据拖垮整批)。
function sanitizeRemoteEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!id || !url) return null;
  const entry = { id, name: name || id, url };
  if (Number.isFinite(Number(raw.candidateLimit))) {
    entry.candidateLimit = Number(raw.candidateLimit);
  }
  // 故意不拷贝raw.fixed —— 见文件头注释,是否免检测只能由founder在本地决定。
  return entry;
}

function entriesEqual(a, b) {
  return a.name === b.name && a.url === b.url && (a.candidateLimit || null) === (b.candidateLimit || null);
}

// 核心diff逻辑:给定"远程列表 + 本地pool.manualSources + managedIds名单",
// 算出四类结果。这个函数不读写任何文件,方便check和diff两处复用同一套判断,
// 避免"抓取时诊断一套逻辑、展示时又是另一套逻辑"这种两边不一致的bug。
function computeDiff(remoteEntries, localManualSources, managedIds) {
  const localById = new Map((localManualSources || []).map((e) => [e.id, e]));
  const managedSet = new Set(managedIds || []);

  const toAdd = [];
  const toUpdate = [];
  const conflicts = [];
  let unchangedCount = 0;

  for (const remote of remoteEntries) {
    const local = localById.get(remote.id);
    if (!local) {
      toAdd.push(remote);
      continue;
    }
    if (!managedSet.has(remote.id)) {
      // 本地有这个id,但不是我们自己同步写进去的 —— 极可能是founder手动加的(比如wangcai),
      // 一律当冲突,不碰。
      conflicts.push({ id: remote.id, localName: local.name, remoteName: remote.name });
      continue;
    }
    // 本地有、且是我们自己管的id —— 允许被当成"更新"来比较。
    if (entriesEqual(local, remote)) {
      unchangedCount += 1;
    } else {
      toUpdate.push({ id: remote.id, before: local, after: remote });
    }
  }

  return { toAdd, toUpdate, conflicts, unchangedCount };
}

// 步骤1:抓远程列表,算diff,落地staging。只读,不改config.json。
async function checkForUpdate(sourceListSyncConfig) {
  const rawUrl = sourceListSyncConfig && sourceListSyncConfig.rawUrl;
  if (!rawUrl) {
    return { ok: false, error: 'source_list_sync_not_configured' };
  }
  if (!repoFetch || typeof repoFetch.fetchText !== 'function') {
    return { ok: false, error: 'repo_fetch_unavailable' };
  }

  const timeoutMs = (sourceListSyncConfig && sourceListSyncConfig.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;

  let fetchResult;
  try {
    // 2026-07-30修正:真实签名是 fetchText(url, timeoutMs),网络层失败(DNS/超时)才会
    // throw,这里的catch对应这一种情况——跟core/pool.js的fetchFromManualSource用法一致。
    fetchResult = await repoFetch.fetchText(rawUrl, timeoutMs);
  } catch (err) {
    return { ok: false, error: `fetch_failed: ${err.message}` };
  }
  // 2026-07-30修正:HTTP非200不会throw,而是返回{ok:false,status},必须显式检查,
  // 之前的版本完全没做这一步,遇到404/500会把错误页面内容当成正文往下传给JSON.parse。
  if (!fetchResult || fetchResult.ok !== true) {
    const status = fetchResult ? fetchResult.status : 'unknown';
    return { ok: false, error: `fetch_failed: HTTP status ${status}` };
  }

  const text = fetchResult.text;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: 'remote_content_not_json' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'remote_content_not_array' };
  }

  const remoteEntries = parsed.map(sanitizeRemoteEntry).filter(Boolean);

  const config = readConfig();
  const localManualSources = (config.pool && config.pool.manualSources) || [];
  const state = loadState();

  const diff = computeDiff(remoteEntries, localManualSources, state.managedIds);
  const checkedAt = new Date().toISOString();

  writeJsonSafe(STAGING_PATH, { checkedAt, rawUrl, remoteEntries });

  return {
    ok: true,
    hasUpdate: diff.toAdd.length > 0 || diff.toUpdate.length > 0,
    // 2026-08-01修复:之前这里没有sourceCount字段,导致面板"已是最新"分支显示
    // "当前共有 undefined 个候选来源"。这里等于远程列表的条目总数——四个diff分类
    // (toAdd/toUpdate/conflicts/unchangedCount)加起来正好是exhaustive partition,
    // 覆盖了remoteEntries里的每一条,不用另外单独存一份remoteEntries.length。
    sourceCount: diff.toAdd.length + diff.toUpdate.length + diff.conflicts.length + diff.unchangedCount,
    addedCount: diff.toAdd.length,
    updatedCount: diff.toUpdate.length,
    conflictCount: diff.conflicts.length,
    unchangedCount: diff.unchangedCount,
    checkedAt
  };
}

// 步骤2:面板展示diff详情时调用 —— 每次都用config.json此刻的真实内容重新算,
// 不信任check()那一刻的旧diff(万一founder在这期间自己手动改过config.json)。
function diffStagingAgainstCurrent() {
  const staging = readJsonSafe(STAGING_PATH, null);
  if (!staging || !Array.isArray(staging.remoteEntries)) {
    return { ok: false, error: 'no_staging' };
  }

  const config = readConfig();
  const localManualSources = (config.pool && config.pool.manualSources) || [];
  const state = loadState();

  const diff = computeDiff(staging.remoteEntries, localManualSources, state.managedIds);

  return {
    ok: true,
    checkedAt: staging.checkedAt,
    toAdd: diff.toAdd,
    toUpdate: diff.toUpdate,
    conflicts: diff.conflicts,
    unchangedCount: diff.unchangedCount
  };
}

// 步骤3:人工确认后真正落地 —— 唯一会写config.json的入口。
// acceptedIds 只应该包含toAdd/toUpdate里的id;conflicts里的id即使意外传进来,
// 这里也会重新判一遍冲突规则再次拦下,不因为前端传参失误就误伤founder的手动源。
function applyStaging({ acceptedIds } = {}) {
  const staging = readJsonSafe(STAGING_PATH, null);
  if (!staging || !Array.isArray(staging.remoteEntries)) {
    return { ok: false, error: 'no_staging' };
  }

  const config = readConfig();
  if (!config.pool) config.pool = {};
  if (!Array.isArray(config.pool.manualSources)) config.pool.manualSources = [];

  const state = loadState();
  const diff = computeDiff(staging.remoteEntries, config.pool.manualSources, state.managedIds);

  const accepted = new Set(Array.isArray(acceptedIds) ? acceptedIds : []);
  const conflictIds = new Set(diff.conflicts.map((c) => c.id));

  let appliedCount = 0;
  const newManagedIds = new Set(state.managedIds || []);

  // 新增
  for (const entry of diff.toAdd) {
    if (!accepted.has(entry.id) || conflictIds.has(entry.id)) continue;
    config.pool.manualSources.push({ id: entry.id, name: entry.name, url: entry.url, ...(entry.candidateLimit ? { candidateLimit: entry.candidateLimit } : {}) });
    newManagedIds.add(entry.id);
    appliedCount += 1;
  }

  // 更新(只针对本来就是我们管的id,conflicts里的id在computeDiff阶段已经不会出现在toUpdate里,
  // 这里的conflictIds二次检查纯粹是防御性的,防止未来computeDiff改动引入回归)。
  for (const change of diff.toUpdate) {
    if (!accepted.has(change.id) || conflictIds.has(change.id)) continue;
    const idx = config.pool.manualSources.findIndex((e) => e.id === change.id);
    if (idx === -1) continue;
    config.pool.manualSources[idx] = {
      id: change.after.id,
      name: change.after.name,
      url: change.after.url,
      ...(change.after.candidateLimit ? { candidateLimit: change.after.candidateLimit } : {})
    };
    newManagedIds.add(change.id);
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    return { ok: true, appliedCount: 0, skippedConflictCount: diff.conflicts.length };
  }

  backupConfig();
  writeConfig(config);

  saveState({ managedIds: Array.from(newManagedIds), lastAppliedAt: new Date().toISOString() });

  return { ok: true, appliedCount, skippedConflictCount: diff.conflicts.length };
}

module.exports = {
  checkForUpdate,
  diffStagingAgainstCurrent,
  applyStaging
};
