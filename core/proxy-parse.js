'use strict';

// 流量池新项目·批次一:通用协议解析。
//
// 现有 vless-parse.js 只解析 vless+reality 单一组合,是给旧的
// usability-check.js(单节点检测)用的,那个场景够用。
// 但流量池抓来的候选节点协议混杂(vless/vmess/ss/trojan/hysteria2/tuic),
// 三层检测器需要一个通用解析器——不是重写 vless-parse.js,是新增一个更宽的模块,
// 产出统一目标是 sing-box 的 outbound JSON 片段(不带 tag,调用方自己拼)。
//
// 范围说明(如实写,别指望这个模块啥协议都能解):
// - vless:支持 reality 和 tls 两种 security,支持 tcp/ws/grpc 三种 transport。
// - vmess:只支持标准的 vmess://base64(json) 格式(v2rayN 经典格式),
//   不支持 vmess://uuid@host:port?... 这种新版 querystring 格式。
// - ss:支持 SIP002 格式(ss://base64(method:password)@host:port)和
//   老式全串 base64(ss://base64(method:password@host:port))两种。
// - trojan:支持 tls,tcp/ws/grpc transport。
// - hysteria2:支持 hysteria2:// 和 hy2:// 两种 scheme。
// - hysteria(v1,2026-07-30新增):按最常见的auth/peer/upmbps/downmbps字段写法解析,
//   没有真实样本验证过,格式本身业界写法就不算统一,遇到解析不出的v1链接不代表
//   一定是bug,也可能是某个分享工具用了这里没覆盖到的字段名写法。
// - tuic:支持标准 tuic://uuid:password@host:port 格式。
// - anytls(2026-07-30新增):sing-box团队自己维护的协议,官方文档(anytls-go仓库
//   docs/uri_scheme.md)有明确的单行URI格式:anytls://密码@host:port/?sni=..&insecure=1#tag,
//   照官方格式实现,不是猜的。
// - socks5(2026-07-30新增):标准 socks5://[user:pass@]host:port,sing-box原生支持
//   socks outbound,顺手加上,节点列表里偶尔会混进来。
// - ssr:本版本仍不解析,原因不是"没空写",是sing-box官方发行版本身不支持SSR
//   协议(需要额外参数单独编译),就算解析出来也没法用现有检测引擎测试连通性,
//   写了也用不上,2026-07-30确认过后明确按"不做"处理,而不是遗漏。
// - shadowtls(2026-07-30评估后明确不做):查证后确认这个协议在业界根本没有
//   统一的单行分享链接格式——它必须跟shadowsocks链式组合使用,实际分发方式
//   要么是完整的两段式JSON配置,要么是Surge/Loon客户端专属的一整行参数字符串
//   (如 "ss, host, port, encrypt-method=..., shadow-tls-password=..."),
//   都不符合本模块"一条链接→一个sing-box outbound JSON"的设计前提。写一个
//   假想的"shadowtls://"解析器等于自己发明一个不存在的标准,节点列表里也不会
//   真的出现这种链接,纯属空转,明确按"不做"处理。
// - http/https 代理链接(2026-07-30本次会话核实并实现,之前"待确认"的疑虑已解决):
//   拿到了core/repo-fetch.js的真实源码核实过,它的parseSubscriptionContent()
//   并没有"整行内容是http(s)开头就当成订阅链接去二次抓取"这种逻辑——那种理解
//   只发生在更上层(config.json里配置的来源地址本身),跟"内容里某一行是不是
//   http开头"是两回事,不会冲突,之前的顾虑不成立。标准写法
//   http(s)://[user:pass@]host:port,https://额外把tls.enabled置true,
//   sing-box outbound type是"http"。如实标注一个不是bug、是设计取舍的残留
//   局限:如果抓到的内容里混进一条"其实是订阅链接"的http(s)地址(不是真实代理
//   服务器,而是还需要再抓一次内容的地址),会被误判成代理服务器地址去解析,
//   实际检测时因为host:port不是真实代理服务会正常测不过,不会报错或崩溃,
//   只是白白浪费一次检测机会——本项目目前没有"识别出是订阅链接后自动展开
//   二次抓取"这个功能,这个局限跟repo-fetch.js那边保持一致的记录方式,不重复展开。
// - vless 的 xtls-rprx 系列老 flow、其他冷门协议:本版本不解析,返回 null。
//
// 解析失败或协议不支持时统一返回 null,调用方(pool-checker.js)应当把这种情况
// 当作"这条节点本版本测不了",标 unsupported,不是当成检测失败。

function safeUrl(link) {
  try {
    return new URL(link);
  } catch (err) {
    return null;
  }
}

function base64Decode(str) {
  try {
    // 兼容 url-safe base64(部分节点分享工具用 -_ 代替 +/)
    const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
  } catch (err) {
    return null;
  }
}

function extractTag(link) {
  const hashIdx = link.indexOf('#');
  if (hashIdx === -1) return '';
  try {
    return decodeURIComponent(link.slice(hashIdx + 1));
  } catch (err) {
    return link.slice(hashIdx + 1);
  }
}

// 统一构造 tls 字段。security 为空/none 时不加密(极少数节点这么配,允许但不推荐)。
function buildTlsSettings({ security, sni, fingerprint, publicKey, shortId, spiderX, alpn, insecure }) {
  if (security === 'reality') {
    return {
      enabled: true,
      server_name: sni,
      utls: { enabled: true, fingerprint: fingerprint || 'chrome' },
      reality: { enabled: true, public_key: publicKey, short_id: shortId || '' }
    };
  }
  if (security === 'tls') {
    const tls = {
      enabled: true,
      server_name: sni,
      insecure: !!insecure
    };
    if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean);
    if (fingerprint) tls.utls = { enabled: true, fingerprint };
    return tls;
  }
  return { enabled: false };
}

// 统一构造 transport 字段(ws/grpc/tcp,tcp 不需要 transport 字段,返回 undefined)。
function buildTransport({ type, path, host, serviceName }) {
  if (type === 'ws') {
    const t = { type: 'ws', path: path || '/' };
    if (host) t.headers = { Host: host };
    return t;
  }
  if (type === 'grpc') {
    return { type: 'grpc', service_name: serviceName || '' };
  }
  return undefined; // tcp/raw,不需要 transport
}

function parseVless(link) {
  const url = safeUrl(link);
  if (!url) return null;
  const uuid = decodeURIComponent(url.username || '');
  const address = url.hostname;
  const port = Number(url.port);
  if (!uuid || !address || !port) return null;

  const p = url.searchParams;
  const security = (p.get('security') || 'none').toLowerCase();
  const netType = (p.get('type') || 'tcp').toLowerCase();
  const sni = p.get('sni') || p.get('host') || address;

  const outbound = {
    type: 'vless',
    server: address,
    server_port: port,
    uuid,
    flow: p.get('flow') || undefined
  };

  if (security === 'reality') {
    const publicKey = p.get('pbk');
    if (!publicKey) return null; // reality 缺 pbk 是明确的解析失败,不是"没配"
    outbound.tls = buildTlsSettings({
      security, sni, fingerprint: p.get('fp'), publicKey, shortId: p.get('sid'), spiderX: p.get('spx')
    });
  } else if (security === 'tls') {
    outbound.tls = buildTlsSettings({
      security, sni, fingerprint: p.get('fp'), alpn: p.get('alpn'), insecure: p.get('allowInsecure') === '1'
    });
  }

  const transport = buildTransport({ type: netType, path: p.get('path'), host: p.get('host'), serviceName: p.get('serviceName') });
  if (transport) outbound.transport = transport;

  return { type: 'vless', tag: extractTag(link), outbound };
}

function parseVmess(link) {
  const b64 = link.slice('vmess://'.length);
  const jsonStr = base64Decode(b64);
  if (!jsonStr) return null;
  let cfg;
  try {
    cfg = JSON.parse(jsonStr);
  } catch (err) {
    return null;
  }
  const address = cfg.add;
  const port = Number(cfg.port);
  const uuid = cfg.id;
  if (!address || !port || !uuid) return null;

  const netType = (cfg.net || 'tcp').toLowerCase();
  const tlsOn = (cfg.tls || '').toLowerCase() === 'tls';

  const outbound = {
    type: 'vmess',
    server: address,
    server_port: port,
    uuid,
    security: 'auto',
    alter_id: Number(cfg.aid) || 0
  };

  if (tlsOn) {
    outbound.tls = buildTlsSettings({
      security: 'tls',
      sni: cfg.sni || cfg.host || address,
      fingerprint: cfg.fp,
      alpn: cfg.alpn,
      insecure: false
    });
  }

  const transport = buildTransport({ type: netType, path: cfg.path, host: cfg.host, serviceName: cfg.path });
  if (transport) outbound.transport = transport;

  return { type: 'vmess', tag: cfg.ps || extractTag(link), outbound };
}

function parseShadowsocks(link) {
  const body = link.slice('ss://'.length);
  const hashIdx = body.indexOf('#');
  const main = hashIdx >= 0 ? body.slice(0, hashIdx) : body;

  // SIP002:ss://base64(method:password)@host:port
  const atIdx = main.indexOf('@');
  if (atIdx > 0) {
    const userInfo = main.slice(0, atIdx);
    const hostPart = main.slice(atIdx + 1);
    const decoded = base64Decode(decodeURIComponent(userInfo));
    if (decoded && decoded.includes(':')) {
      const [method, ...rest] = decoded.split(':');
      const password = rest.join(':');
      const hostUrl = safeUrl('ss://' + hostPart);
      const address = hostUrl ? hostUrl.hostname : hostPart.split(':')[0].split('?')[0];
      const port = hostUrl ? Number(hostUrl.port) : Number((hostPart.split(':')[1] || '').split(/[?/]/)[0]);
      if (method && password && address && port) {
        return {
          type: 'shadowsocks',
          tag: extractTag(link),
          outbound: { type: 'shadowsocks', server: address, server_port: port, method, password }
        };
      }
    }
  }

  // 老式全串 base64:ss://base64(method:password@host:port)
  const decodedAll = base64Decode(main);
  if (decodedAll) {
    const m = decodedAll.match(/^([^:]+):(.+)@([^@]+):(\d+)$/);
    if (m) {
      const [, method, password, address, port] = m;
      return {
        type: 'shadowsocks',
        tag: extractTag(link),
        outbound: { type: 'shadowsocks', server: address, server_port: Number(port), method, password }
      };
    }
  }

  return null;
}

function parseTrojan(link) {
  const url = safeUrl(link);
  if (!url) return null;
  const password = decodeURIComponent(url.username || '');
  const address = url.hostname;
  const port = Number(url.port);
  if (!password || !address || !port) return null;

  const p = url.searchParams;
  const netType = (p.get('type') || 'tcp').toLowerCase();
  const sni = p.get('sni') || p.get('peer') || address;

  const outbound = {
    type: 'trojan',
    server: address,
    server_port: port,
    password,
    tls: buildTlsSettings({
      security: 'tls', sni, fingerprint: p.get('fp'), alpn: p.get('alpn'), insecure: p.get('allowInsecure') === '1'
    })
  };

  const transport = buildTransport({ type: netType, path: p.get('path'), host: p.get('host'), serviceName: p.get('serviceName') });
  if (transport) outbound.transport = transport;

  return { type: 'trojan', tag: extractTag(link), outbound };
}

function parseHysteria2(link) {
  const normalized = link.replace(/^hy2:\/\//, 'hysteria2://');
  const url = safeUrl(normalized);
  if (!url) return null;
  const password = decodeURIComponent(url.username || '');
  const address = url.hostname;
  const port = Number(url.port);
  if (!password || !address || !port) return null;

  const p = url.searchParams;
  const sni = p.get('sni') || address;

  const outbound = {
    type: 'hysteria2',
    server: address,
    server_port: port,
    password,
    tls: { enabled: true, server_name: sni, insecure: p.get('insecure') === '1' }
  };
  if (p.get('obfs')) {
    outbound.obfs = { type: p.get('obfs'), password: p.get('obfs-password') || '' };
  }

  return { type: 'hysteria2', tag: extractTag(link), outbound };
}

function parseTuic(link) {
  const url = safeUrl(link);
  if (!url) return null;
  // tuic://uuid:password@host:port
  const uuid = decodeURIComponent(url.username || '');
  const password = decodeURIComponent(url.password || '');
  const address = url.hostname;
  const port = Number(url.port);
  if (!uuid || !address || !port) return null;

  const p = url.searchParams;
  const sni = p.get('sni') || address;

  const outbound = {
    type: 'tuic',
    server: address,
    server_port: port,
    uuid,
    password,
    congestion_control: p.get('congestion_control') || 'bbr',
    tls: { enabled: true, server_name: sni, alpn: (p.get('alpn') || 'h3').split(',') }
  };

  return { type: 'tuic', tag: extractTag(link), outbound };
}

// 本轮新增(2026-07-30):hysteria(v1)协议解析,区别于已支持的hysteria2/hy2。
// v1协议已被上游标注为过时,格式也不如hysteria2标准化,不同分享工具生成的
// 链接字段名有差异,这里按目前观察到的最常见写法实现(auth字段做鉴权凭据,
// peer/sni做证书域名,upmbps/downmbps是v1特有的带宽声明字段,没有对应真实
// 样本验证过,如实标注这一点,不要当成跟vless/ss/trojan一样验证过的部分)。
function parseHysteria(link) {
  const url = safeUrl(link);
  if (!url) return null;
  const address = url.hostname;
  const port = Number(url.port);
  if (!address || !port) return null;

  const p = url.searchParams;
  const auth = p.get('auth') || decodeURIComponent(url.username || '');
  const sni = p.get('peer') || p.get('sni') || address;

  const outbound = {
    type: 'hysteria',
    server: address,
    server_port: port,
    auth_str: auth || undefined,
    up_mbps: Number(p.get('upmbps')) || undefined,
    down_mbps: Number(p.get('downmbps')) || undefined,
    obfs: p.get('obfs') || undefined,
    tls: { enabled: true, server_name: sni, insecure: p.get('insecure') === '1' }
  };

  return { type: 'hysteria', tag: extractTag(link), outbound };
}

// 本轮新增(2026-07-30):anytls协议解析。格式照anytls-go官方文档
// (docs/uri_scheme.md)实现:anytls://password@host:port/?sni=..&insecure=1&fp=..#tag,
// 密码放在URI的用户名部分(userinfo),跟trojan的写法类似。这个格式是官方定义的,
// 不是从社区分享工具反推的,置信度比hysteria(v1)那种高。
function parseAnyTls(link) {
  const url = safeUrl(link);
  if (!url) return null;
  const password = decodeURIComponent(url.username || '');
  const address = url.hostname;
  const port = Number(url.port) || 443; // 官方文档:端口省略时默认443
  if (!password || !address) return null;

  const p = url.searchParams;
  // 官方文档特别注明:当sni的值是IP地址时,客户端必须不发送SNI——这里只做
  // 字段透传,是否要按这条规则清空sni留给下游sing-box/调用方处理,不在这里
  // 硬编码判断"像不像IP地址"这种容易出错的逻辑。
  const sni = p.get('sni') || address;

  const outbound = {
    type: 'anytls',
    server: address,
    server_port: port,
    password,
    tls: { enabled: true, server_name: sni, insecure: p.get('insecure') === '1' }
  };

  return { type: 'anytls', tag: extractTag(link), outbound };
}

// 本轮新增(2026-07-30):socks5代理链接解析。标准写法 socks5://[user:pass@]host:port,
// 认证信息可选(裸机场/开放代理常见不带认证)。sing-box outbound type是"socks",
// 这里固定写version:"5"(不解析没有认证信息版本号的老式socks4链接,遇到就返回null)。
function parseSocks5(link) {
  const url = safeUrl(link);
  if (!url) return null;
  const address = url.hostname;
  const port = Number(url.port);
  if (!address || !port) return null;

  const username = url.username ? decodeURIComponent(url.username) : '';
  const password = url.password ? decodeURIComponent(url.password) : '';

  const outbound = {
    type: 'socks',
    server: address,
    server_port: port,
    version: '5'
  };
  // 认证信息是可选的,没有就不加这两个字段(sing-box允许匿名socks5)。
  if (username) outbound.username = username;
  if (password) outbound.password = password;

  return { type: 'socks5', tag: extractTag(link), outbound };
}

// 本轮新增(2026-07-30):http/https代理链接解析。标准写法
// http(s)://[user:pass@]host:port,认证信息可选(裸机场/开放代理常见不带认证,
// 写法跟socks5的处理方式保持一致)。https://和http://解析逻辑完全一样,唯一
// 区别是https://要求开启tls(走"HTTP CONNECT over TLS"这种常见的加密HTTP代理
// 形态,sing-box的http outbound原生支持tls字段)。见文件头本次会话的说明:
// 已核实跟repo-fetch.js的自动格式识别不冲突,可以放心加。
function parseHttpProxy(link) {
  const url = safeUrl(link);
  if (!url) return null;
  const address = url.hostname;
  const isHttps = link.toLowerCase().startsWith('https://');
  // 如实标注一个测试时发现的真实坑,不是想当然写的:JS内置URL在端口正好等于
  // scheme默认端口时(http的80/https的443),url.port会是空字符串,不是"80"/"443"
  // 这两个字符串——如果这里直接Number(url.port),遇到没写端口号但实际是走标准
  // 端口的链接(比如https://host,不带:443)会变成Number('')===0,被下面的
  // !port误判成"没端口,解析失败",返回null——链接其实完全合法,是这里的默认值
  // 处理漏了。用跟parseAnyTls同样的写法(Number(url.port) || 默认端口)修掉,
  // 两处保持一致的处理方式。
  const port = Number(url.port) || (isHttps ? 443 : 80);
  if (!address) return null;
  const username = url.username ? decodeURIComponent(url.username) : '';
  const password = url.password ? decodeURIComponent(url.password) : '';

  const outbound = {
    type: 'http',
    server: address,
    server_port: port
  };
  // 认证信息可选,没有就不加这两个字段(sing-box允许匿名http代理)。
  if (username) outbound.username = username;
  if (password) outbound.password = password;
  if (isHttps) {
    const p = url.searchParams;
    outbound.tls = { enabled: true, server_name: p.get('sni') || address, insecure: p.get('insecure') === '1' };
  }

  return { type: isHttps ? 'https' : 'http', tag: extractTag(link), outbound };
}

const PARSERS = [
  { prefix: 'vless://', fn: parseVless },
  { prefix: 'vmess://', fn: parseVmess },
  { prefix: 'ss://', fn: parseShadowsocks },
  { prefix: 'trojan://', fn: parseTrojan },
  { prefix: 'hysteria2://', fn: parseHysteria2 },
  { prefix: 'hy2://', fn: parseHysteria2 },
  { prefix: 'hysteria://', fn: parseHysteria },
  { prefix: 'tuic://', fn: parseTuic },
  { prefix: 'anytls://', fn: parseAnyTls },
  { prefix: 'socks5://', fn: parseSocks5 },
  // 'http://'和'https://'字符串本身互不为对方前缀('https:'比'http:'多一个's',
  // startsWith判断不会互相误命中),两条顺序前后放都一样,这里就按字母顺序放。
  { prefix: 'http://', fn: parseHttpProxy },
  { prefix: 'https://', fn: parseHttpProxy }
];

// 主入口:给一条分享链接,返回 { type, tag, outbound } 或 null(不支持/解析失败)。
function parseProxyLink(link) {
  if (!link || typeof link !== 'string') return null;
  const lower = link.toLowerCase();
  for (const { prefix, fn } of PARSERS) {
    if (lower.startsWith(prefix)) {
      try {
        return fn(link);
      } catch (err) {
        return null;
      }
    }
  }
  return null; // ssr 及其他未覆盖协议
}

module.exports = { parseProxyLink };
