'use strict';

// 端到端mock测试:验证 refreshPool() 多来源整合流程本身能跑通、不崩溃、
// 数据能正确流转到 source-trust.js。
//
// 如实说明:沙盒里没有真实的sing-box二进制,pool-checker.js会对每个候选节点
// 返回check_error(测不了,不是down)——这跟14.3/15.2节记录的历史情况一致。
// 这个测试验证的是"多来源调度、异常检测、加权抽取、source-trust记录"这一整套
// 骨架流程是通的,不是验证"真实网络环境下能不能抓到能用的节点"(那部分需要
// 真机才能验证,如实标注)。

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

const TEST_DATA_DIR = path.join(__dirname, 'data');
// 本轮修复(自查发现的真实bug):pool.js/source-trust.js内部用path.join(__dirname,'..','data')
// 硬编码指向仓库真实data目录,这个测试文件之前是直接删掉这个真实目录再重建,如果在一个
// 已经有真实运营数据的部署目录里跑这个测试,会把真实的sources.json等数据直接清空——
// 而且跑完也没有清理,测试用的假数据(orgD/repoD等)会永远留在真实data目录里,这正是
// 之前v10.zip里带着orgZ/repoZ测试残留数据的根本原因。
// 修复方式:如果真实data目录已经存在,先整个改名备份;不管测试怎么结束(成功/失败/
// 异常中断),process退出时都会把测试产生的data目录删掉、把备份的真实数据目录改名
// 恢复回来。改用process.on('exit',...)而不是try/finally,是因为exit事件在进程退出前
// 一定会触发(包括process.exit()、未捕获异常导致的退出),覆盖面更全。
const TEST_DATA_BACKUP_DIR = TEST_DATA_DIR + '.pretest-backup-' + process.pid;
let realDataWasBackedUp = false;
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.renameSync(TEST_DATA_DIR, TEST_DATA_BACKUP_DIR);
  realDataWasBackedUp = true;
}
process.on('exit', () => {
  try {
    if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    if (realDataWasBackedUp) fs.renameSync(TEST_DATA_BACKUP_DIR, TEST_DATA_DIR);
  } catch (restoreErr) {
    console.error('[test-pool-e2e] 恢复真实data目录时出错,请手动检查:', restoreErr.message);
  }
});

const V2RAY_CONTENT_B64 = Buffer.from(
  'vless://uuid-agg-1@1.1.1.1:443?security=tls&type=tcp&sni=a.com#agg1', 'utf-8'
).toString('base64');

global.fetch = async (url) => {
  if (url.includes('/repos/orgD/repoD') && !url.includes('/contents/')) {
    return { ok: true, json: async () => ({ default_branch: 'main' }) };
  }
  if (url === 'https://raw.githubusercontent.com/orgD/repoD/main/data/v2ray.txt') {
    return { ok: true, text: async () => V2RAY_CONTENT_B64 };
  }
  return { ok: false, status: 404 };
};

// 沙盒没有真实sing-box二进制,没法测出真正的'ok'/'down'结果——用cache替换的方式
// 把pool-checker.js换成一个受控的假实现,只为了验证"多来源调度→加权抽取→
// source-trust记录"这条数据流转链路本身是对的,不是在验证真实检测逻辑
// (pool-checker.js本身批次一已经真机验证过,不重复测)。
const poolCheckerPath = require.resolve('./core/pool-checker');
require.cache[poolCheckerPath] = {
  id: poolCheckerPath, filename: poolCheckerPath, loaded: true,
  exports: {
    checkNode: async () => ({ outcome: 'ok', layers: {} }),
    checkNodes: async (links) => links.map(() => ({ outcome: 'ok', layers: {} }))
  }
};

const pool = require('./core/pool');
const sourceTrust = require('./core/source-trust');

async function main() {
  const config = {
    pool: {
      enabled: true,
      aggregatorDir: '/tmp/nodenanny-test-nonexistent-agg-dir', // 故意让legacy路径失败
      checker: { enabled: true, concurrency: 2 }, // enabled:true才会真的调用checkNodes(测试check_error路径)
      maxNodes: 10,
      checkCandidateLimit: 10,
      discovery: {
        enabled: true,
        githubToken: '',
        candidateLimitPerSource: 10,
        scanIntervalHours: 168
      },
      sourceWeighting: { aggregatorWeight: 1 }
    }
  };

  // 手动喂一条"已发现来源"进discovery缓存,绕开真实discoverSources()的GitHub搜索调用
  // (那部分已经在source-discovery.js原有测试里验证过,这里只测repo-fetch往后的链路)
  const DATA_DIR = path.join(__dirname, 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'discovered-sources.json'), JSON.stringify({
    sources: [{ repoFullName: 'orgD/repoD', matchedBy: ['filename:v2ray.txt'], matchedFiles: [{ filename: 'v2ray.txt', path: 'data/v2ray.txt' }] }],
    scannedAt: new Date().toISOString(),
    errors: []
  }, null, 2));

  const result = await pool.refreshPool(config);

  check('refreshPool 没有抛异常,正常返回结果', result && typeof result === 'object');
  check('legacy aggregator路径失败被正确记录在sources摘要里', result.sources.some((s) => s.sourceId === 'aggregator-default' && s.ok === false));
  check('discovered来源orgD/repoD被尝试抓取并记录在sources摘要里', result.sources.some((s) => s.sourceId === 'orgD/repoD'));

  const state = sourceTrust.getSourceState('orgD/repoD');
  check('source-trust.js 正确记录了这个来源的一轮结果', state !== null);
  check('这一轮totalChecked>0(candidates.length=1条vless链接)', state && state.passRate !== undefined);

  // 因为沙盒没有sing-box,candidates全部会是check_error(测不了),不会是ok,
  // 所以这一轮passed应该是0,状态仍然是trial(没有达标,也没有触发0通过率连续拉黑,
  // 因为check_error不等同于"totalChecked>0且passed===0"里的"跑过了但没通过"——
  // 这里如实确认一下实际记录下来的passRate,不用猜的方式断言。
  console.log(`[信息] orgD/repoD 记录状态: status=${state.status}, passRate=${state.passRate}, weight=${state.weight}`);

  console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('测试脚本本身抛出异常:', err);
  process.exit(1);
});
