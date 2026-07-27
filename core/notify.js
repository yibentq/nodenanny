'use strict';

const nodemailer = require('nodemailer');
const store = require('./store');

let cachedTransporter = null;

function getTransporter(smtpConfig) {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass
    }
  });
  return cachedTransporter;
}

// SMTP 是否已实际配置（跳过时 host/user/pass 是占位值或空，不应该尝试发信）
function smtpConfigured(smtpConfig) {
  if (!smtpConfig) return false;
  const { host, user, pass } = smtpConfig;
  // 任何一个关键字段为空、或者还是 example.com 占位域名，视为未配置
  if (!host || !user || !pass) return false;
  if (host === 'smtp.example.com') return false;
  if (user === 'you@example.com') return false;
  // 值里含中文字符说明还是写-config.js 的说明性占位文字，还没换成真实值
  if (/[\u4e00-\u9fff]/.test(pass) || /[\u4e00-\u9fff]/.test(user)) return false;
  return true;
}

// 冷却时间内不重复发信，避免节点在阈值边缘反复抖动时邮箱被刷屏
function withinCooldown(cooldownMinutes) {
  const state = store.getState();
  if (!state.lastNotifyAt) return false;
  const elapsedMs = Date.now() - new Date(state.lastNotifyAt).getTime();
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

async function send(smtpConfig, subject, bodyText) {
  const transporter = getTransporter(smtpConfig);
  await transporter.sendMail({
    from: smtpConfig.from,
    to: smtpConfig.to,
    subject,
    text: bodyText
  });
  // 真实bug修复(本轮复查发现):这里此前无条件更新lastNotifyAt，但lastNotifyAt
  // 是notifyDown专用的冷却计时字段(withinCooldown只给notifyDown用)。send()是四种
  // 邮件(down/recovered/diagnosis/usability建议)共用的底层发信函数，如果recovered/
  // diagnosis/usability建议邮件也顺手把lastNotifyAt刷新了，会导致：这几类邮件发出
  // 后的冷却时间内(默认30分钟)如果节点真的又挂了，notifyDown会误判"还在冷却期"而
  // 跳过本该发送的异常通知——用户可能因此完全收不到"节点down了"这封最重要的邮件。
  // 这跟notifyUsabilitySuggestion那边"故意不复用notifyDown冷却状态"的注释初衷矛盾
  // (意图是对的，但因为共用send()，实际代码没做到隔离)。改成lastNotifyAt只由
  // notifyDown自己在发信成功后更新，send()变成纯粹的发信函数，不再动任何冷却状态。
}

// 五语言邮件模板。ai.language 决定诊断邮件语言，node 通知邮件跟随同一个语言设置。
// 如果 config.ai.language 未设，回退英文（国际通用，安全的默认值）。
const TEMPLATES = {
  zh: {
    downSubject: (name) => `【NodeNanny】${name} 节点异常`,
    downBody: (name, host, port, time) => [
      `${name} 检测到异常，NodeNanny 已经在尝试自动重启。`,
      '',
      `检测时间：${time}`,
      `检测地址：${host}:${port}`,
      '',
      '如果之后收到"已恢复"的邮件，说明已经自动修好了，不用管。',
      '如果一直没收到恢复邮件，可能需要你登录服务器看一下。'
    ].join('\n'),
    recoveredSubject: (name) => `【NodeNanny】${name} 节点已恢复`,
    recoveredBody: (name, time, downMinutes) => [
      `${name} 已经恢复正常，NodeNanny 继续在后台盯着，你不用做任何事。`,
      '',
      `恢复时间：${time}`,
      downMinutes !== null ? `本次异常持续约 ${downMinutes} 分钟。` : ''
    ].join('\n'),
    diagSubject: (name) => `【NodeNanny】${name} 的 AI 故障诊断建议`,
    diagBody: (name, text, time) => [
      `${name} 持续异常了一段时间，这是 AI 给出的诊断建议（仅供参考，不会自动执行任何操作）：`,
      '',
      text,
      '',
      `生成时间：${time}`,
      '',
      '你也可以随时登录面板查看这条建议。'
    ].join('\n'),
    // 本轮新增:二层可用性检测连续N次失败的"仅建议"通知，跟downSubject/downBody
    // 明确区分开——这里不会触发重启(重启对"隧道通了但请求没拿到预期结果"这种
    // 情况大概率没用)，纯粹是提醒你去看一眼，附带知识库匹配到的建议(如果有的话)。
    usabilitySuggestSubject: (name) => `【NodeNanny】${name} 二层可用性检测连续异常（仅提醒，未触发重启）`,
    usabilitySuggestBody: (name, code, detail, kbText, time) => [
      `${name} 的二层可用性检测（真实代理请求，而不只是端口探测）连续多次没有通过。`,
      '这不会触发自动重启——隧道本身能建立，但请求没拿到预期结果，重启代理进程大概率无济于事，需要人工看一眼（比如是否被针对性干扰、路由是否有问题）。',
      '',
      `具体现象：${detail || code || '未知'}`,
      kbText ? '\n知识库里匹配到的相关建议：\n' + kbText : '',
      '',
      `检测时间：${time}`,
      '',
      '你也可以随时登录面板查看这条提醒。'
    ].join('\n'),
    // v36新增(founder拍板):二层检测连续更多次(比"仅建议"的阈值更高)判定为down时，
    // 真的调用node.restartCommand重启本地代理一次，并单独发一封信告知——跟上面
    // usabilitySuggest的"我们判断重启大概率没用"那句话正好相反的场景说明，这里
    // 要如实说明"已经自动重启过一次了"，避免用户以为NodeNanny没反应。
    usabilityAutoRestartSubject: (name) => `【NodeNanny】${name} 二层可用性检测持续异常，已自动重启一次`,
    usabilityAutoRestartBody: (name, code, detail, kbText, restartOk, time) => [
      `${name} 的二层可用性检测（真实代理请求）连续多次没有通过，NodeNanny 已经自动重启了一次本地代理进程。`,
      restartOk
        ? '重启命令已成功执行。如果之后收到"已恢复"的邮件，说明重启起作用了；如果没有，可能是端口层面还检测不到变化，或者问题不是重启能解决的（比如被针对性干扰），建议登录看一下。'
        : '重启命令执行失败了（服务器上可能有权限问题或者restartCommand配置有误），需要你登录服务器手动看一下。',
      '',
      `具体现象：${detail || code || '未知'}`,
      kbText ? '\n知识库里匹配到的相关建议：\n' + kbText : '',
      '',
      `触发时间：${time}`,
      '',
      '这次发作期内不会重复自动重启，如果问题持续存在，请手动排查。'
    ].join('\n')
  },
  en: {
    downSubject: (name) => `[NodeNanny] ${name} node is down`,
    downBody: (name, host, port, time) => [
      `${name} is unreachable. NodeNanny has already attempted an automatic restart.`,
      '',
      `Detected at: ${time}`,
      `Target: ${host}:${port}`,
      '',
      'If you later receive a "recovered" email, it fixed itself automatically — nothing to do.',
      'If no recovery email arrives, you may need to log in to the server and investigate.'
    ].join('\n'),
    recoveredSubject: (name) => `[NodeNanny] ${name} node recovered`,
    recoveredBody: (name, time, downMinutes) => [
      `${name} is back online. NodeNanny is watching in the background — nothing you need to do.`,
      '',
      `Recovered at: ${time}`,
      downMinutes !== null ? `Total downtime: ~${downMinutes} minute(s).` : ''
    ].join('\n'),
    diagSubject: (name) => `[NodeNanny] AI diagnosis suggestion for ${name}`,
    diagBody: (name, text, time) => [
      `${name} has been down for a while. Here is the AI diagnosis (advisory only — nothing is executed automatically):`,
      '',
      text,
      '',
      `Generated at: ${time}`,
      '',
      'You can also view this suggestion any time in the panel.'
    ].join('\n'),
    usabilitySuggestSubject: (name) => `[NodeNanny] ${name}: repeated layer-2 usability failures (advisory only, no restart)`,
    usabilitySuggestBody: (name, code, detail, kbText, time) => [
      `${name}'s layer-2 usability check (a real proxy request, not just a port probe) has failed several times in a row.`,
      "This will not trigger an automatic restart — the tunnel itself connects fine, but the request didn't get the expected result, so restarting the proxy process is unlikely to help. Worth a manual look (possible targeted interference, routing issue, etc.).",
      '',
      `Detail: ${detail || code || 'unknown'}`,
      kbText ? '\nRelated knowledge-base suggestions:\n' + kbText : '',
      '',
      `Detected at: ${time}`,
      '',
      'You can also view this notice any time in the panel.'
    ].join('\n'),
    usabilityAutoRestartSubject: (name) => `[NodeNanny] ${name}: persistent layer-2 usability failures, auto-restarted once`,
    usabilityAutoRestartBody: (name, code, detail, kbText, restartOk, time) => [
      `${name}'s layer-2 usability check (a real proxy request) has failed repeatedly, so NodeNanny automatically restarted the local proxy process once.`,
      restartOk
        ? 'The restart command ran successfully. If a "recovered" email follows, the restart fixed it; if not, the issue may not be something a restart can fix (e.g. targeted interference) — worth a manual look.'
        : 'The restart command failed to run (possibly a permissions issue on the server, or a misconfigured restartCommand). Please log in and check manually.',
      '',
      `Detail: ${detail || code || 'unknown'}`,
      kbText ? '\nRelated knowledge-base suggestions:\n' + kbText : '',
      '',
      `Triggered at: ${time}`,
      '',
      "NodeNanny won't auto-restart again during this same incident. If the issue persists, please investigate manually."
    ].join('\n')
  },
  ja: {
    downSubject: (name) => `【NodeNanny】${name} ノードに障害が発生しました`,
    downBody: (name, host, port, time) => [
      `${name} に接続できません。NodeNanny は自動再起動を試みました。`,
      '',
      `検出時刻：${time}`,
      `対象アドレス：${host}:${port}`,
      '',
      'その後「復旧しました」というメールが届いた場合、自動修復されています。対応は不要です。',
      '復旧メールが届かない場合は、サーバーにログインして確認してください。'
    ].join('\n'),
    recoveredSubject: (name) => `【NodeNanny】${name} ノードが復旧しました`,
    recoveredBody: (name, time, downMinutes) => [
      `${name} が正常に復旧しました。NodeNanny がバックグラウンドで引き続き監視します。対応は不要です。`,
      '',
      `復旧時刻：${time}`,
      downMinutes !== null ? `今回の障害時間：約 ${downMinutes} 分。` : ''
    ].join('\n'),
    diagSubject: (name) => `【NodeNanny】${name} の AI 故障診断レポート`,
    diagBody: (name, text, time) => [
      `${name} がしばらく停止しています。以下は AI による診断提案です（参考のみ、自動実行は一切しません）：`,
      '',
      text,
      '',
      `生成時刻：${time}`,
      '',
      'パネルからいつでもこの提案を確認できます。'
    ].join('\n'),
    usabilitySuggestSubject: (name) => `【NodeNanny】${name} 二層可用性チェックが連続して失敗（通知のみ、再起動なし）`,
    usabilitySuggestBody: (name, code, detail, kbText, time) => [
      `${name} の二層可用性チェック（実際のプロキシリクエスト、ポート探査だけではない）が連続して失敗しています。`,
      'これにより自動再起動は行われません——トンネル自体は確立できていますが、リクエストが期待した結果を得られていないため、プロセスの再起動はほとんど役に立ちません。手動での確認をおすすめします（意図的な妨害やルーティングの問題などの可能性）。',
      '',
      `詳細：${detail || code || '不明'}`,
      kbText ? '\n知識ベースの関連する提案：\n' + kbText : '',
      '',
      `検出時刻：${time}`,
      '',
      'パネルからいつでもこの通知を確認できます。'
    ].join('\n'),
    usabilityAutoRestartSubject: (name) => `【NodeNanny】${name} 二層可用性チェックが持続的に異常、自動的に一度再起動しました`,
    usabilityAutoRestartBody: (name, code, detail, kbText, restartOk, time) => [
      `${name} の二層可用性チェック（実際のプロキシリクエスト）が連続して失敗したため、NodeNanny はローカルのプロキシプロセスを自動的に一度再起動しました。`,
      restartOk
        ? '再起動コマンドは正常に実行されました。この後「復旧しました」というメールが届けば再起動で直ったということです。届かない場合は再起動では解決しない問題（意図的な妨害など）の可能性があるため、手動での確認をおすすめします。'
        : '再起動コマンドの実行に失敗しました（サーバー側の権限の問題、またはrestartCommandの設定ミスの可能性があります）。サーバーにログインして手動で確認してください。',
      '',
      `詳細：${detail || code || '不明'}`,
      kbText ? '\n知識ベースの関連する提案：\n' + kbText : '',
      '',
      `発生時刻：${time}`,
      '',
      '今回の発作期間中は再度の自動再起動は行いません。問題が続く場合は手動で調査してください。'
    ].join('\n')
  },
  de: {
    downSubject: (name) => `[NodeNanny] ${name} Node ausgefallen`,
    downBody: (name, host, port, time) => [
      `${name} ist nicht erreichbar. NodeNanny hat bereits einen automatischen Neustart versucht.`,
      '',
      `Erkannt um: ${time}`,
      `Ziel: ${host}:${port}`,
      '',
      'Falls du später eine "Wiederhergestellt"-E-Mail erhältst, hat es sich automatisch repariert — nichts zu tun.',
      'Wenn keine Wiederherstellungs-E-Mail ankommt, musst du dich möglicherweise am Server einloggen und nachsehen.'
    ].join('\n'),
    recoveredSubject: (name) => `[NodeNanny] ${name} Node wiederhergestellt`,
    recoveredBody: (name, time, downMinutes) => [
      `${name} ist wieder online. NodeNanny überwacht weiter im Hintergrund — du musst nichts tun.`,
      '',
      `Wiederhergestellt um: ${time}`,
      downMinutes !== null ? `Gesamtausfallzeit: ca. ${downMinutes} Minute(n).` : ''
    ].join('\n'),
    diagSubject: (name) => `[NodeNanny] KI-Diagnosevorschlag für ${name}`,
    diagBody: (name, text, time) => [
      `${name} ist schon eine Weile ausgefallen. Hier ist die KI-Diagnose (nur Hinweis — es wird nichts automatisch ausgeführt):`,
      '',
      text,
      '',
      `Erstellt um: ${time}`,
      '',
      'Du kannst diesen Vorschlag jederzeit im Panel ansehen.'
    ].join('\n'),
    usabilitySuggestSubject: (name) => `[NodeNanny] ${name}: wiederholte Layer-2-Nutzbarkeitsfehler (nur Hinweis, kein Neustart)`,
    usabilitySuggestBody: (name, code, detail, kbText, time) => [
      `Die Layer-2-Nutzbarkeitsprüfung von ${name} (eine echte Proxy-Anfrage, nicht nur ein Port-Test) ist mehrmals hintereinander fehlgeschlagen.`,
      'Das löst keinen automatischen Neustart aus — der Tunnel selbst steht, aber die Anfrage lieferte nicht das erwartete Ergebnis, ein Neustart des Prozesses würde hier wahrscheinlich nichts bringen. Ein manueller Blick lohnt sich (mögliche gezielte Störung, Routing-Problem usw.).',
      '',
      `Details: ${detail || code || 'unbekannt'}`,
      kbText ? '\nZugehörige Vorschläge aus der Wissensdatenbank:\n' + kbText : '',
      '',
      `Erkannt um: ${time}`,
      '',
      'Du kannst diesen Hinweis jederzeit im Panel ansehen.'
    ].join('\n'),
    usabilityAutoRestartSubject: (name) => `[NodeNanny] ${name}: anhaltende Layer-2-Nutzbarkeitsfehler, einmal automatisch neu gestartet`,
    usabilityAutoRestartBody: (name, code, detail, kbText, restartOk, time) => [
      `Die Layer-2-Nutzbarkeitsprüfung von ${name} (eine echte Proxy-Anfrage) ist wiederholt fehlgeschlagen, daher hat NodeNanny den lokalen Proxy-Prozess automatisch einmal neu gestartet.`,
      restartOk
        ? 'Der Neustart-Befehl wurde erfolgreich ausgeführt. Wenn danach eine "Wiederhergestellt"-E-Mail kommt, hat der Neustart geholfen; wenn nicht, liegt das Problem möglicherweise woanders (z. B. gezielte Störung) — ein manueller Blick lohnt sich.'
        : 'Der Neustart-Befehl konnte nicht ausgeführt werden (möglicherweise ein Berechtigungsproblem auf dem Server oder ein falsch konfigurierter restartCommand). Bitte logg dich ein und prüfe manuell.',
      '',
      `Details: ${detail || code || 'unbekannt'}`,
      kbText ? '\nZugehörige Vorschläge aus der Wissensdatenbank:\n' + kbText : '',
      '',
      `Ausgelöst um: ${time}`,
      '',
      'NodeNanny wird während dieses Vorfalls nicht erneut automatisch neu starten. Bitte bei anhaltendem Problem manuell prüfen.'
    ].join('\n')
  },
  ru: {
    downSubject: (name) => `[NodeNanny] Узел ${name} недоступен`,
    downBody: (name, host, port, time) => [
      `${name} недоступен. NodeNanny уже попытался выполнить автоматический перезапуск.`,
      '',
      `Обнаружено в: ${time}`,
      `Адрес: ${host}:${port}`,
      '',
      'Если позже придёт письмо "восстановлен" — всё починилось автоматически, делать ничего не нужно.',
      'Если письмо о восстановлении не пришло — возможно, нужно войти на сервер и разобраться.'
    ].join('\n'),
    recoveredSubject: (name) => `[NodeNanny] Узел ${name} восстановлен`,
    recoveredBody: (name, time, downMinutes) => [
      `${name} снова работает. NodeNanny продолжает наблюдение в фоне — ничего делать не нужно.`,
      '',
      `Восстановлен в: ${time}`,
      downMinutes !== null ? `Общее время простоя: ~${downMinutes} мин.` : ''
    ].join('\n'),
    diagSubject: (name) => `[NodeNanny] Рекомендация ИИ-диагностики для ${name}`,
    diagBody: (name, text, time) => [
      `${name} недоступен уже некоторое время. Вот рекомендация ИИ-диагностики (только совет — ничего не выполняется автоматически):`,
      '',
      text,
      '',
      `Создано в: ${time}`,
      '',
      'Вы также можете посмотреть эту рекомендацию в панели в любое время.'
    ].join('\n'),
    usabilitySuggestSubject: (name) => `[NodeNanny] ${name}: повторные сбои проверки реальной доступности (только уведомление, без перезапуска)`,
    usabilitySuggestBody: (name, code, detail, kbText, time) => [
      `Проверка реальной доступности (layer-2) узла ${name} — настоящий запрос через прокси, а не просто проверка порта — несколько раз подряд не пройдена.`,
      'Это не вызовет автоматический перезапуск: туннель устанавливается нормально, но запрос не дал ожидаемого результата, поэтому перезапуск процесса вряд ли поможет. Стоит проверить вручную (возможна целевая блокировка, проблема с маршрутизацией и т.п.).',
      '',
      `Подробности: ${detail || code || 'неизвестно'}`,
      kbText ? '\nСвязанные рекомендации из базы знаний:\n' + kbText : '',
      '',
      `Обнаружено в: ${time}`,
      '',
      'Вы также можете посмотреть это уведомление в панели в любое время.'
    ].join('\n'),
    usabilityAutoRestartSubject: (name) => `[NodeNanny] ${name}: постоянные сбои проверки реальной доступности, выполнен автоматический перезапуск`,
    usabilityAutoRestartBody: (name, code, detail, kbText, restartOk, time) => [
      `Проверка реальной доступности (layer-2) узла ${name} (настоящий запрос через прокси) неоднократно не проходила, поэтому NodeNanny автоматически перезапустил локальный процесс прокси один раз.`,
      restartOk
        ? 'Команда перезапуска выполнена успешно. Если после этого придёт письмо "восстановлен" — перезапуск помог; если нет, проблема может быть не в том, что решается перезапуском (например, целевая блокировка) — стоит проверить вручную.'
        : 'Команда перезапуска не выполнилась (возможна проблема с правами на сервере или неверно настроен restartCommand). Пожалуйста, войдите на сервер и проверьте вручную.',
      '',
      `Подробности: ${detail || code || 'неизвестно'}`,
      kbText ? '\nСвязанные рекомендации из базы знаний:\n' + kbText : '',
      '',
      `Обнаружено в: ${time}`,
      '',
      'В течение этого инцидента повторный автоматический перезапуск выполняться не будет. Если проблема сохраняется, проверьте вручную.'
    ].join('\n')
  }
};

function getTpl(config) {
  const lang = (config.ai && config.ai.language) || 'en';
  return TEMPLATES[lang] || TEMPLATES.en;
}

function nowStr(config) {
  const lang = (config.ai && config.ai.language) || 'en';
  // zh/ja 用本地格式，其余 ISO-like
  const locale = { zh: 'zh-CN', ja: 'ja-JP', de: 'de-DE', ru: 'ru-RU', en: 'en-US' }[lang] || 'en-US';
  return new Date().toLocaleString(locale);
}

async function notifyDown(config, host, port) {
  if (!smtpConfigured(config.smtp)) {
    console.log('[notify] SMTP 未配置，跳过异常通知邮件');
    return;
  }
  if (withinCooldown(config.monitor.notifyCooldownMinutes)) {
    console.log('[notify] 冷却中，本次不重复发送异常邮件');
    return;
  }
  const tpl = getTpl(config);
  const nodeName = config.node.name;
  await send(
    config.smtp,
    tpl.downSubject(nodeName),
    tpl.downBody(nodeName, host, port, nowStr(config))
  );
  // lastNotifyAt现在只在这里更新(down邮件专属冷却)，见上面send()里的说明。
  store.updateState({ lastNotifyAt: new Date().toISOString() });
}

async function notifyRecovered(config, downSinceIso) {
  if (!smtpConfigured(config.smtp)) {
    console.log('[notify] SMTP 未配置，跳过恢复通知邮件');
    return;
  }
  const tpl = getTpl(config);
  const nodeName = config.node.name;
  const downSince = downSinceIso ? new Date(downSinceIso) : null;
  const downMinutes = downSince
    ? Math.round((Date.now() - downSince.getTime()) / 60000)
    : null;
  await send(
    config.smtp,
    tpl.recoveredSubject(nodeName),
    tpl.recoveredBody(nodeName, nowStr(config), downMinutes)
  );
}

// AI 诊断结果通知：跟异常通知是分开的两封邮件，因为诊断要等「连续失败达到阈值」才会出结果，
// 时间点跟第一封异常邮件对不上，硬塞进去反而让用户等邮件等半天。这封信不占用 notifyDown 的冷却时间，
// 只在诊断真的出结果时发一次（每次异常发作期最多一次，由 checker.js 控制触发次数）。
async function notifyDiagnosis(config, diagnosisText) {
  if (!smtpConfigured(config.smtp)) {
    console.log('[notify] SMTP 未配置，跳过 AI 诊断通知邮件');
    return;
  }
  const tpl = getTpl(config);
  const nodeName = config.node.name;
  await send(
    config.smtp,
    tpl.diagSubject(nodeName),
    tpl.diagBody(nodeName, diagnosisText, nowStr(config))
  );
}

// 二层可用性检测连续N次失败时的"仅建议"通知(v34本轮新增)。跟notifyDown是两条
// 完全独立的通知线——不复用notifyDown的冷却状态(lastNotifyAt)，避免TCP层的down
// 邮件把这封本该独立发出的邮件的冷却时间占掉；用同一个notifyCooldownMinutes配置项，
// 但冷却计时字段单独存(lastUsabilitySuggestAt)。
function withinUsabilitySuggestCooldown(cooldownMinutes) {
  const state = store.getState();
  if (!state.lastUsabilitySuggestAt) return false;
  const elapsedMs = Date.now() - new Date(state.lastUsabilitySuggestAt).getTime();
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

async function notifyUsabilitySuggestion(config, { code, detail, kbText }) {
  if (!smtpConfigured(config.smtp)) {
    console.log('[notify] SMTP 未配置，跳过二层可用性建议通知邮件');
    return;
  }
  const cooldownMinutes = (config.monitor && config.monitor.notifyCooldownMinutes) || 0;
  if (withinUsabilitySuggestCooldown(cooldownMinutes)) {
    console.log('[notify] 冷却中，本次不重复发送二层可用性建议邮件');
    return;
  }
  const tpl = getTpl(config);
  const nodeName = config.node.name;
  await send(
    config.smtp,
    tpl.usabilitySuggestSubject(nodeName),
    tpl.usabilitySuggestBody(nodeName, code, detail, kbText, nowStr(config))
  );
  store.updateState({ lastUsabilitySuggestAt: new Date().toISOString() });
}

// 二层检测触发自动重启后的通知(v36新增)。故意不复用notifyDown/
// notifyUsabilitySuggestion的冷却字段——三条通知线各自独立记录"上次发送时间"，
// 理由跟notifyUsabilitySuggestion顶部注释一致：共用冷却字段会导致其中一条
// 抢占另一条的发送窗口，用户可能因此错过某一类邮件。
function withinUsabilityAutoRestartCooldown(cooldownMinutes) {
  const state = store.getState();
  if (!state.lastUsabilityAutoRestartAt) return false;
  const elapsedMs = Date.now() - new Date(state.lastUsabilityAutoRestartAt).getTime();
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

async function notifyUsabilityAutoRestart(config, { code, detail, kbText, restartOk }) {
  if (!smtpConfigured(config.smtp)) {
    console.log('[notify] SMTP 未配置，跳过二层可用性自动重启通知邮件');
    return;
  }
  const cooldownMinutes = (config.monitor && config.monitor.notifyCooldownMinutes) || 0;
  if (withinUsabilityAutoRestartCooldown(cooldownMinutes)) {
    console.log('[notify] 冷却中，本次不重复发送二层可用性自动重启邮件');
    return;
  }
  const tpl = getTpl(config);
  const nodeName = config.node.name;
  await send(
    config.smtp,
    tpl.usabilityAutoRestartSubject(nodeName),
    tpl.usabilityAutoRestartBody(nodeName, code, detail, kbText, restartOk, nowStr(config))
  );
  store.updateState({ lastUsabilityAutoRestartAt: new Date().toISOString() });
}

module.exports = { notifyDown, notifyRecovered, notifyDiagnosis, notifyUsabilitySuggestion, notifyUsabilityAutoRestart };
