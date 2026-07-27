'use strict';

// 测试:本轮新增的 cleanupStaleTrials() —— 清理长期没被扫描到的孤儿trial记录。
// 用隔离的 data 目录跑，不碰真实的 data/sources.json。

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-stale-trial-'));
const fakeCoreDir = path.join(tmpRoot, 'core');
fs.mkdirSync(fakeCoreDir);
// source-trust.js 用 path.join(__dirname, '..', 'data')，所以把它复制到隔离目录里跑。
fs.copyFileSync(path.join(__dirname, 'core', 'source-trust.js'), path.join(fakeCoreDir, 'source-trust.js'));

const sourceTrust = require(path.join(fakeCoreDir, 'source-trust.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// 手动写入几种场景的记录，绕开 recordCheckResult 走时间线（方便精确控制 lastUpdated）。
const dataFile = path.join(tmpRoot, 'data', 'sources.json');
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify({
  sources: {
    'orgA/freshTrial': { sourceId: 'orgA/freshTrial', status: 'trial', history: [], weight: 0.01, addedAt: daysAgoIso(5), lastUpdated: daysAgoIso(2), blacklistedAt: null },
    'orgB/staleTrial': { sourceId: 'orgB/staleTrial', status: 'trial', history: [], weight: 0.0, addedAt: daysAgoIso(60), lastUpdated: daysAgoIso(35), blacklistedAt: null },
    'orgC/trustedOld': { sourceId: 'orgC/trustedOld', status: 'trusted', history: [], weight: 0.8, addedAt: daysAgoIso(90), lastUpdated: daysAgoIso(40), blacklistedAt: null },
    'orgD/blacklistedOld': { sourceId: 'orgD/blacklistedOld', status: 'blacklisted', history: [], weight: 0, addedAt: daysAgoIso(90), lastUpdated: daysAgoIso(40), blacklistedAt: daysAgoIso(40) }
  }
}, null, 2));

const { removed, removedSourceIds } = sourceTrust.cleanupStaleTrials();

assert(removed === 1, `应该只清理1条(实际${removed})`);
assert(removedSourceIds.includes('orgB/staleTrial'), '应该清理掉orgB/staleTrial(35天没更新的trial记录)');
assert(!removedSourceIds.includes('orgA/freshTrial'), '不应该清理orgA/freshTrial(只有2天,还新鲜)');
assert(!removedSourceIds.includes('orgC/trustedOld'), '不应该清理orgC/trustedOld(trusted状态,不在清理范围内)');
assert(!removedSourceIds.includes('orgD/blacklistedOld'), '不应该清理orgD/blacklistedOld(已经是blacklisted,归cleanupBlacklisted管,不归这个函数管)');

const afterState = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
assert(afterState.sources['orgA/freshTrial'], 'orgA/freshTrial 应该还在文件里');
assert(!afterState.sources['orgB/staleTrial'], 'orgB/staleTrial 应该已经从文件里删除');
assert(afterState.sources['orgC/trustedOld'], 'orgC/trustedOld 应该还在文件里');
assert(afterState.sources['orgD/blacklistedOld'], 'orgD/blacklistedOld 应该还在文件里(不归这个函数管)');

// 再跑一次,应该没有新的可清理项(幂等)
const second = sourceTrust.cleanupStaleTrials();
assert(second.removed === 0, '第二次调用应该没有新记录可清理(幂等)');

console.log(`\ntest-stale-trial-cleanup.js: ${pass} passed, ${fail} failed`);
fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
