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
// - tuic:支持标准 tuic://uuid:password@host:port 格式。
// - ssr、vless 的 xtls-rprx 系列老 flow、其他冷门协议:本版本不解析,返回 null。
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

const PARSERS = [
  { prefix: 'vless://', fn: parseVless },
  { prefix: 'vmess://', fn: parseVmess },
  { prefix: 'ss://', fn: parseShadowsocks },
  { prefix: 'trojan://', fn: parseTrojan },
  { prefix: 'hysteria2://', fn: parseHysteria2 },
  { prefix: 'hy2://', fn: parseHysteria2 },
  { prefix: 'tuic://', fn: parseTuic }
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
