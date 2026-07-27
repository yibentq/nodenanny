'use strict';

// 极简的文件存储层。
//
// 为什么不用 SQLite：better-sqlite3 需要原生编译，在一些精简系统 /
// 网络受限的 VPS 上安装容易失败；对于"一个节点、一份状态、几百条事件"
// 这种数据量，JSON 文件完全够用，而且零依赖、零编译、随处能跑。
// 以后如果数据量变大，可以在不改动上层调用方式的前提下换成真正的数据库。

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const MAX_EVENTS = 200;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      state: {
        status: 'unknown', // 'ok' | 'down' | 'unknown'
        since: new Date().toISOString(),
        lastCheck: null,
        restartsToday: 0, // 重启尝试次数（不管成功与否都计数）
        restartsSuccessToday: 0, // 发现4修复：重启实际执行成功的次数，跟"尝试次数"分开统计，
        // 避免"今日自动重启 N 次"这个数字在重启命令本身无效时给人一种"系统在努力自愈"的误导印象
        restartsTodayDate: new Date().toISOString().slice(0, 10),
        lastNotifyAt: null,
        activeSource: 'self', // 'self' | 'pool' —— 当前对外提供的订阅走的是自建节点还是应急流量池
        consecutiveFailures: 0, // 连续检测失败次数，恢复后清零，用于触发AI诊断（避免单次抖动就调用API）
        lastDiagnosis: null, // { at, text, error } —— 最近一次AI诊断结果，覆盖式存储
        aiDiagnosedThisIncident: false // 本次故障期是否已经自动触发过一次AI诊断，恢复后清零
      },
      events: []
    };
    writeStore(initial);
  }
}

function readStore() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    // 文件损坏时不至于让整个监控进程崩溃，重建一份干净的
    console.error('[store] 数据文件解析失败，已重置：', err.message);
    const fresh = {
      state: {
        status: 'unknown',
        since: new Date().toISOString(),
        lastCheck: null,
        restartsToday: 0,
        restartsSuccessToday: 0,
        restartsTodayDate: new Date().toISOString().slice(0, 10),
        lastNotifyAt: null,
        activeSource: 'self',
        consecutiveFailures: 0,
        lastDiagnosis: null,
        aiDiagnosedThisIncident: false
      },
      events: []
    };
    writeStore(fresh);
    return fresh;
  }
}

function writeStore(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // 先写临时文件再原子替换，避免监控进程和面板进程同时读写时读到半截文件
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

function getState() {
  return readStore().state;
}

function getEvents(limit = 20) {
  const store = readStore();
  return store.events.slice(0, limit);
}

// 事件只存"类型 + 参数"，不存拼好的中文句子。
// 这样面板前端可以按用户选择的语言，把同一条事件渲染成中/英/日/德/俄文，
// 而不需要后端为每种语言各存一份文本。
function addEvent(type, params = {}) {
  const store = readStore();
  store.events.unshift({
    time: new Date().toISOString(),
    type, // 'down' | 'recovered' | 'restart' | 'restart_failed' | 'info'
    params
  });
  if (store.events.length > MAX_EVENTS) {
    store.events.length = MAX_EVENTS;
  }
  writeStore(store);
}

function updateState(patch) {
  const store = readStore();
  store.state = { ...store.state, ...patch };
  writeStore(store);
  return store.state;
}

// 连续失败计数：给AI诊断当触发条件用，只在"持续异常"而不是单次抖动时才值得调用AI。
// 老版本升级上来的 store.json 可能没有这个字段，用 || 0 兜底，不强制做数据迁移。
function bumpConsecutiveFailures() {
  const store = readStore();
  store.state.consecutiveFailures = (store.state.consecutiveFailures || 0) + 1;
  writeStore(store);
  return store.state.consecutiveFailures;
}

function resetConsecutiveFailures() {
  const store = readStore();
  store.state.consecutiveFailures = 0;
  store.state.aiDiagnosedThisIncident = false;
  writeStore(store);
}

// 老版本 store.json 缺 aiDiagnosedThisIncident 字段时用 !! 兜底成 false，不强制做数据迁移。
function hasAiDiagnosedThisIncident() {
  return !!readStore().state.aiDiagnosedThisIncident;
}

function markAiDiagnosedThisIncident() {
  const store = readStore();
  store.state.aiDiagnosedThisIncident = true;
  writeStore(store);
}

// 二层可用性检测的独立连续失败计数(v34本轮新增)。故意跟上面TCP层的
// consecutiveFailures分开存一个字段——两层检测各自独立判断"是不是持续异常"，
// 不共用同一个计数器，避免"TCP层刚恢复正常，二层的计数却被TCP层的reset清零"
// 这种互相干扰。check_error(检测手段本身有问题)既不算失败也不算恢复，故意
// 不在这两个函数里处理，调用方(checker.js)只在outcome是down或ok时才调用。
function bumpUsabilityConsecutiveDown() {
  const store = readStore();
  store.state.usabilityConsecutiveDown = (store.state.usabilityConsecutiveDown || 0) + 1;
  writeStore(store);
  return store.state.usabilityConsecutiveDown;
}

function resetUsabilityConsecutiveDown() {
  const store = readStore();
  store.state.usabilityConsecutiveDown = 0;
  store.state.usabilitySuggestedThisIncident = false;
  store.state.usabilityAutoRestartedThisIncident = false;
  writeStore(store);
}

function hasSuggestedUsabilityIncident() {
  return !!readStore().state.usabilitySuggestedThisIncident;
}

function markSuggestedUsabilityIncident() {
  const store = readStore();
  store.state.usabilitySuggestedThisIncident = true;
  writeStore(store);
}

// 二层检测触发的自动重启标记(founder拍板，v36新增，跟上面"仅建议"的标记是两条
// 独立的线——各自有自己的阈值、各自的"这次发作期只触发一次"标记，互不影响，
// 都在resetUsabilityConsecutiveDown()里一起清零。
function hasAutoRestartedUsabilityIncident() {
  return !!readStore().state.usabilityAutoRestartedThisIncident;
}

function markAutoRestartedUsabilityIncident() {
  const store = readStore();
  store.state.usabilityAutoRestartedThisIncident = true;
  writeStore(store);
}

function setLastDiagnosis(diagnosis) {
  const store = readStore();
  store.state.lastDiagnosis = diagnosis; // { at, text, error }
  writeStore(store);
}

function getLastDiagnosis() {
  return readStore().state.lastDiagnosis || null;
}

// 发现4修复：接收 success 参数，把"尝试次数"和"成功次数"分开计数，
// 面板前端才能如实展示"今日自动重启 N 次，其中成功 M 次"，而不是让用户误以为
// 每一次都真的把节点救回来了。老版本 store.json 可能没有 restartsSuccessToday 字段，用 || 0 兜底。
function bumpRestartCount(success) {
  const store = readStore();
  const today = new Date().toISOString().slice(0, 10);
  if (store.state.restartsTodayDate !== today) {
    store.state.restartsToday = 0;
    store.state.restartsSuccessToday = 0;
    store.state.restartsTodayDate = today;
  }
  store.state.restartsToday += 1;
  if (success) {
    store.state.restartsSuccessToday = (store.state.restartsSuccessToday || 0) + 1;
  }
  writeStore(store);
  return { attempts: store.state.restartsToday, success: store.state.restartsSuccessToday || 0 };
}

// 面板登录用的会话签名密钥。
// 不要求用户手动往 config.json 里加一段随机字符串——第一次用到时自动生成
// 并写进 data/store.json，之后重启进程还是同一把密钥，登录状态不会丢。
function getOrCreateSessionSecret() {
  const store = readStore();
  if (store.sessionSecret) return store.sessionSecret;
  const secret = require('crypto').randomBytes(32).toString('hex');
  store.sessionSecret = secret;
  writeStore(store);
  return secret;
}

// 面板订阅接口用的令牌（capability token）。
// 订阅链接要给客户端（Shadowrocket/Clash等）直接拉取，客户端没法走 Cookie 登录，
// 所以订阅地址本身要带一段不可猜测的随机串来防止被陌生人扫到；跟登录密码是两回事。
function getOrCreateSubToken() {
  const store = readStore();
  if (store.subToken) return store.subToken;
  const token = require('crypto').randomBytes(16).toString('hex');
  store.subToken = token;
  writeStore(store);
  return token;
}

// 终端模块（在线SSH/pty）专用的会话签名密钥，跟面板登录的 sessionSecret 是两把不同的钥匙。
// 设计意图（交接文档v4第二节第11条）：终端能执行shell命令，权限应该高于"看一眼面板数据"，
// 所以终端会话单独签名、单独校验、单独设置更短的有效期，不能因为面板登录着就自动获得终端权限。
function getOrCreateTerminalSecret() {
  const store = readStore();
  if (store.terminalSecret) return store.terminalSecret;
  const secret = require('crypto').randomBytes(32).toString('hex');
  store.terminalSecret = secret;
  writeStore(store);
  return secret;
}

module.exports = {
  getState,
  getEvents,
  addEvent,
  updateState,
  bumpRestartCount,
  bumpConsecutiveFailures,
  resetConsecutiveFailures,
  hasAiDiagnosedThisIncident,
  markAiDiagnosedThisIncident,
  bumpUsabilityConsecutiveDown,
  resetUsabilityConsecutiveDown,
  hasSuggestedUsabilityIncident,
  markSuggestedUsabilityIncident,
  hasAutoRestartedUsabilityIncident,
  markAutoRestartedUsabilityIncident,
  setLastDiagnosis,
  getLastDiagnosis,
  getOrCreateSessionSecret,
  getOrCreateSubToken,
  getOrCreateTerminalSecret
};
