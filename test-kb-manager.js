'use strict';

// 骨架自测（交接文档v4）：验证 kb-manager.js 的核心路径没有明显bug，
// 不追求覆盖所有边界，先把"骨架能跑通"这条底线立住，后续批量填充知识库内容
// 时如果引入回归，这个测试至少能兜住最基本的加载/匹配/风险分级逻辑。
//
// 用真实的 data/knowledge-base.json（本次会话新增的5条示例数据）跑匹配测试，
// 不额外造假数据目录——这几条示例数据本身就是为了让这个测试有意义而写的。

const assert = require('assert');
const kb = require('./core/kb-manager');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

async function main() {
  // 1. 加载
  const loaded = kb.loadKnowledgeBase({ force: true });
  check('知识库加载出17条条目(16条历史条目 + 本次新增1条github-discovery-token-missing词条)', loaded.entries.length === 17);

  // 1.5 本次会话新增/补齐:确认4个此前缺失的code现在都能命中对应词条
  const singboxStart = await kb.matchCode('POOL_SINGBOX_START_FAILED', { contextKey: 'test-ctx-singbox-start' });
  check('POOL_SINGBOX_START_FAILED命中pool-checker-environment-issue', singboxStart.some((e) => e.id === 'pool-checker-environment-issue'));

  const authAllFailed = await kb.matchCode('POOL_AUTHENTIC_ALL_FAILED', { contextKey: 'test-ctx-auth-all-failed' });
  check('POOL_AUTHENTIC_ALL_FAILED命中pool-node-actually-unreachable', authAllFailed.some((e) => e.id === 'pool-node-actually-unreachable'));

  const authCheckError = await kb.matchCode('POOL_AUTHENTIC_CHECK_ERROR', { contextKey: 'test-ctx-auth-check-error' });
  check('POOL_AUTHENTIC_CHECK_ERROR命中pool-checker-detection-facility-issue', authCheckError.some((e) => e.id === 'pool-checker-detection-facility-issue'));

  const unsupportedProto = await kb.matchCode('POOL_UNSUPPORTED_PROTOCOL', { contextKey: 'test-ctx-unsupported-protocol' });
  check('POOL_UNSUPPORTED_PROTOCOL命中新增的pool-unsupported-protocol词条', unsupportedProto.some((e) => e.id === 'pool-unsupported-protocol'));

  // 2. 校验函数本身
  check('validateEntry拒绝空对象', kb.validateEntry(null) === false);
  check('validateEntry拒绝riskLevel非法的条目', kb.validateEntry({
    id: 'x', matchPatterns: ['a'], fixCommands: [], riskLevel: 'not-a-level', explanation: {}
  }) === false);
  check('validateEntry接受合法条目', kb.validateEntry({
    id: 'x', matchPatterns: ['a'], fixCommands: [], riskLevel: 'low', explanation: { zh: '测试' }
  }) === true);

  // 3. 正常匹配：xray服务失败
  const hits1 = await kb.matchLine('systemd[1]: xray.service: Failed to start');
  check('命中xray-service-down', hits1.some((e) => e.id === 'xray-service-down'));

  // 4. 不匹配任何条目的日志
  const hits2 = await kb.matchLine('这是一条完全无关的普通日志，不该命中任何知识库条目');
  check('无关日志不命中任何条目', hits2.length === 0);

  // 5. 冷却机制：同一条日志短时间内第二次匹配应该被冷却掉
  const hitsAgain = await kb.matchLine('systemd[1]: xray.service: Failed to start', { contextKey: 'cooldown-test' });
  check('冷却生效：同key短时间内第一次触发', hitsAgain.some((e) => e.id === 'xray-service-down'));
  const hitsThird = await kb.matchLine('systemd[1]: xray.service: Failed to start', { contextKey: 'cooldown-test' });
  check('冷却生效：同key短时间内第二次被冷却掉', hitsThird.length === 0);
  // 换一个contextKey，冷却不应该互相影响
  const hitsDifferentKey = await kb.matchLine('systemd[1]: xray.service: Failed to start', { contextKey: 'cooldown-test-2' });
  check('不同contextKey的冷却互不影响', hitsDifferentKey.some((e) => e.id === 'xray-service-down'));

  // 6. 命令风险兜底分级：声明是low，但命令本身危险，必须被强制升级
  check('rm -rf 被强制升级为high（即使声明low）', kb.classifyCommandRisk('rm -rf /tmp/foo', 'low') === 'high');
  check('kill -9 被强制升级为high', kb.classifyCommandRisk('kill -9 1234', 'medium') === 'high');
  check('普通命令保留声明的risk级别', kb.classifyCommandRisk('pm2 restart nodenanny-panel', 'low') === 'low');
  check('声明high的命令即使命令本身不危险也保持high', kb.classifyCommandRisk('echo hello', 'high') === 'high');

  // 7. 正则安全启发式
  check('识别出嵌套量词形状的正则为可疑', kb.looksSuspicious('(a+)+') === true);
  check('普通正则不被误判为可疑', kb.looksSuspicious('xray\\.service.*failed') === false);

  // 8. needsSandbox：未verified的条目一定要进沙箱
  check('未verified条目需要沙箱', kb.needsSandbox({ verified: false, matchPatterns: ['abc'] }) === true);
  check('remote-sync来源的条目需要沙箱', kb.needsSandbox({ verified: true, source: 'remote-sync', matchPatterns: ['abc'] }) === true);
  check('本地manual且verified的普通正则不需要沙箱', kb.needsSandbox({ verified: true, source: 'manual', matchPatterns: ['abc'] }) === false);

  // 9. 沙箱本身：正常正则应该能在沙箱里正确判断匹配结果
  const sandboxResult = await kb.testInSandbox('foo', 'this line has foo in it', 500);
  check('沙箱内正常正则匹配结果正确', sandboxResult.ok === true && sandboxResult.matched === true);

  console.log(`\n共 ${pass + fail} 项断言，通过 ${pass} 项，失败 ${fail} 项。`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[test-kb-manager] 测试运行时抛出异常：', err);
  process.exitCode = 1;
});
