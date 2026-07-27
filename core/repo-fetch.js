'use strict';

// 流量池自愈生态·批次三:单仓库候选节点抓取模块。
//
// 定位:source-discovery.js 只发现"有哪些仓库",这个模块负责"从某一个具体仓库里
// 真的抓到候选节点链接"——这是founder本轮拍板要做的"改造抓取方式":放弃aggregator
// 整包抓、不分来源的旧模式,改成逐仓库单独抓取解析,这样每个节点天然带着"我是从
// 哪个来源来的"这个信息,能真正喂给source-trust.js。
//
// 对外只暴露一个函数:fetchCandidatesForSource(sourceRecord, discoveryConfig, headers)
//   -> Promise<{ sourceId, links: string[], filesFound: [...], filesTried: [...], errors: [...] }>
//
// 如实说明:
// - GitHub Contents API(探测/获取具体文件内容)本轮同样需要认证才能有稳定的调用额度
//   (未认证 60次/小时,每个来源可能要探测好几个候选文件名,量上去很容易打满),
//   跟source-discovery.js的代码搜索接口是同一份githubToken配置。
// - raw.githubusercontent.com 不受GitHub API限流规则管(它是静态文件CDN,不是API),
//   所以"已知确切路径"的文件用它直接抓,不占用API额度;"猜文件名"这一步因为要先
//   确认文件存不存在,必须先过一次Contents API(HEAD式存在性检查),这一步才占额度。
// - 本模块在沙盒里只做过mock测试(模拟fetch响应),没有真机验证过——沙盒没有网络,
//   这是本轮工作范围内做不到的部分,如实标注,不假装已经验证过。

const fs = require('fs');
const path = require('path');

const GITHUB_API_BASE = 'https://api.github.com';
const RAW_BASE = 'https://raw.githubusercontent.com';
const API_VERSION = '2022-11-28';
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_PROBE_THROTTLE_MS = 300;

// topic命中(不知道具体文件名)的来源,猜测尝试的常见候选文件名/路径。
// 只试仓库根目录,不做递归遍历子目录——如果找不到,大概率这个仓库本身就不是
// 一个"节点订阅仓库",让source-trust.js的试用期机制去处理(通过率0会被拉黑),
// 不在这里为了"多试几个路径"过度增加复杂度和API调用量。
const DEFAULT_GUESS_FILENAMES = [
  'v2ray.txt', 'sub.txt', 'clash.yaml', 'clash.yml', 'list.txt', 'config.yaml'
];

// 探测结果缓存(修复记录:此前每一轮刷新都会对所有来源重新猜一遍6个候选文件名，
// 哪怕上一轮已经确认某个来源根本没有这个文件——随着来源数量积累，这个成本会
// 持续线性增长。缓存"这个文件存不存在"这个判断结果一段时间，同一个来源同一个
// 文件名，缓存新鲜期内不重复探测，直接复用上次的结论；只有"探测到文件真的存在"
// 或"猜测缓存已过期"时才重新调用Contents API。内容本身(fetchText)不缓存——
// 文件内容会变化，每次都应该抓最新的，缓存的只是"值不值得去抓"这个判断。)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7天
const CACHE_FILE = path.join(__dirname, '..', 'data', 'repo-fetch-probe-cache.json');

function readProbeCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {}; // 缓存文件损坏，当成没有缓存处理，不影响主流程
  }
}

function writeProbeCache(cache) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    // 缓存写入失败不影响主流程，下次探测退化成"没有缓存"重新探测一次即可
  }
}

function probeCacheKey(repoFullName, filename) {
  return `${repoFullName}::${filename}`;
}

function getCachedProbe(cache, repoFullName, filename) {
  const entry = cache[probeCacheKey(repoFullName, filename)];
  if (!entry) return null;
  if (Date.now() - new Date(entry.checkedAt).getTime() > CACHE_TTL_MS) return null; // 过期，当成没有缓存
  return entry;
}

function setCachedProbe(cache, repoFullName, filename, exists) {
  cache[probeCacheKey(repoFullName, filename)] = { exists, checkedAt: new Date().toISOString() };
}

// 补丁(本轮修复):来源被拉黑并从 sources.json 里滚动清理掉之后,它当初探测过的
// 缓存记录(每个来源最多6条,每条几十字节)此前会永远留在 repo-fetch-probe-cache.json
// 里,没有对应的清理机制——量级很小,不影响功能,但既然 sourceId 就是 repoFullName,
// 缓存 key 又是 `${repoFullName}::${filename}` 这种可预测的前缀,清理起来很简单,
// 顺手补上,让这份缓存也跟 sources.json 一样有始有终。
// 由调用方(discovery-runner.js,在 cleanupBlacklisted() 之后)传入被清理掉的
// sourceId 列表,这里只做"删除以这些 sourceId 开头的缓存条目"这一件事。
function cleanupProbeCacheFor(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return { removed: 0 };
  const cache = readProbeCache();
  const prefixes = sourceIds.map((id) => `${id}::`);
  let removed = 0;
  for (const key of Object.keys(cache)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      delete cache[key];
      removed += 1;
    }
  }
  if (removed > 0) writeProbeCache(cache);
  return { removed };
}

function buildHeaders(token) {
  const headers = {
    'User-Agent': 'NodeNanny-RepoFetch',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION
  };
  if (token) headers['Authorization'] = `token ${token}`;
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 修复记录:此前fetchJson/fetchText是裸调用fetch()，没有设超时——一次请求卡住
// (网络抖动、对方服务器无响应)会拖慢整轮刷新，不像pool-checker.js三层检测那样
// 每一层都有独立超时保护。这里用AbortController统一加一层超时，超时当成请求
// 失败处理(不抛异常中断整个流程，跟现有"每次独立请求单独try/catch"的原则一致)。
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, headers, timeoutMs) {
  const res = await fetchWithTimeout(url, { headers }, timeoutMs);
  if (!res.ok) return { ok: false, status: res.status };
  try {
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: res.status, error: err.message };
  }
}

async function fetchText(url, timeoutMs) {
  // 本轮修复(创始人反馈"旺财"手动订阅源一直测不出候选节点):此前这里裸调用
  // fetchWithTimeout(url, {}, timeoutMs)，完全没带任何请求头。GitHub API那条路径
  // (fetchJson)一直有带User-Agent，唯独手动订阅源用的这个fetchText没有——不少个人
  // 维护的订阅服务会对没有UA、或者UA像脚本/爬虫的请求返回一个说明页/跳转页而不是
  // 真实订阅内容，请求本身是200成功的，但parseSubscriptionContent()三种格式全部
  // 识别不出节点，最终会静默判定成"这一轮0个候选"，看起来就像来源没人维护，实际上
  // 只是请求没伪装成一个正常客户端。这里补上跟GitHub路径一致的User-Agent。
  const headers = { 'User-Agent': 'NodeNanny-RepoFetch' };
  const res = await fetchWithTimeout(url, { headers }, timeoutMs);
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text();
  return { ok: true, text };
}

// 取仓库默认分支,拿不到就依次尝试常见分支名兜底,不让一次接口失败就整个来源放弃。
async function resolveDefaultBranch(repoFullName, headers, timeoutMs) {
  const { ok, data } = await fetchJson(`${GITHUB_API_BASE}/repos/${repoFullName}`, headers, timeoutMs);
  if (ok && data && data.default_branch) return data.default_branch;
  return null; // 交给调用方按 main/master 顺序兜底试
}

// 探测仓库根目录下某个文件是否存在,只在"topic命中、不知道具体路径"时才需要这一步。
async function fileExistsAtRoot(repoFullName, filename, branch, headers, timeoutMs) {
  const url = `${GITHUB_API_BASE}/repos/${repoFullName}/contents/${encodeURIComponent(filename)}?ref=${encodeURIComponent(branch)}`;
  const { ok } = await fetchJson(url, headers, timeoutMs);
  return ok;
}

// 解析一段抓到的原始文本,尝试三种可能的格式,依次识别:
// 1. 明文分享链接列表(每行一个 vless://...)
// 2. 整体base64编码的订阅内容(解一次base64后再按1识别)
// 3. clash yaml格式(有 proxies 数组)
// 三种都试不出内容,返回空数组,不当成错误——很多topic命中的仓库本身跟节点无关,
// 这是预期内会发生的情况。
function parseSubscriptionContent(text) {
  const clashYaml = require('./clash-yaml');
  const raw = (text || '').trim();
  if (!raw) return { format: 'empty', links: [] };

  const tryLines = (s) =>
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^(vless|vmess|ss|ssr|trojan|hysteria2?|hy2|tuic):\/\//i.test(l));

  let lines = tryLines(raw);
  if (lines.length > 0) return { format: 'raw-links', links: Array.from(new Set(lines)) };

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    lines = tryLines(decoded);
    if (lines.length > 0) return { format: 'base64-links', links: Array.from(new Set(lines)) };
  } catch (err) {
    // 不是合法base64,继续往下试
  }

  const yamlResult = clashYaml.extractLinksFromClashYaml(raw);
  if (yamlResult && yamlResult.links.length > 0) {
    return { format: 'clash-yaml', links: Array.from(new Set(yamlResult.links)), yamlTotal: yamlResult.total, yamlConverted: yamlResult.converted };
  }

  return { format: 'unrecognized', links: [] };
}

// 主入口:给一条source-discovery.js发现的来源记录,抓取这个来源这一轮产出的候选节点。
async function fetchCandidatesForSource(sourceRecord, discoveryConfig, headers) {
  const cfg = discoveryConfig || {};
  const guessFilenames = cfg.guessFilenames || DEFAULT_GUESS_FILENAMES;
  const repoFullName = sourceRecord.repoFullName;
  const filesTried = [];
  const filesFound = [];
  const errors = [];
  const allLinks = new Set();
  const timeoutMs = cfg.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
  const throttleMs = cfg.probeThrottleMs != null ? cfg.probeThrottleMs : DEFAULT_PROBE_THROTTLE_MS;
  const probeCache = readProbeCache();
  let probeCacheDirty = false;

  if (!repoFullName) {
    return { sourceId: repoFullName, links: [], filesFound, filesTried, errors: ['缺少repoFullName'] };
  }

  // 第一步:确定要尝试的候选路径列表。
  // filename命中的来源已经有确切路径(matchedFiles),topic命中的来源没有,
  // 需要先猜文件名、逐个探测是否存在。两者都试是安全的(有确切路径优先直接抓,
  // 猜测列表作为补充,不会因为已经有确切路径就跳过猜测——万一同一仓库还有其他节点文件)。
  const knownPaths = (sourceRecord.matchedFiles || []).map((f) => f.path).filter(Boolean);

  let branch = null;
  try {
    branch = await resolveDefaultBranch(repoFullName, headers, timeoutMs);
  } catch (err) {
    errors.push(`获取默认分支失败:${err.message}`);
  }
  const branchCandidates = branch ? [branch] : ['main', 'master'];

  // 已知确切路径:直接用raw CDN抓,不占GitHub API额度,也不需要节流
  // (raw.githubusercontent.com是静态文件CDN,不受API限流规则管,见文件顶部说明)。
  for (const p of knownPaths) {
    let fetched = false;
    for (const b of branchCandidates) {
      const url = `${RAW_BASE}/${repoFullName}/${b}/${p}`;
      filesTried.push(url);
      try {
        const { ok, text } = await fetchText(url, timeoutMs);
        if (ok) {
          filesFound.push(url);
          const parsed = parseSubscriptionContent(text);
          parsed.links.forEach((l) => allLinks.add(l));
          fetched = true;
          break;
        }
      } catch (err) {
        errors.push(`抓取失败(${url}):${err.message}`);
      }
    }
    if (!fetched) errors.push(`已知路径抓取失败(所有候选分支都试过):${p}`);
  }

  // 猜测文件名(仅对topic命中、且还没有任何已知路径命中过内容的情况有意义;
  // 就算filename命中已经拿到内容了,这里仍然顺手都试一遍——万一同一个仓库
  // 根目录下还有别的节点文件,多一份候选没有坏处,GitHub Contents API的
  // 探测请求本身失败也不影响其他候选)。
  if (cfg.githubTokenMissingSkipGuess !== true) {
    let firstProbe = true;
    for (const filename of guessFilenames) {
      if (knownPaths.includes(filename)) continue; // 已经试过同名的确切路径,不重复

      // 探测缓存命中(修复记录见文件顶部注释):同一个来源同一个文件名,如果最近
      // CACHE_TTL_MS内已经探测过、且确认不存在,直接跳过这次API调用;只有缓存
      // 过期或者从没探测过时才真的发请求。缓存命中也算一次"探测"，仍然计入
      // filesTried便于观测,但不产生网络请求、不占节流时间。
      const cached = getCachedProbe(probeCache, repoFullName, filename);
      if (cached && cached.exists === false) {
        continue;
      }

      if (!firstProbe && throttleMs > 0) {
        await sleep(throttleMs);
      }
      firstProbe = false;

      let existsChecked = false;
      let branchUsed = null;
      for (const b of branchCandidates) {
        try {
          const exists = await fileExistsAtRoot(repoFullName, filename, b, headers, timeoutMs);
          if (exists) {
            existsChecked = true;
            branchUsed = b;
            break;
          }
        } catch (err) {
          errors.push(`探测文件是否存在失败(${repoFullName}/${filename}@${b}):${err.message}`);
        }
      }
      setCachedProbe(probeCache, repoFullName, filename, existsChecked);
      probeCacheDirty = true;
      if (!existsChecked) continue;
      const url = `${RAW_BASE}/${repoFullName}/${branchUsed}/${filename}`;
      filesTried.push(url);
      try {
        const { ok, text } = await fetchText(url, timeoutMs);
        if (ok) {
          filesFound.push(url);
          const parsed = parseSubscriptionContent(text);
          parsed.links.forEach((l) => allLinks.add(l));
        }
      } catch (err) {
        errors.push(`抓取失败(${url}):${err.message}`);
      }
    }
  }

  if (probeCacheDirty) writeProbeCache(probeCache);

  return {
    sourceId: repoFullName,
    links: Array.from(allLinks),
    filesFound,
    filesTried,
    errors
  };
}

module.exports = {
  fetchCandidatesForSource,
  parseSubscriptionContent,
  fetchText,
  buildHeaders,
  cleanupProbeCacheFor
};
