'use strict';

// 流量池自愈生态·批次三:候选来源发现的定时缓存管理。
//
// 背景:source-discovery.js的discoverSources()本身不做任何持久化,每次调用都是
// 一次真实的GitHub API扫描。但18.1节已经拍板"候选来源扫描频率是每周一次",而
// refreshPool()现在(改造后)是按pool.refreshIntervalHours(默认6小时)的节奏跑的,
// 不能每次刷新流量池都触发一次GitHub扫描——那会在几小时内就把请求量堆起来,
// 跟"每周扫一次"的设计意图不符,也没必要(候选仓库列表不会小时级别变化)。
//
// 这个模块负责:维护一份本地缓存(data/discovered-sources.json),记录"上次扫描的
// 时间"和"上次扫描发现的来源列表"。refreshPool()每次要用来源列表时调用
// getActiveSources(config),由这个模块决定"要不要真的发起一次新的GitHub扫描,
// 还是直接把缓存吐回去"。
//
// 对外只暴露一个函数:getActiveSources(discoveryConfig) -> Promise<{ sources, scannedAt, fromCache }>

const fs = require('fs');
const path = require('path');
const { discoverSources, filterByProtocolTopic } = require('./source-discovery');
const sourceTrust = require('./source-trust');
const repoFetch = require('./repo-fetch');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'discovered-sources.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readCache() {
  ensureDataDir();
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch (err) {
    console.error('[discovery-runner] discovered-sources.json 解析失败,已忽略缓存:', err.message);
    return null;
  }
}

function writeCache(data) {
  ensureDataDir();
  const tmp = CACHE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CACHE_FILE);
}

// 主入口:按需(缓存不存在,或者已经超过scanIntervalHours)触发一次真实扫描,
// 否则直接返回上次缓存的结果。scanIntervalHours默认168小时(约一周),
// 跟18.1节拍板的"每周扫描一次"一致。
async function getActiveSources(discoveryConfig) {
  const cfg = discoveryConfig || {};
  if (!cfg.enabled) return { sources: [], scannedAt: null, fromCache: false, skipped: true };

  const intervalHours = cfg.scanIntervalHours || 168;
  const cache = readCache();
  const now = Date.now();
  const cacheAgeMs = cache && cache.scannedAt ? now - new Date(cache.scannedAt).getTime() : Infinity;

  if (cache && cacheAgeMs < intervalHours * 3600 * 1000) {
    return { sources: cache.sources || [], scannedAt: cache.scannedAt, fromCache: true, errors: cache.errors || [] };
  }

  // 缓存过期或不存在,发起一次真实扫描。扫描本身失败(比如网络问题、token失效)
  // 不应该让refreshPool()整体崩溃——如果有旧缓存,退回旧缓存并如实记录这次扫描失败;
  // 完全没有缓存(第一次跑)才返回空列表。
  try {
    const result = await discoverSources(cfg);
    // v21新增:过滤掉"只命中通用topic关键词、标签里却没有任何VPN协议特征"的来源
    // (比如网页HTTP代理IP列表项目)，见 source-discovery.js 里 filterByProtocolTopic
    // 的说明。只在真的发起新扫描时过滤一次，不影响直接吐缓存的分支。
    const { kept: filteredSources, filteredOut } = filterByProtocolTopic(result.found);
    if (filteredOut > 0) {
      console.log(`[discovery-runner] 按协议标签共现规则过滤掉了 ${filteredOut} 个疑似无关来源(仅命中通用关键词、标签里没有任何VPN协议特征)`);
    }
    writeCache({ sources: filteredSources, scannedAt: result.scannedAt, errors: result.errors });
    // 复查发现问题2修复:cleanupBlacklisted()此前写好了、测试也通过了,但没有任何地方
    // 真正调用它——创始人在20.1节明确确认过要做"拉黑超过一段时间自动清理",代码交付了
    // 却没接线,等于这条需求一直没生效。这个函数本身注释里也写好了"由每周跑一次来源
    // 发现的同一个定时任务顺手调一次即可",这里就是那个"顺手调一次"的地方——只在真的
    // 发起了一次新扫描时才清理(不是每次getActiveSources都清理),跟扫描本身同一个节奏。
    try {
      const { removed, removedSourceIds } = sourceTrust.cleanupBlacklisted();
      if (removed > 0) console.log(`[discovery-runner] 清理了 ${removed} 条超过滚动清理周期的拉黑来源记录`);
      // 本轮修复:被清理掉的来源,它当初探测过的文件名缓存(repo-fetch-probe-cache.json)
      // 此前会永远留着,没有对应的清理机制——量级很小,但既然 cleanupBlacklisted 现在
      // 会把 sourceId 列表带出来,顺手接上这个联动清理,让这份缓存也有始有终。
      if (removedSourceIds && removedSourceIds.length > 0) {
        try {
          const { removed: cacheRemoved } = repoFetch.cleanupProbeCacheFor(removedSourceIds);
          if (cacheRemoved > 0) console.log(`[discovery-runner] 联动清理了 ${cacheRemoved} 条已拉黑来源的探测缓存记录`);
        } catch (cacheCleanErr) {
          console.error('[discovery-runner] 探测缓存联动清理失败(不影响本次扫描结果):', cacheCleanErr.message);
        }
      }
    } catch (cleanupErr) {
      console.error('[discovery-runner] cleanupBlacklisted 执行失败(不影响本次扫描结果):', cleanupErr.message);
    }
    // 本轮新增:清理trial状态的孤儿记录(长期没被扫描到、既不会转正也不会被拉黑的来源)。
    // 同一个每周定时任务里顺手调用，跟cleanupBlacklisted是独立的两件事，互不影响彼此的结果。
    try {
      const { removed, removedSourceIds } = sourceTrust.cleanupStaleTrials();
      if (removed > 0) console.log(`[discovery-runner] 清理了 ${removed} 条长期未被扫描到的孤儿trial来源记录`);
      if (removedSourceIds && removedSourceIds.length > 0) {
        try {
          const { removed: cacheRemoved } = repoFetch.cleanupProbeCacheFor(removedSourceIds);
          if (cacheRemoved > 0) console.log(`[discovery-runner] 联动清理了 ${cacheRemoved} 条孤儿trial来源的探测缓存记录`);
        } catch (cacheCleanErr) {
          console.error('[discovery-runner] 探测缓存联动清理失败(不影响本次扫描结果):', cacheCleanErr.message);
        }
      }
    } catch (staleErr) {
      console.error('[discovery-runner] cleanupStaleTrials 执行失败(不影响本次扫描结果):', staleErr.message);
    }
    // 本轮新增:清理长期(180天)没被扫描到的trusted孤儿记录(创始人已拍板方向A)。
    // 同一个每周定时任务里顺手调用,跟前两个清理函数各自独立、互不影响彼此的结果。
    try {
      const { removed, removedSourceIds } = sourceTrust.cleanupStaleTrusted();
      if (removed > 0) console.log(`[discovery-runner] 清理了 ${removed} 条长期未被扫描到的孤儿trusted来源记录`);
      if (removedSourceIds && removedSourceIds.length > 0) {
        try {
          const { removed: cacheRemoved } = repoFetch.cleanupProbeCacheFor(removedSourceIds);
          if (cacheRemoved > 0) console.log(`[discovery-runner] 联动清理了 ${cacheRemoved} 条孤儿trusted来源的探测缓存记录`);
        } catch (cacheCleanErr) {
          console.error('[discovery-runner] 探测缓存联动清理失败(不影响本次扫描结果):', cacheCleanErr.message);
        }
      }
    } catch (staleTrustedErr) {
      console.error('[discovery-runner] cleanupStaleTrusted 执行失败(不影响本次扫描结果):', staleTrustedErr.message);
    }
    return { sources: filteredSources, scannedAt: result.scannedAt, fromCache: false, errors: result.errors };
  } catch (err) {
    if (cache) {
      return { sources: cache.sources || [], scannedAt: cache.scannedAt, fromCache: true, scanError: err.message };
    }
    return { sources: [], scannedAt: null, fromCache: false, scanError: err.message };
  }
}

module.exports = { getActiveSources };
