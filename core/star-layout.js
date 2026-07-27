'use strict';

// 守望星图·布局算法(批次五·星图第一步)。
//
// 定位:纯计算函数,只负责"给定一批节点/来源,算出每颗星在画布上的坐标",
// 不掺杂任何DOM/SVG/HTML渲染逻辑——方便单独写自动化测试,也方便以后
// 面板正式接入时直接复用这份计算结果去画图。
//
// 设计依据(创始人已拍板的三个决策,详见交接文档三十六.6节):
// 1. 数量上限:最多摆20颗"来源星"(established/trial),超过按weight
//    从高到低取前20,截掉的不在这个函数的职责范围内(由调用方在传入
//    nodes之前先做好截断)。
// 2. 拉黑来源(blacklisted):固定摆在画布角落一小簇,不参与主星区的
//    随机布局,数量本身也有软上限(默认8个,更多的话调用方自己在
//    UI上收纳成"+N",这个函数只负责给到"最多能摆几个坐标")。
// 3. 布局随机性:每次调用都重新随机(不做sourceId哈希固定位置)。
//
// 算法:拒绝采样(rejection sampling),不引入力导向/物理引擎这类
// 重量级方案,符合项目"极简优先"的原则。

const MAX_MAIN_STARS = 20; // 主星区(established+trial)最多同时布局的星数
const MAX_BLACKLIST_STARS = 8; // 角落拉黑区最多同时布局的星数
const MIN_DISTANCE = 18; // 星与星之间的最小间距(像素)
const MAX_RETRIES = 20; // 单颗星找不重叠位置的最大重试次数
const JITTER = 2; // 最终坐标叠加的小幅随机抖动(像素,正负范围)

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

// 在给定矩形区域内,用拒绝采样摆放count个点,尽量互相不重叠。
// area: { xMin, xMax, yMin, yMax }
// existingPoints: 已经放好的点(比如另一个分区已经占用的坐标),新点也要避开这些。
// 返回:坐标数组,长度等于count(即使最后没能完全避开重叠,也不会少放)。
function placePointsInArea(count, area, existingPoints) {
  const placed = [];
  const allPoints = existingPoints.slice(); // 避开这个分区之外已放置的点

  for (let i = 0; i < count; i++) {
    let candidate = null;
    let attempts = 0;
    while (attempts < MAX_RETRIES) {
      const x = randomInRange(area.xMin, area.xMax);
      const y = randomInRange(area.yMin, area.yMax);
      const tooClose = allPoints.some((p) => distance(p, { x, y }) < MIN_DISTANCE);
      if (!tooClose) {
        candidate = { x, y };
        break;
      }
      candidate = { x, y }; // 即使这次太近,也先记下来,万一是最后一次尝试就用它
      attempts++;
    }
    // 叠加小幅抖动,避免"网格感"(即便是拒绝采样已经算出的坐标,也不完全是规整分布,
    // 但抖动能让最终视觉效果更自然一些,不会看起来像是精确计算出来的)。
    const jittered = {
      x: candidate.x + randomInRange(-JITTER, JITTER),
      y: candidate.y + randomInRange(-JITTER, JITTER)
    };
    // 抖动之后夹回画布边界内,避免星星画到区域外面去。
    jittered.x = Math.min(Math.max(jittered.x, area.xMin), area.xMax);
    jittered.y = Math.min(Math.max(jittered.y, area.yMin), area.yMax);

    placed.push(jittered);
    allPoints.push(jittered);
  }

  return placed;
}

// 主入口。
// nodes: 数组,每个元素形如 { sourceId, status, weight }
//        status: 'established' | 'trial' | 'blacklisted'
//        weight: 数字,越大越优先(不足20个建立/试用来源时无需截断,调用方也可以
//                提前截好再传进来,这个函数本身也会做一次兜底截断,双重保险)。
// canvasWidth/canvasHeight: 画布尺寸(像素),用于圈定可摆放区域。
// harborArea: 可选,{ xMin, xMax, yMin, yMax } 形式,标出"港口标记"(主节点图标)
//             占用的区域,布局时会避开这块地方,不传的话默认不做特殊排除。
//
// 返回:{ stars: [{ sourceId, x, y, status }], overflowCount, blacklistOverflowCount }
//   overflowCount: 主星区因为超过MAX_MAIN_STARS上限而没有画出来的established/trial来源数量
//   blacklistOverflowCount: 拉黑区因为超过MAX_BLACKLIST_STARS上限而没有画出来的数量
// 在一个椭圆放射区域内(以centerX/centerY为锚点,radiusX/radiusY为半径)按
// [minFrac, maxFrac]这个半径比例区间随机取点——用"放射状环带"代替"同心矩形",
// 能自然铺满整个画布,不会把established/trial挤在中间一小块矩形里。
function placePointsRadial(count, opts, existingPoints) {
  const { centerX, centerY, radiusX, radiusY, minFrac, maxFrac, xMin, xMax, yMin, yMax } = opts;
  const placed = [];
  const allPoints = existingPoints.slice();

  for (let i = 0; i < count; i++) {
    let candidate = null;
    let attempts = 0;
    while (attempts < MAX_RETRIES) {
      const angle = randomInRange(0, Math.PI * 2);
      const frac = randomInRange(minFrac, maxFrac);
      let x = centerX + Math.cos(angle) * radiusX * frac;
      let y = centerY + Math.sin(angle) * radiusY * frac;
      x = Math.min(Math.max(x, xMin), xMax);
      y = Math.min(Math.max(y, yMin), yMax);
      const tooClose = allPoints.some((p) => distance(p, { x, y }) < MIN_DISTANCE);
      if (!tooClose) { candidate = { x, y }; break; }
      candidate = { x, y };
      attempts++;
    }
    const jittered = {
      x: Math.min(Math.max(candidate.x + randomInRange(-JITTER, JITTER), xMin), xMax),
      y: Math.min(Math.max(candidate.y + randomInRange(-JITTER, JITTER), yMin), yMax)
    };
    placed.push(jittered);
    allPoints.push(jittered);
  }
  return placed;
}

function layoutStars(nodes, canvasWidth, canvasHeight, harborArea) {
  const list = Array.isArray(nodes) ? nodes : [];

  const mainCandidates = list
    .filter((n) => n && (n.status === 'established' || n.status === 'trial'))
    .slice() // 不修改调用方传进来的原数组
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));

  const blacklistCandidates = list.filter((n) => n && n.status === 'blacklisted');

  const mainToPlace = mainCandidates.slice(0, MAX_MAIN_STARS);
  const overflowCount = Math.max(mainCandidates.length - MAX_MAIN_STARS, 0);

  const blacklistToPlace = blacklistCandidates.slice(0, MAX_BLACKLIST_STARS);
  const blacklistOverflowCount = Math.max(blacklistCandidates.length - MAX_BLACKLIST_STARS, 0);

  // 本轮修复(创始人反馈第一版demo挤成一团后):放弃"两个同心矩形"这个思路,
  // 改用"以锚点为中心的放射状环带"——established取内环半径比例区间,trial取
  // 外环区间,但两者的半径比例区间都覆盖到接近整个画布,不会被限制在一小块
  // 矩形里,视觉上更接近"满天星"的疏朗感。
  const margin = Math.min(canvasWidth, canvasHeight) * 0.06;
  const usableArea = { xMin: margin, xMax: canvasWidth - margin, yMin: margin, yMax: canvasHeight - margin };
  // 锚点特意不放在画布正中心,而是偏右上一些——呼应港口(主节点)固定在左下角,
  // 让整体构图有"从左下港口望向右上星空"的方向感,不是死板的居中对称。
  const centerX = canvasWidth * 0.56;
  const centerY = canvasHeight * 0.42;
  const radiusX = canvasWidth / 2 - margin;
  const radiusY = canvasHeight / 2 - margin;

  const preOccupied = [];
  if (harborArea) {
    preOccupied.push({
      x: (harborArea.xMin + harborArea.xMax) / 2,
      y: (harborArea.yMin + harborArea.yMax) / 2
    });
  }

  const established = mainToPlace.filter((n) => n.status === 'established');
  const trial = mainToPlace.filter((n) => n.status === 'trial');

  const establishedPoints = placePointsRadial(established.length, {
    centerX, centerY, radiusX, radiusY, minFrac: 0.08, maxFrac: 0.62, ...usableArea
  }, preOccupied);
  const trialPoints = placePointsRadial(trial.length, {
    centerX, centerY, radiusX, radiusY, minFrac: 0.38, maxFrac: 0.98, ...usableArea
  }, preOccupied.concat(establishedPoints));

  const mainStars = [];
  established.forEach((n, i) => {
    mainStars.push({ sourceId: n.sourceId, status: n.status, weight: n.weight, x: establishedPoints[i].x, y: establishedPoints[i].y });
  });
  trial.forEach((n, i) => {
    mainStars.push({ sourceId: n.sourceId, status: n.status, weight: n.weight, x: trialPoints[i].x, y: trialPoints[i].y });
  });

  // 拉黑角落区:固定在画布右下角一小块(独立区域,间距要求也放宽一些,
  // 因为这里本来就是"熄灭的星",紧凑一点反而符合"角落一小簇"的设计意图)。
  const cornerSize = Math.min(canvasWidth, canvasHeight) * 0.2;
  const cornerArea = {
    xMin: canvasWidth - cornerSize - margin * 0.6,
    xMax: canvasWidth - margin * 0.6,
    yMin: canvasHeight - cornerSize - margin * 0.6,
    yMax: canvasHeight - margin * 0.6
  };
  const blacklistPoints = placePointsInArea(blacklistToPlace.length, cornerArea, []);
  const blacklistStars = blacklistToPlace.map((n, i) => ({
    sourceId: n.sourceId, status: n.status, weight: n.weight,
    x: blacklistPoints[i].x, y: blacklistPoints[i].y
  }));

  return {
    stars: mainStars.concat(blacklistStars),
    overflowCount,
    blacklistOverflowCount
  };
}

module.exports = {
  layoutStars,
  MAX_MAIN_STARS,
  MAX_BLACKLIST_STARS,
  MIN_DISTANCE
};
