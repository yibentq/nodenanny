'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('./store');
const auth = require('./auth');
const pool = require('./pool');
const poolEvents = require('./pool-events');
const ai = require('./ai-provider');
const { runCheck } = require('./checker');
const terminal = require('./terminal');
const kbManager = require('./kb-manager');
const kbSync = require('./kb-sync');
const sourceListSync = require('./source-list-sync');
const wikiManager = require('./wiki-manager');
const wikiSync = require('./wiki-sync');
const failureReport = require('./failure-report');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(
      `[panel] 找不到配置文件：${CONFIG_PATH}\n` +
      '请先复制 config/config.example.json 为 config/config.json 并填好内容。'
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function formatDuration(sinceIso) {
  if (!sinceIso) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(sinceIso).getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return { days, hours, minutes, totalSeconds: seconds };
}

function main() {
  const config = loadConfig();
  const app = express();
  const sessionSecret = store.getOrCreateSessionSecret();
  const terminalSecret = store.getOrCreateTerminalSecret();
  const panelPassword = config.panel.password || '';
  const bindHost = config.panel.bindHost || '127.0.0.1';

  // 面板打算通过 Nginx 反代对外开放时，一定要设置密码；
  // 只在本机/SSH 隧道场景下访问才允许留空跳过登录（向下兼容旧配置）。
  if (!panelPassword && bindHost !== '127.0.0.1') {
    console.error(
      '[panel] 拒绝启动：config.panel.bindHost 不是 127.0.0.1（即打算被外部访问），' +
      '但 config.panel.password 为空。\n' +
      '[panel] 请先在 config.json 里设置 panel.password，否则任何人都能直接打开你的面板。'
    );
    process.exit(1);
  }

  // 如果面板部署在 Nginx 反代后面，信任 X-Forwarded-* 头，
  // 这样才能正确识别 HTTPS（用于登录 Cookie 的 Secure 属性）和真实客户端 IP（用于登录限速）。
  app.set('trust proxy', 1);
  app.use(express.json());

  function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  function setSessionCookie(req, res) {
    const { name, token, maxAgeMs } = auth.createSessionCookie(sessionSecret);
    const secureFlag = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secureFlag}`
    );
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
  }

  // ---------- 登录相关：不需要鉴权即可访问 ----------
  app.get('/login.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  // ---------- 订阅接口：也不走 Cookie 登录（代理客户端没法登录），靠 URL 里的随机令牌保护 ----------
  // 发现16 修复（批次四第三轮真机测试）：这里以前对自建节点分支做的是 res.redirect(302, subscriptionUrl)，
  // 但 subscriptionUrl 是一条 vless:// 裸链接，不是 http(s) 地址——302 跳转只能跳到 http(s)，
  // 客户端"添加订阅"发起的是标准 HTTP 请求、期待直接拿到订阅内容本体（base64），跳到一个非法
  // scheme 只会失败或拿到空内容。这就是"原始订阅地址能用、智能订阅用不了"的真实原因，而且跟
  // 流量池分支（下面 buildPoolSubscription 那条）处理方式本来就不一致。现在统一改成：不管走的是
  // 自建节点还是流量池，都直接把订阅内容按标准订阅格式 base64 编码后返回，不再对任何分支做 redirect。
  app.get('/sub/:token', (req, res) => {
    const subToken = store.getOrCreateSubToken();
    if (req.params.token !== subToken) {
      return res.status(404).send('not found');
    }
    const state = store.getState();
    const subscriptionUrl = (config.node && config.node.subscriptionUrl) || '';

    if (state.activeSource === 'pool') {
      const poolData = pool.getPool();
      if (poolData.nodes && poolData.nodes.length > 0) {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        return res.send(pool.buildPoolSubscription(config.language));
      }
      // 池子空了，没有更好的选择，只能退回真实订阅（如果有的话）
    }

    if (subscriptionUrl) {
      // 自建节点场景：跟流量池分支保持一致，直接把这条节点链接本身按标准订阅格式
      // （单条链接、base64 整体编码）返回，而不是 302 跳转到一个非 http(s) 的 scheme。
      // 批次五·第一批新增(交接文档40.7/40.8节)：不再原样返回subscriptionUrl本身，
      // 而是先用buildMainNodeSubscription()给节点名称加一个"来自NodeNanny"的品牌后缀
      // （跟随config.language走五语言），让用户在客户端App里也能一眼认出这是哪个项目
      // 装的节点，不是裸链接原样转发。
      res.set('Content-Type', 'text/plain; charset=utf-8');
      return res.send(pool.buildMainNodeSubscription(subscriptionUrl, config.language));
    }
    res.status(404).send(
      '还没有配置 node.subscriptionUrl（你的一键装节点脚本生成的那个真实订阅地址），\n' +
      '请在 config.json 里补上，或者暂时直接用装节点脚本给你的原始订阅地址。'
    );
  });

  app.post('/api/login', (req, res) => {
    const ip = clientIp(req);
    if (auth.isLocked(ip)) {
      return res.status(429).json({ ok: false, error: 'locked' });
    }
    if (!panelPassword) {
      // 没设密码（仅限本机访问场景），登录接口直接放行，方便本地调试
      setSessionCookie(req, res);
      return res.json({ ok: true });
    }
    const submitted = (req.body && req.body.password) || '';
    if (auth.timingSafeEqualStr(submitted, panelPassword)) {
      auth.registerSuccess(ip);
      setSessionCookie(req, res);
      return res.json({ ok: true });
    }
    auth.registerFailure(ip);
    return res.status(401).json({ ok: false, error: 'wrong_password' });
  });

  app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---------- 以下路由都需要先登录 ----------
  app.use((req, res, next) => {
    // v21修复(真实bug,不是浏览器缓存问题):这条鉴权中间件此前挡在 express.static
    // 之前,拦截的是"所有非/api/开头的请求"——包括 /assets/favicon.png、css、js
    // 这些静态资源本身。后果:在login.html这个本来就不需要登录就能看到的页面上,
    // 浏览器发起的favicon请求(GET /assets/favicon.png)同样会命中这条中间件,
    // 因为还没登录、又不是/api/开头,直接被redirect到/login.html——浏览器拿到的
    // 是一段HTML而不是图片字节,自然无法渲染成图标,不管换成无痕模式、清多少次
    // 缓存都没用,因为请求根本没到达真正提供图片的express.static那一步。
    // 修复:静态资源(/assets/下的文件)本身不含敏感信息(图标/样式/脚本),直接放行,
    // 不受登录状态影响；真正的数据仍然全部走 /api/ 接口,鉴权逻辑不变。
    if (req.path.startsWith('/assets/')) return next();
    if (!panelPassword) return next(); // 未设密码时不强制登录，保持旧行为
    if (auth.verifySessionCookie(req.headers.cookie, sessionSecret)) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    res.redirect('/login.html');
  });

  app.use(express.static(PUBLIC_DIR));

  // 批次二新增：面板首页展示"订阅信息"区块要用到的接口，返回两个订阅地址：
  // - nodeSubscriptionUrl：233boy 装机脚本自带的真实订阅地址（一次性、静态，来自 config.node.subscriptionUrl）
  // - nannySubUrl：NodeNanny 自己的智能订阅入口（/sub/:token）。发现16修复后，这个接口不再对
  //   任何分支做 302 跳转，而是统一直接返回订阅内容本体（base64）：自建节点正常时返回真实节点
  //   本身，自建节点异常且流量池有节点时返回应急节点内容，客户端只要订阅这一个地址就够了。
  // 引导用户用 nannySubUrl 而不是 nodeSubscriptionUrl，具体文案放在前端页面里说明。
  app.get('/api/subscription-info', (req, res) => {
    const nodeSubscriptionUrl = (config.node && config.node.subscriptionUrl) || '';
    const subToken = store.getOrCreateSubToken();
    // 发现23 修复：nodomain 模式下面板本体走自签证书 HTTPS（人用浏览器点一次"继续访问"就过去了），
    // 但 /sub/:token 这个订阅接口是给 Shadowrocket 这类 App 直接发 HTTP 请求拉取内容的，这类 App
    // 不会像浏览器一样弹出"信任例外"的选项，遇到自签证书直接判定失败——装系统级证书信任又对非
    // 技术用户太麻烦，权衡后订阅接口改走明文 HTTP（见 setup-reverse-proxy.sh 里新增的单独 HTTP
    // 端口，只开放 /sub/ 这一个路径，其它路径一律拒绝）。这个专用地址存在 config.access.subUrlBase
    // 里（由 setup-reverse-proxy.sh 写入），存在就优先用它拼订阅地址；不存在（比如本机直连、或者
    // domain 模式本来就有正规证书不需要这套）就退回旧逻辑，从当前请求的协议+host 反推。
    const origin = (config.access && config.access.subUrlBase)
      || `${req.protocol}://${req.get('host')}`;
    const nannySubUrl = `${origin}/sub/${subToken}`;

    // 发现5修复：告诉前端"智能订阅现在到底能不能真的用"，而不是让前端无条件显示乐观文案。
    // 判断逻辑跟 /sub/:token 的实际行为保持一致：activeSource 是 pool 时看池子里有没有节点，
    // 否则看 node.subscriptionUrl 是否为空——为空的话 /sub/:token 会直接返回 404，谈不上"正常使用"。
    const state = store.getState();
    let nannySubUsable = false;
    if (state.activeSource === 'pool') {
      const poolData = pool.getPool();
      nannySubUsable = !!(poolData.nodes && poolData.nodes.length > 0);
    } else {
      nannySubUsable = !!nodeSubscriptionUrl;
    }

    res.json({ nodeSubscriptionUrl, nannySubUrl, nannySubUsable });
  });

  app.get('/api/status', (req, res) => {
    const state = store.getState();
    const events = store.getEvents(20);
    const poolEnabled = !!(config.pool && config.pool.enabled);
    const poolData = poolEnabled ? pool.getPool() : null;
    const aiEnabled = !!(config.ai && config.ai.enabled);
    res.json({
      nodeName: config.node.name,
      status: state.status,
      since: state.since,
      duration: formatDuration(state.since),
      lastCheck: state.lastCheck,
      restartsToday: state.restartsToday,
      restartsSuccessToday: state.restartsSuccessToday || 0,
      checkIntervalMinutes: config.monitor.checkIntervalMinutes,
      events,
      pool: {
        enabled: poolEnabled,
        activeSource: state.activeSource || 'self',
        manualOverride: !!state.poolManualOverride,
        nodeCount: poolData ? poolData.nodes.length : 0,
        updatedAt: poolData ? poolData.updatedAt : null,
        // 修复记录:此前refreshPool()内部其实算出了很详细的per-source摘要
        // (哪个来源trial/trusted/blacklisted、通过率)，但一直被直接丢弃，
        // 用户想看只能手动登服务器翻data/sources.json——自愈生态的核心卖点
        // 就是"可测量的信任"，这里补上，让面板每次刷新都能看到当前各来源
        // 的实时状态，不需要手动触发一次刷新才能看到、也不用登服务器。
        sources: poolEnabled ? pool.getSourceTrustSummary(config) : [],
        // 批次五·第一批新增(交接文档40.6/40.7节)：只在"当前订阅内容确实来自流量池"
        // (activeSource==='pool')时才有意义——不是流量池启用就展示，启用之后大多数
        // 时间主节点其实是正常的，不该误导用户以为正在用陌生节点。数据本身直接复用
        // pool.getActiveNodesSummary()，不重新设计一套来源统计逻辑。
        activeNodes: (poolEnabled && state.activeSource === 'pool') ? pool.getActiveNodesSummary() : []
      },
      ai: {
        enabled: aiEnabled,
        diagnosis: state.lastDiagnosis || null
      }
    });
  });

  // 星图第三步·后端接口(交接文档三十六.6/36.8节):把pool.getStarmapData()
  // 算好的坐标+元数据原样吐给前端，前端不需要自己调用layoutStars()，避免
  // demo(pool-starchart-v2.html)和正式面板各跑一份布局算法、两边参数漂移。
  // 流量池没启用时返回一个空壳(stars:[])，不报错，方便前端统一处理"暂无数据"
  // 这种状态，不用单独判断这个接口存不存在。
  app.get('/api/pool/starmap', (req, res) => {
    const poolEnabled = !!(config.pool && config.pool.enabled);
    if (!poolEnabled) {
      res.json({ enabled: false, canvasWidth: 420, canvasHeight: 320, stars: [], overflowCount: 0, blacklistOverflowCount: 0, updatedAt: null });
      return;
    }
    const width = parseInt(req.query.w, 10) || 420;
    const height = parseInt(req.query.h, 10) || 320;
    try {
      const data = pool.getStarmapData(width, height);
      res.json(Object.assign({ enabled: true }, data));
    } catch (err) {
      res.status(500).json({ enabled: true, error: err.message, stars: [] });
    }
  });

  // 流量池检测明细日志——跟 /api/pool/starmap 同样的"流量池未开启就返回空壳"原则，
  // 不报错，前端统一处理"暂无数据"这个状态。数据来自独立的 pool-events.json，
  // 不占用自建节点那份 store.js events 的名额。
  app.get('/api/pool/events', (req, res) => {
    const poolEnabled = !!(config.pool && config.pool.enabled);
    if (!poolEnabled) {
      res.json({ enabled: false, rounds: [] });
      return;
    }
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      const rounds = poolEvents.getRecentRounds(limit);
      res.json({ enabled: true, rounds });
    } catch (err) {
      res.status(500).json({ enabled: true, error: err.message, rounds: [] });
    }
  });

  app.post('/api/check', async (req, res) => {
    try {
      const result = await runCheck(config);
      res.json({ ok: true, status: result.status });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 手动触发一次流量池刷新，方便部署完立刻验证抓取有没有跑通，不用干等定时任务
  app.post('/api/pool/refresh', async (req, res) => {
    if (!config.pool || !config.pool.enabled) {
      return res.status(400).json({ ok: false, error: 'pool_disabled' });
    }
    try {
      const result = await pool.refreshPool(config);
      if (result.ok) {
        store.addEvent('pool_refreshed', { count: result.count });
      } else if (!result.skipped) {
        store.addEvent('pool_refresh_failed', { error: result.error });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 手动切换备用池开关（founder拍板，跟checker.js的自动切换是两条独立的线）：用户不想等
  // 自建节点真的挂了才用上流量池，可以在面板上主动点一下强制切过去；再点一次切回来。
  // 用一个开关按钮而不是两个独立按钮——当前状态由 state.poolManualOverride 决定下一步动作。
  app.post('/api/pool/manual-toggle', (req, res) => {
    if (!config.pool || !config.pool.enabled) {
      return res.status(400).json({ ok: false, error: 'pool_disabled' });
    }
    const state = store.getState();
    if (state.poolManualOverride) {
      // 当前是手动pool模式，切回自建节点，恢复自动挡
      store.updateState({ activeSource: 'self', poolManualOverride: false });
      store.addEvent('pool_manual_restored', {});
      return res.json({ ok: true, activeSource: 'self', manualOverride: false });
    }
    // 当前是self（或理论上checker.js自动切的pool，但那种情况下poolManualOverride本来就是false，
    // 走到这里说明用户是在自动挡pool状态下又手动点了一次，效果是"接管"成手动挡，同样需要校验节点数）
    const poolData = pool.getPool();
    if (!poolData.nodes || poolData.nodes.length === 0) {
      return res.status(400).json({ ok: false, error: 'pool_empty' });
    }
    store.updateState({ activeSource: 'pool', poolManualOverride: true });
    store.addEvent('pool_manual_activated', { count: poolData.nodes.length });
    return res.json({ ok: true, activeSource: 'pool', manualOverride: true });
  });

  // 手动触发一次AI诊断，方便测试或者用户想主动问一次，不用等连续失败3次自动触发。
  // 手动触发不发送诊断邮件（避免用户测试功能也被塞邮箱），只更新面板上显示的结果。
  // 用一个进程内标记防止手快多点几下并发打好几次 AI API（消耗的是用户自己的 Key 额度，
  // 不是安全问题，但没必要浪费）；不用分布式锁，单进程内够用。
  let aiDiagnoseInFlight = false;
  app.post('/api/ai/diagnose', async (req, res) => {
    if (!config.ai || !config.ai.enabled) {
      return res.status(400).json({ ok: false, error: 'ai_disabled' });
    }
    if (aiDiagnoseInFlight) {
      return res.status(429).json({ ok: false, error: 'ai_diagnose_in_progress' });
    }
    aiDiagnoseInFlight = true;
    try {
      const diagnosisText = await ai.diagnose({
        providerConfig: config.ai,
        nodeInfo: config.node,
        events: store.getEvents(20)
      });
      const diagnosis = { at: new Date().toISOString(), text: diagnosisText, error: null };
      store.setLastDiagnosis(diagnosis);
      store.addEvent('ai_diagnosis', { node: config.node.name });
      res.json({ ok: true, diagnosis });
    } catch (err) {
      const diagnosis = { at: new Date().toISOString(), text: null, error: err.message };
      store.setLastDiagnosis(diagnosis);
      store.addEvent('ai_diagnosis_failed', { node: config.node.name, error: err.message.slice(0, 200) });
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      aiDiagnoseInFlight = false;
    }
  });

  // ---------- 终端二次解锁（交接文档v4：终端权限应高于普通面板登录） ----------
  // 普通面板登录之后，打开终端前还要单独再输入一次 config.terminal.password。
  // 走独立的cookie/密钥/失败限速表，不跟面板登录混用。
  app.post('/api/terminal/unlock', (req, res) => {
    const ip = clientIp(req);
    if (!config.terminal || !config.terminal.enabled) {
      return res.status(400).json({ ok: false, error: 'terminal_disabled' });
    }
    if (auth.isTerminalLocked(ip)) {
      return res.status(429).json({ ok: false, error: 'too_many_attempts' });
    }
    const { password } = req.body || {};
    const terminalPassword = config.terminal.password || '';
    if (!terminalPassword || !auth.timingSafeEqualStr(password || '', terminalPassword)) {
      auth.registerTerminalFailure(ip);
      return res.status(401).json({ ok: false, error: 'wrong_password' });
    }
    auth.registerTerminalSuccess(ip);
    const { name, token, maxAgeMs } = auth.createTerminalSessionCookie(terminalSecret);
    const secureFlag = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secureFlag}`
    );
    res.json({ ok: true, expiresInMinutes: auth.TERMINAL_SESSION_MINUTES });
  });

  // ---------- 知识库：匹配/列表/同步 ----------
  // 给面板日志展示区调用：把一行日志丢进来，返回命中的知识库条目（已含fixCommands/riskLevel）。
  // code重构第二批新增:请求体可以传 code(比如事件里存的 USABILITY_BAD_STATUS_CODE)
  // 做精确匹配，不用再传line去猜正则——如果同时传了两者，code优先(更快、更准，
  // 不用进沙箱)，line命中的结果追加在后面、按entry.id去重，两条路径的命中都不丢。
  app.post('/api/kb/match', async (req, res) => {
    try {
      const { line, code, contextKey } = req.body || {};
      const hits = [];
      const seenIds = new Set();
      if (code) {
        for (const entry of await kbManager.matchCode(code, { contextKey })) {
          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            hits.push(entry);
          }
        }
      }
      if (line) {
        for (const entry of await kbManager.matchLine(line, { contextKey })) {
          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            hits.push(entry);
          }
        }
      }
      res.json({ ok: true, hits });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/kb/list', (req, res) => {
    const kb = kbManager.loadKnowledgeBase();
    res.json({ ok: true, entries: kb.entries });
  });

  // 手动触发一次远程知识库同步检查；只落地staging，不自动合并（合并要走下面的apply路由，
  // 由人工在面板上看过diff之后再点确认）。
  app.post('/api/kb/sync/check', async (req, res) => {
    if (!config.kbSync || !config.kbSync.rawUrl) {
      return res.status(400).json({ ok: false, error: 'kb_sync_not_configured' });
    }
    try {
      const result = await kbSync.checkForUpdate(config.kbSync);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/kb/sync/diff', (req, res) => {
    res.json(kbSync.diffStagingAgainstCurrent());
  });

  // 人工确认合并staging——这是唯一会真正改动生效版knowledge-base.json的入口，
  // 前端务必在调用前把diff完整展示给用户看过。
  app.post('/api/kb/sync/apply', (req, res) => {
    try {
      const { acceptedIds } = req.body || {};
      const result = kbSync.applyStaging({ acceptedIds });
      if (result.ok) store.addEvent('kb_sync_applied', { count: result.appliedCount });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- 官方节点来源列表远程同步(v39新增) ----------
  // 跟kb-sync走完全一样的三步流程:check(只读、返回diff)→前端展示diff→人工点确认才apply。
  // 合并对象是真实的config.json的pool.manualSources，不是config.example.json，
  // 具体的字段清洗/去fixed逻辑都在source-list-sync.js里，这里只负责接路由。
  app.post('/api/sources/sync/check', async (req, res) => {
    if (!config.sourceListSync || !config.sourceListSync.rawUrl) {
      return res.status(400).json({ ok: false, error: 'source_list_sync_not_configured' });
    }
    try {
      const result = await sourceListSync.checkForUpdate(config.sourceListSync);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/sources/sync/diff', (req, res) => {
    res.json(sourceListSync.diffStagingAgainstCurrent());
  });

  // 人工确认合并——唯一会真正改动config.json的入口，前端务必先把diff完整展示给用户看过。
  app.post('/api/sources/sync/apply', (req, res) => {
    try {
      const { acceptedIds } = req.body || {};
      const result = sourceListSync.applyStaging({ acceptedIds });
      if (result.ok) store.addEvent('source_list_sync_applied', { count: result.appliedCount });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- Wiki百科：分类树/单页/搜索 ----------
  // 跟上面的knowledge-base是两条独立数据线（见wiki-manager.js文件头注释）：
  // 这里返回的都是原始markdown文本，服务端不做任何HTML渲染，渲染+清洗放在
  // 前端wiki.html里用marked.js + DOMPurify做，避免第三方教程原文里混入的
  // 不可信内容在服务端就被当成HTML处理。
  // lang 查询参数（?lang=en 等）：非法或缺省一律由 wikiManager.normalizeLang 兜底成'zh'，
  // 不在这一层做校验/报错——多语言是"缺了就回退中文"的柔性设计，不是硬性要求。
  app.get('/api/wiki/tree', (req, res) => {
    try {
      res.json({ ok: true, categories: wikiManager.buildTree(req.query.lang) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/wiki/page/:categoryId/:slug', (req, res) => {
    const page = wikiManager.getPage(req.params.categoryId, req.params.slug, req.query.lang);
    if (!page) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, page });
  });

  app.get('/api/wiki/search', (req, res) => {
    try {
      const results = wikiManager.search(req.query.q, req.query.lang);
      res.json({ ok: true, results });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- Wiki内容远程同步（v29交接文档第三节"第一件事"，本次会话新增） ----------
  // 创始人本次明确确认的方案：直接覆盖式镜像同步，不保留本地手改（跟kb-sync的
  // "staging+逐条确认"重流程不同）。流程固定两步：先check（只读、返回diff），
  // 前端把diff完整展示给用户看过，用户点"确认覆盖"之后才调用apply（真正落盘）。
  app.get('/api/wiki-sync/status', (req, res) => {
    res.json({ ok: true, status: wikiSync.getStatus() });
  });

  app.post('/api/wiki-sync/check', async (req, res) => {
    if (!config.wikiSync || !config.wikiSync.owner || !config.wikiSync.repo) {
      return res.status(400).json({ ok: false, error: 'wiki_sync_not_configured' });
    }
    try {
      const result = await wikiSync.checkForUpdate(config.wikiSync);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 唯一会真正改动 data/wiki/ 目录内容的入口——前端必须在调用前把check()返回的
  // diff（added/changed/removed）完整展示给用户确认过，这里不重复展示逻辑。
  app.post('/api/wiki-sync/apply', async (req, res) => {
    if (!config.wikiSync || !config.wikiSync.owner || !config.wikiSync.repo) {
      return res.status(400).json({ ok: false, error: 'wiki_sync_not_configured' });
    }
    try {
      const result = await wikiSync.applyUpdate(config.wikiSync);
      if (result.ok) {
        store.addEvent('wiki_sync_applied', {
          downloaded: result.downloadedCount,
          removed: result.removedCount
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- 失败报告生成器(任务清单第4项) ----------
  // 纯读取，不改动任何数据；组装逻辑全在failure-report.js里，这里只负责接参数、
  // 兜底language取值（跟其它面板文案一样：优先明确传的lang query，没有就退回
  // config.language，本身还有非法值兜底成zh，见failure-report.js的normalizeLang）。
  app.get('/api/failure-report', (req, res) => {
    try {
      const lang = failureReport.normalizeLang(req.query.lang || config.language);
      const text = failureReport.buildFailureReport({ config, lang });
      res.json({ ok: true, text });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- 终端命令写入/确认 ----------
  // 供知识库修复卡片"一键执行"按钮调用：真正的风险分级判断在terminalApi.writeCommand里做，
  // 这里只负责把请求转发过去，不在路由层重复判断逻辑。
  app.post('/api/terminal/write-command', (req, res) => {
    if (!terminalApi || !terminalApi.enabled) {
      return res.status(400).json({ ok: false, error: 'terminal_disabled' });
    }
    const { sessionId, command, riskLevel, verified } = req.body || {};
    if (!sessionId || !command) {
      return res.status(400).json({ ok: false, error: 'missing_sessionId_or_command' });
    }
    // verified 显式要求传 true 才解锁一键执行；不传/传其它值一律按false处理，
    // 这是v4文档要求的"权限层面强制"，不是只在前端UI上提示一下就算了。
    const result = terminalApi.writeCommand(sessionId, command, riskLevel, verified === true);
    res.json(result);
  });

  app.post('/api/terminal/confirm-command', (req, res) => {
    if (!terminalApi || !terminalApi.enabled) {
      return res.status(400).json({ ok: false, error: 'terminal_disabled' });
    }
    const { sessionId, confirmToken } = req.body || {};
    if (!sessionId || !confirmToken) {
      return res.status(400).json({ ok: false, error: 'missing_sessionId_or_token' });
    }
    const result = terminalApi.confirmCommand(sessionId, confirmToken);
    res.json(result);
  });

  const port = config.panel.port || 8787;
  let terminalApi = { enabled: false };
  const httpServer = app.listen(port, bindHost, () => {
    console.log(`[panel] 面板已启动：http://${bindHost}:${port}`);
    if (!panelPassword) {
      console.log('[panel] 警告：未设置 panel.password，任何能连上这个地址的人都不用登录直接看到面板。');
    }
    if (bindHost === '127.0.0.1') {
      console.log('[panel] 当前只绑定本机地址。外部访问建议走 Nginx 反向代理（见 README「面板访问」一节），');
      console.log('[panel] 或者用 SSH 端口转发临时看一眼：');
      console.log(`[panel]   ssh -L ${port}:127.0.0.1:${port} 你的用户名@服务器IP`);
    }
    if (config.pool && config.pool.enabled) {
      const subToken = store.getOrCreateSubToken();
      console.log('[panel] 流量池功能已启用，订阅地址（填进客户端订阅栏，不要外传）：');
      console.log(`[panel]   http(s)://你的面板访问地址/sub/${subToken}`);
    }
  });

  // 终端功能挂载在同一个http server上（走 /ws/terminal 这个WebSocket升级路径），
  // 依赖没装好或者config.terminal.enabled为false时，attachTerminal内部会打印原因并
  // 返回 {enabled:false}，不影响面板其余功能正常运行。
  terminalApi = terminal.attachTerminal(httpServer, { config, sessionSecret, terminalSecret });
  if (config.terminal && config.terminal.enabled && !terminalApi.enabled) {
    console.log('[panel] 提示：config.terminal.enabled=true，但终端未能成功挂载，看上面几行日志确认原因。');
  }
}

main();
