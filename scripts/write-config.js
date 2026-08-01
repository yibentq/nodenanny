'use strict';

// 从环境变量读取 install.sh 交互式问答收集到的值，写成 config.json。
// 用环境变量传参而不是在 shell 里拼 JSON 字符串，是为了避免密码/邮箱里
// 出现引号、反斜杠等字符时把 JSON 拼坏——这是真实会发生的事，别嫌麻烦。

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name, fallback) {
  const v = process.env[name];
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

// 各语言下"未设置节点名字"时的兜底默认值，跟 scripts/i18n.sh 里 node_name_default
// 保持一致（那边是安装过程终端提示用的，这里是 write-config.js 万一在
// NN_NODE_NAME 完全没设置的情况下被单独调用时的兜底——正常走 install.sh 全流程时，
// NN_NODE_NAME 在这之前就已经按 NN_LANG 选好本地化默认值了，这里理论上不会触发，
// 只是防止将来有人绕开 install.sh 单独跑这个脚本时，兜底值仍然写死成中文。
const NODE_NAME_DEFAULT_BY_LANG = {
  zh: '我的节点',
  en: 'My Node',
  ja: 'My Node',
  de: 'My Node',
  ru: 'My Node'
};

function defaultNodeName() {
  const lang = env('NN_LANG', 'zh');
  return NODE_NAME_DEFAULT_BY_LANG[lang] || NODE_NAME_DEFAULT_BY_LANG.en;
}

const config = {
  // 决定订阅链接里"应急/备用节点"标注文字等服务器端会被用户看到的文案用哪种语言
  // (跟面板网页那套浏览器端语言切换是两回事，见 core/node-label-i18n.js 顶部注释)。
  // 默认跟随安装时选择的界面语言（NN_LANG），没选过就是zh。
  language: env('NN_LANG', 'zh'),
  node: {
    name: env('NN_NODE_NAME', defaultNodeName()),
    checkHost: env('NN_CHECK_HOST', '127.0.0.1'),
    checkPort: envInt('NN_CHECK_PORT', 443),
    serviceName: env('NN_SERVICE_NAME', 'xray'),
    restartCommand: env('NN_RESTART_CMD', 'systemctl restart xray'),
    subscriptionUrl: env('NN_SUBSCRIPTION_URL', '')
  },
  monitor: {
    checkIntervalMinutes: envInt('NN_CHECK_INTERVAL', 5),
    notifyCooldownMinutes: envInt('NN_NOTIFY_COOLDOWN', 30)
  },
  panel: {
    port: envInt('NN_PANEL_PORT', 8787),
    bindHost: env('NN_PANEL_BINDHOST', '127.0.0.1'),
    password: env('NN_PANEL_PASSWORD', '')
  },
  pool: {
    // NN_POOL_ENABLED 的取值不只受"是否成功装好aggregator"影响：批次三新增的GitHub
    // 候选来源发现（discovery）不依赖aggregator，如果用户只选了discovery没装aggregator，
    // install.sh 也会把这个env设成true，pool整体开关才能生效（见install.sh 5b/5c段）。
    enabled: envBool('NN_POOL_ENABLED', false),
    aggregatorDir: env('NN_POOL_AGG_DIR', '/root/aggregator'),
    fetchCommand: env('NN_POOL_FETCH_CMD', 'python3 subscribe/collect.py -s'),
    outputFile: env('NN_POOL_OUTPUT_FILE', 'data/v2ray.txt'),
    refreshIntervalHours: envInt('NN_POOL_REFRESH_HOURS', 6),
    maxNodes: envInt('NN_POOL_MAX_NODES', 50),
    checkCandidateLimit: envInt('NN_POOL_CHECK_CANDIDATE_LIMIT', 250),
    // 本轮新增(修复:原硬编码20分钟超时短于真机实测的23~25分钟抓取耗时，导致
    // 明明快抓完了却被误判失败)，默认45分钟，留足余量，也方便以后手动调整。
    aggregatorFetchTimeoutMs: envInt('NN_POOL_AGG_FETCH_TIMEOUT_MS', 45 * 60 * 1000),
    // 此前write-config.js完全没写这三个子字段（checker/discovery/sourceWeighting），
    // 只是靠core/pool-checker.js、discovery-runner.js等模块内部的兜底默认值在跑，
    // 用户想在config.json里看到/手动调整这些值却根本找不到。批次三补全，值本身
    // 跟config.example.json的默认值一致，不是新拍板的参数。
    checker: {
      enabled: true,
      concurrency: 3,
      singboxBinary: 'sing-box',
      aliveUrl: 'https://cp.cloudflare.com/generate_204',
      aliveTimeoutMs: 8000,
      speedTestUrl: 'https://speed.cloudflare.com/__down?bytes=500000',
      speedMinKBps: 15,
      speedTimeoutMs: 20000,
      authenticTargets: [
        'https://www.gstatic.com/generate_204',
        'https://cp.cloudflare.com/generate_204',
        'https://captive.apple.com/hotspot-detect.html'
      ],
      authenticTimeoutMs: 12000
    },
    sourceWeighting: {
      aggregatorWeight: 1
    },
    // 本轮修复的真实缺口:此前write-config.js从来没写过这个字段,导致不管
    // config.example.json里样例默认值写了多少条"手动种子来源"(旺财等社区分享
    // 订阅),真正跑install.sh装出来的config.json里这个字段永远不存在——
    // install.sh也从来没问过用户要不要用。这里补上:默认不启用(空数组),
    // 用户在install.sh里明确选择启用时,才从config.example.json复制这份样例
    // 列表写进来(见install.sh "5d. 手动种子来源"一节)。
    manualSources: envBool('NN_POOL_MANUAL_SOURCES_ENABLED', false)
      ? (() => {
          try {
            const example = JSON.parse(
              fs.readFileSync(path.join(__dirname, '..', 'config', 'config.example.json'), 'utf-8')
            );
            return (example.pool && Array.isArray(example.pool.manualSources)) ? example.pool.manualSources : [];
          } catch (e) {
            return [];
          }
        })()
      : [],

    // enabled/githubToken 这两项由install.sh的交互问答决定；topicQueries等其余细节
    // 参数是18.5节里AI自主判断的初始值，不是逐条问创始人确认过的产品决策，如果后续
    // 发现候选质量不理想，可以直接来这里手改，不需要重新走一遍安装问答。
    discovery: {
      enabled: envBool('NN_POOL_DISCOVERY_ENABLED', false),
      githubToken: env('NN_GITHUB_TOKEN', ''),
      topicQueries: ['v2ray-node', 'free-nodes', 'clash-config', 'proxy-list', 'free-node'],
      filenameQueries: ['v2ray.txt', 'clash.yaml', 'sub.txt'],
      recentPushedWithinDays: 30,
      maxResultsPerQuery: 30,
      scanIntervalHours: 168,
      candidateLimitPerSource: 20,
      // 本轮新增的资源保护字段(修复记录:此前完全没有来源数量上限/节流/超时保护，
      // 随着候选来源持续积累，每轮刷新的耗时和请求量会无限增长，这是7.3.6节
      // 提出过、但此前一直没有真正兜住的风险)。值跟config.example.json一致。
      maxSourcesPerRun: 30,
      sourceThrottleMs: 500,
      requestTimeoutMs: 8000,
      probeThrottleMs: 300
    }
  },
  // 此前这一段在 write-config.js 里完全被漏掉：install.sh 从没问过 AI 相关问题，
  // 导致标准安装流程装完的 config.json 里根本没有 ai 字段，面板永远显示"未开启"，
  // 用户也没有任何线索该怎么打开——本轮补上交互问答（见 install.sh）和这里的写入逻辑。
  // apiKey/model 默认真正留空 ""，而不是用说明性占位文字，避免 || 兜底逻辑失效。
  ai: {
    enabled: envBool('NN_AI_ENABLED', false),
    provider: env('NN_AI_PROVIDER', 'anthropic'),
    apiKey: env('NN_AI_APIKEY', ''),
    model: env('NN_AI_MODEL', ''),
    // 本轮补上（Addendum 8 bug#2的另一半根因）：此前就算install.sh问了baseUrl/
    // apiPath（其实之前连问都没问），write-config.js这边也从来没把这两个字段
    // 写进config.json——provider=openai-compatible但没有baseUrl，ai-provider.js
    // 实际调用时就没有端点可用。留空字符串默认值，跟apiKey/model同一套约定，
    // 不用说明性占位文字，避免||兜底逻辑失效。
    baseUrl: env('NN_AI_BASEURL', ''),
    apiPath: env('NN_AI_APIPATH', ''),
    triggerAfterFailures: envInt('NN_AI_TRIGGER_AFTER', 3),
    // 诊断正文和报错文本用哪种语言，默认跟随安装时选择的界面语言（NN_LANG），
    // 装完之后也可以直接改这个字段，不需要跟面板显示语言绑死。
    language: env('NN_AI_LANG', env('NN_LANG', 'zh'))
  },
  smtp: {
    host: env('NN_SMTP_HOST', 'smtp.example.com'),
    port: envInt('NN_SMTP_PORT', 465),
    secure: envBool('NN_SMTP_SECURE', true),
    user: env('NN_SMTP_USER', ''),
    pass: env('NN_SMTP_PASS', ''),
    from: env('NN_SMTP_FROM', `NodeNanny <${env('NN_SMTP_USER', '')}>`),
    to: env('NN_SMTP_TO', '')
  }
};

fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
console.log(`已生成配置文件：${CONFIG_PATH}`);
