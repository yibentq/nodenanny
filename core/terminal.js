'use strict';

// 在线终端模块（交接文档v4方案，骨架阶段）。
//
// 依赖说明（需要 `npm install ws node-pty`，目前还没加进package.json——这两个是新引入的
// 依赖，其中node-pty需要编译原生模块，跟项目原本"零依赖风险"的原则有出入，这一点在
// 交接文档里已经提过，创始人如果部署时编译环境有问题需要单独处理，不是这个文件的bug）。
//
// 安全设计要点（全部对应交接文档v4第二节第4条列出的隐藏风险）：
// 1. WS握手阶段就鉴权，鉴权不过直接拒绝upgrade，pty都不创建（不是"连上再踢出去"）
// 2. 每个连接独立一个pty进程，空闲超时自动kill，连接断开时同步销毁
// 3. resize事件同步给pty，避免前端换行错位
// 4. 知识库自动写入命令 vs 用户手动打字：检测最近是否有用户输入，有的话拒绝抢写
// 5. 命令执行前的风险分级在这里做最终把关（配合kb-manager.classifyCommandRisk的兜底），
//    high级别要求携带一次性确认token，不是随便一个POST请求就能跑

let WebSocketServer;
let pty;
try {
  // eslint-disable-next-line global-require
  WebSocketServer = require('ws').WebSocketServer;
  // eslint-disable-next-line global-require
  pty = require('node-pty');
} catch (err) {
  // 依赖没装的时候不要让整个面板进程直接崩溃退出——终端功能没了，但节点监控/知识库
  // 展示这些核心功能还应该能正常用。attachTerminal()里会检测这个标记并跳过挂载。
  WebSocketServer = null;
  pty = null;
}

const crypto = require('crypto');
const auth = require('./auth');
const kbManager = require('./kb-manager');

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15分钟无输入自动关闭pty，防止忘记关标签页导致僵尸进程
const USER_TYPING_WINDOW_MS = 800; // 用户最近800ms内有输入，视为"正忙"，知识库命令不抢写
const CONFIRM_TOKEN_TTL_MS = 60 * 1000; // high风险命令的一次性确认token，1分钟内有效

// connId -> { ptyProcess, ws, lastUserInputAt, idleTimer, pendingConfirmTokens: Map }
const sessions = new Map();

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// 握手阶段的双重鉴权：既要有效的面板登录session，也要有效的终端专属session
// （由前端在打开终端面板前先调 /api/terminal/unlock 换来，见panel-server.js里的路由）。
// 任何一个不过，直接拒绝WS upgrade，不进入下一步创建pty。
function verifyUpgradeAuth(req, { sessionSecret, terminalSecret, panelPassword }) {
  if (!panelPassword) return true; // 面板本身就没设密码（本机场景），跟其它/api/行为保持一致
  const cookieHeader = req.headers.cookie;
  if (!auth.verifySessionCookie(cookieHeader, sessionSecret)) return false;
  if (!auth.verifyTerminalSessionCookie(cookieHeader, terminalSecret)) return false;
  return true;
}

// 纯逻辑：给定verified/风险分级/是否正忙，决定writeCommand该做什么动作，
// 不碰pty/session map，方便脱离真实ws/node-pty单测（见test-terminal.js）。
// 行为必须跟原来内联在writeCommand里的判断顺序完全一致：
// 1) unverified直接copy-only，连"是否正忙"都不检查（跟原实现一致）
// 2) 分级
// 3) 正忙拦截
// 4) 按风险出动作
function decideWriteCommand({ command, declaredRiskLevel, verified, lastUserInputAt, now }) {
  if (verified !== true) {
    return { ok: true, risk: 'copy-only', executed: false, note: 'unverified_entry_copy_only', action: 'copy_only' };
  }

  const risk = kbManager.classifyCommandRisk(command, declaredRiskLevel);

  if (now - lastUserInputAt < USER_TYPING_WINDOW_MS) {
    return { ok: false, error: 'terminal_busy_user_typing' };
  }

  if (risk === 'low') {
    return { ok: true, risk, executed: true, action: 'run' };
  }

  if (risk === 'medium') {
    return { ok: true, risk, executed: false, note: 'prefilled_no_autorun', action: 'prefill' };
  }

  // high
  return { ok: true, risk, executed: false, note: 'confirmation_required', action: 'confirm_required' };
}

// 纯逻辑：确认token是否已过期。
function isTokenExpired(pending, now) {
  return now > pending.expiresAt;
}

function resetIdleTimer(session) {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    try {
      session.ws.send(JSON.stringify({ type: 'idle_timeout' }));
    } catch (_) { /* 连接可能已经断了，忽略 */ }
    destroySession(session.id);
  }, IDLE_TIMEOUT_MS);
}

function destroySession(id) {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.idleTimer);
  try {
    session.ptyProcess.kill();
  } catch (_) { /* 进程可能已经退出 */ }
  try {
    if (session.ws.readyState === session.ws.OPEN) session.ws.close();
  } catch (_) { /* 忽略 */ }
  sessions.delete(id);
}

function attachTerminal(httpServer, { config, sessionSecret, terminalSecret }) {
  if (!WebSocketServer || !pty) {
    console.error(
      '[terminal] 未检测到 ws / node-pty 依赖，在线终端功能已跳过挂载。\n' +
      '[terminal] 如需启用，先执行 `npm install ws node-pty`（node-pty需要本机有编译原生模块的工具链）。'
    );
    return { enabled: false };
  }
  if (!config.terminal || !config.terminal.enabled) {
    return { enabled: false };
  }

  const panelPassword = config.panel.password || '';
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws/terminal') return; // 不是终端的升级请求，不掺和，让其它逻辑处理

    if (!verifyUpgradeAuth(req, { sessionSecret, terminalSecret, panelPassword })) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = crypto.randomBytes(8).toString('hex');
      const shell = process.env.SHELL || '/bin/bash';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || '/root',
        env: process.env
      });

      const session = {
        id,
        ws,
        ptyProcess,
        lastUserInputAt: 0,
        idleTimer: null,
        pendingConfirmTokens: new Map() // token -> { command, expiresAt }
      };
      sessions.set(id, session);
      resetIdleTimer(session);

      ptyProcess.onData((data) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
      });
      ptyProcess.onExit(() => destroySession(id));

      ws.send(JSON.stringify({ type: 'ready', sessionId: id }));

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch (_) {
          return; // 忽略解析不了的消息，不让一条坏数据打断连接
        }
        resetIdleTimer(session);

        if (msg.type === 'input') {
          // 用户手动打字：记录时间戳（供知识库写入时判断"是否正忙"），直接转发给pty
          session.lastUserInputAt = Date.now();
          ptyProcess.write(msg.data);
        } else if (msg.type === 'resize') {
          const cols = parseInt(msg.cols, 10);
          const rows = parseInt(msg.rows, 10);
          if (cols > 0 && rows > 0) ptyProcess.resize(cols, rows);
        }
      });

      ws.on('close', () => destroySession(id));
      ws.on('error', () => destroySession(id));
    });
  });

  return {
    enabled: true,
    // 供panel-server.js的/api/kb/execute路由调用：把知识库/AI给出的修复命令写进
    // 指定终端会话，按风险分级决定"自动跑"还是"只填不跑"还是"需要确认token"。
    // verified: 对应知识库条目自己的 verified 字段。这是v4文档明确要求的"权限层面强制"
    // ——AI生成/远程同步来的条目默认 verified:false，即使声明的riskLevel是low，
    // 这里也一律锁定为"仅可复制手动执行"，不写入pty、不给一键执行/自动确认的通道。
    // 调用方（panel-server.js的路由）必须显式传true才能解锁一键执行，不传时按false
    // 处理（安全默认值），不能指望调用方"记得传"。
    writeCommand(sessionId, command, declaredRiskLevel, verified = false) {
      const session = sessions.get(sessionId);
      if (!session) return { ok: false, error: 'session_not_found' };

      const decision = decideWriteCommand({
        command,
        declaredRiskLevel,
        verified,
        lastUserInputAt: session.lastUserInputAt,
        now: Date.now()
      });

      if (!decision.ok) return decision; // terminal_busy_user_typing

      if (decision.action === 'copy_only') {
        return { ok: true, risk: decision.risk, executed: false, note: decision.note };
      }

      if (decision.action === 'run') {
        session.ptyProcess.write(`${command}\r`);
        return { ok: true, risk: decision.risk, executed: true };
      }

      if (decision.action === 'prefill') {
        session.ptyProcess.write(command); // 不带\r，用户自己看一眼按回车
        return { ok: true, risk: decision.risk, executed: false, note: decision.note };
      }

      // confirm_required：只生成一次性确认token，真正写入要走 confirmCommand()
      const token = crypto.randomBytes(6).toString('hex');
      session.pendingConfirmTokens.set(token, {
        command,
        expiresAt: Date.now() + CONFIRM_TOKEN_TTL_MS
      });
      return { ok: true, risk: decision.risk, executed: false, note: decision.note, confirmToken: token };
    },

    confirmCommand(sessionId, token) {
      const session = sessions.get(sessionId);
      if (!session) return { ok: false, error: 'session_not_found' };
      const pending = session.pendingConfirmTokens.get(token);
      if (!pending) return { ok: false, error: 'invalid_or_used_token' };
      session.pendingConfirmTokens.delete(token);
      if (isTokenExpired(pending, Date.now())) return { ok: false, error: 'token_expired' };
      // 高危命令即使确认了，也只填入不自动回车——多一道"人手动按Enter"的摩擦，
      // 这是v4文档里明确要求的"高危要有摩擦感"，不能确认完就自动执行。
      session.ptyProcess.write(pending.command);
      return { ok: true, executed: false, note: 'prefilled_after_confirm_no_autorun' };
    },

    getActiveSessionCount() {
      return sessions.size;
    }
  };
}

module.exports = {
  attachTerminal,
  // 导出方便脱离ws/node-pty单测，见test-terminal.js
  _internal: { parseCookie, verifyUpgradeAuth, decideWriteCommand, isTokenExpired }
};
