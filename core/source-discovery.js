'use strict';

// 候选来源发现模块(流量池自愈生态·第二批)。
//
// 定位:纯机械化扫描 GitHub,找"存在、活跃"的候选节点仓库,不判断"可不可信"——
// 可信度交给 source-trust.js 的试用期状态机去测量,这里只管发现。
//
// 对外只暴露一个函数:discoverSources(discoveryConfig)。

const GITHUB_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const THROTTLE_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 修复记录(v36.0诊断出的根因bug):这两个搜索函数之前是裸调用fetch()，完全没有
// 超时保护——candidate缓存(discovery-runner.js)一般一周才过期一次，过期时才会
// 真的走到这里发请求；一旦某次请求卡住(网络抖动/对方无响应)，await fetch()会
// 永远挂起，不返回也不报错，导致整个refreshPool()卡死，且没有任何子进程/网络连接
// 残留可供排查。写法跟repo-fetch.js里的fetchWithTimeout保持一致:用AbortController
// 统一加一层超时，超时后abort、fetch会reject，调用方原有的try/catch会捕获住
// (调用方discoverSources()对每个query已经是独立try/catch，一次超时只记进errors
// 数组，不会中断其它query或让整个扫描崩溃)。
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders(token) {
  const headers = {
    'User-Agent': 'NodeNanny-SourceDiscovery',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION
  };
  if (token) headers['Authorization'] = `token ${token}`;
  return headers;
}

function pushedSinceDate(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// 本轮修复(创始人反馈发现的真实缺口):topic搜索靠 `pushed:>日期` 这个查询语法本身
// 就能把太老的仓库排除在结果之外,但filename搜索(searchCodeByFilename)用的是GitHub
// 代码搜索API,这个接口不支持pushed:/updated:这类新鲜度筛选参数(这是GitHub API本身
// 的限制,不是漏写),所以查询语句里加不了这个条件——filename搜到的候选完全没有
// 经过任何时效性过滤,可能是几年前就不再维护的仓库。
// 解决方式:代码搜索的返回结果里其实已经带着item.repository.pushed_at(见
// searchCodeByFilename里的lastUpdated字段),只是一直没有拿这个字段做二次过滤——
// 现在补上,用跟topic搜索同一个recentPushedWithinDays阈值,在拿到结果之后过滤一遍。
// 没有lastUpdated信息的条目(理论上代码搜索返回的仓库对象偶尔可能缺这个字段)保守
// 起见不过滤掉,避免因为信息缺失就误伤。
function isWithinRecency(lastUpdated, days) {
  if (!lastUpdated) return true;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const updatedMs = new Date(lastUpdated).getTime();
  if (Number.isNaN(updatedMs)) return true;
  return updatedMs >= cutoffMs;
}

// 仓库搜索(对应 topicQueries):不需要认证也能用。
async function searchRepositoriesByTopic(topic, cfg, headers) {
  const since = pushedSinceDate(cfg.recentPushedWithinDays);
  const q = encodeURIComponent(`topic:${topic} pushed:>${since}`);
  const url = `${GITHUB_API_BASE}/search/repositories?q=${q}&sort=updated&order=desc&per_page=${cfg.maxResultsPerQuery}`;
  const res = await fetchWithTimeout(url, { headers }, cfg.requestTimeoutMs);
  const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const items = (data.items || []).map((repo) => ({
    repoFullName: repo.full_name,
    url: repo.html_url,
    lastUpdated: repo.pushed_at,
    topics: repo.topics || [],
    stars: repo.stargazers_count || 0
  }));
  return { items, rateLimitRemaining };
}

// 代码搜索(对应 filenameQueries):自2023年起 GitHub 强制要求这个接口必须认证,
// 不认证的请求会直接被拒绝,不是"限额少"而是"用不了"。这一条是核实文档18.5节
// 方案时发现的,不是原方案里写的。另外 sort/order 参数在代码搜索里已经被 GitHub
// 废弃(结果统一按 best match 排序),这里就不传了,免得以后哪天真的报错。
async function searchCodeByFilename(filename, cfg, headers) {
  const q = encodeURIComponent(`filename:${filename}`);
  const url = `${GITHUB_API_BASE}/search/code?q=${q}&per_page=${cfg.maxResultsPerQuery}`;
  const res = await fetchWithTimeout(url, { headers }, cfg.requestTimeoutMs);
  const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  // 注意:代码搜索返回的 items 是"文件匹配记录",真正的仓库信息在 items[i].repository。
  // 补充(批次三实现层面的小修,之前讨论时提过):item.path 是这个文件在仓库里的
  // 具体路径,之前的版本只取了 item.repository、把这个路径信息丢了——repo-fetch.js
  // 抓取"filename命中"的来源时需要知道具体去仓库哪个路径拿文件,不能只知道仓库名,
  // 所以这里把 path 一并记下来,放进 matchedFiles 字段(每个仓库可能因为多个文件
  // 匹配同一个filename query,这里也一并去重合并)。
  const items = (data.items || [])
    .filter((item) => item.repository)
    .map((item) => ({
      repoFullName: item.repository.full_name,
      url: item.repository.html_url,
      lastUpdated: item.repository.pushed_at || null, // 代码搜索返回的仓库对象里可能没有这个字段
      topics: item.repository.topics || [],
      stars: item.repository.stargazers_count || 0,
      matchedFile: { filename, path: item.path || null }
    }));
  return { items, rateLimitRemaining };
}

async function discoverSources(discoveryConfig) {
  const cfg = discoveryConfig || {};
  const headers = buildHeaders(cfg.githubToken);
  const hasToken = Boolean(cfg.githubToken);

  const found = new Map(); // repoFullName -> 合并后的记录
  const errors = [];
  let rateLimitRemaining = null;

  // matchedFiles:只有 filename 命中的来源才会带 item.matchedFile(具体路径已知);
  // topic 命中的来源没有这个信息,repo-fetch.js 会对这类来源走"猜文件名"那条路径。
  function mergeMatchedFiles(existingList, matchedFile) {
    if (!matchedFile) return existingList;
    const already = existingList.some(
      (f) => f.filename === matchedFile.filename && f.path === matchedFile.path
    );
    return already ? existingList : [...existingList, matchedFile];
  }

  function mergeIn(items, matchedByLabel) {
    for (const item of items) {
      const matchedFile = item.matchedFile;
      const itemRest = { repoFullName: item.repoFullName, url: item.url, lastUpdated: item.lastUpdated, topics: item.topics, stars: item.stars };
      const existing = found.get(itemRest.repoFullName);
      if (existing) {
        existing.topics = Array.from(new Set([...existing.topics, ...itemRest.topics]));
        existing.matchedBy = Array.from(new Set([...existing.matchedBy, matchedByLabel]));
        existing.matchedFiles = mergeMatchedFiles(existing.matchedFiles, matchedFile);
        // lastUpdated/stars 用较新的一次覆盖(代码搜索那次可能没有 lastUpdated)
        if (itemRest.lastUpdated) existing.lastUpdated = itemRest.lastUpdated;
      } else {
        found.set(itemRest.repoFullName, {
          ...itemRest,
          matchedBy: [matchedByLabel],
          matchedFiles: mergeMatchedFiles([], matchedFile)
        });
      }
    }
  }

  const topicQueries = cfg.topicQueries || [];
  const filenameQueries = cfg.filenameQueries || [];

  for (const topic of topicQueries) {
    try {
      const { items, rateLimitRemaining: rlr } = await searchRepositoriesByTopic(topic, cfg, headers);
      if (rlr !== null) rateLimitRemaining = rlr;
      mergeIn(items, `topic:${topic}`);
    } catch (err) {
      errors.push({ query: `topic:${topic}`, reason: err.message });
    }
    await sleep(THROTTLE_MS);
  }

  for (const filename of filenameQueries) {
    if (!hasToken) {
      // 不发起注定会被拒绝的请求,直接记录原因,省时间也省额度。
      errors.push({
        query: `filename:${filename}`,
        reason: '跳过:GitHub 代码搜索接口要求必须认证,当前未配置 githubToken'
      });
      continue;
    }
    try {
      const { items, rateLimitRemaining: rlr } = await searchCodeByFilename(filename, cfg, headers);
      if (rlr !== null) rateLimitRemaining = rlr;
      const recentDays = cfg.recentPushedWithinDays || 30;
      const recentItems = items.filter((item) => isWithinRecency(item.lastUpdated, recentDays));
      const staleSkipped = items.length - recentItems.length;
      if (staleSkipped > 0) {
        console.log(`[source-discovery] filename:${filename} 命中的候选里有 ${staleSkipped} 个仓库超过 ${recentDays} 天没有更新，已过滤（代码搜索API本身不支持按更新时间筛选，这是拿到结果后的二次过滤）`);
      }
      mergeIn(recentItems, `filename:${filename}`);
    } catch (err) {
      errors.push({ query: `filename:${filename}`, reason: err.message });
    }
    await sleep(THROTTLE_MS);
  }

  return {
    found: Array.from(found.values()),
    scannedAt: new Date().toISOString(),
    rateLimitRemaining,
    errors
  };
}

// v21新增(创始人反馈"自动发现搜到的很多是网页HTTP代理列表,不是真正的节点聚合项目"，
// 真实搜索验证后确认的规律):topic 搜索用的关键词(比如 free-node、clash-config)
// 本身不够精确——真正的节点聚合项目(比如 BestClash、V2RayAggregator 这类)几乎都会
// 同时打上具体的协议类标签(vmess/vless/trojan/clash/v2ray/shadowsocks/sing-box等)，
// 而单纯的网页HTTP代理IP列表项目通常只有generic的proxy/socks5这类词，不会带任何
// VPN协议类标签。用这个"标签共现"规则过滤，比单纯删减/增加某几个关键词更可靠。
// 只对"仅通过topic搜索命中"的来源生效——通过filename搜索命中的来源(比如真的在
// 仓库里发现一个叫v2ray.txt的文件)本身就是更强的信号，不受这条限制，即使这个仓库
// 没有打任何topics标签也一样保留，避免误伤。
const PROTOCOL_TOPIC_KEYWORDS = new Set([
  'vmess', 'vless', 'trojan', 'shadowsocks', 'shadowsocksr', 'ssr', 'ss',
  'v2ray', 'v2rayn', 'v2rayng', 'clash', 'clash-meta', 'clashmeta', 'mihomo',
  'sing-box', 'singbox', 'xray', 'hysteria', 'hysteria2', 'hy2', 'tuic'
]);

function hasProtocolTopic(topics) {
  return (topics || []).some((t) => PROTOCOL_TOPIC_KEYWORDS.has(String(t).toLowerCase()));
}

function filterByProtocolTopic(sources) {
  const kept = [];
  let filteredOut = 0;
  for (const s of sources) {
    const matchedOnlyByTopic = (s.matchedBy || []).every((m) => m.startsWith('topic:'));
    if (matchedOnlyByTopic && !hasProtocolTopic(s.topics)) {
      filteredOut += 1;
      continue;
    }
    kept.push(s);
  }
  return { kept, filteredOut };
}

module.exports = { discoverSources, filterByProtocolTopic, isWithinRecency };
