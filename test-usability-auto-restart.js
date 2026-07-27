'use strict';

// core/checker.js 里 shouldSuggestUsability / shouldAutoRestartUsability 的单元测试。
// 跟test-terminal.js的思路一致：只测从checkUsabilityAndLog里抽出来的纯判定函数，
// 不碰store.js的真实data/store.json文件、不碰notify.js的真实发信、不碰
// usability-check.js的真实xray进程——那些是需要真实基础设施的部分，不在这里测。
//
// v36新增背景：二层可用性检测此前(v34)只有"连续N次down就发一封仅建议不重启的邮件"
// 这一条线。这一轮founder拍板加了第二条独立的线——连续更多次(默认5，比建议阈值3更高)
// 就真的调用一次node.restartCommand自动重启本地代理。两条线用各自独立的阈值/
// "这次发作期是否已触发"标记，互不影响，见checker.js里的注释。

const assert = require('assert');
const {
  _internal: { shouldSuggestUsability, shouldAutoRestartUsability }
} = require('./core/checker');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('shouldSuggestUsability（v34已有的"仅建议"触发线，回归保护）:');

test('连续次数低于阈值，不建议', () => {
  const result = shouldSuggestUsability({ consecutiveUsabilityDown: 2, suggestThreshold: 3, alreadySuggestedThisIncident: false });
  assert.strictEqual(result, false);
});

test('连续次数达到阈值、这次发作期还没建议过 -> 建议', () => {
  const result = shouldSuggestUsability({ consecutiveUsabilityDown: 3, suggestThreshold: 3, alreadySuggestedThisIncident: false });
  assert.strictEqual(result, true);
});

test('连续次数超过阈值很多，但这次发作期已经建议过 -> 不重复建议', () => {
  const result = shouldSuggestUsability({ consecutiveUsabilityDown: 10, suggestThreshold: 3, alreadySuggestedThisIncident: true });
  assert.strictEqual(result, false);
});

console.log('shouldAutoRestartUsability（v36新增的自动重启触发线）:');

test('连续次数低于阈值，不重启', () => {
  const result = shouldAutoRestartUsability({
    consecutiveUsabilityDown: 4,
    autoRestartThreshold: 5,
    alreadyAutoRestartedThisIncident: false,
    hasRestartCommand: 'systemctl restart xray'
  });
  assert.strictEqual(result, false);
});

test('连续次数达到阈值、这次发作期还没重启过、配置了restartCommand -> 重启', () => {
  const result = shouldAutoRestartUsability({
    consecutiveUsabilityDown: 5,
    autoRestartThreshold: 5,
    alreadyAutoRestartedThisIncident: false,
    hasRestartCommand: 'systemctl restart xray'
  });
  assert.strictEqual(result, true);
});

test('连续次数远超阈值，但这次发作期已经重启过一次 -> 不重复重启（每次发作期最多一次）', () => {
  const result = shouldAutoRestartUsability({
    consecutiveUsabilityDown: 20,
    autoRestartThreshold: 5,
    alreadyAutoRestartedThisIncident: true,
    hasRestartCommand: 'systemctl restart xray'
  });
  assert.strictEqual(result, false);
});

test('达到阈值、这次发作期没重启过，但没配置restartCommand -> 不重启（没有目标可重启，不强制要求配置）', () => {
  const result = shouldAutoRestartUsability({
    consecutiveUsabilityDown: 8,
    autoRestartThreshold: 5,
    alreadyAutoRestartedThisIncident: false,
    hasRestartCommand: undefined
  });
  assert.strictEqual(result, false);
});

test('hasRestartCommand是空字符串（等同未配置）-> 不重启', () => {
  const result = shouldAutoRestartUsability({
    consecutiveUsabilityDown: 8,
    autoRestartThreshold: 5,
    alreadyAutoRestartedThisIncident: false,
    hasRestartCommand: ''
  });
  assert.strictEqual(result, false);
});

test('自动重启阈值(5)明显高于建议阈值(3)——同一批次连续失败次数从3到5的过程中，先建议、后重启，两条线不冲突', () => {
  // 模拟连续down从1数到6，观察两条线各自何时触发
  let suggested = false;
  let autoRestarted = false;
  let suggestedAtCount = null;
  let autoRestartedAtCount = null;
  for (let count = 1; count <= 6; count++) {
    if (shouldSuggestUsability({ consecutiveUsabilityDown: count, suggestThreshold: 3, alreadySuggestedThisIncident: suggested })) {
      suggested = true;
      suggestedAtCount = count;
    }
    if (shouldAutoRestartUsability({
      consecutiveUsabilityDown: count,
      autoRestartThreshold: 5,
      alreadyAutoRestartedThisIncident: autoRestarted,
      hasRestartCommand: 'systemctl restart xray'
    })) {
      autoRestarted = true;
      autoRestartedAtCount = count;
    }
  }
  assert.strictEqual(suggestedAtCount, 3);
  assert.strictEqual(autoRestartedAtCount, 5);
});

console.log(`\n${passed} 项通过`);
