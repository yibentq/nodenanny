'use strict';

// 2026-07-14新增:验证"手动种子来源"(创始人自己挑的第三方订阅链接,比如"旺财"这类)
// 能正确接入 refreshPool() 的多来源调度、并且跟GitHub发现来源共用同一套试用期/
// 信任状态机(不是像legacy aggregator那样直接判永久信任)。
//
// 同样用process.on('exit')做真实data目录的备份/恢复保护，写法照抄test-pool-e2e.js
// 已经验证过是正确的那一套，不重新发明。

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

const TEST_DATA_DIR = path.join(__dirname, 'data');
const TEST_DATA_BACKUP_DIR = TEST_DATA_DIR + '.manualsrc-pretest-backup-' + process.pid;
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
    console.error('[test-manual-source] 恢复真实data目录时出错,请手动检查:', restoreErr.message);
  }
});

const MANUAL_SUB_CONTENT_B64 = Buffer.from(
  'vless://uuid-manual-1@2.2.2.2:443?security=tls&type=tcp&sni=b.com#manual1', 'utf-8'
).toString('base64');

global.fetch = async (url) => {
  if (url === 'https://example.com/manual-sub-test') {
    return { ok: true, status: 200, text: async () => MANUAL_SUB_CONTENT_B64 };
  }
  if (url === 'https://example.com/manual-sub-broken') {
    return { ok: false, status: 500, text: async () => '' };
  }
  if (url === 'https://example.com/manual-sub-empty') {
    return { ok: true, status: 200, text: async () => '' };
  }
  return { ok: false, status: 404, text: async () => '' };
};

// 沙盒没有真实sing-box，用受控假实现替换pool-checker.js，只验证数据流转，
// 不重复验证真实检测逻辑(那部分批次一已经真机验证过)。
const poolCheckerPath = require.resolve('./core/pool-checker');
require.cache[poolCheckerPath] = {
  id: poolCheckerPath, filename: poolCheckerPath, loaded: true,
  exports: {
    checkNode: async () => ({ outcome: 'ok', layers: {} }),
    checkNodes: async (links) => links.map(() => ({ outcome: 'ok', layers: {} })),
    _internal: { classifyProbeError: () => 'check_error' }
  }
};

const pool = require('./core/pool');
const sourceTrust = require('./core/source-trust');

async function main() {
  const baseConfig = {
    pool: {
      enabled: true,
      aggregatorDir: '/tmp/nodenanny-test-nonexistent-agg-dir', // 故意让legacy路径失败,只看manualSources
      checker: { enabled: true, concurrency: 2 },
      maxNodes: 10,
      checkCandidateLimit: 10,
      discovery: { enabled: false }, // 关掉GitHub发现,只测manualSources这条独立路径
      sourceWeighting: { aggregatorWeight: 1 },
      manualSources: [
        { id: 'wangcai-test', name: '测试用旺财', url: 'https://example.com/manual-sub-test' }
      ]
    }
  };

  const DATA_DIR = path.join(__dirname, 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const result = await pool.refreshPool(baseConfig);

  check('refreshPool 没有抛异常,正常返回结果', result && typeof result === 'object');
  check('手动来源用manual:前缀的sourceId,不跟GitHub格式(owner/repo)冲突',
    result.sources.some((s) => s.sourceId === 'manual:wangcai-test'));
  check('手动来源这一轮抓到并测出1个通过的节点',
    result.sources.some((s) => s.sourceId === 'manual:wangcai-test' && s.passed === 1));
  check('refreshPool最终结果里count>0(手动来源的节点真的进了池子)', result.ok === true && result.count > 0);

  const state = sourceTrust.getSourceState('manual:wangcai-test');
  check('source-trust.js 正确记录了这个手动来源的状态', state !== null);
  check('手动来源第一轮默认是trial状态(不是像legacy aggregator那样直接永久信任)',
    state && state.status === 'trial');
  check('trial状态的权重被锁在低上限内(不是1.0那种跟legacy aggregator同等的权重)',
    state && state.weight < 0.1);

  // 验证resolveNodeTier/getStarmapData不会把手动来源误判成跟legacy aggregator一样的
  // "default"长期来源——这是本次改动最容易出错的地方，因为最初legacy aggregator是
  // 用sourceId特判的，如果代码里哪里漏改，手动来源可能被错误当成永久信任处理。
  const internal = pool._internal;
  check('resolveNodeTier(manual来源) 正确识别为trial,不是default(这是防止误判永久信任的关键断言)',
    internal.resolveNodeTier('manual:wangcai-test') === 'trial');

  const starmap = pool.getStarmapData(420, 320);
  const manualStar = starmap.stars.find((s) => s.sourceId === 'manual:wangcai-test');
  check('星图数据里手动来源被正确标记成trial(试用期)状态', manualStar && manualStar.status === 'trial');

  console.log(`[信息] manual:wangcai-test 记录状态: status=${state.status}, passRate=${state.passRate}, weight=${state.weight}`);

  // 第二轮:测试配置不完整(缺url)和请求失败两种情况不会让整轮刷新崩溃
  fs.writeFileSync(path.join(DATA_DIR, 'pool.json'), JSON.stringify({ updatedAt: null, count: 0, nodes: [], lastError: null, sources: [] }));
  const brokenConfig = JSON.parse(JSON.stringify(baseConfig));
  brokenConfig.pool.manualSources = [
    { id: 'no-url-test' }, // 缺url,应该被跳过,不报错
    { id: 'broken-test', name: '会挂的订阅', url: 'https://example.com/manual-sub-broken' },
    { id: 'empty-test', name: '空订阅', url: 'https://example.com/manual-sub-empty' }
  ];
  let secondRunThrew = false;
  let secondResult;
  try {
    secondResult = await pool.refreshPool(brokenConfig);
  } catch (err) {
    secondRunThrew = true;
    console.error('第二轮refreshPool不应该抛异常:', err);
  }
  check('配置不完整(缺url)/请求失败/空订阅这几种情况都不会让refreshPool抛异常', !secondRunThrew);
  check('缺url的来源被跳过,没有出现在sources摘要里',
    secondResult && !secondResult.sources.some((s) => s.sourceId === 'manual:no-url-test'));
  check('请求失败(HTTP 500)的来源被正确记成error而不是崩溃',
    secondResult && secondResult.sources.some((s) => s.sourceId === 'manual:broken-test' && s.error));
  check('空订阅(候选0条)的来源被正确记录,candidateCount为0',
    secondResult && secondResult.sources.some((s) => s.sourceId === 'manual:empty-test' && s.candidateCount === 0));

  // 2026-08-03新增:复现并锁定本次修复——频道这一轮解析不到今天的订阅链接时,
  // 不应该借用"manual:<频道id>"这个旧命名空间下可能存在的历史拉黑记录来报状态。
  // 先手工在sources.json里种一条"manual:tg-resolve-fail-test"的已拉黑记录，模拟
  // "域名信任隔离上线前遗留下来的旧记录"，再验证:即使这条旧记录是blacklisted，
  // 频道本轮解析失败时返回的status也不应该是'blacklisted'，而应该是中性的
  // 'no_link_this_round'，weight锁定为0，且不去读那条旧记录。
  sourceTrust.recordCheckResult('manual:tg-resolve-fail-test', { totalChecked: 1, passed: 0 });
  sourceTrust.recordCheckResult('manual:tg-resolve-fail-test', { totalChecked: 1, passed: 0 });
  sourceTrust.recordCheckResult('manual:tg-resolve-fail-test', { totalChecked: 1, passed: 0 });
  sourceTrust.recordCheckResult('manual:tg-resolve-fail-test', { totalChecked: 1, passed: 0 });
  const staleState = sourceTrust.getSourceState('manual:tg-resolve-fail-test');
  check('测试前置条件:手工种的旧记录确实已经是blacklisted状态(模拟历史遗留)',
    staleState && staleState.status === 'blacklisted');

  const telegramFetchPath = require.resolve('./core/telegram-fetch');
  require.cache[telegramFetchPath] = {
    id: telegramFetchPath, filename: telegramFetchPath, loaded: true,
    exports: {
      isTelegramChannelUrl: () => true,
      normalizeToPreviewUrl: (u) => u,
      fetchLatestFileUrl: async () => ({ ok: false, error: '模拟:今天频道里没有找到带链接的消息' }),
      extractRawNodeLinks: () => []
    }
  };
  delete require.cache[require.resolve('./core/pool')];
  const poolReloaded = require('./core/pool');
  const tgFailResult = await poolReloaded._internal.fetchFromManualSource(
    { id: 'tg-resolve-fail-test', name: '模拟频道', url: 'https://t.me/some-test-channel' },
    baseConfig.pool.checker,
    8000
  );
  check('频道本轮解析不到订阅链接时,status是中性的no_link_this_round,不是借用旧记录的blacklisted',
    tgFailResult.status === 'no_link_this_round');
  check('频道本轮解析不到订阅链接时,weight锁定为0',
    tgFailResult.weight === 0);
  const staleStateAfter = sourceTrust.getSourceState('manual:tg-resolve-fail-test');
  check('旧的manual:<id>记录本身没有被这次调用改动(既不读也不写,纯粹不再牵扯)',
    staleStateAfter && staleStateAfter.status === 'blacklisted' &&
    staleStateAfter.lastUpdated === staleState.lastUpdated);

  console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('测试脚本本身抛出异常:', err);
  process.exit(1);
});
