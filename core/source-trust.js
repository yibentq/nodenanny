'use strict';

// 候选来源信任度状态机(流量池自愈生态·批次二第二步)。
//
// 定位:source-discovery.js 只负责"发现"(存在、活跃),这个模块负责"测量可信度"。
// 核心洞察(见交接文档7.3.4节):可信度不该被"判断",应该被"测量"——不管一个来源
// 背后是谁、动机是什么,都可靠地测量"这个来源产出的节点,拿去做真实测试,通过率是多少"。
//
// 对外只暴露三个函数(严格按18.6节契约):
//   recordCheckResult(sourceId, { totalChecked, passed, anomalyDetected }) -> 记录一轮结果并更新状态机
//   getSourceState(sourceId) -> { status, weight, consecutivePeriods, passRate, addedAt }
//   getAllSourceWeights() -> { sourceId: weight, ... }  留给批次三的加权抽取用
//
// 数据存储:data/sources.json,跟 pool.json 分开存(职责分开,18.6节已定)。

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');

// ============ 以下四个参数,创始人本轮已当面确认(见交接文档18.7+18.8.6节) ============
const TRIAL_PASS_RATE_THRESHOLD = 0.70; // trial期"持续达标"的通过率阈值(创始人确认:70%)
const TRIAL_PERIODS_TO_PROMOTE = 7; // trial期需要连续达标多少轮才转正(此前已确认:7轮≈42小时)
const TRUSTED_DOWNGRADE_PERIODS = 7; // trusted状态连续多少轮跌破阈值就降级(创始人确认:跟trial期一样,7轮)
const TRIAL_WEIGHT_CAP = 0.05; // trial期权重上限5%
// 权重浮动方式(创始人确认:0%~5%区间,按实测通过率线性浮动,不是固定死5%)
const HISTORY_KEEP_PERIODS = 10; // sources.json 滚动清理:每个来源history只保留最近10轮(创始人确认要做)
const BLACKLIST_CLEANUP_DAYS = 15; // 拉黑超过多少天自动从文件里清理掉这条记录（创始人反馈30天太久，改成15天，只改这一个常量，STALE_TRIAL_CLEANUP_DAYS的30天不动）
// 本轮新增(v30续篇二.2节,创始人确认要做):trial状态的"孤儿记录"清理——一个来源如果
// 曾经被扫描到过、但后来连续多周都没有再出现在GitHub扫描结果里(比如仓库改名/下线/
// 不再匹配查询词),它既不会被拉黑也不会转正，会永远以一条trial记录留在sources.json里，
// 没有任何清理路径。这里跟拉黑清理用同一套"多少天没更新就清"的思路，天数最初是照抄
// BLACKLIST_CLEANUP_DAYS定的（当时两者都是30）。本轮创始人把BLACKLIST_CLEANUP_DAYS
// 单独改成了15天，这个常量没有一起改，两者现在是独立的、不再相等——如果觉得trial
// 孤儿记录清理也该缩短，需要单独调整这个常量，不会跟着BLACKLIST_CLEANUP_DAYS联动。
const STALE_TRIAL_CLEANUP_DAYS = 30;
// 本轮新增(v30续篇·清理方案讨论,创始人已拍板选方向A):trusted来源目前完全没有任何
// 自动清理机制(代码里此前是刻意设计成"trusted永不自动清理",怕误删还在正常工作、
// 只是暂时没被扫到的来源)。创始人确认要加一层"多少天没被recordCheckResult更新过
// 就清理"的兜底,天数比trial期宽松很多(trusted代表已经证明过可靠,应该更宽容,
// 不能跟trial期的30天用同一个标准),创始人当面确认用180天。
const STALE_TRUSTED_CLEANUP_DAYS = 180;
// ============ 以上四个是本轮拍板的参数,以下是没有单独问、由AI按18.5节"初始参数可自主判断"精神做的实现细节 ============
// (如实说明:下面这两个不在18.7/18.8.6明确列出的必须确认清单里,是AI在实现层面做的选择,
//  不是创始人拍板的产品决策。如果跟创始人预期不符,后续可以调整,不影响其他部分。)
// v21修复(对应创始人反馈"旺财固定节点池被拉黑后,即使换了检测目标也永远测不出"):
// 1) CONSECUTIVE_ZERO_TO_BLACKLIST 从2放宽到4——2轮对一个全新来源(没有任何历史战绩
//    可以触发"战绩保护")来说太敏感,前面alive探测目标写死Google的bug就是活生生的例子:
//    旺财池子第一次被检测,直接就撞上0/16,2轮内就被判永久拉黑,根本没机会积累到
//    MIN_CHECKS_FOR_TRACK_RECORD要求的8次检测量去触发保护。放宽到4轮,给新来源更多
//    喘息空间,同时也不是没有下限——真的完全不可用的来源，4轮0通过率一样会被拉黑。
// 2) MIN_TRACK_RECORD_PASS_RATE从30%降到20%——创始人本轮明确要求"降低检测标准，
//    能用就行"，这个数字本身就是"战绩及格线"，降低门槛让更多有一定历史战绩的来源
//    获得保护，不被短期波动误杀。
const CONSECUTIVE_ZERO_TO_BLACKLIST = 4; // trial期连续几轮通过率为0(且totalChecked>0)直接拉黑,不等满7轮
const TRUSTED_DOWNGRADE_RATE_THRESHOLD = TRIAL_PASS_RATE_THRESHOLD; // trusted降级用的"跌破阈值"沿用跟trial一样的70%,没有单独问过创始人这一项
// 2026-07-15新增(创始人反馈"手动验证过能用的固定节点池被拉黑"问题,真机复查后确认):
// 上面CONSECUTIVE_ZERO_TO_BLACKLIST=2这条规则完全不看这个来源在此之前的战绩——
// 哪怕之前16次检测过了8次,只要最近连续2轮撞上坏运气(比如三层检测里刁钻的
// 真实性验证目标,详见pool-checker.js的修复说明),照样直接判永久拉黑,没有申诉机制。
// 这里加一道保护:判断"连续2轮0通过率"要不要直接拉黑之前,先看这个来源在这2轮
// 之前积累的战绩够不够硬——总检测量达到MIN_CHECKS_FOR_TRACK_RECORD、且通过率
// 不低于MIN_TRACK_RECORD_PASS_RATE,就认为"证明过自己"，不该被最近的坏运气一票
// 判死刑，先按"这轮没达标"处理（不拉黑，但也不算达标，达标连续计数照样清零），
// 留着继续观察。全新来源/从没证明过自己的来源不受这条保护，行为跟以前完全一样。
const MIN_CHECKS_FOR_TRACK_RECORD = 8; // 至少要有这么多次真实检测量,才谈得上"有战绩"
const MIN_TRACK_RECORD_PASS_RATE = 0.2; // 战绩及格线:20%(v21从30%降低),给了保护但没打算给"几乎没用"的来源开绿灯

// v21新增(真实bug修复,不是新功能——对应"拉黑之后代码里根本没有复活路径"这个死结):
// 已拉黑的来源此前是永久状态,除非手动删 sources.json 里的记录。但代码里其实已经有
// 一套"拉黑超过30天自动清理"的机制(cleanupBlacklisted),问题是它只挂在
// discovery-runner.js 每周一次的GitHub扫描定时任务上调用——如果用户没开GitHub发现
// 功能(discovery.enabled=false)、只用手动订阅源，这个清理函数从来不会被调用，
// 手动来源被拉黑之后连"30天后自动清理重来"这条路都没有,彻底死路一条。
// 这里加两层修复:
//   a) REVIVAL_PERIODS_TO_UNBLACKLIST:已拉黑的来源如果连续若干轮真实通过率又达标了
//      (说明当初判死可能是环境/检测目标一次性的问题，不是节点本身真的不行——这次
//      alive探测目标从Google换成Cloudflare之后就是这种情况)，直接复活成trial状态
//      重新计权重，不用等30天、也不用手动改JSON。所有来源类型都适用这条(discovered
//      来源理论上因为已拉黑后不再被重新抓取而不会触发到这条,但manual来源会持续
//      被抓取，这条就是专门为它设计的)。
//   b) refreshPool()里会在每轮刷新时顺手调用cleanupBlacklisted，不再只依赖每周
//      的discovery定时任务，即使关掉discovery功能，manual来源的拉黑记录也能到期
//      自动清理(见pool.js对应修复)。
const REVIVAL_PERIODS_TO_UNBLACKLIST = 2; // 已拉黑来源连续几轮达标通过率(70%)就复活成trial

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDataDir();
  if (!fs.existsSync(SOURCES_FILE)) {
    return { sources: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.sources) return { sources: {} };
    return parsed;
  } catch (err) {
    console.error('[source-trust] sources.json 解析失败,已重置为空:', err.message);
    return { sources: {} };
  }
}

function writeAll(data) {
  ensureDataDir();
  const tmp = SOURCES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, SOURCES_FILE);
}

function nowIso() {
  return new Date().toISOString();
}

function clamp01(n) {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// 新来源第一次出现时的初始记录。
function createInitialRecord(sourceId) {
  return {
    sourceId,
    status: 'trial', // 'trial' | 'trusted' | 'blacklisted'
    consecutivePeriods: 0, // trial: 连续达标轮数;trusted: 连续跌破阈值轮数(复用同一字段,含义随status切换)
    consecutiveZeroPeriods: 0, // trial期连续0通过率轮数,用于提前拉黑判断
    recoveryStreak: 0, // v21新增:已拉黑状态下连续达标轮数,用于判断能否复活(见REVIVAL_PERIODS_TO_UNBLACKLIST)
    history: [], // [{ periodAt, totalChecked, passed, passRate, anomalyDetected }]
    weight: 0,
    addedAt: nowIso(),
    lastUpdated: nowIso(),
    blacklistedAt: null
  };
}

// 按最近的history算一个"当前测量通过率"(取最近几轮的均值,比单轮更稳,避免一次抖动就大幅调权重)。
function computeRecentPassRate(record) {
  if (!record.history.length) return 0;
  const recent = record.history.slice(0, Math.min(record.history.length, TRIAL_PERIODS_TO_PROMOTE));
  const totalChecked = recent.reduce((sum, h) => sum + h.totalChecked, 0);
  const totalPassed = recent.reduce((sum, h) => sum + h.passed, 0);
  if (totalChecked === 0) return 0;
  return totalPassed / totalChecked;
}

function trimHistory(record) {
  if (record.history.length > HISTORY_KEEP_PERIODS) {
    record.history.length = HISTORY_KEEP_PERIODS;
  }
}

// 记录一轮检测结果,并推进状态机。
// totalChecked: 这一轮该来源产出、送去做三层检测的候选节点数
// passed: 这些节点里三层全部通过的数量
// anomalyDetected: 可选,调用方(比如未来做UUID重复检测的地方)发现"一眼假"信号时传true,
//                  不管当前处于trial还是trusted,直接拉黑(18.6节:trial期这条规则明确写了,
//                  trusted期文档没写死"异常信号"是否也适用,这里按更安全的方向统一处理,
//                  如实标注这是AI补的一条,不是原文逐字要求)
function recordCheckResult(sourceId, { totalChecked, passed, anomalyDetected = false } = {}) {
  if (!sourceId) throw new Error('recordCheckResult 需要 sourceId');
  const safeTotalChecked = Number.isFinite(totalChecked) ? Math.max(0, totalChecked) : 0;
  const safePassed = Number.isFinite(passed) ? Math.max(0, Math.min(passed, safeTotalChecked)) : 0;
  const passRate = safeTotalChecked > 0 ? safePassed / safeTotalChecked : 0;

  const all = readAll();
  let record = all.sources[sourceId];
  if (!record) {
    record = createInitialRecord(sourceId);
    all.sources[sourceId] = record;
  }

  // 新的一轮结果,先入史册(不管后面状态机怎么走,原始记录都要留痕)。
  record.history.unshift({
    periodAt: nowIso(),
    totalChecked: safeTotalChecked,
    passed: safePassed,
    passRate,
    anomalyDetected: Boolean(anomalyDetected)
  });
  trimHistory(record);
  record.lastUpdated = nowIso();

  // 异常信号:不管当前什么状态,直接拉黑,不需要等满周期数。
  if (anomalyDetected) {
    record.status = 'blacklisted';
    record.blacklistedAt = record.blacklistedAt || nowIso();
    record.weight = 0;
    record.consecutivePeriods = 0;
    record.consecutiveZeroPeriods = 0;
    writeAll(all);
    return getSourceState(sourceId);
  }

  if (record.status === 'trial') {
    if (safeTotalChecked > 0 && safePassed === 0) {
      record.consecutiveZeroPeriods += 1;
    } else {
      record.consecutiveZeroPeriods = 0;
    }

    // 战绩保护:history[0]是刚才unshift进去的这一轮,排除掉它,只看这一轮之前
    // 积累下来的战绩够不够硬。
    const priorHistory = record.history.slice(1);
    const priorTotalChecked = priorHistory.reduce((sum, h) => sum + h.totalChecked, 0);
    const priorPassed = priorHistory.reduce((sum, h) => sum + h.passed, 0);
    const priorPassRate = priorTotalChecked > 0 ? priorPassed / priorTotalChecked : 0;
    const hasProvenTrackRecord =
      priorTotalChecked >= MIN_CHECKS_FOR_TRACK_RECORD && priorPassRate >= MIN_TRACK_RECORD_PASS_RATE;

    if (record.consecutiveZeroPeriods >= CONSECUTIVE_ZERO_TO_BLACKLIST && !hasProvenTrackRecord) {
      record.status = 'blacklisted';
      record.blacklistedAt = nowIso();
      record.weight = 0;
      record.consecutivePeriods = 0;
    } else if (passRate >= TRIAL_PASS_RATE_THRESHOLD) {
      record.consecutivePeriods += 1;
      // trial权重:0~5%区间,按最近测量通过率线性浮动(创始人确认的方式),不是等转正才给权重。
      const recentRate = computeRecentPassRate(record);
      record.weight = clamp01(recentRate) * TRIAL_WEIGHT_CAP;

      if (record.consecutivePeriods >= TRIAL_PERIODS_TO_PROMOTE) {
        // 转正:trial期的"连续达标轮数"计数器切换含义,用于trusted期的降级判断,这里清零重新起算。
        record.status = 'trusted';
        record.consecutivePeriods = 0;
        const recentRateOnPromote = computeRecentPassRate(record);
        record.weight = clamp01(recentRateOnPromote); // 转正后不再受5%上限限制,权重直接按实测通过率给
      }
    } else {
      // 这一轮没达标但也不是连续0,不算失败也不算成功,达标连续计数中断重来。
      record.consecutivePeriods = 0;
      const recentRate = computeRecentPassRate(record);
      record.weight = clamp01(recentRate) * TRIAL_WEIGHT_CAP;
    }
  } else if (record.status === 'trusted') {
    const recentRate = computeRecentPassRate(record);
    record.weight = clamp01(recentRate);

    if (passRate < TRUSTED_DOWNGRADE_RATE_THRESHOLD) {
      record.consecutivePeriods += 1;
      if (record.consecutivePeriods >= TRUSTED_DOWNGRADE_PERIODS) {
        // 降级回trial,不是直接拉黑(拉黑只留给"异常信号"或者trial期连续0的情况)。
        record.status = 'trial';
        record.consecutivePeriods = 0;
        record.consecutiveZeroPeriods = 0;
        record.weight = clamp01(recentRate) * TRIAL_WEIGHT_CAP;
      }
    } else {
      // 达标一轮,降级计数器清零重新起算(要连续跌破才会累计降级)。
      record.consecutivePeriods = 0;
    }
  } else if (record.status === 'blacklisted') {
    // v21新增:复活机制(修复"拉黑=永久死路,连30天自动清理都没接上"的问题,见上面
    // REVIVAL_PERIODS_TO_UNBLACKLIST处的说明)。已拉黑的来源如果继续被抓取/检测
    // (目前只有manual来源会这样,discovered来源拉黑后直接不再抓取,不会走到这里)，
    // 连续REVIVAL_PERIODS_TO_UNBLACKLIST轮真实通过率达到TRIAL_PASS_RATE_THRESHOLD，
    // 说明当初判死很可能是检测环境本身的问题(比如探测目标不合适)，不是节点/来源真的
    // 不行——直接复活成trial状态重新计权重，不用等30天清理、也不用手动删JSON。
    if (passRate >= TRIAL_PASS_RATE_THRESHOLD) {
      record.recoveryStreak = (record.recoveryStreak || 0) + 1;
      if (record.recoveryStreak >= REVIVAL_PERIODS_TO_UNBLACKLIST) {
        record.status = 'trial';
        record.blacklistedAt = null;
        record.consecutivePeriods = 0;
        record.consecutiveZeroPeriods = 0;
        record.recoveryStreak = 0;
        const recentRate = computeRecentPassRate(record);
        record.weight = clamp01(recentRate) * TRIAL_WEIGHT_CAP;
      }
    } else {
      record.recoveryStreak = 0;
    }
  }

  writeAll(all);
  return getSourceState(sourceId);
}

function getSourceState(sourceId) {
  const all = readAll();
  const record = all.sources[sourceId];
  if (!record) return null;
  return {
    sourceId: record.sourceId,
    status: record.status,
    weight: record.weight,
    consecutivePeriods: record.consecutivePeriods,
    passRate: computeRecentPassRate(record),
    addedAt: record.addedAt,
    // 复查发现问题4新增:pool.js做"每轮最多处理N个来源、按最久没抓过的优先"这个
    // 轮转排序时需要知道"这个来源上次真的被记录过一轮是什么时候"，之前契约里没有
    // 暴露这个字段——这是新增字段，不影响任何已有调用方（多读一个字段不会破坏什么）。
    lastUpdated: record.lastUpdated
  };
}

function getAllSourceWeights() {
  const all = readAll();
  const result = {};
  for (const [sourceId, record] of Object.entries(all.sources)) {
    result[sourceId] = record.status === 'blacklisted' ? 0 : record.weight;
  }
  return result;
}

// 清理:拉黑超过 BLACKLIST_CLEANUP_DAYS 天的来源记录直接从文件里删掉(创始人确认要做的滚动清理)。
// 不在每次recordCheckResult时都跑一遍(没必要那么频繁),暴露成独立函数,由调用方(比如每周跑一次
// 来源发现的同一个定时任务)顺手调一次即可。
function cleanupBlacklisted() {
  const all = readAll();
  const cutoff = Date.now() - BLACKLIST_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  // 本轮修复:此前这里只返回一个数量(removed),调用方没办法知道具体是哪些
  // sourceId 被清理掉了——导致 repo-fetch.js 那边"这个来源当初探测过的缓存记录"
  // 没有对应的联动清理入口。现在把被删除的 sourceId 列表也带出去,调用方可以拿这份
  // 列表去清理其他跟这个 sourceId 相关、但生命周期本该跟着 sources.json 走的数据。
  const removedSourceIds = [];
  for (const [sourceId, record] of Object.entries(all.sources)) {
    if (record.status === 'blacklisted' && record.blacklistedAt) {
      const blacklistedAtMs = new Date(record.blacklistedAt).getTime();
      if (blacklistedAtMs < cutoff) {
        delete all.sources[sourceId];
        removed += 1;
        removedSourceIds.push(sourceId);
      }
    }
  }
  if (removed > 0) writeAll(all);
  return { removed, removedSourceIds };
}

// 清理:trial状态且连续STALE_TRIAL_CLEANUP_DAYS天没有被recordCheckResult更新过的"孤儿记录"
// 直接删除(本轮新增,创始人确认要做)。只清理trial状态——trusted来源理论上会持续出现在
// 每周扫描结果里、持续被记录,如果trusted来源也很久没更新，大概率是别的问题(比如整个
// discovery功能挂了),不应该被这个函数悄悄清掉，所以特意只限定trial状态，范围收窄一些更安全。
// blacklisted已经有独立的cleanupBlacklisted处理，不重复。
// 跟cleanupBlacklisted一样，不在每次recordCheckResult时都跑，暴露成独立函数，由调用方
// (discovery-runner.js里每周跑一次来源发现的同一个定时任务)顺手调一次即可。
function cleanupStaleTrials() {
  const all = readAll();
  const cutoff = Date.now() - STALE_TRIAL_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  const removedSourceIds = [];
  for (const [sourceId, record] of Object.entries(all.sources)) {
    if (record.status === 'trial' && record.lastUpdated) {
      const lastUpdatedMs = new Date(record.lastUpdated).getTime();
      if (lastUpdatedMs < cutoff) {
        delete all.sources[sourceId];
        removed += 1;
        removedSourceIds.push(sourceId);
      }
    }
  }
  if (removed > 0) writeAll(all);
  return { removed, removedSourceIds };
}

// 清理:trusted状态且连续STALE_TRUSTED_CLEANUP_DAYS天没有被recordCheckResult更新过的
// 记录直接删除(本轮新增,创始人已拍板方向A)。只清理trusted状态——trial的孤儿记录归
// cleanupStaleTrials管,blacklisted归cleanupBlacklisted管,三个函数各管各的状态,互不重叠。
// 180天是特意比trial期的30天宽松很多的阈值:trusted来源已经证明过可靠(转正需要连续7轮
// 达标),不应该因为短暂几周没被扫到就被当成失效清掉;但如果连续半年都没有再出现在
// 每周GitHub扫描结果里(仓库改名/下线/不再匹配查询词),继续占着这条记录也没有意义,
// 这正是v30续篇里提到的"trusted名单会一年年攒下去,没有任何机制让它变小"这个隐患的兜底。
// 同样不在每次recordCheckResult时都跑,暴露成独立函数,由discovery-runner.js每周一次的
// 定时任务顺手调用。
function cleanupStaleTrusted() {
  const all = readAll();
  const cutoff = Date.now() - STALE_TRUSTED_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  const removedSourceIds = [];
  for (const [sourceId, record] of Object.entries(all.sources)) {
    if (record.status === 'trusted' && record.lastUpdated) {
      const lastUpdatedMs = new Date(record.lastUpdated).getTime();
      if (lastUpdatedMs < cutoff) {
        delete all.sources[sourceId];
        removed += 1;
        removedSourceIds.push(sourceId);
      }
    }
  }
  if (removed > 0) writeAll(all);
  return { removed, removedSourceIds };
}

module.exports = {
  recordCheckResult,
  getSourceState,
  getAllSourceWeights,
  cleanupBlacklisted,
  cleanupStaleTrials,
  cleanupStaleTrusted
};
