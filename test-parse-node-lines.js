'use strict';

// 本次会话在验证repo-fetch.js的hy2修复时,顺手在core/pool.js里发现了同一类bug的
// 第二处:parseNodeLines()(legacy aggregator抓取路径专用的行解析函数)用的是
// 跟repo-fetch.js修复前完全一样的候选行正则,同样漏掉hy2://前缀。这个函数目前没有
// 任何测试覆盖,之前也没在_internal里导出。虽然pool.enabled=false、legacy aggregator
// 路径当前在生产环境不跑,但既然是同一个bug模式,这次一并修掉、补上测试,避免以后
// 谁重新启用这条路径时又踩一次同样的坑。

const { _internal } = require('./core/pool');
const { parseNodeLines } = _internal;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

// 明文场景:hy2:// 和其它协议混用
const PLAIN_MIXED = 'vless://uuid1@1.1.1.1:443#n1\nhy2://pw1@2.2.2.2:443#HK\nhysteria2://pw2@3.3.3.3:443#SG\nvmess://abc#n2';
check('parseNodeLines识别明文混合链接(含hy2)全部4条', parseNodeLines(PLAIN_MIXED).length === 4);
check('parseNodeLines识别的链接里包含hy2://那条', parseNodeLines(PLAIN_MIXED).some((l) => l.startsWith('hy2://')));

// 大小写不敏感
check('parseNodeLines对HY2://大小写不敏感', parseNodeLines('HY2://pw@1.2.3.4:443#x').length === 1);

// base64整体编码场景:内容是纯hy2链接列表
const HY2_ONLY_PLAIN = 'hy2://pwA@10.0.0.1:443?sni=a.com#HK\nhy2://pwB@10.0.0.2:443?sni=b.com#SG';
const HY2_ONLY_BASE64 = Buffer.from(HY2_ONLY_PLAIN, 'utf-8').toString('base64');
check('parseNodeLines识别base64编码的hy2订阅(HK+SG两条)', parseNodeLines(HY2_ONLY_BASE64).length === 2);

// 空输入/无关内容安全返回空数组
check('parseNodeLines对空字符串返回空数组', Array.isArray(parseNodeLines('')) && parseNodeLines('').length === 0);
check('parseNodeLines对无关文本返回空数组', parseNodeLines('just some random log output, nothing here').length === 0);

console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
