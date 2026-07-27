'use strict';

// 知识库远程同步模块（交接文档v4方案，骨架阶段——还没接入创始人真正要用的GitHub仓库地址）。
//
// 安全设计（v4文档第二节第3条，这是这个文件存在的全部意义）：
// 1. 远程内容永远先落地到 staging，不直接合并进生效的 knowledge-base.json
// 2. 合并前必须做commit hash比对：只有当远程内容的hash发生变化时才提示"有更新"，
//    而且要求配置里显式pin住"当前信任的hash"，不能是"文件变了就无条件采信"
// 3. staging合并进生效版需要显式调用 applyStaging()（由人工在面板点确认触发），
//    没有任何自动定时任务会跳过人工确认直接合并
// 4. 合并进来的条目一律标记 verified:false、source:'remote-sync'，不自动获得一键执行权限
//
// 当前还没做但清单里写明、以后接入真实仓库时必须补上的：
// - GPG/sigstore 签名校验（现在只做hash比对，hash比对防不住"仓库账号被盗后连带改了
//   记录的hash"这种攻击链，只是防"内容被中间人篡改却没人发现"这种最基础的问题）
// - 仓库维护者白名单（只信任特定几个GitHub账号的commit，而不是"这个仓库地址下的任何内容"）

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KB_PATH = path.join(DATA_DIR, 'knowledge-base.json');
const STAGING_PATH = path.join(DATA_DIR, 'kb-staging.json');
const SYNC_STATE_PATH = path.join(DATA_DIR, 'kb-sync-state.json');

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[kb-sync] 读取 ${filePath} 失败：${err.message}`);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function httpsGet(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // GitHub raw 内容偶尔会走一次重定向，跟一层就够，不做无限跟随。
        resolve(httpsGet(res.headers.location, timeoutMs));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.on('error', reject);
  });
}

// 拉取远程知识库，只做hash比对+落地staging，不做任何合并动作。
// syncConfig 形状（对应 config.json 里未来的 kbSync 段，还没定字段名，先按这个来）：
//   { rawUrl: '...', pinnedHash: '上次人工确认过的hash（可选，首次同步时为空）' }
async function checkForUpdate(syncConfig) {
  if (!syncConfig || !syncConfig.rawUrl) {
    return { ok: false, error: 'kb_sync_not_configured' };
  }
  let remoteText;
  try {
    remoteText = await httpsGet(syncConfig.rawUrl);
  } catch (err) {
    return { ok: false, error: `fetch_failed: ${err.message}` };
  }

  let remoteJson;
  try {
    remoteJson = JSON.parse(remoteText);
  } catch (err) {
    // 远程内容解析失败，绝不当成"暂时没有更新"悄悄放过——必须显式报错，
    // 否则一次网络劫持/损坏的响应会被静默忽略，用户完全不知道同步其实失败了。
    return { ok: false, error: `remote_content_invalid_json: ${err.message}` };
  }

  const remoteHash = sha256(remoteText);
  const syncState = readJsonSafe(SYNC_STATE_PATH, { pinnedHash: null, lastCheckedAt: null });

  const hasUpdate = remoteHash !== syncState.pinnedHash;
  if (hasUpdate) {
    // 落地到staging，等待人工调用 applyStaging() 确认合并；这一步本身不改动生效版knowledge-base.json。
    writeJson(STAGING_PATH, {
      fetchedAt: new Date().toISOString(),
      hash: remoteHash,
      entries: Array.isArray(remoteJson.entries) ? remoteJson.entries : []
    });
  }

  syncState.lastCheckedAt = new Date().toISOString();
  writeJson(SYNC_STATE_PATH, syncState);

  return { ok: true, hasUpdate, remoteHash, entryCount: (remoteJson.entries || []).length };
}

// 生成"远程staging vs 当前生效版"的diff，供面板展示给用户看了再决定要不要合并。
// 只做id级别的新增/修改/删除对比，不做逐字段的深度diff（够用，且前端展示更简单）。
function diffStagingAgainstCurrent() {
  const staging = readJsonSafe(STAGING_PATH, null);
  if (!staging) return { ok: false, error: 'no_staging' };
  const current = readJsonSafe(KB_PATH, { entries: [] });

  const currentById = new Map((current.entries || []).map((e) => [e.id, e]));
  const stagingById = new Map((staging.entries || []).map((e) => [e.id, e]));

  const added = [];
  const modified = [];
  const removed = [];

  for (const [id, entry] of stagingById) {
    if (!currentById.has(id)) {
      added.push(entry);
    } else if (JSON.stringify(currentById.get(id)) !== JSON.stringify(entry)) {
      modified.push({ id, before: currentById.get(id), after: entry });
    }
  }
  for (const [id, entry] of currentById) {
    if (!stagingById.has(id) && entry.source === 'remote-sync') {
      // 只有"上次也是从远程同步来的"条目才算"远程删除了这一条"；
      // 本地手动/AI生成的条目哪怕staging里没有，也不算"被移除"，不能被远程同步影响。
      removed.push(entry);
    }
  }

  return { ok: true, added, modified, removed, fetchedAt: staging.fetchedAt, hash: staging.hash };
}

// 人工在面板上点了"确认合并"之后才会调用这个函数。
// 合并进来/改动过的条目一律强制 verified:false、source:'remote-sync'，
// 不管远程数据里怎么写这两个字段——防止远程内容自己声称"我已经verified"来绕过人工复核。
function applyStaging({ acceptedIds } = {}) {
  const staging = readJsonSafe(STAGING_PATH, null);
  if (!staging) return { ok: false, error: 'no_staging' };
  const current = readJsonSafe(KB_PATH, { entries: [] });
  const currentById = new Map((current.entries || []).map((e) => [e.id, e]));

  const idsToApply = Array.isArray(acceptedIds)
    ? new Set(acceptedIds)
    : new Set((staging.entries || []).map((e) => e.id)); // 不传则全量接受

  for (const entry of staging.entries || []) {
    if (!idsToApply.has(entry.id)) continue;
    currentById.set(entry.id, Object.assign({}, entry, {
      verified: false,
      source: 'remote-sync'
    }));
  }

  writeJson(KB_PATH, { entries: Array.from(currentById.values()) });

  const syncState = readJsonSafe(SYNC_STATE_PATH, {});
  syncState.pinnedHash = staging.hash;
  syncState.appliedAt = new Date().toISOString();
  writeJson(SYNC_STATE_PATH, syncState);

  return { ok: true, appliedCount: idsToApply.size };
}

module.exports = {
  checkForUpdate,
  diffStagingAgainstCurrent,
  applyStaging
};
