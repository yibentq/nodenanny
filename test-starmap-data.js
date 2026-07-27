'use strict';

// 星图第三步·后端接口测试(交接文档三十六.6/36.8节的后续:pool.getStarmapData())。
// 只测pool.js这层"数据整理+调用layoutStars"的逻辑，不重复测layoutStars本身的
// 布局算法(那部分已经在test-star-layout.js里独立测过17项)。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

const DATA_DIR = path.join(__dirname, 'data');
const POOL_FILE = path.join(DATA_DIR, 'pool.json');
const backupPath = POOL_FILE + '.backup-before-starmap-test';

// 测试前备份真实pool.json(如果存在),测试结束后原样还原——不能让这个测试
// 污染真实数据，这是项目一贯的做法(呼应三十六.2节GeoIP验证时的隔离原则)。
let hadOriginal = false;
if (fs.existsSync(POOL_FILE)) {
  hadOriginal = true;
  fs.copyFileSync(POOL_FILE, backupPath);
}

function writeFakePool(sources) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify({
    updatedAt: '2026-07-13T00:00:00.000Z',
    count: 0,
    nodes: [],
    lastError: null,
    sources
  }));
}

function restorePool() {
  if (hadOriginal) {
    fs.copyFileSync(backupPath, POOL_FILE);
    fs.unlinkSync(backupPath);
  } else if (fs.existsSync(POOL_FILE)) {
    fs.unlinkSync(POOL_FILE);
  }
}

try {
  // 每次都要重新require，因为pool.js内部没有缓存文件内容，直接读文件，
  // 用require缓存不影响测试结果，这里沿用项目里其它测试文件的写法。
  delete require.cache[require.resolve('./core/pool')];
  const pool = require('./core/pool');

  // 1. legacy aggregator来源应该被映射成established，即使sources里完全没有status字段。
  {
    writeFakePool([
      { sourceId: 'aggregator-default', ok: true, error: null, candidateCount: 10, passed: 2 }
    ]);
    const data = pool.getStarmapData(420, 320);
    check(data.stars.length === 1, `应该摆出1颗星(实际:${data.stars.length})`);
    check(data.stars[0].status === 'established', `legacy aggregator应该映射成established(实际:${data.stars[0].status})`);
    check(data.stars[0].passed === 2, `passed字段应该正确merge回来(实际:${data.stars[0].passed})`);
  }

  // 2. GitHub发现来源:trusted -> established, trial保持trial, blacklisted保持blacklisted。
  {
    writeFakePool([
      { sourceId: 'orgA/repoA', ok: true, error: null, candidateCount: 20, passed: 5, weight: 0.8, status: 'trusted', sampleCountryCode: 'JP' },
      { sourceId: 'orgB/repoB', ok: true, error: null, candidateCount: 15, passed: 1, weight: 0.05, status: 'trial', sampleCountryCode: 'KR' },
      { sourceId: 'orgC/repoC', ok: true, error: null, candidateCount: 16, passed: 16, weight: 0, status: 'blacklisted', sampleCountryCode: null }
    ]);
    const data = pool.getStarmapData(420, 320);
    check(data.stars.length === 3, `应该摆出3颗星(实际:${data.stars.length})`);
    const byId = {};
    data.stars.forEach((s) => { byId[s.sourceId] = s; });
    check(byId['orgA/repoA'].status === 'established', `trusted应该映射成established(实际:${byId['orgA/repoA'].status})`);
    check(byId['orgA/repoA'].countryCode === 'JP', `国家码应该正确merge回来(实际:${byId['orgA/repoA'].countryCode})`);
    check(byId['orgB/repoB'].status === 'trial', `trial应该保持trial(实际:${byId['orgB/repoB'].status})`);
    check(byId['orgC/repoC'].status === 'blacklisted', `blacklisted应该保持blacklisted(实际:${byId['orgC/repoC'].status})`);
  }

  // 3. 没有status字段的GitHub来源(理论上不该出现，但防御性处理):不擅自当作长期来源，按trial算。
  {
    writeFakePool([
      { sourceId: 'orgD/repoD', ok: true, error: null, candidateCount: 5, passed: 1, weight: 0.02 }
    ]);
    const data = pool.getStarmapData(420, 320);
    check(data.stars[0].status === 'trial', `没有status字段的来源应该保守按trial处理(实际:${data.stars[0].status})`);
  }

  // 4. 空来源列表:不报错,返回空stars数组。
  {
    writeFakePool([]);
    const data = pool.getStarmapData(420, 320);
    check(Array.isArray(data.stars) && data.stars.length === 0, '空来源列表应该返回空stars数组');
    check(data.overflowCount === 0 && data.blacklistOverflowCount === 0, '空来源列表overflow计数应该都是0');
  }

  // 5. harborArea应该按传入的画布尺寸等比例换算(不是写死420x320)。
  {
    writeFakePool([{ sourceId: 'aggregator-default', ok: true, error: null, candidateCount: 1, passed: 1 }]);
    const data = pool.getStarmapData(840, 640); // 2倍尺寸
    check(data.harborArea.xMin === 76, `harborArea应该按比例换算(实际xMin:${data.harborArea.xMin})`);
    check(data.canvasWidth === 840 && data.canvasHeight === 640, '应该原样返回传入的画布尺寸');
  }

  // 6. 不传画布尺寸时,退回420x320默认值(跟pool-starchart-v2.html demo一致)。
  {
    writeFakePool([{ sourceId: 'aggregator-default', ok: true, error: null, candidateCount: 1, passed: 1 }]);
    const data = pool.getStarmapData();
    check(data.canvasWidth === 420 && data.canvasHeight === 320, `不传参数应该退回420x320默认值(实际:${data.canvasWidth}x${data.canvasHeight})`);
  }

} finally {
  restorePool();
}

console.log(`\n通过: ${pass}  失败: ${fail}`);
if (fail > 0) process.exit(1);
