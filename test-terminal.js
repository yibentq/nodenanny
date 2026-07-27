'use strict';

// core/terminal.js 的单元测试。
// 跟项目里 test-wiki-sync.js 的覆盖策略保持一致：只测不依赖真实网络/进程的纯逻辑
// 部分，不对真实的 ws / node-pty 做mock（这两个依赖本身也可能没装，terminal.js
// 顶部已经用try/catch处理了缺依赖时优雅降级，这里的测试同样应该在没装ws/node-pty
// 的环境下也能跑通——测的是parseCookie/verifyUpgradeAuth/decideWriteCommand/
// isTokenExpired这几个从attachTerminal()闭包里拆出来的纯函数，见terminal.js里
// 的_internal导出）。
// 真正需要真实WS连接+pty进程的部分（attachTerminal本体、writeCommand/confirmCommand
// 对session/pty的实际写入）不在这里测，跟kb-sync.js/wiki-sync.js的checkForUpdate一样
// 需要真实基础设施，留给部署后的手工验证。

const assert = require('assert');
const {
  _internal: { parseCookie, verifyUpgradeAuth, decideWriteCommand, isTokenExpired }
} = require('./core/terminal');

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

console.log('parseCookie:');

test('能从cookie header里取出指定名字的值', () => {
  assert.strictEqual(parseCookie('nn_session=abc123; other=xyz', 'nn_session'), 'abc123');
});

test('取不同名字互不干扰', () => {
  assert.strictEqual(parseCookie('nn_session=abc; nn_terminal_session=def', 'nn_terminal_session'), 'def');
});

test('cookie里有URL编码字符时正确解码', () => {
  assert.strictEqual(parseCookie('nn_session=a%2Fb%3Dc', 'nn_session'), 'a/b=c');
});

test('cookie header为空/undefined时返回null', () => {
  assert.strictEqual(parseCookie('', 'nn_session'), null);
  assert.strictEqual(parseCookie(undefined, 'nn_session'), null);
});

test('cookie header里没有对应名字时返回null', () => {
  assert.strictEqual(parseCookie('other=xyz', 'nn_session'), null);
});

test('只有前缀匹配但名字不同的cookie不会被误取（比如nn_session_extra不该匹配nn_session）', () => {
  // parseCookie按 "name=" 前缀匹配，nn_session_extra=foo 会被误认成 name=nn_session 的一部分吗？
  // startsWith('nn_session=') 要求紧跟等号，所以 nn_session_extra=foo 不会命中，这里确认这一点。
  assert.strictEqual(parseCookie('nn_session_extra=foo', 'nn_session'), null);
});

console.log('verifyUpgradeAuth:');

test('面板没设密码时（本机场景）直接放行，不检查cookie', () => {
  const req = { headers: {} };
  const ok = verifyUpgradeAuth(req, { sessionSecret: 's1', terminalSecret: 't1', panelPassword: '' });
  assert.strictEqual(ok, true);
});

test('设了密码但请求没带cookie，拒绝', () => {
  const req = { headers: {} };
  const ok = verifyUpgradeAuth(req, { sessionSecret: 's1', terminalSecret: 't1', panelPassword: 'pw' });
  assert.strictEqual(ok, false);
});

test('设了密码，只带了普通面板session，没有终端二次鉴权session，拒绝', () => {
  const auth = require('./core/auth');
  const sessionCookie = auth.createSessionCookie('s1');
  const req = { headers: { cookie: `${sessionCookie.name}=${sessionCookie.token}` } };
  const ok = verifyUpgradeAuth(req, { sessionSecret: 's1', terminalSecret: 't1', panelPassword: 'pw' });
  assert.strictEqual(ok, false);
});

test('设了密码，同时带了有效的面板session和终端session，放行', () => {
  const auth = require('./core/auth');
  const sessionCookie = auth.createSessionCookie('s1');
  const terminalCookie = auth.createTerminalSessionCookie('t1');
  const req = {
    headers: { cookie: `${sessionCookie.name}=${sessionCookie.token}; ${terminalCookie.name}=${terminalCookie.token}` }
  };
  const ok = verifyUpgradeAuth(req, { sessionSecret: 's1', terminalSecret: 't1', panelPassword: 'pw' });
  assert.strictEqual(ok, true);
});

test('两个session都在但密钥不对（签名对不上），拒绝', () => {
  const auth = require('./core/auth');
  const sessionCookie = auth.createSessionCookie('s1');
  const terminalCookie = auth.createTerminalSessionCookie('t1');
  const req = {
    headers: { cookie: `${sessionCookie.name}=${sessionCookie.token}; ${terminalCookie.name}=${terminalCookie.token}` }
  };
  // 用错误的secret去验证，签名对不上
  const ok = verifyUpgradeAuth(req, { sessionSecret: 'wrong-secret', terminalSecret: 't1', panelPassword: 'pw' });
  assert.strictEqual(ok, false);
});

console.log('decideWriteCommand（写入决策，对应writeCommand的核心分支）:');

test('未verified的条目，无论声明risk是什么都是copy-only，且不检查是否正忙', () => {
  const result = decideWriteCommand({
    command: 'echo hi',
    declaredRiskLevel: 'low',
    verified: false,
    lastUserInputAt: Date.now(), // 刚刚还在打字，如果verified分支之后才检查会被拦下
    now: Date.now()
  });
  assert.strictEqual(result.action, 'copy_only');
  assert.strictEqual(result.executed, false);
  assert.strictEqual(result.note, 'unverified_entry_copy_only');
});

test('verified=true但用户800ms内刚打过字，即使是low风险也要拦下（terminal_busy_user_typing）', () => {
  const now = Date.now();
  const result = decideWriteCommand({
    command: 'ls -la',
    declaredRiskLevel: 'low',
    verified: true,
    lastUserInputAt: now - 100, // 100ms前，小于800ms窗口
    now
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'terminal_busy_user_typing');
});

test('verified=true，用户很久没打字，low风险 -> 直接执行（run）', () => {
  const now = Date.now();
  const result = decideWriteCommand({
    command: 'ls -la',
    declaredRiskLevel: 'low',
    verified: true,
    lastUserInputAt: now - 10000, // 10秒前，超出800ms窗口
    now
  });
  assert.strictEqual(result.action, 'run');
  assert.strictEqual(result.executed, true);
  assert.strictEqual(result.risk, 'low');
});

test('verified=true，medium风险 -> 只填入不自动回车（prefill）', () => {
  const now = Date.now();
  const result = decideWriteCommand({
    command: 'systemctl restart xray',
    declaredRiskLevel: 'medium',
    verified: true,
    lastUserInputAt: now - 10000,
    now
  });
  assert.strictEqual(result.action, 'prefill');
  assert.strictEqual(result.executed, false);
  assert.strictEqual(result.risk, 'medium');
});

test('verified=true，声明high风险 -> 需要确认token（confirm_required）', () => {
  const now = Date.now();
  const result = decideWriteCommand({
    command: 'systemctl stop nodenanny',
    declaredRiskLevel: 'high',
    verified: true,
    lastUserInputAt: now - 10000,
    now
  });
  assert.strictEqual(result.action, 'confirm_required');
  assert.strictEqual(result.executed, false);
  assert.strictEqual(result.risk, 'high');
});

test('声明是low，但命令本身命中危险模式（rm -rf）-> kb-manager强制升级成high，走确认流程', () => {
  const now = Date.now();
  const result = decideWriteCommand({
    command: 'rm -rf /var/log/*',
    declaredRiskLevel: 'low', // 声明是低危，但正则应该兜底强制升级
    verified: true,
    lastUserInputAt: now - 10000,
    now
  });
  assert.strictEqual(result.risk, 'high');
  assert.strictEqual(result.action, 'confirm_required');
});

test('危险命令即使unverified也是copy-only（不会因为危险就换一种更严格的结果，逻辑本来就最严格）', () => {
  const result = decideWriteCommand({
    command: 'dd if=/dev/zero of=/dev/sda',
    declaredRiskLevel: 'low',
    verified: false,
    lastUserInputAt: 0,
    now: Date.now()
  });
  assert.strictEqual(result.action, 'copy_only');
});

console.log('isTokenExpired:');

test('未过期的token返回false', () => {
  const now = Date.now();
  assert.strictEqual(isTokenExpired({ expiresAt: now + 5000 }, now), false);
});

test('已过期的token返回true', () => {
  const now = Date.now();
  assert.strictEqual(isTokenExpired({ expiresAt: now - 1 }, now), true);
});

test('恰好等于expiresAt那一刻，视为未过期（now > expiresAt才算过期，不是>=）', () => {
  const now = Date.now();
  assert.strictEqual(isTokenExpired({ expiresAt: now }, now), false);
});

console.log(`\n${passed} 项通过`);
