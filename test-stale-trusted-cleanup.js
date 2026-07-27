'use strict';

// 测试:本轮新增的 cleanupStaleTrusted() —— 清理长期(180天)没被扫描到的trusted孤儿记录。
// 用隔离的 data 目录跑,不碰真实的 data/sources.json。

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-stale-trusted-'));
const fakeCoreDir = path.join(tmpRoot, 'core');
fs.mkdirSync(fakeCoreDir);
// source-trust.js 用 path.join(__dirname, '..', 'data'),所以把它复制到隔离目录里跑。
fs.copyFileSync(path.join(__dirname, 'core', 'source-trust.js'), path.join(fakeCoreDir, 'source-trust.js'));

const sourceTrust = require(path.join(fakeCoreDir, 'source-trust.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// 手动写入几种场景的记录,绕开 recordCheckResult 走时间线(方便精确控制 lastUpdated)。
const dataFile = path.join(tmpRoot, 'data', 'sources.json');
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify({
  sources: {
    'orgA/freshTrusted': { sourceId: 'orgA/freshTrusted', status: 'trusted', history: [], weight: 0.8, addedAt: daysAgoIso(300), lastUpdated: daysAgoIso(20), blacklistedAt: null },
    'orgB/staleTrusted': { sourceId: 'orgB/staleTrusted', status: 'trusted', history: [], weight: 0.7, addedAt: daysAgoIso(400), lastUpdated: daysAgoIso(200), blacklistedAt: null },
    'orgC/borderlineTrusted': { sourceId: 'orgC/borderlineTrusted', status: 'trusted', history: [], weight: 0.6, addedAt: daysAgoIso(400), lastUpdated: daysAgoIso(179), blacklistedAt: null },
    'orgD/staleTrial': { sourceId: 'orgD/staleTrial', status: 'trial', history: [], weight: 0.0, addedAt: daysAgoIso(60), lastUpdated: daysAgoIso(200), blacklistedAt: null },
    'orgE/staleBlacklisted': { sourceId: 'orgE/staleBlacklisted', status: 'blacklisted', history: [], weight: 0, addedAt: daysAgoIso(400), lastUpdated: daysAgoIso(200), blacklistedAt: daysAgoIso(200) }
  }
}, null, 2));

const { removed, removedSourceIds } = sourceTrust.cleanupStaleTrusted();

assert(removed === 1, `应该只清理1条(实际${removed})`);
assert(removedSourceIds.includes('orgB/staleTrusted'), '应该清理掉orgB/staleTrusted(200天没更新,超过180天阈值)');
assert(!removedSourceIds.includes('orgA/freshTrusted'), '不应该清理orgA/freshTrusted(只有20天,还新鲜)');
assert(!removedSourceIds.includes('orgC/borderlineTrusted'), '不应该清理orgC/borderlineTrusted(179天,还没超过180天阈值)');
assert(!removedSourceIds.includes('orgD/staleTrial'), '不应该清理orgD/staleTrial(trial状态不归这个函数管,归cleanupStaleTrials管)');
assert(!removedSourceIds.includes('orgE/staleBlacklisted'), '不应该清理orgE/staleBlacklisted(blacklisted状态不归这个函数管,归cleanupBlacklisted管)');

const afterState = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
assert(afterState.sources['orgA/freshTrusted'], 'orgA/freshTrusted 应该还在文件里');
assert(!afterState.sources['orgB/staleTrusted'], 'orgB/staleTrusted 应该已经从文件里删除');
assert(afterState.sources['orgC/borderlineTrusted'], 'orgC/borderlineTrusted 应该还在文件里(179天,差1天没到阈值)');
assert(afterState.sources['orgD/staleTrial'], 'orgD/staleTrial 应该还在文件里(不归这个函数管)');
assert(afterState.sources['orgE/staleBlacklisted'], 'orgE/staleBlacklisted 应该还在文件里(不归这个函数管)');

// 再跑一次,应该没有新的可清理项(幂等)
const second = sourceTrust.cleanupStaleTrusted();
assert(second.removed === 0, '第二次调用应该没有新记录可清理(幂等)');

// 边界:sources.json 完全没有任何记录时,不应该报错,应该返回 removed:0
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-stale-trusted-empty-'));
const emptyCoreDir = path.join(emptyRoot, 'core');
fs.mkdirSync(emptyCoreDir);
fs.copyFileSync(path.join(__dirname, 'core', 'source-trust.js'), path.join(emptyCoreDir, 'source-trust.js'));
const emptySourceTrust = require(path.join(emptyCoreDir, 'source-trust.js'));
let emptyThrew = false;
let emptyResult;
try {
  emptyResult = emptySourceTrust.cleanupStaleTrusted();
} catch (e) {
  emptyThrew = true;
}
assert(!emptyThrew, 'sources.json 不存在时不应该报错');
assert(emptyResult && emptyResult.removed === 0, 'sources.json 不存在时应该返回 removed:0');

console.log(`\ntest-stale-trusted-cleanup.js: ${pass} passed, ${fail} failed`);
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.rmSync(emptyRoot, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
