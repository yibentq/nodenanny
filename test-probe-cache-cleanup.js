'use strict';

// 本轮修复验证:来源被 cleanupBlacklisted() 滚动清理之后,它在
// repo-fetch-probe-cache.json 里留下的探测缓存条目应该被联动清理掉,
// 不应该永远留着(三十四节记录的遗留小bug)。

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
// 本轮修复(自查发现的真实bug,同test-pool-e2e.js/test-zero-candidate-blacklist.js):
// 不再直接删除仓库真实data目录,改成备份/恢复,避免清空真实数据或留下测试残留。
const DATA_BACKUP_DIR = DATA_DIR + '.pretest-backup-' + process.pid;
let realDataWasBackedUp = false;
if (fs.existsSync(DATA_DIR)) {
  fs.renameSync(DATA_DIR, DATA_BACKUP_DIR);
  realDataWasBackedUp = true;
}
process.on('exit', () => {
  try {
    if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
    if (realDataWasBackedUp) fs.renameSync(DATA_BACKUP_DIR, DATA_DIR);
  } catch (restoreErr) {
    console.error('[test-probe-cache-cleanup] 恢复真实data目录时出错,请手动检查:', restoreErr.message);
  }
});
fs.mkdirSync(DATA_DIR, { recursive: true });

const sourceTrust = require('./core/source-trust');
const repoFetch = require('./core/repo-fetch');

const PROBE_CACHE_FILE = path.join(DATA_DIR, 'repo-fetch-probe-cache.json');

async function main() {
  // 1. 构造一个来源的探测缓存条目(模拟repo-fetch.js之前真的探测过这个来源)
  fs.writeFileSync(PROBE_CACHE_FILE, JSON.stringify({
    'orgY/repoY::sub': { exists: false, checkedAt: new Date().toISOString() },
    'orgY/repoY::clash.yaml': { exists: true, checkedAt: new Date().toISOString() },
    'orgKeep/repoKeep::sub': { exists: false, checkedAt: new Date().toISOString() }
  }, null, 2));

  // 2. 让 orgY/repoY 变成一个"很久以前就被拉黑"的来源,满足滚动清理的时间条件
  const BLACKLIST_CLEANUP_DAYS_GUESS = 30; // 只要明显早于清理周期即可,具体阈值以source-trust.js内部常量为准
  const longAgo = new Date(Date.now() - (BLACKLIST_CLEANUP_DAYS_GUESS + 5) * 24 * 60 * 60 * 1000).toISOString();
  sourceTrust.recordCheckResult('orgY/repoY', { totalChecked: 5, passed: 0 });
  // recordCheckResult本身不一定会直接把状态写成blacklisted且带旧时间戳,这里直接改写
  // sources.json,模拟"一个早就被拉黑的来源",避免这个测试依赖连续几轮才拉黑的具体规则细节。
  const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');
  const raw = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf-8'));
  raw.sources['orgY/repoY'].status = 'blacklisted';
  raw.sources['orgY/repoY'].blacklistedAt = longAgo;
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(raw, null, 2));

  // 3. 跑cleanupBlacklisted(),确认它把这个来源清理掉了,并且带回了removedSourceIds
  const { removed, removedSourceIds } = sourceTrust.cleanupBlacklisted();
  check('cleanupBlacklisted清理了1个过期拉黑来源', removed === 1);
  check('cleanupBlacklisted带回了对应的sourceId', Array.isArray(removedSourceIds) && removedSourceIds.includes('orgY/repoY'));

  // 4. 用这份sourceId列表去清理探测缓存,确认orgY/repoY的2条缓存被删掉,orgKeep/repoKeep的不受影响
  const { removed: cacheRemoved } = repoFetch.cleanupProbeCacheFor(removedSourceIds);
  check('联动清理删除了orgY/repoY的2条探测缓存', cacheRemoved === 2);

  const finalCache = JSON.parse(fs.readFileSync(PROBE_CACHE_FILE, 'utf-8'));
  check('orgY/repoY的缓存条目已经不在了', !finalCache['orgY/repoY::sub'] && !finalCache['orgY/repoY::clash.yaml']);
  check('没有被拉黑的来源(orgKeep/repoKeep)的缓存条目没有被误删', !!finalCache['orgKeep/repoKeep::sub']);

  // 5. 边界情况:传空数组/undefined不应该报错,也不应该删任何东西
  const emptyResult = repoFetch.cleanupProbeCacheFor([]);
  check('传空数组时不删除任何缓存', emptyResult.removed === 0);
  const undefinedResult = repoFetch.cleanupProbeCacheFor(undefined);
  check('传undefined时不报错、不删除任何缓存', undefinedResult.removed === 0);

  console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('测试执行出错:', err);
  process.exit(1);
});
