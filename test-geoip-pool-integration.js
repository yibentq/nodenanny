'use strict';

const pool = require('./core/pool');
const { extractHostFromLink, attachCountryCodes } = pool._internal;

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
}

(async () => {
  // 1. extractHostFromLink:逐协议真实链接提取地址
  check(extractHostFromLink('vless://uuid@1.2.3.4:443?security=none&type=tcp#test') === '1.2.3.4',
    'vless链接应该提取出1.2.3.4');
  check(extractHostFromLink('trojan://password@example.com:443?security=tls#test') === 'example.com',
    'trojan链接应该提取出example.com');
  const vmessLink = 'vmess://' + Buffer.from(JSON.stringify({
    v: '2', ps: 'test', add: '5.6.7.8', port: '443', id: 'uuid', aid: '0', net: 'tcp', type: 'none', host: '', path: '', tls: ''
  })).toString('base64');
  check(extractHostFromLink(vmessLink) === '5.6.7.8', 'vmess链接应该提取出5.6.7.8');
  check(extractHostFromLink('not-a-valid-link') === null, '无效链接应该返回null');
  check(extractHostFromLink(null) === null, 'null输入应该返回null');
  check(extractHostFromLink('') === null, '空字符串应该返回null');

  // 2. attachCountryCodes:给一批节点对象写入countryCode,不抛异常,不影响原有字段
  const nodes = [
    { link: 'vless://uuid@8.8.8.8:443?security=none&type=tcp#us-node', sourceId: 'aggregator-default' },
    { link: 'not-a-valid-link', sourceId: 'aggregator-default' } // 提取不到地址,应该安全地得到countryCode:null
  ];
  const result = await attachCountryCodes(nodes);
  check(result === nodes, 'attachCountryCodes应该原地修改并返回同一个数组');
  check(nodes[0].countryCode === 'US', `第一个节点(8.8.8.8)应该查到US(实际:${nodes[0].countryCode})`);
  check(nodes[1].countryCode === null, `第二个节点(无效链接)应该是null(实际:${nodes[1].countryCode})`);
  // 原有字段没有被破坏
  check(nodes[0].sourceId === 'aggregator-default', '原有sourceId字段应该还在');
  check(nodes[0].link.startsWith('vless://'), '原有link字段应该还在');

  console.log(`\ntest-geoip-pool-integration.js: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
