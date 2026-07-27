'use strict';

// 只负责把一条 vless:// 分享链接解析成 Xray 客户端 outbound 需要的字段。
// 范围明确限定：只支持 vless + reality（本项目目前唯一真机验证过的组合，233boy 默认方案）。
// 其他协议（vmess/trojan/ss...）或 security 类型（tls/none）本版本不解析，
// 返回 null，调用方应当把这种情况当作"暂不支持二层检测"处理，而不是报错。
function parseVlessReality(link) {
  if (!link || typeof link !== 'string' || !link.startsWith('vless://')) {
    return null;
  }
  let url;
  try {
    url = new URL(link);
  } catch (err) {
    return null;
  }

  const uuid = decodeURIComponent(url.username || '');
  const address = url.hostname;
  const port = Number(url.port);
  if (!uuid || !address || !port) return null;

  const params = url.searchParams;
  const security = (params.get('security') || '').toLowerCase();
  if (security !== 'reality') {
    // 明确只做 reality，tls/none 等留给以后有需要再扩展。
    return null;
  }

  const publicKey = params.get('pbk');
  const sni = params.get('sni') || params.get('host') || address;
  if (!publicKey) return null;

  return {
    uuid,
    address,
    port,
    encryption: params.get('encryption') || 'none',
    flow: params.get('flow') || '',
    network: params.get('type') || 'tcp',
    security,
    realitySettings: {
      serverName: sni,
      fingerprint: params.get('fp') || 'chrome',
      publicKey,
      shortId: params.get('sid') || '',
      spiderX: params.get('spx') || ''
    }
  };
}

module.exports = { parseVlessReality };
