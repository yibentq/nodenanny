'use strict';

// 2026-07-15新增,2026-07-27更新(任务清单第5项:修复硬编码中文串透传到多语言面板的问题,
// socksHttpProbe内部错误消息全部从中文改成了英文,这里的断言同步跟着改,行为本身不变):
// 验证 usability-check.js(二层"真实可用性检测",给主节点自己用的,
// 不是流量池那套 pool-checker.js)的超时阶段感知分类逻辑。
// 背景:此前 socksHttpProbe 里所有阶段(greeting/connect/http)超时都抛同一句
// 消息,runUsabilityCheck 的 catch 分支只认"CONNECT failed"这一种情况,
// 导致 connect/http 阶段超时(隧道已经往前走了一段,是节点/目标那头的问题)
// 被误判成 check_error(本机检测设施问题)。这个函数不依赖真实 xray,直接单测。

const assert = require('assert');
const { _internal: { classifyUsabilityError } } = require('./core/usability-check');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('classifyUsabilityError 阶段感知分类:');

test('greeting阶段超时 -> check_error(本机xray客户端自己没反应)', () => {
  const err = new Error('Probe timed out [stage:greeting]');
  assert.strictEqual(classifyUsabilityError(err), 'check_error');
});

test('connect阶段超时 -> down(隧道已经往前走了一段,是节点连不上目标)', () => {
  const err = new Error('Probe timed out [stage:connect]');
  assert.strictEqual(classifyUsabilityError(err), 'down');
});

test('http阶段超时 -> down(隧道通了但目标半天没响应,节点实际不可用)', () => {
  const err = new Error('Probe timed out [stage:http]');
  assert.strictEqual(classifyUsabilityError(err), 'down');
});

test('没有阶段标记的旧格式消息 -> 兜底check_error', () => {
  const err = new Error('Probe timed out');
  assert.strictEqual(classifyUsabilityError(err), 'check_error');
});

test('SOCKS5 CONNECT失败(非超时类) -> down不变', () => {
  const err = new Error('SOCKS5 CONNECT failed, proxy could not reach the target address (likely the node is actually down)');
  assert.strictEqual(classifyUsabilityError(err), 'down');
});

test('SOCKS5握手失败 -> check_error不变', () => {
  const err = new Error('SOCKS5 handshake failed (xray client may not have started, or config mismatch)');
  assert.strictEqual(classifyUsabilityError(err), 'check_error');
});

test('完全未知的错误 -> 兜底check_error(宁可错杀检测本身也不错杀节点)', () => {
  const err = new Error('some totally unexpected internal error');
  assert.strictEqual(classifyUsabilityError(err), 'check_error');
});

console.log(`\n${passed} 项通过`);
if (process.exitCode) {
  console.error('存在失败项');
  process.exit(1);
}
