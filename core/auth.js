'use strict';

// 面板登录鉴权：签名 Cookie 会话 + 简单的失败限速。
// 不引入 express-session / bcrypt 这类额外依赖，保持项目"零依赖风险"的原则，
// 用 Node 内置 crypto 就能把这件事做对。

const crypto = require('crypto');

const COOKIE_NAME = 'nn_session';
const SESSION_DAYS = 14;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// 登录失败限速：同一 IP 连续失败 5 次后，锁 60 秒。
// 只是防止最基础的密码猜测脚本，不是安防产品，够用就好。
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;
const attempts = new Map(); // ip -> { count, lockedUntil }

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // 长度不等时也要走一次比较，避免通过响应时间差猜出密码长度
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSessionCookie(secret) {
  const expires = Date.now() + SESSION_MS;
  const payload = String(expires);
  const sig = sign(payload, secret);
  const token = `${payload}.${sig}`;
  return { name: COOKIE_NAME, token, maxAgeMs: SESSION_MS };
}

function verifySessionCookie(cookieHeader, secret) {
  if (!cookieHeader) return false;
  const match = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!match) return false;
  const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload, secret);
  if (!timingSafeEqualStr(sig, expected)) return false;
  const expires = Number(payload);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  return true;
}

function isLocked(ip) {
  const record = attempts.get(ip);
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    attempts.delete(ip);
  }
  return false;
}

function registerFailure(ip) {
  const record = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_MS;
    record.count = 0;
  }
  attempts.set(ip, record);
}

function registerSuccess(ip) {
  attempts.delete(ip);
}

// ---------- 终端专属二次鉴权（交接文档v4第二节第11条：终端权限应高于普通登录） ----------
// 独立的 cookie 名字、独立的密钥（store.getOrCreateTerminalSecret）、更短的有效期。
// 即使面板登录 session 还有效，打开终端前依然要求单独验证一次 terminal.password，
// 防止"面板账号密码泄露 = 直接拿到服务器shell"这种最坏情况。
const TERMINAL_COOKIE_NAME = 'nn_terminal_session';
const TERMINAL_SESSION_MINUTES = 30; // 比普通登录短得多，且不会因为继续操作自动续期
const TERMINAL_SESSION_MS = TERMINAL_SESSION_MINUTES * 60 * 1000;

// 终端密码错误限速：复用跟登录一样的思路，但用独立的计数表，避免终端密码和面板密码
// 的失败计数互相污染（比如面板密码连续输错触发锁定，不应该连带把终端密码也锁住）。
const terminalAttempts = new Map();

function createTerminalSessionCookie(secret) {
  const expires = Date.now() + TERMINAL_SESSION_MS;
  const payload = String(expires);
  const sig = sign(payload, secret);
  const token = `${payload}.${sig}`;
  return { name: TERMINAL_COOKIE_NAME, token, maxAgeMs: TERMINAL_SESSION_MS };
}

function verifyTerminalSessionCookie(cookieHeader, secret) {
  if (!cookieHeader) return false;
  const match = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${TERMINAL_COOKIE_NAME}=`));
  if (!match) return false;
  const token = decodeURIComponent(match.slice(TERMINAL_COOKIE_NAME.length + 1));
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload, secret);
  if (!timingSafeEqualStr(sig, expected)) return false;
  const expires = Number(payload);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  return true;
}

function isTerminalLocked(ip) {
  const record = terminalAttempts.get(ip);
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    terminalAttempts.delete(ip);
  }
  return false;
}

function registerTerminalFailure(ip) {
  const record = terminalAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_MS;
    record.count = 0;
  }
  terminalAttempts.set(ip, record);
}

function registerTerminalSuccess(ip) {
  terminalAttempts.delete(ip);
}

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  createSessionCookie,
  verifySessionCookie,
  timingSafeEqualStr,
  isLocked,
  registerFailure,
  registerSuccess,
  TERMINAL_COOKIE_NAME,
  TERMINAL_SESSION_MINUTES,
  createTerminalSessionCookie,
  verifyTerminalSessionCookie,
  isTerminalLocked,
  registerTerminalFailure,
  registerTerminalSuccess
};
