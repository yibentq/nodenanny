'use strict';

const assert = require('assert');
const geoip = require('./core/geoip');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

(async () => {
  // 1. 直接给IP,应该能查到国家码(用几个知名公共DNS/CDN的IP,国家码基本不会变)
  const usIp = await geoip.resolveCountryCode('8.8.8.8');
  check(usIp === 'US', `8.8.8.8 应该是 US(实际:${usIp})`);

  const cnIp = await geoip.resolveCountryCode('223.5.5.5');
  check(cnIp === 'CN', `223.5.5.5 应该是 CN(实际:${cnIp})`);

  // 2. IPv6地址也应该能查
  const v6 = await geoip.resolveCountryCode('2606:4700:4700::1111'); // Cloudflare IPv6
  check(typeof v6 === 'string' || v6 === null, `IPv6地址查询不应该抛异常(实际:${v6})`);

  // 3. 空值/非字符串输入,应该安全返回null,不抛异常
  const nullResult1 = await geoip.resolveCountryCode(null);
  check(nullResult1 === null, '传null应该返回null');
  const nullResult2 = await geoip.resolveCountryCode(undefined);
  check(nullResult2 === null, '传undefined应该返回null');
  const nullResult3 = await geoip.resolveCountryCode('');
  check(nullResult3 === null, '传空字符串应该返回null');

  // 4. 一个不存在的域名,DNS解析应该失败但不抛异常,返回null
  const badDomain = await geoip.resolveCountryCode('this-domain-definitely-does-not-exist-nodenanny-test.invalid');
  check(badDomain === null, `不存在的域名应该返回null(实际:${badDomain})`);

  // 5. 同一个查询重复调用两次,结果应该一致(验证内存缓存不会导致结果不一致)
  const first = await geoip.resolveCountryCode('1.1.1.1');
  const second = await geoip.resolveCountryCode('1.1.1.1');
  check(first === second, `重复查询同一个地址结果应该一致(${first} vs ${second})`);

  console.log(`\ntest-geoip.js: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
