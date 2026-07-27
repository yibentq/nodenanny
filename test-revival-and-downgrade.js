'use strict';

// 测试:source-trust.js 里两条此前完全没有测试覆盖的路径——
//   1) REVIVAL_PERIODS_TO_UNBLACKLIST 复活机制(blacklisted -> trial)
//   2) TRUSTED_DOWNGRADE_PERIODS 降级机制(trusted -> trial)
// 这两条状态转换此前只有代码和注释,没有任何自动化测试验证过真实行为——
// 本轮复查(创始人要求排查拉黑机制隐藏问题)手动模拟跑通过,补一份测试固定下来,
// 避免以后改动 source-trust.js 时无声无息破坏这两条路径。
// 用隔离的 data 目录跑，不碰真实的 data/sources.json。

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-revival-downgrade-'));
const fakeCoreDir = path.join(tmpRoot, 'core');
fs.mkdirSync(fakeCoreDir);
fs.copyFileSync(path.join(__dirname, 'core', 'source-trust.js'), path.join(fakeCoreDir, 'source-trust.js'));

const sourceTrust = require(path.join(fakeCoreDir, 'source-trust.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

// ---------- 场景一:复活机制(blacklisted -> trial) ----------
(() => {
  const id = 'manual:revival-scenario';

  // 用异常信号(anomalyDetected)直接判死,制造一个"已拉黑"来源。
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 10, anomalyDetected: true });
  let state = sourceTrust.getSourceState(id);
  assert(state.status === 'blacklisted', '异常信号应该直接拉黑');
  assert(state.weight === 0, '拉黑后权重应该归零');

  // 第1轮达标(>=70%通过率),还不够复活。
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 });
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'blacklisted', '只有1轮达标,还不够REVIVAL_PERIODS_TO_UNBLACKLIST(2轮),应该仍是blacklisted');

  // 第2轮继续达标 -> 应该复活成trial。
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 });
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'trial', '连续2轮达标后应该复活成trial');
  assert(state.weight > 0 && state.weight <= 0.05, `复活后权重应该在trial期上限(5%)内(实际${state.weight})`);
})();

// ---------- 场景二:复活途中被打断,连续计数要清零重来 ----------
(() => {
  const id = 'manual:revival-interrupted';
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 10, anomalyDetected: true });

  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 }); // 达标1轮
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 1 }); // 中间插一轮不达标,打断连续计数
  let state = sourceTrust.getSourceState(id);
  assert(state.status === 'blacklisted', '连续达标被打断,不应该复活');

  // 打断之后重新连续达标2轮才能复活,单单再来1轮还不够。
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 });
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'blacklisted', '打断后只重新达标1轮,还不够,应该仍是blacklisted');

  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 });
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'trial', '打断后重新连续达标2轮,应该复活');
})();

// ---------- 场景三:降级机制(trusted -> trial) ----------
(() => {
  const id = 'manual:downgrade-scenario';

  // 先用7轮连续达标把它从trial推上trusted。
  for (let i = 0; i < 7; i++) {
    sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 });
  }
  let state = sourceTrust.getSourceState(id);
  assert(state.status === 'trusted', '连续7轮达标应该转正为trusted');
  assert(state.weight > 0.8, `刚转正时权重应该接近实测通过率(实际${state.weight})`);

  // 连续6轮跌破阈值,还不够降级(需要连续7轮)。
  for (let i = 0; i < 6; i++) {
    sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 2 }); // 20%,低于70%阈值
  }
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'trusted', '连续6轮跌破阈值还不够(需要7轮),应该仍是trusted');

  // 第7轮 -> 应该降级回trial。
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 2 });
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'trial', '连续7轮跌破阈值应该降级回trial');
  assert(state.weight <= 0.05, `降级回trial后权重应该被压回trial期上限内(实际${state.weight})`);
})();

// ---------- 场景四:降级途中恢复达标,连续计数清零重来(不应该被打断的坏轮"记仇") ----------
(() => {
  const id = 'manual:downgrade-interrupted';
  for (let i = 0; i < 7; i++) {
    sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 });
  }
  for (let i = 0; i < 6; i++) {
    sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 2 }); // 6轮跌破
  }
  sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 9 }); // 第7轮突然恢复达标,打断降级计数
  let state = sourceTrust.getSourceState(id);
  assert(state.status === 'trusted', '降级计数被恢复达标打断,不应该被降级,应该仍是trusted');

  // 打断之后重新连续跌破7轮才会降级,不会因为之前攒的6轮残留就提前触发。
  for (let i = 0; i < 6; i++) {
    sourceTrust.recordCheckResult(id, { totalChecked: 10, passed: 2 });
  }
  state = sourceTrust.getSourceState(id);
  assert(state.status === 'trusted', '打断后只重新跌破6轮,还不够,应该仍是trusted(验证计数器真的被清零重算,不是延续之前的残留)');
})();

// 清理:这个测试用的是隔离的tmp目录,不会碰到真实的data/sources.json,直接删掉整个tmp目录即可。
console.log(`\ntest-revival-and-downgrade.js: ${pass} passed, ${fail} failed`);
fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
