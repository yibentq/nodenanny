'use strict';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
// 本轮修复(自查发现的真实bug,同test-pool-e2e.js):不再直接删除仓库真实data目录,
// 改成备份/恢复,避免在真实部署目录里跑测试时清空真实数据、或者留下orgZ/repoZ这类
// 测试假数据残留(v10.zip里发现的那份残留数据就是这个脚本跑完没清理产生的)。
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
    console.error('[test-zero-candidate-blacklist] 恢复真实data目录时出错,请手动检查:', restoreErr.message);
  }
});

// 模拟一个topic命中、但仓库根目录下什么候选文件都探测不到的来源:
// resolveDefaultBranch返回ok,之后所有contents探测/raw抓取一律404。
global.fetch = async (url) => {
  if (url.includes('/repos/orgZ/repoZ') && !url.includes('/contents/')) {
    return { ok: true, json: async () => ({ default_branch: 'main' }) };
  }
  return { ok: false, status: 404 };
};

const pool = require('./core/pool');
const sourceTrust = require('./core/source-trust');
const { fetchFromDiscoveredSource } = pool._internal.__proto__ ? {} : {}; // 不存在,走下面的公开路径测

async function main() {
  const sourceRecord = { repoFullName: 'orgZ/repoZ', matchedBy: ['topic:v2ray-node'], matchedFiles: [] };
  const discoveryConfig = { candidateLimitPerSource: 10 };
  const checkerConfig = { enabled: true, concurrency: 2 };
  const repoFetch = require('./core/repo-fetch');
  const headers = repoFetch.buildHeaders('');

  // 直接调用pool.js里没有导出的fetchFromDiscoveredSource不方便,改成通过repoFetch确认
  // 这个来源确实会抓到0条候选(验证前提),然后手动模拟pool.js里"0候选记1:0"这条逻辑
  // 对source-trust.js连续调用2次,确认第2次之后状态变成blacklisted。
  const fetchResult = await repoFetch.fetchCandidatesForSource(sourceRecord, discoveryConfig, headers);
  check('前提:这个来源真的抓不到任何候选链接', fetchResult.links.length === 0);

  sourceTrust.recordCheckResult('orgZ/repoZ', { totalChecked: 1, passed: 0 });
  let state = sourceTrust.getSourceState('orgZ/repoZ');
  check('第1轮后仍是trial状态(还没到连续4轮的阈值,v21已放宽)', state.status === 'trial');

  sourceTrust.recordCheckResult('orgZ/repoZ', { totalChecked: 1, passed: 0 });
  state = sourceTrust.getSourceState('orgZ/repoZ');
  check('第2轮后仍是trial状态(v21:阈值从2轮放宽到4轮)', state.status === 'trial');

  sourceTrust.recordCheckResult('orgZ/repoZ', { totalChecked: 1, passed: 0 });
  state = sourceTrust.getSourceState('orgZ/repoZ');
  check('第3轮后仍是trial状态(还差1轮)', state.status === 'trial');

  sourceTrust.recordCheckResult('orgZ/repoZ', { totalChecked: 1, passed: 0 });
  state = sourceTrust.getSourceState('orgZ/repoZ');
  check('第4轮后被正确拉黑(修复前:totalChecked记0会导致永远不触发这条路径)', state.status === 'blacklisted');
  check('拉黑后权重归零', state.weight === 0);

  console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('测试脚本本身抛出异常:', err);
  process.exit(1);
});
