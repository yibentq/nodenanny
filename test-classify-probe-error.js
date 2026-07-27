'use strict';

// 2026-07-14新增:验证 pool-checker.js 的 classifyProbeError 阶段感知分类逻辑。
// 背景:真机诊断发现 SOCKS5连接超时 卡在 connect 阶段(本机代理正常,远程节点没接通)
// 之前被错误归类成 check_error(本机问题),应该判 down(节点问题)。
// 这个函数不依赖真实 sing-box,直接单测,不需要真机环境。

const assert = require('assert');
const {
  _internal: { classifyProbeError, pickRandomTargets, KNOWN_AUTHENTIC_TARGETS, DEFAULT_AUTHENTIC_SAMPLE_SIZE }
} = require('./core/pool-checker');

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

console.log('classifyProbeError 阶段感知分类:');

test('connect阶段超时 -> down(节点连不上,不是本机问题)', () => {
  const err = new Error('SOCKS5连接超时[阶段:connect]');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('connecting阶段超时 -> check_error(本机连自己sing-box端口都没连上)', () => {
  const err = new Error('SOCKS5连接超时[阶段:connecting]');
  assert.strictEqual(classifyProbeError(err), 'check_error');
});

test('greeting阶段超时 -> check_error(本机sing-box没回应握手)', () => {
  const err = new Error('SOCKS5连接超时[阶段:greeting]');
  assert.strictEqual(classifyProbeError(err), 'check_error');
});

test('没有阶段标记的旧格式消息 -> 兜底按check_error处理', () => {
  const err = new Error('SOCKS5连接超时');
  assert.strictEqual(classifyProbeError(err), 'check_error');
});

test('SOCKS5握手失败(非超时类) -> check_error不变', () => {
  const err = new Error('SOCKS5握手失败(本机代理客户端没起来或配置有误)');
  assert.strictEqual(classifyProbeError(err), 'check_error');
});

test('SOCKS5CONNECT失败 -> down不变(这条链路真的走不通)', () => {
  const err = new Error('SOCKS5CONNECT失败(节点这条链路实际走不通)');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('HTTP请求超时 -> down不变', () => {
  const err = new Error('HTTP请求超时');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('连接被对端关闭 -> down不变', () => {
  const err = new Error('连接被对端关闭,且没有收到任何HTTP响应');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('TLS握手失败 -> down不变', () => {
  const err = new Error('TLS握手失败:unable to verify the first certificate');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('TLS握手超时 -> down(自查发现,此前会被误判check_error)', () => {
  // 背景:socks-fetch.js里tls.connect()握手迟迟没响应、被本地setTimeout掐断时抛的
  // 是"TLS握手超时"，跟tls.connect()真正报错时的"TLS握手失败:xxx"是两条不同的文案，
  // 此前只覆盖了"失败"没覆盖"超时"，导致这类节点被错误归类成check_error而不是down，
  // 跟本文件测的SOCKS5连接超时[阶段:connect]是完全相同性质的遗漏。
  const err = new Error('TLS握手超时');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('目标返回非预期格式响应 -> down不变', () => {
  const err = new Error('目标返回了非预期格式的响应:garbage');
  assert.strictEqual(classifyProbeError(err), 'down');
});

test('完全未知的错误 -> 兜底check_error(宁可错杀检测本身也不错杀节点)', () => {
  const err = new Error('some totally unexpected node internal error');
  assert.strictEqual(classifyProbeError(err), 'check_error');
});

console.log('\n真实性验证目标池 + 随机抽样(2026-07-15新增,交接文档45.9节"检测标准可能被应试"修复):');

test('目标池覆盖了用户常用网站,不再只有三家CDN大厂', () => {
  const urls = Object.keys(KNOWN_AUTHENTIC_TARGETS);
  assert.ok(urls.length >= 7, '目标池应该扩充到至少7个');
  assert.ok(urls.some((u) => u.includes('youtube.com')), '应该包含YouTube');
  assert.ok(urls.some((u) => u.includes('github.com')), '应该包含GitHub');
  assert.ok(urls.some((u) => u.includes('telegram.org')), '应该包含Telegram');
  assert.ok(urls.some((u) => u.includes('claude.ai')), '应该包含Claude');
});

test('pickRandomTargets: 抽样数量正确,且不重复', () => {
  const pool = Object.keys(KNOWN_AUTHENTIC_TARGETS);
  const picked = pickRandomTargets(pool, 3);
  assert.strictEqual(picked.length, 3);
  assert.strictEqual(new Set(picked).size, 3, '抽出来的应该是3个不同的URL,不能重复');
  picked.forEach((u) => assert.ok(pool.includes(u), '抽出来的必须是池子里已有的URL'));
});

test('pickRandomTargets: 请求数量超过池子大小时,不报错、只返回池子全部', () => {
  const pool = ['a', 'b'];
  const picked = pickRandomTargets(pool, 10);
  assert.strictEqual(picked.length, 2);
});

test('pickRandomTargets: 默认抽样数量是3', () => {
  assert.strictEqual(DEFAULT_AUTHENTIC_SAMPLE_SIZE, 3);
});

test('pickRandomTargets: 多次调用结果会变化(证明是真随机,不是每次固定同一批)', () => {
  const pool = Object.keys(KNOWN_AUTHENTIC_TARGETS);
  const samples = new Set();
  for (let i = 0; i < 30; i += 1) {
    samples.add(pickRandomTargets(pool, 3).slice().sort().join(','));
  }
  // 池子有7个,一次抽3个,组合数远大于1,30次里几乎不可能全部抽到同一种组合
  assert.ok(samples.size > 1, '多次抽样应该出现不同的组合,不能每次都一样');
});

console.log(`\n${passed} 项通过`);
if (process.exitCode) {
  console.error('存在失败项');
  process.exit(1);
}
