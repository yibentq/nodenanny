'use strict';

// AI 故障诊断 provider 抽象层。
//
// 只做一件事：用户自带 API Key，直连官方 API 要一段诊断建议。不代理、不转发、
// 不经过 NodeNanny 自己的服务器、不收集数据，成本永远是 $0。
// 现在实现 anthropic 和 openai 两个具体 provider，接口统一（都是 diagnose()），
// 以后要加别的 provider，只需要在这个文件里加一个 case 分支，不用动 checker.js。
//
// 只出建议，不做任何自动决策或自动执行——这是拍过板的原则，不要在这里加"自动重启/自动切换"之类的逻辑。

const https = require('https');

// 面板五语言（中/英/日/德/俄）对应的语言代码，跟 public/index.html 的 I18N 字典保持一致。
// ai.language 决定：① 诊断正文用哪种语言写 ② 诊断失败时 error 文本用哪种语言——
// 这两块是"实质信息"，不是 UI 外壳，之前被漏掉本地化，这里补上。
const SUPPORTED_LANGS = ['zh', 'en', 'ja', 'de', 'ru'];

const LANG_NAMES = {
  zh: '简体中文',
  en: 'English',
  ja: '日本語',
  de: 'Deutsch',
  ru: 'русский язык'
};

// 每种语言各一份错误文案。新增错误类型时，五种语言都要补上，不能只写中文
// ——这是项目本身的规则（新增事件类型/文案都要五语言齐全），之前 AI 报错部分没有照做。
const ERR = {
  zh: {
    notEnabled: 'AI 诊断未启用',
    noApiKey: '未配置 API Key',
    apiKeyPlaceholder: 'API Key 看起来还是配置模板里的说明文字，还没换成你自己的真实 Key',
    unsupportedProvider: (p) => `不支持的 AI provider：${p}`,
    parseFail: (m) => `AI 接口响应解析失败：${m}`,
    httpError: (code, msg) => `AI 接口返回 HTTP ${code}：${msg}`,
    timeout: 'AI 接口请求超时',
    reqFail: (m) => `AI 接口请求失败：${m}`,
    emptyResult: 'AI 返回了空结果'
  },
  en: {
    notEnabled: 'AI diagnosis is not enabled',
    noApiKey: 'No API Key configured',
    apiKeyPlaceholder: 'The API Key still looks like the template placeholder text — replace it with your real key',
    unsupportedProvider: (p) => `Unsupported AI provider: ${p}`,
    parseFail: (m) => `Failed to parse AI response: ${m}`,
    httpError: (code, msg) => `AI API returned HTTP ${code}: ${msg}`,
    timeout: 'AI API request timed out',
    reqFail: (m) => `AI API request failed: ${m}`,
    emptyResult: 'AI returned an empty result'
  },
  ja: {
    notEnabled: 'AI診断が有効になっていません',
    noApiKey: 'APIキーが設定されていません',
    apiKeyPlaceholder: 'APIキーがまだテンプレートの説明文のままのようです。実際のキーに置き換えてください',
    unsupportedProvider: (p) => `サポートされていないAIプロバイダーです：${p}`,
    parseFail: (m) => `AI応答の解析に失敗しました：${m}`,
    httpError: (code, msg) => `AI APIがHTTP ${code}を返しました：${msg}`,
    timeout: 'AI APIリクエストがタイムアウトしました',
    reqFail: (m) => `AI APIリクエストに失敗しました：${m}`,
    emptyResult: 'AIが空の結果を返しました'
  },
  de: {
    notEnabled: 'KI-Diagnose ist nicht aktiviert',
    noApiKey: 'Kein API-Key konfiguriert',
    apiKeyPlaceholder: 'Der API-Key sieht noch nach dem Platzhaltertext der Vorlage aus — bitte durch deinen echten Key ersetzen',
    unsupportedProvider: (p) => `Nicht unterstützter AI-Provider: ${p}`,
    parseFail: (m) => `AI-Antwort konnte nicht geparst werden: ${m}`,
    httpError: (code, msg) => `AI-API antwortete mit HTTP ${code}: ${msg}`,
    timeout: 'AI-API-Anfrage hat das Zeitlimit überschritten',
    reqFail: (m) => `AI-API-Anfrage fehlgeschlagen: ${m}`,
    emptyResult: 'AI hat ein leeres Ergebnis zurückgegeben'
  },
  ru: {
    notEnabled: 'ИИ-диагностика не включена',
    noApiKey: 'API-ключ не настроен',
    apiKeyPlaceholder: 'API-ключ похож на текст-плейсхолдер из шаблона — замените его на свой настоящий ключ',
    unsupportedProvider: (p) => `Неподдерживаемый провайдер ИИ: ${p}`,
    parseFail: (m) => `Не удалось разобрать ответ ИИ: ${m}`,
    httpError: (code, msg) => `API ИИ вернул HTTP ${code}: ${msg}`,
    timeout: 'Истекло время ожидания запроса к API ИИ',
    reqFail: (m) => `Запрос к API ИИ не удался: ${m}`,
    emptyResult: 'ИИ вернул пустой результат'
  }
};

// ---------- 第三方/免费模型脱敏（交接文档v4第二节第4条：发给第三方AI的内容要脱敏）----------
// 只对"openai-compatible"这一类（智谱、DeepSeek等用户自己配置base_url的第三方/免费接口）
// 做脱敏；官方 anthropic/openai 走的是用户自己的Key直连官方API，属于原有设计里"不代理、
// 不转发、不经过NodeNanny自己的服务器"的信任边界内，不需要额外脱敏（脱敏是给"数据留存政策
// 不透明的免费接口"设的门槛，不是不信任Anthropic/OpenAI官方API本身）。
function redactHost(host) {
  if (!host) return host;
  // IP地址：只保留网段，把最后一段打码，比如 1.2.3.4 -> 1.2.3.***
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.replace(/\.\d{1,3}$/, '.***');
  }
  // 域名：保留顶级域和一级子域结构信息，隐去更具体的子域标识
  const parts = host.split('.');
  if (parts.length > 2) {
    return `***.${parts.slice(-2).join('.')}`;
  }
  return host;
}

function redactUrlsInText(text) {
  if (!text) return text;
  return String(text).replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g, '[redacted-url]');
}

function sanitizeNodeInfoForThirdParty(nodeInfo) {
  return Object.assign({}, nodeInfo, {
    checkHost: redactHost(nodeInfo.checkHost),
    name: nodeInfo.name // 节点名一般是用户自己起的别名，不算敏感网络位置信息，保留有助于AI理解上下文
  });
}

function sanitizeEventsForThirdParty(events) {
  return (events || []).map((e) => {
    const params = {};
    for (const [k, v] of Object.entries(e.params || {})) {
      params[k] = redactUrlsInText(v);
    }
    return Object.assign({}, e, { params });
  });
}

function getLang(providerConfig) {
  const lang = providerConfig && providerConfig.language;
  return SUPPORTED_LANGS.includes(lang) ? lang : 'zh';
}

// 配置文件里如果还留着"在这里填你自己的...Key"这类说明性占位文字（而不是真正留空），
// 会被当成非空字符串通过校验，直接拿去调 API 得到一个莫名其妙的 401，而不是清晰的本地提示。
// 占位文字的共同特征是夹杂中文说明，真正的 API Key/模型名不会出现中文字符，用这个做简单检测。
function looksLikePlaceholder(value) {
  return /[\u4e00-\u9fff]/.test(value || '');
}

function postJson(hostname, reqPath, headers, bodyObj, lang, timeoutMs = 30000) {
  const errMsg = ERR[lang];
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (err) {
            reject(new Error(errMsg.parseFail(err.message)));
            return;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg = (parsed && parsed.error && parsed.error.message) || data.slice(0, 300);
            reject(new Error(errMsg.httpError(res.statusCode, msg)));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(errMsg.timeout));
    });
    req.on('error', (err) => reject(new Error(errMsg.reqFail(err.message))));
    req.write(body);
    req.end();
  });
}

// 把最近事件时间线 + 节点基本信息组织成 prompt。
// 关键要求：让 AI 结合具体的事件时间线做判断（比如"反复重启但一直连不上"和"重启后短暂恢复又掉线"
// 指向的原因完全不同），而不是输出一份放之四海皆准的通用排查清单——那种建议价值不大，
// 用户自己搜索引擎也能找到。诊断只是建议，明确告知不会替用户执行任何操作。
function buildPrompt(nodeInfo, events, lang = 'zh') {
  const languageName = LANG_NAMES[lang] || LANG_NAMES.zh;
  const timeline = (events || [])
    .slice(0, 15)
    .map((e) => {
      const paramsStr = Object.entries(e.params || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `- [${e.time}] ${e.type}${paramsStr ? ' (' + paramsStr + ')' : ''}`;
    })
    .join('\n');

  return [
    '你是一名熟悉 Xray/sing-box 和 Linux VPS 运维的资深工程师，正在帮一个不太懂技术的普通用户诊断他自建代理节点的故障。',
    '',
    '节点信息：',
    `- 名称：${nodeInfo.name}`,
    `- 检测地址：${nodeInfo.checkHost}:${nodeInfo.checkPort}`,
    `- 关联服务：${nodeInfo.serviceName || '未知'}`,
    '',
    '最近事件时间线（从新到旧）：',
    timeline || '（暂无事件记录）',
    '',
    '请基于这个时间线做判断，要求：',
    '1. 先给出最可能的1-2个原因，结合时间线里的具体线索说明依据（例如：反复自动重启但依然连不上，通常指向端口占用/防火墙/证书失效而不是进程本身没起来；重启后短暂恢复又很快掉线，更可能是被墙或触发了限速封锁；从未成功过 vs 之前一直正常突然异常，指向的原因也不一样）。',
    '2. 再给1-3条用户自己能做的下一步排查动作，要具体到命令或检查点，不要空泛地说"检查一下服务器"。',
    '3. 如果时间线信息不足以支撑判断，直接说不确定，不要编造原因。',
    `4. 全程使用${languageName}作答（无论上面这份提示词是什么语言写的，输出必须是${languageName}），语气平实不夸张，不要用"亲爱的用户"这类客套话，总长控制在200字以内（非中文语言可按语义对应的长度）。`,
    '5. 明确这只是建议，不会替用户执行任何操作。',
    '',
    `IMPORTANT: Your entire response must be written in ${languageName}, regardless of the language of this prompt.`
  ].join('\n');
}

async function diagnoseWithAnthropic(providerConfig, nodeInfo, events, lang) {
  // model 字段允许留空走默认值；如果它看起来还是模板里的说明文字（含中文），
  // 同样按"留空"处理，而不是把这段说明文字原样发给官方 API 换来一个"模型不存在"的报错。
  const rawModel = providerConfig.model;
  const model = rawModel && !looksLikePlaceholder(rawModel) ? rawModel : 'claude-sonnet-4-6';
  const prompt = buildPrompt(nodeInfo, events, lang);
  const resp = await postJson(
    'api.anthropic.com',
    '/v1/messages',
    { 'x-api-key': providerConfig.apiKey, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 500, messages: [{ role: 'user', content: prompt }] },
    lang
  );
  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error(ERR[lang].emptyResult);
  return text;
}

async function diagnoseWithOpenAI(providerConfig, nodeInfo, events, lang) {
  const rawModel = providerConfig.model;
  const model = rawModel && !looksLikePlaceholder(rawModel) ? rawModel : 'gpt-4o-mini';
  const prompt = buildPrompt(nodeInfo, events, lang);
  const resp = await postJson(
    'api.openai.com',
    '/v1/chat/completions',
    { Authorization: `Bearer ${providerConfig.apiKey}` },
    { model, max_tokens: 500, messages: [{ role: 'user', content: prompt }] },
    lang
  );
  const text = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  if (!text || !text.trim()) throw new Error(ERR[lang].emptyResult);
  return text.trim();
}

// 通用 OpenAI 兼容 provider：智谱、DeepSeek、通义、Moonshot 等大部分国内模型/免费接口
// 都支持 /chat/completions 这套格式，只要 baseUrl + apiKey + model 三个字段可配置就够用，
// 不用为每一家单独写一个 diagnoseWithXxx()。providerConfig 里需要额外的 baseUrl 字段
// （形如 "open.bigmodel.cn" 这种hostname，不带协议头，跟其它两个provider的postJson用法保持一致）。
async function diagnoseWithOpenAICompatible(providerConfig, nodeInfo, events, lang) {
  const errMsg = ERR[lang];
  if (!providerConfig.baseUrl) {
    throw new Error(errMsg.unsupportedProvider('openai-compatible（缺少baseUrl配置）'));
  }
  const rawModel = providerConfig.model;
  if (!rawModel || looksLikePlaceholder(rawModel)) {
    throw new Error(errMsg.unsupportedProvider('openai-compatible（缺少model配置，第三方接口没有默认模型名可用）'));
  }
  // 发给第三方/免费接口之前脱敏——这是跟官方anthropic/openai两个provider唯一的额外步骤
  const safeNodeInfo = sanitizeNodeInfoForThirdParty(nodeInfo);
  const safeEvents = sanitizeEventsForThirdParty(events);
  const prompt = buildPrompt(safeNodeInfo, safeEvents, lang);
  const reqPath = providerConfig.apiPath || '/v1/chat/completions';
  const resp = await postJson(
    providerConfig.baseUrl,
    reqPath,
    { Authorization: `Bearer ${providerConfig.apiKey}` },
    { model: rawModel, max_tokens: 500, messages: [{ role: 'user', content: prompt }] },
    lang
  );
  const text = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  if (!text || !text.trim()) throw new Error(errMsg.emptyResult);
  return text.trim();
}

// 统一入口。providerConfig 就是 config.json 里的 ai 段。
// providerConfig.language 决定诊断正文和报错文本用哪种语言（zh/en/ja/de/ru），不传则回退简体中文，
// 兼容老版本 config.json 没有这个字段的情况。
async function diagnose({ providerConfig, nodeInfo, events }) {
  const lang = getLang(providerConfig);
  const errMsg = ERR[lang];
  if (!providerConfig || !providerConfig.enabled) {
    throw new Error(errMsg.notEnabled);
  }
  if (!providerConfig.apiKey) {
    throw new Error(errMsg.noApiKey);
  }
  if (looksLikePlaceholder(providerConfig.apiKey)) {
    throw new Error(errMsg.apiKeyPlaceholder);
  }
  switch (providerConfig.provider) {
    case 'anthropic':
      return diagnoseWithAnthropic(providerConfig, nodeInfo, events, lang);
    case 'openai':
      return diagnoseWithOpenAI(providerConfig, nodeInfo, events, lang);
    case 'openai-compatible':
      return diagnoseWithOpenAICompatible(providerConfig, nodeInfo, events, lang);
    default:
      throw new Error(errMsg.unsupportedProvider(providerConfig.provider));
  }
}

module.exports = {
  diagnose,
  buildPrompt,
  redactHost,
  redactUrlsInText,
  sanitizeNodeInfoForThirdParty,
  sanitizeEventsForThirdParty
};
