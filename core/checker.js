'use strict';

const net = require('net');
const { exec } = require('child_process');
const store = require('./store');
const notify = require('./notify');
const pool = require('./pool');
const ai = require('./ai-provider');
const kbManager = require('./kb-manager');
const { runUsabilityCheck } = require('./usability-check');

// 给一个错误code查知识库，返回精简后的条目数组(id/title/explanation/fixCommands/riskLevel)，
// 跟pool-events.js里matchKbForResult的取舍逻辑保持一致——只留前端/邮件实际会用到的字段。
// title这里转发完整的{zh,en,ja,de,ru}对象（不在这里挑语言），由消费方(terminal.html/
// failure-report.js)各自按自己的语言上下文取值——之前这里漏转发了title，导致
// failure-report.js的KB建议列表在真实事件上永远退化成显示entry.id，这次一并补上。
// contextKey这里随便给个带时间戳的值就行：这条路径本来就只在"状态发生变化"或
// "连续失败刚好达到阈值"这类低频时机才会调用，不存在同一批候选短时间内重复触发、
// 需要靠contextKey互相区分的场景（那是pool-events那边的问题）。
async function matchKbForEvent(code) {
  if (!code) return [];
  try {
    const hits = await kbManager.matchCode(code, { contextKey: `usability:${Date.now()}` });
    return hits.map((entry) => ({ id: entry.id, title: entry.title, explanation: entry.explanation, fixCommands: entry.fixCommands, riskLevel: entry.riskLevel }));
  } catch (err) {
    console.error('[checker] 二层检测事件的知识库匹配失败，本条不带建议：', err.message);
    return [];
  }
}

// 把匹配到的知识库条目拼成邮件里能直接读的一段文字，按config.ai.language选语言，
// 跟notify.js里getTpl()挑语言的逻辑保持一致，缺失时回退英文。
function kbHitsToText(kbHits, lang) {
  return kbHits
    .map((h) => (h.explanation && (h.explanation[lang] || h.explanation.en)) || '')
    .filter(Boolean)
    .join('\n');
}

// 纯逻辑：二层检测连续down次数达到"仅建议"阈值时是否该发通知。
// 从checkUsabilityAndLog里抽出来，不碰store/notify，方便单测(见test-usability-auto-restart.js)。
function shouldSuggestUsability({ consecutiveUsabilityDown, suggestThreshold, alreadySuggestedThisIncident }) {
  return consecutiveUsabilityDown >= suggestThreshold && !alreadySuggestedThisIncident;
}

// 纯逻辑：二层检测连续down次数达到"自动重启"阈值时是否该真的重启。
// v36新增。三个必要条件缺一不可：达到阈值 / 这次发作期还没重启过 / 配置了restartCommand
// (没配置就没有重启目标，跟TCP层"if (node.restartCommand)"的保守判断一致，不强制)。
function shouldAutoRestartUsability({ consecutiveUsabilityDown, autoRestartThreshold, alreadyAutoRestartedThisIncident, hasRestartCommand }) {
  return (
    consecutiveUsabilityDown >= autoRestartThreshold &&
    !alreadyAutoRestartedThisIncident &&
    !!hasRestartCommand
  );
}

// 检测端口是否能连通，作为"节点是否存活"的判断依据。
// 不检测具体协议内容，只看端口通不通——足够覆盖"进程挂了/被墙导致连不上"这两种最常见情况。
function checkPort(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function runShell(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr, error });
    });
  });
}

// 第二层：TCP 端口通了之后，顺手跑一次真实可用性检测（真的走一遍代理协议发请求，
// 而不是只看端口通不通）。这里只负责记录结果，刻意不去动上面那套已经验证过的
// 状态机——不会因为二层检测的结果去触发重启/流量池切换，那些仍然完全由
// TCP 层（checkPort）决定，这是最初的边界，不做扩大化改动。
//
// v34本轮新增(founder明确拍板):二层检测连续N次(默认3，config.usabilityCheck.
// suggestAfterFailures可覆盖)判定为down时，触发一条"仅建议、不重启"的通知——
// 明确不复用node.restartCommand，因为这层检测的典型场景是"隧道建好了但请求没
// 拿到预期结果"，重启代理进程大概率无济于事(真的是进程挂了那种情况，TCP层早就
// 测出来down了)。这条独立触发线用它自己的连续失败计数器(store.js的
// usabilityConsecutiveDown)，不跟TCP层的consecutiveFailures共用，两条线互不
// 影响、也各自独立清零。詳細的维护/排查教程本身这批先不做，只把已有知识库里
// 匹配到的条目(如果有)附在通知里，不新增知识库内容。
//
// v36本轮新增(founder明确拍板，打破上面"最初的边界"):如果二层检测持续down、
// 一直到一个比"仅建议"阈值更高的独立阈值(默认5次，config.usabilityCheck.
// autoRestartAfterFailures可覆盖)，才真的调用一次node.restartCommand。
// 之所以阈值要比suggestAfterFailures更高、且是独立的一条触发线(独立计数标记
// usabilityAutoRestartedThisIncident，不跟usabilitySuggestedThisIncident共用)：
// "仅建议"那条线本身的判断没错(重启对付不了"隧道通但请求没结果"这类情况)，
// 但founder拍板认为持续更久之后，即使大概率无效，"试一次总比完全不试强"，
// 所以放在明显更高的阈值上、且只允许每次发作期触发一次，跟TCP层的重启逻辑
// (runShell + bumpRestartCount)共用同一个执行/计数路径，行为跟"节点down"时
// 的自动重启保持一致，不另起一套。没配置node.restartCommand时直接跳过，
// 跟TCP层"if (node.restartCommand) {...}"的判断方式保持一致，不强制要求配置。
async function checkUsabilityAndLog(config) {
  const OUTER_TIMEOUT_MS = 20000; // 兜底超时：即便内部各层超时设置都失效，也不能无限期拖住检测循环
  let result;
  try {
    result = await Promise.race([
      runUsabilityCheck(config),
      new Promise((resolve) =>
        setTimeout(() => resolve({ outcome: 'check_error', code: 'USABILITY_OUTER_TIMEOUT', detail: '二层检测超时（超过 20 秒仍未返回结果）' }), OUTER_TIMEOUT_MS)
      )
    ]);
  } catch (err) {
    result = { outcome: 'check_error', code: 'USABILITY_UNEXPECTED_EXCEPTION', detail: '二层检测抛出异常：' + err.message };
  }

  if (result.outcome === 'unsupported') {
    // 未启用 / 订阅链接不是 vless+reality：完全不记录事件，避免每 5 分钟就刷一条没意义的日志。
    return;
  }

  const node = config.node || {};

  // 连续失败计数独立于下面"状态没变化就不记事件"的dedup逻辑——哪怕事件日志因为
  // dedup没有新增一条，连续次数也必须照常累加，否则"连续3次"会因为dedup漏计，
  // 变成事实上只在"从ok变成down"那一刻才算一次，永远数不到3。
  // check_error(检测手段本身有问题)既不算失败也不算恢复，故意不动这个计数器。
  if (result.outcome === 'ok') {
    store.resetUsabilityConsecutiveDown();
  } else if (result.outcome === 'down') {
    const consecutiveUsabilityDown = store.bumpUsabilityConsecutiveDown();
    const suggestThreshold = (config.usabilityCheck && config.usabilityCheck.suggestAfterFailures) || 3;
    if (shouldSuggestUsability({
      consecutiveUsabilityDown,
      suggestThreshold,
      alreadySuggestedThisIncident: store.hasSuggestedUsabilityIncident()
    })) {
      store.markSuggestedUsabilityIncident();
      const kbHits = await matchKbForEvent(result.code);
      store.addEvent('usability_restart_suggested', { node: node.name, code: result.code, detail: result.detail, kb: kbHits });
      try {
        const lang = (config.ai && config.ai.language) || 'en';
        await notify.notifyUsabilitySuggestion(config, { code: result.code, detail: result.detail, kbText: kbHitsToText(kbHits, lang) });
      } catch (err) {
        console.error('[checker] 二层可用性建议通知邮件发送失败：', err.message);
      }
    }

    const autoRestartThreshold = (config.usabilityCheck && config.usabilityCheck.autoRestartAfterFailures) || 5;
    if (shouldAutoRestartUsability({
      consecutiveUsabilityDown,
      autoRestartThreshold,
      alreadyAutoRestartedThisIncident: store.hasAutoRestartedUsabilityIncident(),
      hasRestartCommand: node.restartCommand
    })) {
      store.markAutoRestartedUsabilityIncident();
      const restartResult = await runShell(node.restartCommand);
      store.bumpRestartCount(restartResult.ok);
      const kbHits = await matchKbForEvent(result.code);
      store.addEvent('usability_auto_restart', {
        node: node.name,
        code: result.code,
        detail: result.detail,
        restartOk: restartResult.ok,
        kb: kbHits
      });
      try {
        const lang = (config.ai && config.ai.language) || 'en';
        await notify.notifyUsabilityAutoRestart(config, {
          code: result.code,
          detail: result.detail,
          kbText: kbHitsToText(kbHits, lang),
          restartOk: restartResult.ok
        });
      } catch (err) {
        console.error('[checker] 二层可用性自动重启通知邮件发送失败：', err.message);
      }
    }
  }

  const prevState = store.getState();
  if (prevState.usabilityStatus === result.outcome) {
    // 只在结果发生变化时才记常规事件（跟"down 期间不会一直刷 down"这条思路一致），
    // 避免 check_error/down 持续出现时把最近事件列表刷满，掩盖更重要的信息。
    // 上面的连续失败计数/建议通知不受这条影响，见上面的说明。
    return;
  }
  store.updateState({ usabilityStatus: result.outcome });

  if (result.outcome === 'ok') {
    store.addEvent('usability_ok', { node: node.name });
  } else if (result.outcome === 'down') {
    // code重构:跟着detail一起把result.code存进事件里，让检测源头判定的具体
    // 错误类型（比如usability-check.js/USABILITY_BAD_STATUS_CODE）一路传到
    // 事件日志。v34本轮新增:顺手做一次知识库匹配存进kb字段——主面板此前对这类
    // 事件只有写死的翻译文本，没有真正查知识库，这里补上，做法跟pool-events.js
    // 的attachKbMatches一致。
    const kb = await matchKbForEvent(result.code);
    store.addEvent('usability_down', { node: node.name, code: result.code, detail: result.detail, kb });
  } else {
    // check_error：检测手段本身出问题（比如 xray 二进制找不到、外部探测目标超时），
    // 明确跟"节点故障"区分开，前端要用不同文案，避免误导用户以为节点真的坏了。
    const kb = await matchKbForEvent(result.code);
    store.addEvent('usability_check_error', { node: node.name, code: result.code, detail: result.detail, kb });
  }
}

// 执行一次完整检测：查端口 -> 如果异常则尝试重启 -> 根据状态变化发通知 -> 记事件
async function runCheck(config) {
  const { node } = config;
  const isUp = await checkPort(node.checkHost, node.checkPort);
  const prevState = store.getState();
  const now = new Date().toISOString();

  store.updateState({ lastCheck: now });

  if (isUp) {
    store.resetConsecutiveFailures();
    if (prevState.status !== 'ok') {
      // 从异常/未知 → 正常，视为一次"恢复"
      const downMinutes = prevState.status === 'down' && prevState.since
        ? Math.round((Date.now() - new Date(prevState.since).getTime()) / 60000)
        : null;
      store.addEvent('recovered', { node: node.name, downMinutes });
      store.updateState({ status: 'ok', since: now });
      if (prevState.status === 'down') {
        try {
          await notify.notifyRecovered(config, prevState.since);
        } catch (err) {
          console.error('[checker] 恢复通知邮件发送失败：', err.message);
        }
      }
      // 自建节点恢复了，自动切回自建订阅、流量池停用（如果之前在用的话）——但如果当前是
      // 用户手动强制切到pool的（poolManualOverride），这条自动切回逻辑要跳过，等用户自己
      // 在面板上点开关切回来，不然手动切换形同虚设。
      if (prevState.activeSource === 'pool' && !prevState.poolManualOverride) {
        store.updateState({ activeSource: 'self' });
        store.addEvent('pool_deactivated', { node: node.name });
      }
    }
    // TCP 层判定"存活"之后，顺手跑二层真实可用性检测（不影响这里已经决定要返回的 'ok'）。
    await checkUsabilityAndLog(config);
    return { status: 'ok' };
  }

  // 本轮修复(真实bug,复查发现):这里此前是每次检测到端口不通就无条件记一条'down'事件,
  // 哪怕节点已经连续down了几十轮、状态完全没变化——跟 checkUsabilityAndLog() 里明确写的
  // "只在结果发生变化时才记事件,避免把最近事件列表刷满,掩盖更重要的信息"这条原则矛盾
  // (同一份代码库,同一类"持续异常"场景,处理方式却不一致)。默认5分钟一次检测,down几小时
  // 就是几十条一模一样的'down'事件,把 MAX_EVENTS=200 的事件环形缓冲区挤占掉一大截,
  // 挤掉本该更有参考价值的记录(比如恢复、AI诊断)。改成只在"从非down转为down"时才记一条,
  // 重启尝试/重启失败仍然照常每轮都记(那部分信息本身每轮都不同,不受这条修复影响)。
  const wasAlreadyDown = prevState.status === 'down';
  if (!wasAlreadyDown) {
    store.addEvent('down', { node: node.name, port: node.checkPort });
  }
  if (prevState.status === 'ok' || prevState.status === 'unknown') {
    store.updateState({ status: 'down', since: now });
  }
  const consecutiveFailures = store.bumpConsecutiveFailures();

  if (node.restartCommand) {
    const result = await runShell(node.restartCommand);
    // 发现4修复：把这次重启是否真的成功传给计数器，尝试次数和成功次数分开统计。
    store.bumpRestartCount(result.ok);
    if (result.ok) {
      store.addEvent('restart', { node: node.name, serviceName: node.serviceName });
    } else {
      const errorSnippet = (result.stderr || String(result.error) || '').toString().slice(0, 200);
      store.addEvent('restart_failed', { node: node.name, error: errorSnippet });
    }
  }

  try {
    await notify.notifyDown(config, node.checkHost, node.checkPort);
  } catch (err) {
    console.error('[checker] 异常通知邮件发送失败：', err.message);
  }

  // AI 故障诊断：只在"持续异常"（连续失败次数刚好达到阈值）时触发一次，
  // 不是每次检测都调用，避免单次抖动就烧用户的 API 额度，也避免同一次异常发作期内反复调用。
  // 只出诊断建议，不做任何自动决策或自动执行。
  const aiConfig = config.ai;
  const triggerThreshold = (aiConfig && aiConfig.triggerAfterFailures) || 3;
  // 用 >= 而不是 ===：如果用户是在节点已经连续失败超过阈值之后才启用AI诊断并重启进程，
  // 计数器会直接跳过那个"恰好等于阈值"的时间点，严格相等就永远不会触发。
  // 用 aiDiagnosedThisIncident 保证同一次故障期只自动触发一次，恢复后清零，不会因为 >= 而反复调用。
  if (
    aiConfig &&
    aiConfig.enabled &&
    consecutiveFailures >= triggerThreshold &&
    !store.hasAiDiagnosedThisIncident()
  ) {
    store.markAiDiagnosedThisIncident();
    try {
      const diagnosisText = await ai.diagnose({
        providerConfig: aiConfig,
        nodeInfo: node,
        events: store.getEvents(20)
      });
      store.setLastDiagnosis({ at: new Date().toISOString(), text: diagnosisText, error: null });
      store.addEvent('ai_diagnosis', { node: node.name });
      try {
        await notify.notifyDiagnosis(config, diagnosisText);
      } catch (err) {
        console.error('[checker] AI 诊断邮件发送失败：', err.message);
      }
    } catch (err) {
      store.setLastDiagnosis({ at: new Date().toISOString(), text: null, error: err.message });
      store.addEvent('ai_diagnosis_failed', { node: node.name, error: err.message.slice(0, 200) });
      console.error('[checker] AI 诊断调用失败：', err.message);
    }
  }

  // 自建节点异常：如果流量池功能开着、且池子里当前有节点，就临时切过去应急，
  // 只是切换"对外提供的订阅内容"，不代表节点已经修好——这只是安全气囊。
  if (config.pool && config.pool.enabled && prevState.activeSource !== 'pool') {
    const poolData = pool.getPool();
    if (poolData.nodes && poolData.nodes.length > 0) {
      store.updateState({ activeSource: 'pool' });
      store.addEvent('pool_activated', { node: node.name, count: poolData.nodes.length });
    } else {
      store.addEvent('pool_unavailable', { node: node.name });
    }
  }

  return { status: 'down' };
}

module.exports = {
  runCheck,
  checkPort,
  // 导出方便单测，见test-usability-auto-restart.js
  _internal: { shouldSuggestUsability, shouldAutoRestartUsability }
};
