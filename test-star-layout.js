'use strict';

const assert = require('assert');
const { layoutStars, MAX_MAIN_STARS, MAX_BLACKLIST_STARS, MIN_DISTANCE } = require('./core/star-layout');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

function makeNodes(establishedCount, trialCount, blacklistedCount) {
  const nodes = [];
  for (let i = 0; i < establishedCount; i++) {
    nodes.push({ sourceId: `est-${i}`, status: 'established', weight: 100 - i });
  }
  for (let i = 0; i < trialCount; i++) {
    nodes.push({ sourceId: `trial-${i}`, status: 'trial', weight: 10 - i * 0.1 });
  }
  for (let i = 0; i < blacklistedCount; i++) {
    nodes.push({ sourceId: `bl-${i}`, status: 'blacklisted', weight: 0 });
  }
  return nodes;
}

const CANVAS_W = 420;
const CANVAS_H = 320;

// 1. 基本调用:数量不超上限时,全部节点都应该被摆出坐标。
{
  const nodes = makeNodes(3, 2, 1);
  const result = layoutStars(nodes, CANVAS_W, CANVAS_H);
  check(result.stars.length === 6, `6个节点应该摆出6颗星(实际:${result.stars.length})`);
  check(result.overflowCount === 0, `未超上限时overflowCount应该是0(实际:${result.overflowCount})`);
  check(result.blacklistOverflowCount === 0, `未超上限时blacklistOverflowCount应该是0(实际:${result.blacklistOverflowCount})`);
}

// 2. 主星区超过上限(20):应该只摆20颗,超出部分计入overflowCount，且按weight取前20(权重最高的应该都在)。
{
  const nodes = makeNodes(15, 10, 0); // 共25个established+trial，超过20
  const result = layoutStars(nodes, CANVAS_W, CANVAS_H);
  const mainStars = result.stars.filter((s) => s.status !== 'blacklisted');
  check(mainStars.length === MAX_MAIN_STARS, `主星区应该只摆${MAX_MAIN_STARS}颗(实际:${mainStars.length})`);
  check(result.overflowCount === 5, `25个节点超上限20，overflowCount应该是5(实际:${result.overflowCount})`);
  // 权重最高的几个established(weight 100,99,98...)必须都在结果里
  const placedIds = new Set(mainStars.map((s) => s.sourceId));
  check(placedIds.has('est-0') && placedIds.has('est-1'), '权重最高的established节点应该被优先保留');
}

// 3. 拉黑区超过上限(8):应该只摆8颗，超出部分计入blacklistOverflowCount。
{
  const nodes = makeNodes(2, 2, 12);
  const result = layoutStars(nodes, CANVAS_W, CANVAS_H);
  const blStars = result.stars.filter((s) => s.status === 'blacklisted');
  check(blStars.length === MAX_BLACKLIST_STARS, `拉黑区应该只摆${MAX_BLACKLIST_STARS}颗(实际:${blStars.length})`);
  check(result.blacklistOverflowCount === 4, `12个拉黑节点超上限8，blacklistOverflowCount应该是4(实际:${result.blacklistOverflowCount})`);
}

// 4. 所有坐标必须落在画布范围内。
{
  const nodes = makeNodes(20, 20, 10);
  const result = layoutStars(nodes, CANVAS_W, CANVAS_H);
  const outOfBounds = result.stars.filter((s) => s.x < 0 || s.x > CANVAS_W || s.y < 0 || s.y > CANVAS_H);
  check(outOfBounds.length === 0, `所有坐标应该落在画布范围内(超出范围的有${outOfBounds.length}个)`);
}

// 5. 同一分区内的星星,大多数情况下应该保持最小间距(允许极少数因为MAX_RETRIES耗尽而贴近，
//    但不应该出现大面积重叠——这里用宽松阈值验证:重叠(距离<MIN_DISTANCE的一半)的对数应为0)。
{
  const nodes = makeNodes(15, 5, 0);
  const result = layoutStars(nodes, CANVAS_W, CANVAS_H);
  let severeOverlaps = 0;
  for (let i = 0; i < result.stars.length; i++) {
    for (let j = i + 1; j < result.stars.length; j++) {
      const dx = result.stars[i].x - result.stars[j].x;
      const dy = result.stars[i].y - result.stars[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < MIN_DISTANCE / 2) severeOverlaps++;
    }
  }
  check(severeOverlaps === 0, `不应该出现严重重叠(距离小于最小间距一半)的星对(实际:${severeOverlaps}对)`);
}

// 6. 空输入应该安全返回，不抛异常。
{
  const result = layoutStars([], CANVAS_W, CANVAS_H);
  check(result.stars.length === 0, '空数组输入应该返回0颗星');
  check(result.overflowCount === 0 && result.blacklistOverflowCount === 0, '空数组输入的溢出计数都应该是0');
}

{
  const result = layoutStars(null, CANVAS_W, CANVAS_H);
  check(result.stars.length === 0, 'null输入应该安全返回0颗星,不抛异常');
}

// 7. 每次调用都应该重新随机(创始人拍板:不做sourceId哈希固定位置)。
{
  const nodes = makeNodes(5, 3, 0);
  const result1 = layoutStars(nodes, CANVAS_W, CANVAS_H);
  const result2 = layoutStars(nodes, CANVAS_W, CANVAS_H);
  const sameEveryPoint = result1.stars.every((s, i) => {
    const other = result2.stars[i];
    return other && Math.abs(s.x - other.x) < 0.0001 && Math.abs(s.y - other.y) < 0.0001;
  });
  check(!sameEveryPoint, '两次调用应该产生不同的随机布局(不是固定位置)');
}

// 8. established整体应该比trial更靠近画布中心(统计意义上，用较大样本验证平均值，
//    避免单次随机抖动导致的偶然误判)。
{
  const nodes = makeNodes(10, 10, 0);
  const centerX = CANVAS_W / 2;
  const centerY = CANVAS_H / 2;
  let estDistSum = 0, trialDistSum = 0;
  const trials = 30; // 跑30次取平均，减少随机性带来的偶然失败
  for (let t = 0; t < trials; t++) {
    const result = layoutStars(nodes, CANVAS_W, CANVAS_H);
    for (const s of result.stars) {
      const d = Math.sqrt((s.x - centerX) ** 2 + (s.y - centerY) ** 2);
      if (s.status === 'established') estDistSum += d;
      else if (s.status === 'trial') trialDistSum += d;
    }
  }
  const estAvg = estDistSum / (10 * trials);
  const trialAvg = trialDistSum / (10 * trials);
  check(estAvg < trialAvg, `established平均应该比trial更靠近中心(established:${estAvg.toFixed(1)}, trial:${trialAvg.toFixed(1)})`);
}

// 9. 传入harborArea(港口标记占用区域)不应该导致报错,且不影响坐标始终落在画布内。
{
  const nodes = makeNodes(5, 5, 2);
  const harborArea = { xMin: 30, xMax: 60, yMin: 250, yMax: 280 };
  const result = layoutStars(nodes, CANVAS_W, CANVAS_H, harborArea);
  const outOfBounds = result.stars.filter((s) => s.x < 0 || s.x > CANVAS_W || s.y < 0 || s.y > CANVAS_H);
  check(outOfBounds.length === 0, '传入harborArea后坐标依然应该落在画布范围内');
  check(result.stars.length === 12, '传入harborArea不应该影响正常摆放的星星数量');
}

console.log(`\ntest-star-layout.js: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
