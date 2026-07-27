'use strict';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

const { extractLinksFromClashYaml } = require('./core/clash-yaml');
const { parseProxyLink } = require('./core/proxy-parse');

const SAMPLE = `
proxies:
  - name: ss-node
    type: ss
    server: 1.1.1.1
    port: 8388
    cipher: aes-256-gcm
    password: pw123

  - name: vmess-ws-node
    type: vmess
    server: 2.2.2.2
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    alterId: 0
    cipher: auto
    tls: true
    network: ws
    servername: cdn.example.com
    ws-opts:
      path: /ws
      headers:
        Host: cdn.example.com

  - name: trojan-node
    type: trojan
    server: 3.3.3.3
    port: 443
    password: trojanpw
    sni: trojan.example.com
    skip-cert-verify: false

  - name: vless-reality-node
    type: vless
    server: 4.4.4.4
    port: 443
    uuid: 22222222-2222-2222-2222-222222222222
    network: tcp
    tls: true
    servername: reality.example.com
    client-fingerprint: chrome
    flow: xtls-rprx-vision
    reality-opts:
      public-key: abcPublicKey123
      short-id: ab12

  - name: hy2-node
    type: hysteria2
    server: 5.5.5.5
    port: 4433
    password: hy2pw
    sni: hy2.example.com
    skip-cert-verify: true
    obfs: salamander
    obfs-password: obfspw

  - name: tuic-node
    type: tuic
    server: 6.6.6.6
    port: 4443
    uuid: 33333333-3333-3333-3333-333333333333
    password: tuicpw
    sni: tuic.example.com
    congestion-controller: bbr
    alpn: h3

  - name: hysteria-v1-node
    type: hysteria
    server: 8.8.8.8
    port: 5544
    auth_str: hy1pw
    protocol: udp

  - name: unsupported-type-node
    type: socks5
    server: 7.7.7.7
    port: 1080
`;

const result = extractLinksFromClashYaml(SAMPLE);

check('total识别到8个proxy条目(含2个不支持转换的类型)', result.total === 8);
check('converted只转换出6个(hysteria v1和socks5都被跳过)', result.converted === 6);
check('links数组长度跟converted一致', result.links.length === 6);
// 修复记录验证:hysteria(v1)不该被误转换成hysteria2://链接(两者协议不同,
// 硬转换出来的链接必然连不上,只会制造注定失败的候选、浪费检测资源)。
check('hysteria(v1)节点没有产出任何hysteria2://链接被误当成v1数据',
  !result.links.some((l) => l.startsWith('hysteria2://') && l.includes('hy1pw')));

const byPrefix = (prefix) => result.links.find((l) => l.startsWith(prefix));

// ss
const ssLink = byPrefix('ss://');
check('ss链接存在', Boolean(ssLink));
if (ssLink) {
  const parsed = parseProxyLink(ssLink);
  check('ss链接能被proxy-parse.js解析', Boolean(parsed));
  check('ss解析出的method/password正确', parsed && parsed.outbound.method === 'aes-256-gcm' && parsed.outbound.password === 'pw123');
}

// vmess
const vmessLink = byPrefix('vmess://');
check('vmess链接存在', Boolean(vmessLink));
if (vmessLink) {
  const parsed = parseProxyLink(vmessLink);
  check('vmess链接能被proxy-parse.js解析', Boolean(parsed));
  check('vmess解析出uuid/server/transport正确', parsed && parsed.outbound.uuid === '11111111-1111-1111-1111-111111111111'
    && parsed.outbound.server === '2.2.2.2' && parsed.outbound.transport && parsed.outbound.transport.type === 'ws'
    && parsed.outbound.transport.path === '/ws');
}

// trojan
const trojanLink = byPrefix('trojan://');
check('trojan链接存在', Boolean(trojanLink));
if (trojanLink) {
  const parsed = parseProxyLink(trojanLink);
  check('trojan链接能被proxy-parse.js解析', Boolean(parsed));
  check('trojan解析出password/sni正确', parsed && parsed.outbound.password === 'trojanpw' && parsed.outbound.tls.server_name === 'trojan.example.com');
}

// vless (reality)
const vlessLink = byPrefix('vless://');
check('vless链接存在', Boolean(vlessLink));
if (vlessLink) {
  const parsed = parseProxyLink(vlessLink);
  check('vless(reality)链接能被proxy-parse.js解析', Boolean(parsed));
  check('vless解析出reality字段正确', parsed && parsed.outbound.tls && parsed.outbound.tls.reality
    && parsed.outbound.tls.reality.public_key === 'abcPublicKey123' && parsed.outbound.tls.reality.short_id === 'ab12');
}

// hysteria2
const hy2Link = byPrefix('hysteria2://');
check('hysteria2链接存在', Boolean(hy2Link));
if (hy2Link) {
  const parsed = parseProxyLink(hy2Link);
  check('hysteria2链接能被proxy-parse.js解析', Boolean(parsed));
  check('hysteria2解析出obfs正确', parsed && parsed.outbound.obfs && parsed.outbound.obfs.type === 'salamander');
}

// tuic
const tuicLink = byPrefix('tuic://');
check('tuic链接存在', Boolean(tuicLink));
if (tuicLink) {
  const parsed = parseProxyLink(tuicLink);
  check('tuic链接能被proxy-parse.js解析', Boolean(parsed));
  check('tuic解析出uuid/password正确', parsed && parsed.outbound.uuid === '33333333-3333-3333-3333-333333333333' && parsed.outbound.password === 'tuicpw');
}

// 边界情况
check('空文本不报错、返回空结果', extractLinksFromClashYaml('').links.length === 0);
check('没有proxies字段的文本不报错、返回空结果', extractLinksFromClashYaml('foo: bar\nbaz: 1').links.length === 0);
check('随便的乱码文本不报错、返回空结果', extractLinksFromClashYaml('%%%not yaml at all::: {{{').links.length === 0);

console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
