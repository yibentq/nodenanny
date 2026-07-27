'use strict';

// core/pool-events.js 测试。
// 跟test-starmap-data.js对pool.json的处理方式一致：测试前备份真实的
// data/pool-events.json(如果存在)，测试结束后原样还原，不污染真实数据。
//
// 本轮修改(复查发现recordRound此前从没做过知识库匹配，跟前端public/pool-events.html
// 已经假设r.kb字段存在的实现对不上，已在core/pool-events.js里补上)：recordRound()
// 现在是async函数(内部要await kb-manager.matchCode)，这个测试文件相应地把所有
// recordRound调用都改成await，并把整个测试主体包进一个async函数里执行；
// 同时新增几条断言验证kb字段确实被正确写入/不写入。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'pool-events.json');
const backupPath = EVENTS_FILE + '.backup-before-pool-events-test';

let hadOriginal = false;
if (fs.existsSync(EVENTS_FILE)) {
  hadOriginal = true;
  fs.copyFileSync(EVENTS_FILE, backupPath);
}

function restore() {
  if (hadOriginal) {
    fs.copyFileSync(backupPath, EVENTS_FILE);
    fs.unlinkSync(backupPath);
  } else if (fs.existsSync(EVENTS_FILE)) {
    fs.unlinkSync(EVENTS_FILE);
  }
}

async function main() {
  if (fs.existsSync(EVENTS_FILE)) fs.unlinkSync(EVENTS_FILE); // 每个测试文件独立从干净状态开始
  delete require.cache[require.resolve('./core/pool-events')];
  const poolEvents = require('./core/pool-events');

  // 真实的vless/vmess示例链接，跟proxy-parse.js/pool-checker.js测试里用的风格一致。
  const vlessLink = 'vless://ba4bd6fe-4ec6-4223-9702-2d30da436120@1.2.3.4:47286?encryption=none&security=reality&flow=xtls-rprx-vision&type=tcp&sni=www.cloudflare.com&pbk=abc&fp=chrome#test-node-1';
  const badLink = 'not-a-valid-link-at-all';

  // 1. 空文件初始状态
  check(poolEvents.getRecentRounds().length === 0, '初始状态应该没有任何轮次');

  // 2. 记录一轮，candidates和checkResults一一对应
  await poolEvents.recordRound('manual:test-source', [vlessLink, badLink], [
    { outcome: 'ok', code: 'POOL_AUTHENTIC_OK', detail: '不应该被存进去(ok的不存detail)' },
    { outcome: 'down', code: 'POOL_ALIVE_BAD_STATUS_CODE', detail: '连通性探测返回状态码 403' }
  ]);
  let rounds = poolEvents.getRecentRounds();
  check(rounds.length === 1, '记录一轮之后应该有1轮');
  check(rounds[0].sourceId === 'manual:test-source', 'sourceId应该正确记录');
  check(rounds[0].candidateCount === 2, 'candidateCount应该是2');
  check(rounds[0].passedCount === 1, 'passedCount应该正确统计ok的数量(1个)');
  check(rounds[0].results.length === 2, 'results数组长度应该跟candidates一致');

  const okResult = rounds[0].results[0];
  check(okResult.outcome === 'ok', '第一个结果应该是ok');
  check(okResult.protocol === 'vless', '能从vless链接正确解析出协议类型');
  check(okResult.host === '1.2.3.4', '能从链接正确解析出host');
  check(okResult.port === 47286, '能从链接正确解析出port');
  check(!('detail' in okResult), 'ok的结果不应该存detail字段(减少体积)');
  check(!('kb' in okResult), 'ok的结果不应该做知识库匹配、也不应该存kb字段(避免点开显示无意义的"无匹配词条")');
  check(!('link' in okResult) && !('key' in okResult), '不应该存原始链接本身(避免泄露UUID/密码等凭证)');

  const downResult = rounds[0].results[1];
  check(downResult.outcome === 'down', '第二个结果应该是down');
  check(downResult.code === 'POOL_ALIVE_BAD_STATUS_CODE', 'down的结果应该带code');
  check(downResult.detail === '连通性探测返回状态码 403', 'down的结果应该保留detail');
  check(downResult.protocol === null && downResult.host === null, '解析失败的链接应该安全返回null字段,不抛异常');
  check(Array.isArray(downResult.kb), 'down的结果应该带kb字段(数组，即使没匹配到也应该是空数组而不是undefined)');
  check(downResult.kb.length > 0, 'POOL_ALIVE_BAD_STATUS_CODE在知识库里有对应词条，应该匹配到至少一条');
  if (downResult.kb.length > 0) {
    const hit = downResult.kb[0];
    check(typeof hit.id === 'string', 'kb命中条目应该带id字段');
    check(hit.explanation && typeof hit.explanation === 'object', 'kb命中条目应该带explanation字段(多语言对象)');
  }

  // 3. 空数组/参数异常不应该记录任何东西，也不应该抛异常
  await poolEvents.recordRound('manual:empty', [], []);
  check(poolEvents.getRecentRounds().length === 1, '空candidates数组不应该新增轮次');
  await poolEvents.recordRound('manual:bad-args', null, undefined);
  check(poolEvents.getRecentRounds().length === 1, '非法参数不应该新增轮次、也不应该抛异常');

  // 4. 新轮次插入在最前面(最新的在前)
  await poolEvents.recordRound('aggregator-default', [vlessLink], [{ outcome: 'ok', code: 'POOL_AUTHENTIC_OK' }]);
  rounds = poolEvents.getRecentRounds();
  check(rounds.length === 2, '再记一轮之后应该有2轮');
  check(rounds[0].sourceId === 'aggregator-default', '最新的一轮应该排在最前面');
  check(rounds[1].sourceId === 'manual:test-source', '旧的一轮应该往后排');

  // 4b. 同一批候选里出现相同code的多条down结果，即使knowledge-base.matchCode
  // 内部有60秒防刷冷却，靠"轮次时间+候选序号"拼出来的contextKey也应该保证
  // 每一条都能各自独立匹配到，不会因为冷却互相挤掉。
  await poolEvents.recordRound('manual:same-code-batch', [badLink, badLink, badLink], [
    { outcome: 'down', code: 'POOL_ALIVE_BAD_STATUS_CODE', detail: '第1条' },
    { outcome: 'down', code: 'POOL_ALIVE_BAD_STATUS_CODE', detail: '第2条' },
    { outcome: 'down', code: 'POOL_ALIVE_BAD_STATUS_CODE', detail: '第3条' }
  ]);
  const sameCodeRound = poolEvents.getRecentRounds()[0];
  check(sameCodeRound.sourceId === 'manual:same-code-batch', '刚记录的这一轮应该在最前面');
  const allHaveKb = sameCodeRound.results.every((r) => Array.isArray(r.kb) && r.kb.length > 0);
  check(allHaveKb, '同一轮里多条相同code的down结果应该各自都匹配到kb，不应该被冷却机制互相挤掉导致只有第一条有');

  // 5. 超过MAX_ROUNDS上限时自动裁剪，保留最新的
  for (let i = 0; i < poolEvents._internal.MAX_ROUNDS + 5; i++) {
    await poolEvents.recordRound(`source-${i}`, [vlessLink], [{ outcome: 'ok', code: 'POOL_AUTHENTIC_OK' }]);
  }
  rounds = poolEvents.getRecentRounds();
  check(rounds.length === poolEvents._internal.MAX_ROUNDS, `超过上限后应该裁剪到${poolEvents._internal.MAX_ROUNDS}轮，实际${rounds.length}轮`);
  check(rounds[0].sourceId === `source-${poolEvents._internal.MAX_ROUNDS + 4}`, '裁剪后应该保留最新的那些轮次');

  // 6. getRecentRounds支持limit参数
  const limited = poolEvents.getRecentRounds(3);
  check(limited.length === 3, 'limit参数应该正确生效');

  // 7. describeLink对畸形/不支持的输入不抛异常
  const desc = poolEvents._internal.describeLink('');
  check(desc.protocol === null && desc.host === null && desc.port === null, '空字符串输入应该安全返回null字段');

  // 8. 文件损坏时能自愈，不影响主流程
  fs.writeFileSync(EVENTS_FILE, '{ this is not valid json');
  const roundsAfterCorruption = poolEvents.getRecentRounds();
  check(Array.isArray(roundsAfterCorruption) && roundsAfterCorruption.length === 0, '数据文件损坏时应该自愈重置为空数组，不抛异常');
  await poolEvents.recordRound('manual:after-corruption', [vlessLink], [{ outcome: 'ok', code: 'POOL_AUTHENTIC_OK' }]);
  check(poolEvents.getRecentRounds().length === 1, '自愈之后应该能正常继续记录');

  // 9. 不存在的code不应该抛异常，应该安全返回空kb数组
  await poolEvents.recordRound('manual:unknown-code', [badLink], [{ outcome: 'down', code: 'THIS_CODE_DOES_NOT_EXIST_IN_KB', detail: '测试用不存在的code' }]);
  const unknownRound = poolEvents.getRecentRounds()[0];
  check(Array.isArray(unknownRound.results[0].kb) && unknownRound.results[0].kb.length === 0, '知识库里没有对应词条的code应该安全返回空数组，不抛异常');
}

main()
  .catch((err) => {
    fail++;
    console.error('测试过程中出现意外异常：', err);
  })
  .finally(() => {
    restore();
    console.log(`\n共 ${pass + fail} 项断言，通过 ${pass} 项，失败 ${fail} 项。`);
    process.exit(fail > 0 ? 1 : 0);
  });
