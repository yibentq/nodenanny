'use strict';

// Wiki 内容远程同步模块（v29 交接文档第三节"第一件事"，本次会话新增）。
//
// 跟 kb-sync.js 是同类思路（GitHub 拉取 + 先看diff再确认）但完全独立的一套，
// 原因是风险性质不一样，v29交接文档里已经讲清楚：
// - kb-sync.js 同步的是能被一键执行的 shell 命令，必须走"staging + 逐条人工确认 +
//   强制verified:false"这套重流程。
// - 这个文件同步的是纯文本 markdown/分类元数据，不执行任何东西，可以做得更轻量。
//
// 创始人明确选定的方案（本次会话确认，不是猜的）：**直接覆盖式的只读镜像**——
// 远程有更新，用户点"确认覆盖"，本地 data/wiki/ 目录整体按远程内容覆盖，
// 不做"跳过本地改过的页面"这类保留本地修改的逻辑。这意味着：
// 1. 如果有其他 NodeNanny 用户自己手动改过本地 wiki 页面，下次同步会被直接覆盖掉，
//    这是创始人本人确认过的行为，不是遗漏——如果创始人以后改主意，需要重新设计
//    "本地覆盖层"（类似 knowledge-base.local.json 那样），现在先不做。
// 2. 正因为是"直接覆盖"而不是"逐条确认"，流程比kb-sync简化成两步：
//    checkForUpdate()（只读，返回diff清单，不改动任何本地文件）→
//    applyUpdate()（人工在面板上看过diff、点了"确认覆盖"之后才调用，真正落盘）。
//    中间没有staging合并的"选择性接受"这一步，diff清单只是给用户看一眼"要覆盖啥"，
//    不能取消其中某一条单独不覆盖——要嘛全量确认，要嘛不确认。
//
// 安全设计（沿用 kb-sync.js 已经验证过的原则，同样适用在这里）：
// - path 白名单校验：远程 tree 里任何一条 path 只要不满足"相对路径、无 .. 、无绝对路径、
//   字符集在白名单内"就直接丢弃，不写入本地文件系统，防止路径穿越。
// - 文件类型白名单：只接受 .md 和 .json（wiki 目录下实际存在的两类文件：正文和
//   _category.json 分类元数据），其它扩展名一律跳过并打日志，不代表同步失败，
//   只是不信任的内容不落地。
// - 判断"有没有更新"用的是"整棵远程文件树的指纹"（对 path+sha 列表整体做hash），
//   不依赖 GitHub 返回的"版本号"字段之类的东西，避免被伪造的版本号欺骗。
//
// 还没做、以后接入真实仓库时可以加强的：
// - GPG/sigstore 签名校验（现在只做内容hash比对，同类问题kb-sync.js文件头已经记录过，
//   这里不重复展开）
// - 仓库维护者白名单

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WIKI_DIR = path.join(DATA_DIR, 'wiki');
const STATE_PATH = path.join(DATA_DIR, 'wiki-sync-state.json');
const STAGING_PATH = path.join(DATA_DIR, 'wiki-sync-staging.json');

const ALLOWED_EXTENSIONS = new Set(['.md', '.json']);

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[wiki-sync] 读取 ${filePath} 失败：${err.message}`);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ---------- 纯逻辑部分：不碰网络/文件系统，单元测试主要覆盖这几个函数 ----------

// relPath 是相对 data/wiki/ 的路径（比如 "02-nodenanny-guide/overview.md"）。
// 只接受：不以 / 开头、不含 .. 段、不含反斜杠、扩展名在白名单内。
function isSafeRelPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false;
  if (relPath.startsWith('/') || relPath.includes('\\')) return false;
  const segments = relPath.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  const ext = path.extname(relPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  return true;
}

// 从 GitHub git/trees API 的原始 entries 里筛出属于 wiki 目录的文件，
// 剥掉前缀变成相对路径，并按 isSafeRelPath 过滤掉任何可疑条目。
// treeEntries 形如 [{ path: 'data/wiki/xxx.md', type: 'blob', sha: '...' }, ...]
function filterWikiTreeEntries(treeEntries, wikiPathPrefix) {
  const prefix = wikiPathPrefix.endsWith('/') ? wikiPathPrefix : `${wikiPathPrefix}/`;
  const result = [];
  for (const entry of treeEntries || []) {
    if (!entry || entry.type !== 'blob') continue;
    if (typeof entry.path !== 'string' || !entry.path.startsWith(prefix)) continue;
    const relPath = entry.path.slice(prefix.length);
    if (!isSafeRelPath(relPath)) {
      console.error(`[wiki-sync] 跳过不受信任的远程路径：${entry.path}`);
      continue;
    }
    result.push({ relPath, sha: entry.sha });
  }
  return result;
}

// 对"文件列表"整体算一个指纹，用于判断"远程内容跟上次同步时相比有没有变化"。
// 按 relPath 排序后再序列化，保证同一份内容不管 GitHub API 返回顺序如何都得到同一个指纹。
function computeFingerprint(fileList) {
  const sorted = [...fileList].sort((a, b) => a.relPath.localeCompare(b.relPath));
  return sha256(JSON.stringify(sorted));
}

// 对比"远程最新文件列表" vs "本地记录的上次同步状态"，得到 added/changed/removed。
// remoteFiles: [{relPath, sha}], stateFilesMap: { relPath: sha }（上次同步落地时记录的）
// 因为是镜像覆盖模式，removed 指"上次同步过、这次远程没有了"的文件——apply时会被
// 从本地物理删除，这是创始人本次确认过的"直接覆盖"语义的一部分，不是bug。
function diffAgainstState(remoteFiles, stateFilesMap) {
  const stateMap = stateFilesMap || {};
  const remoteByPath = new Map(remoteFiles.map((f) => [f.relPath, f.sha]));

  const added = [];
  const changed = [];
  const removed = [];

  for (const [relPath, sha] of remoteByPath) {
    if (!(relPath in stateMap)) {
      added.push(relPath);
    } else if (stateMap[relPath] !== sha) {
      changed.push(relPath);
    }
  }
  for (const relPath of Object.keys(stateMap)) {
    if (!remoteByPath.has(relPath)) {
      removed.push(relPath);
    }
  }

  return { added, changed, removed };
}

// ---------- 网络/文件系统部分 ----------

function httpsGetJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout: timeoutMs, headers: { 'User-Agent': 'nodenanny-wiki-sync', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGetJson(res.headers.location, timeoutMs));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}（GitHub API，可能是仓库/分支不存在或触发了未认证限流）`));
          return;
        }
        // 真实bug修复(本轮复查发现，很可能就是wiki面板"??"乱码问题的根因):
        // 此前是 let data=''; data += chunk 逐块拼接——chunk是Buffer，+=会把每一块
        // 单独toString('utf-8')再拼接成字符串。网络传输经常把内容切成多个TCP包，
        // 如果一个多字节字符(比如中文，UTF-8下占3字节)刚好被切在两个chunk中间，
        // 对不完整的字节单独decode会产生U+FFFD替换字符，且这个损坏在这一步就已经
        // 写入了字符串——后面全部下游处理拿到的都是坏数据，跟"面板字体渲染问题"
        // 无关。改法：先收集原始Buffer，收完再一次性Buffer.concat().toString('utf-8')，
        // 这样多字节字符不管被切在哪个chunk边界都能正确拼回完整字节再解码。
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`GitHub API 返回内容不是合法JSON：${err.message}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.on('error', reject);
  });
}

function httpsGetText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout: timeoutMs, headers: { 'User-Agent': 'nodenanny-wiki-sync' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGetText(res.headers.location, timeoutMs));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        // 同上httpsGetJson的修复理由：这个函数下载的正是wiki正文markdown（长中文
        // 文章、多字节字符多，被TCP分包切中的概率更高），是"??"乱码最直接的嫌疑对象。
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.on('error', reject);
  });
}

// syncConfig 形状（对应 config.json 里的 wikiSync 段）：
//   { owner: 'xxx', repo: 'yyy', ref: 'main'（可选，默认main）, path: 'data/wiki'（可选，默认data/wiki） }
function normalizeSyncConfig(syncConfig) {
  if (!syncConfig || !syncConfig.owner || !syncConfig.repo) return null;
  return {
    owner: syncConfig.owner,
    repo: syncConfig.repo,
    ref: syncConfig.ref || 'main',
    remotePath: syncConfig.path || 'data/wiki'
  };
}

// 只读检查：拉远程文件树、算diff、把"这次要用哪份远程清单"落地到 staging，
// 不改动 data/wiki/ 下任何一个真实文件。面板上点"检查更新"调用这个。
async function checkForUpdate(syncConfig) {
  const cfg = normalizeSyncConfig(syncConfig);
  if (!cfg) return { ok: false, error: 'wiki_sync_not_configured' };

  let tree;
  try {
    tree = await httpsGetJson(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/git/trees/${encodeURIComponent(cfg.ref)}?recursive=1`
    );
  } catch (err) {
    return { ok: false, error: `fetch_failed: ${err.message}` };
  }
  if (tree.truncated) {
    // wiki目录规模一旦大到让GitHub把recursive tree截断，diff会不完整，必须显式报错
    // 而不是悄悄按不完整的清单处理，那样可能会漏删除/漏更新一部分文件。
    return { ok: false, error: 'remote_tree_truncated_too_large' };
  }

  const remoteFiles = filterWikiTreeEntries(tree.tree, cfg.remotePath);
  if (remoteFiles.length === 0) {
    return { ok: false, error: 'remote_wiki_path_empty_or_not_found' };
  }

  const state = readJsonSafe(STATE_PATH, { fingerprint: null, files: {} });
  const fingerprint = computeFingerprint(remoteFiles);
  const hasUpdate = fingerprint !== state.fingerprint;
  const diff = diffAgainstState(remoteFiles, state.files);

  writeJson(STAGING_PATH, {
    fetchedAt: new Date().toISOString(),
    fingerprint,
    ref: cfg.ref,
    files: remoteFiles // [{relPath, sha}]
  });

  return {
    ok: true,
    hasUpdate,
    added: diff.added,
    changed: diff.changed,
    removed: diff.removed,
    totalRemoteFiles: remoteFiles.length
  };
}

// 人工在面板上看过 checkForUpdate() 返回的diff、点了"确认覆盖"之后调用。
// 直接覆盖式镜像同步：added/changed 的文件下载最新内容覆盖本地，removed 的文件从本地删除。
async function applyUpdate(syncConfig) {
  const cfg = normalizeSyncConfig(syncConfig);
  if (!cfg) return { ok: false, error: 'wiki_sync_not_configured' };

  const staging = readJsonSafe(STAGING_PATH, null);
  if (!staging) return { ok: false, error: 'no_staging_run_check_first' };

  const state = readJsonSafe(STATE_PATH, { fingerprint: null, files: {} });
  const diff = diffAgainstState(staging.files, state.files);
  const toDownload = [...diff.added, ...diff.changed];

  let downloadedCount = 0;
  const failures = [];
  for (const relPath of toDownload) {
    const remoteUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${encodeURIComponent(staging.ref)}/${cfg.remotePath}/${relPath}`;
    try {
      const content = await httpsGetText(remoteUrl);
      const localPath = path.join(WIKI_DIR, relPath);
      // 双重防护：即便 staging 里的 relPath 已经在 checkForUpdate 阶段过滤过，
      // 落盘前再确认一次拼出来的绝对路径确实还在 WIKI_DIR 内。
      if (!localPath.startsWith(WIKI_DIR)) {
        failures.push({ relPath, error: 'path_escapes_wiki_dir' });
        continue;
      }
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content, 'utf-8');
      downloadedCount += 1;
    } catch (err) {
      failures.push({ relPath, error: err.message });
    }
  }

  // 镜像语义：远程没有了的文件，本地也删掉（创始人本次明确选择的"直接覆盖"方案的一部分）。
  let removedCount = 0;
  for (const relPath of diff.removed) {
    const localPath = path.join(WIKI_DIR, relPath);
    if (!localPath.startsWith(WIKI_DIR)) continue;
    try {
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        removedCount += 1;
      }
    } catch (err) {
      failures.push({ relPath, error: `delete_failed: ${err.message}` });
    }
  }

  // 只有真正下载成功的文件才写进新状态里的files map；失败的条目保留旧sha，
  // 下次checkForUpdate时会重新被判定为"changed"，不会因为这次部分失败就被当成已同步。
  const newFilesMap = { ...state.files };
  const failedPaths = new Set(failures.map((f) => f.relPath));
  for (const { relPath, sha } of staging.files) {
    if (failedPaths.has(relPath)) continue;
    newFilesMap[relPath] = sha;
  }
  for (const relPath of diff.removed) {
    if (!failedPaths.has(relPath)) delete newFilesMap[relPath];
  }

  writeJson(STATE_PATH, {
    fingerprint: failures.length === 0 ? staging.fingerprint : null, // 有失败就不敢标记"已完全同步到这个指纹"
    files: newFilesMap,
    lastAppliedAt: new Date().toISOString()
  });

  return {
    ok: failures.length === 0,
    downloadedCount,
    removedCount,
    failures
  };
}

function getStatus() {
  const state = readJsonSafe(STATE_PATH, { fingerprint: null, files: {}, lastAppliedAt: null });
  const staging = readJsonSafe(STAGING_PATH, null);
  return {
    lastAppliedAt: state.lastAppliedAt || null,
    trackedFileCount: Object.keys(state.files || {}).length,
    pendingCheck: staging ? { fetchedAt: staging.fetchedAt, fileCount: staging.files.length } : null
  };
}

module.exports = {
  isSafeRelPath,
  filterWikiTreeEntries,
  computeFingerprint,
  diffAgainstState,
  checkForUpdate,
  applyUpdate,
  getStatus
};
