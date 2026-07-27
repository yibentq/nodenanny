'use strict';

// 2026-07-27补写：任务清单第4项（故障报告生成器）遗漏的测试文件。
// core/failure-report.js 本身在这次session之前就已经存在并交付，但配套的单测
// 在交接文档之间的某次传递中丢失了（推测是某次工具"aborted; no result was returned"
// 故障导致的，具体原因已不可考）。这里补写，覆盖 assembleReportText 这个纯组装函数——
// 只吃传入的 state/events，不碰真实 store.json 文件，跟 test-usability-classify.js
// 对 classifyUsabilityError 的单测方式是同一个思路。

const assert = require('assert');
const { _internal: { assembleReportText, collectKbSuggestions } } = require('./core/failure-report');

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

console.log('assembleReportText / collectKbSuggestions:');

test('中文报告：基本字段（标题/节点名/TCP状态/来源）都出现', () => {
  const text = assembleReportText({
    config: { node: { name: 'hk-01' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self', usabilityStatus: 'ok' },
    events: []
  });
  assert.ok(text.includes('NodeNanny 故障报告'));
  assert.ok(text.includes('hk-01'));
  assert.ok(text.includes('正常'));
  assert.ok(text.includes('自建节点'));
});

test('英文报告：标签用英文，不泄漏中文detail之外的内容', () => {
  const text = assembleReportText({
    config: { node: { name: 'jp-02' } },
    lang: 'en',
    state: { status: 'down', activeSource: 'pool', usabilityStatus: 'down' },
    events: []
  });
  assert.ok(text.includes('NodeNanny Failure Report'));
  assert.ok(text.includes('Down'));
  assert.ok(text.includes('Backup pool'));
});

test('不支持的语言代码回退到中文（normalizeLang兜底）', () => {
  const text = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'fr', // 不在SUPPORTED_LANGS里
    state: { status: 'ok', activeSource: 'self' },
    events: []
  });
  assert.ok(text.includes('NodeNanny 故障报告'));
});

test('没有事件时显示"没有值得记录的事件"占位文案', () => {
  const text = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self' },
    events: []
  });
  assert.ok(text.includes('（最近没有值得记录的事件）'));
});

test('时间线正确渲染down/recovered事件，且按传入顺序（新到旧）摘录', () => {
  const text = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self' },
    events: [
      { type: 'recovered', time: '2026-07-27T02:00:00.000Z', params: { downMinutes: 5 } },
      { type: 'down', time: '2026-07-27T01:55:00.000Z', params: {} }
    ]
  });
  const recoveredIdx = text.indexOf('已恢复正常');
  const downIdx = text.indexOf('判定为down');
  assert.ok(recoveredIdx > -1 && downIdx > -1);
  assert.ok(recoveredIdx < downIdx, '新事件(recovered)应该排在旧事件(down)前面');
  assert.ok(text.includes('持续约 5 分钟'));
});

test('超过15条相关事件时时间线只截取最近15条', () => {
  const events = [];
  for (let i = 0; i < 20; i++) {
    events.push({ type: 'usability_ok', time: `2026-07-27T00:${String(i).padStart(2, '0')}:00.000Z`, params: {} });
  }
  const text = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self' },
    events
  });
  const count = (text.match(/二层可用性检测恢复正常/g) || []).length;
  assert.strictEqual(count, 15);
});

test('无关事件类型（不在RELEVANT_EVENT_TYPES里）不出现在时间线中', () => {
  const text = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self' },
    events: [{ type: 'some_unrelated_noise_type', time: '2026-07-27T00:00:00.000Z', params: {} }]
  });
  assert.ok(text.includes('（最近没有值得记录的事件）'));
});

test('今日无重启动作时显示"还没有触发过"占位文案；有重启时显示尝试/成功次数', () => {
  const textNone = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self', restartsToday: 0, restartsSuccessToday: 0 },
    events: []
  });
  assert.ok(textNone.includes('（还没有触发过任何自动重启/切换动作）'));

  const textSome = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self', restartsToday: 3, restartsSuccessToday: 2 },
    events: []
  });
  assert.ok(textSome.includes('今日累计尝试重启 3 次'));
  assert.ok(textSome.includes('其中重启命令实际执行成功 2 次'));
});

test('AI诊断：成功案例显示诊断文本；失败案例显示失败措辞而不是文本', () => {
  const textOk = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self', lastDiagnosis: { at: '2026-07-27T00:00:00.000Z', text: '疑似目标端限速' } },
    events: []
  });
  assert.ok(textOk.includes('疑似目标端限速'));

  const textFail = assembleReportText({
    config: { node: { name: 'x' } },
    lang: 'zh',
    state: { status: 'ok', activeSource: 'self', lastDiagnosis: { at: '2026-07-27T00:00:00.000Z', error: 'API超时' } },
    events: []
  });
  assert.ok(textFail.includes('AI诊断本身调用失败'));
  assert.ok(textFail.includes('API超时'));
});

test('collectKbSuggestions对同一个kb条目去重，且优先取对应语言的explanation', () => {
  const timelineEvents = [
    { type: 'usability_restart_suggested', time: 't1', params: { kb: [{ id: 'kb-1', title: 'T1', riskLevel: 'high', explanation: { zh: '中文解释', en: 'english explain' } }] } },
    { type: 'usability_restart_suggested', time: 't2', params: { kb: [{ id: 'kb-1', title: 'T1', riskLevel: 'high', explanation: { zh: '中文解释', en: 'english explain' } }] } },
    { type: 'usability_restart_suggested', time: 't3', params: { kb: [{ id: 'kb-2', title: 'T2', explanation: { en: 'only english' } }] } }
  ];
  const zhResult = collectKbSuggestions(timelineEvents, 'zh');
  assert.strictEqual(zhResult.length, 2, '同一个kb-1条目应该只出现一次');
  assert.strictEqual(zhResult[0].explanation, '中文解释');

  const jaResult = collectKbSuggestions(timelineEvents, 'ja');
  // ja没有对应翻译时应该兜底到en
  assert.strictEqual(jaResult[1].explanation, 'only english');
});

console.log(`\n${passed} 项通过`);
if (process.exitCode) {
  console.error('存在失败项');
  process.exit(1);
}
