'use strict';

// 知识库管理模块（交接文档v4方案落地，骨架阶段）。
//
// 职责边界（只做这几件事，别的都不归这个文件管）：
// 1. 加载知识库数据（生效版 + 本地手改覆盖层），提供统一的读接口
// 2. 拿一行日志去匹配知识库条目，返回命中的修复建议
// 3. 对"拼出来的实际shell命令"做兜底风险分级，不管条目自己声明的riskLevel是什么
// 4. 防止同一条修复建议短时间内反复弹出（冷却）
//
// 明确不做的事：
// - 不负责从GitHub同步/校验/合并staging，那是 kb-sync.js 的事
// - 不负责真正执行命令，那是 terminal.js 的事
// - 不调用AI，那是 ai-provider.js 的事（AI生成的建议走另一条路径，不经过这个文件的
//   matchLine，而是ai-provider诊断失败时的兜底，或者未来单独的on-demand生成入口）

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KB_PATH = path.join(DATA_DIR, 'knowledge-base.json');
const KB_LOCAL_PATH = path.join(DATA_DIR, 'knowledge-base.local.json');

const RISK_LEVELS = ['low', 'medium', 'high'];
const SUPPORTED_LANGS = ['zh', 'en', 'ja', 'de', 'ru'];

// ---------- 1. 加载 ----------

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[kb-manager] 读取 ${filePath} 失败，按空数据处理：${err.message}`);
    return fallback;
  }
}

// 校验单条知识库条目的基本形状；不合法的条目在加载阶段直接剔除并打日志，
// 不能让一条格式错误的数据把整个知识库匹配流程搞崩。
//
// code重构第二批新增:一条条目现在可以用 codes(稳定英文标识符数组,精确匹配)
// 代替/补充 matchPatterns(正则猜中文原文)。两者至少要有一个非空——
// 老的纯matchPatterns条目(seed数据)完全不用改,继续按老路子走；新条目
// 如果来自usability-check.js/pool-checker.js这类已经带code的后端消息，
// 直接用codes匹配，不用再写正则、也不用管界面选的是哪种语言。
function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.id || typeof entry.id !== 'string') return false;
  const hasPatterns = Array.isArray(entry.matchPatterns) && entry.matchPatterns.length > 0;
  const hasCodes = Array.isArray(entry.codes) && entry.codes.length > 0;
  if (!hasPatterns && !hasCodes) return false;
  if (!Array.isArray(entry.fixCommands)) return false;
  if (!RISK_LEVELS.includes(entry.riskLevel)) return false;
  if (!entry.explanation || typeof entry.explanation !== 'object') return false;
  return true;
}

// 粗粒度的"看起来会不会灾难性回溯"启发式检测，只用于给未经人工验证的远程/AI生成条目
// 做第一道筛选（真正的运行时保护还是靠下面matchLine里的worker超时）。
// 典型危险结构：嵌套量词 (a+)+ / (a*)* ，以及量词后紧跟同样字符集的量词。
// 命中的话不是直接扔掉这条正则，而是标记为"仅在worker沙箱里跑"，宁可保守。
const SUSPICIOUS_REGEX_SHAPE = /(\([^()]*[+*][^()]*\))[+*]|(\[[^\]]+\][+*]){2,}/;

function looksSuspicious(patternSource) {
  return SUSPICIOUS_REGEX_SHAPE.test(patternSource);
}

function needsSandbox(entry) {
  // 未经人工确认的条目（远程同步/AI生成）一律进沙箱跑，不只看正则形状——
  // 这是"不信任来源"的保守策略，而不是"只信任看起来危险的正则"。
  if (entry.verified === false) return true;
  if (entry.source === 'remote-sync' || entry.source === 'ai-generated') return true;
  return (entry.matchPatterns || []).some((p) => looksSuspicious(p));
}

let cachedKb = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000; // 面板日志匹配频率不低，5秒内复用同一份已加载数据，避免每次都读盘+校验

function loadKnowledgeBase({ force = false } = {}) {
  if (!force && cachedKb && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedKb;
  }
  const base = readJsonSafe(KB_PATH, { entries: [] });
  const local = readJsonSafe(KB_LOCAL_PATH, { entries: [] });

  const byId = new Map();
  for (const entry of base.entries || []) {
    if (validateEntry(entry)) byId.set(entry.id, entry);
    else console.error(`[kb-manager] 忽略一条格式不合法的知识库条目（来自${KB_PATH}）: ${entry && entry.id}`);
  }
  // 本地覆盖层：同id直接覆盖（本地手改优先级最高），新id直接追加。
  // 这是v4文档第二节第3条约定的行为：远程同步不能静默覆盖本地手改，
  // 加载时local永远赢，真正的"远程有更新但和本地冲突"的提示逻辑在kb-sync.js里处理。
  for (const entry of local.entries || []) {
    if (validateEntry(entry)) byId.set(entry.id, Object.assign({}, entry, { source: entry.source || 'manual' }));
    else console.error(`[kb-manager] 忽略一条格式不合法的本地知识库条目: ${entry && entry.id}`);
  }

  cachedKb = { entries: Array.from(byId.values()) };
  cachedAt = Date.now();
  return cachedKb;
}

// code重构第二批新增:按code精确匹配用的索引,一个code理论上应该只对应一条条目，
// 但如果知识库数据不小心把同一个code写重了，这里保留成数组、全部返回，
// 不在加载阶段做去重决策(去重/覆盖策略留给内容维护者，代码层面不替他们做主)。
function buildCodeIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const code of entry.codes || []) {
      if (!index.has(code)) index.set(code, []);
      index.get(code).push(entry);
    }
  }
  return index;
}

// ---------- 2. 匹配 ----------

// worker沙箱：把"用一条正则测一行字符串"丢进独立线程跑，主线程设超时，
// 超时就terminate掉这个worker——这是目前Node生态里唯一能真正"打断"一段
// 正在执行的同步正则匹配的办法（不像setTimeout那样只是不去调度，同步代码
// 该卡还是会卡住事件循环；worker线程被terminate是操作系统级别终止）。
const WORKER_SCRIPT = `
const { parentPort, workerData } = require('worker_threads');
try {
  const re = new RegExp(workerData.pattern, workerData.flags || '');
  const matched = re.test(workerData.line);
  parentPort.postMessage({ ok: true, matched });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
`;

function testInSandbox(pattern, line, timeoutMs = 200) {
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    try {
      worker = new Worker(WORKER_SCRIPT, { eval: true, workerData: { pattern, line } });
    } catch (err) {
      resolve({ ok: false, error: err.message, matched: false });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      // 正则跑超时本身就是ReDoS嫌疑的信号，按"不匹配"处理但打日志，
      // 不能因为一条坏正则就让整个日志匹配流程卡死或抛出异常。
      resolve({ ok: false, error: 'sandbox_timeout', matched: false });
    }, timeoutMs);
    worker.once('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(msg);
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, matched: false });
    });
  });
}

// 短时冷却：同一条知识库条目（可选带上触发来源，比如node名）在冷却期内
// 不重复触发，防止"修复命令执行后自身产生的日志又把自己重新匹配出来"的死循环
// （v4文档第二节第4条最后一点）。冷却表存内存即可，重启面板清空没关系。
const recentlyTriggered = new Map(); // key -> expireAt
const DEFAULT_COOLDOWN_MS = 60 * 1000;

function isCoolingDown(key) {
  const expireAt = recentlyTriggered.get(key);
  if (!expireAt) return false;
  if (Date.now() > expireAt) {
    recentlyTriggered.delete(key);
    return false;
  }
  return true;
}

function markTriggered(key, cooldownMs = DEFAULT_COOLDOWN_MS) {
  recentlyTriggered.set(key, Date.now() + cooldownMs);
}

// 对外主入口：给一行日志文本，返回命中的知识库条目列表（已经过冷却过滤）。
// contextKey 可选，用来区分不同节点/不同来源的冷却计时（不传则全局共享冷却）。
async function matchLine(line, { contextKey = 'global' } = {}) {
  if (!line) return [];
  const kb = loadKnowledgeBase();
  const hits = [];

  for (const entry of kb.entries) {
    const cooldownKey = `${entry.id}:${contextKey}`;
    if (isCoolingDown(cooldownKey)) continue;

    let matched = false;
    for (const pattern of entry.matchPatterns) {
      if (needsSandbox(entry)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await testInSandbox(pattern, line);
        if (result.matched) {
          matched = true;
          break;
        }
      } else {
        try {
          if (new RegExp(pattern).test(line)) {
            matched = true;
            break;
          }
        } catch (err) {
          console.error(`[kb-manager] 知识库条目 ${entry.id} 的正则非法，已跳过：${err.message}`);
        }
      }
    }

    if (matched) {
      hits.push(entry);
      markTriggered(cooldownKey);
    }
  }

  return hits;
}

// code重构第二批新增:按code精确匹配的主入口。跟matchLine是两条平行的路径，
// 不是matchLine的特例——code匹配完全不用碰matchPatterns/正则/worker沙箱那一整套
// (那套东西存在的意义就是"猜不确定格式的文本"，code本身就是确定的标识符，
// 没有可猜的必要，也没有ReDoS风险，不需要沙箱保护)。
// contextKey/冷却机制跟matchLine保持一致，同一个code在冷却期内不会重复触发。
async function matchCode(code, { contextKey = 'global' } = {}) {
  if (!code) return [];
  const kb = loadKnowledgeBase();
  const codeIndex = buildCodeIndex(kb.entries);
  const candidates = codeIndex.get(code) || [];
  const hits = [];
  for (const entry of candidates) {
    const cooldownKey = `${entry.id}:${contextKey}`;
    if (isCoolingDown(cooldownKey)) continue;
    hits.push(entry);
    markTriggered(cooldownKey);
  }
  return hits;
}

// ---------- 3. 命令风险兜底分级 ----------

// 这些关键词不来自知识库数据，是硬编码在代码里的兜底规则——不管条目自己标的riskLevel
// 是什么，命令字符串命中这些模式一律强制升级为high（v4文档第二节"风险分级执行逻辑"约定的兜底）。
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*f/i, // rm -rf 及其参数顺序变体（-fr等）
  /\bkill\s+-9\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\./i,
  /\biptables\s+(-F|--flush)/i,
  />\s*\/etc\//, // 重定向覆盖 /etc/ 下的文件
  />\s*.*\.pem\b/i,
  />\s*.*\.key\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bshutdown\b|\breboot\b/i,
  /\bcurl.*\|\s*(sudo\s+)?(ba)?sh\b/i, // 管道到shell执行远程脚本
  /\bwget.*\|\s*(sudo\s+)?(ba)?sh\b/i
];

function classifyCommandRisk(command, declaredRiskLevel = 'low') {
  const base = RISK_LEVELS.includes(declaredRiskLevel) ? declaredRiskLevel : 'low';
  const forcedHigh = DANGEROUS_COMMAND_PATTERNS.some((re) => re.test(command || ''));
  if (forcedHigh) return 'high';
  return base;
}

module.exports = {
  RISK_LEVELS,
  SUPPORTED_LANGS,
  loadKnowledgeBase,
  validateEntry,
  matchLine,
  matchCode,
  classifyCommandRisk,
  // 导出方便写单元测试
  looksSuspicious,
  needsSandbox,
  testInSandbox
};
