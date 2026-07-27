'use strict';

// clash yaml 格式 -> 标准分享链接 转换(流量池自愈生态·批次三)。
//
// 背景:很多topic命中的候选仓库产出的是clash订阅(yaml格式,proxies是一个结构化
// 配置数组),不是标准的vless://这类分享链接。repo-fetch.js抓到内容后如果识别出
// 是clash yaml,就调用这里的 extractLinksFromClashYaml() 转换成标准链接,再交给
// 后面统一的 proxy-parse.js / pool-checker.js 流程处理——这样上层完全不用关心
// "这条节点原本是什么格式抓来的"。
//
// 如实说明这个模块的真实范围和限制:
// 1. 项目一贯极简、零依赖(package.json目前只有express和nodemailer),这里没有
//    引入js-yaml之类的第三方库,而是手写了一个"缩进层级解析器",只覆盖clash
//    proxies列表这一种受限场景——顶层"proxies:"数组,每项是"- key: value"加
//    若干缩进更深的"key: value"/嵌套映射(比如ws-opts/grpc-opts/reality-opts)。
//    不是通用YAML实现,遇到锚点引用(&/*)、多行字符串(|、>)、flow style([]/{})
//    这些不常见于clash订阅但YAML规范里存在的写法会解析失败,统一按"这个proxy解析
//    不出来"处理,不会让整个文件崩溃。
// 2. 只覆盖项目需要的6种协议:vless/vmess/ss(shadowsocks)/trojan/hysteria2/tuic。
//    clash proxy里的其他类型(如 socks5、http、snell、vmess的部分冷门字段)不转换,
//    计入skipped,不当错误。
// 3. 本模块只做过mock测试(手写的clash yaml样例字符串),没有用真实抓到的clash
//    订阅文件验证过字段命名是否完全对得上各家生成器的习惯(比如"congestion-controller"
//    还是"congestion-control",不同clash-meta分支写法有差异)——如实标注,不假装
//    已经拿真实数据验证过。批次三-第二步会有真机测试的空间,如果真实样本暴露出
//    字段名不匹配的问题,需要下一步来补。

// ---------- 缩进解析器 ----------

function stripComment(line) {
  // 简单去掉行内注释(# 开头),但要避免把password/sni里可能带#的值误伤——
  // clash配置字段值一般不带#,这里按"最前面不在引号内的#"处理,足够用。
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(raw) {
  if (raw === undefined) return raw;
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function coerceScalar(raw) {
  const v = unquote(raw);
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === '~' || v.toLowerCase() === 'null') return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

// 找到顶层"proxies:"这一行,返回它下面属于这个列表的原始行(indent, text),
// 直到遇到缩进 <= "proxies:"本身缩进的下一个顶层key为止。
function extractProxiesBlockLines(rawText) {
  const allLines = rawText.split(/\r?\n/);
  let proxiesIndent = null;
  let startIdx = -1;
  for (let i = 0; i < allLines.length; i++) {
    const line = stripComment(allLines[i]);
    if (/^\s*$/.test(line)) continue;
    const m = line.match(/^(\s*)proxies:\s*(\[.*\])?\s*$/);
    if (m && (m[2] === undefined || m[2] === '')) {
      proxiesIndent = m[1].length;
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return [];

  const blockLines = [];
  for (let i = startIdx; i < allLines.length; i++) {
    const raw = allLines[i];
    const line = stripComment(raw);
    if (/^\s*$/.test(line)) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= proxiesIndent) break; // 回到顶层,proxies列表结束
    blockLines.push({ indent, text: line.trim() });
  }
  return blockLines;
}

// 把"proxies:"下面的原始行切分成一个个proxy(每个以"- "开头的行为起点),
// 每个proxy自己是一组(indent相对偏移, text)行,交给parseMappingLines解析成对象。
function splitIntoProxyBlocks(blockLines) {
  const proxies = [];
  let current = null;
  let listIndent = null;

  for (const { indent, text } of blockLines) {
    const isListItem = text.startsWith('- ') || text === '-';
    if (isListItem && (listIndent === null || indent === listIndent)) {
      listIndent = indent;
      if (current) proxies.push(current);
      current = [];
      const rest = text === '-' ? '' : text.slice(2);
      if (rest.trim() !== '') {
        // "- key: value" 这一行本身也是一条 key:value,把它当成缩进 = indent+2 的普通行
        current.push({ indent: indent + 2, text: rest.trim() });
      }
    } else if (current) {
      current.push({ indent, text });
    }
    // 如果还没遇到任何list item就出现别的行,忽略(容错,不应该发生)
  }
  if (current) proxies.push(current);
  return proxies;
}

// 把一个proxy内部的(indent, text)行解析成嵌套对象。用缩进栈处理"key:"后面
// 跟着更深缩进的子映射(比如ws-opts:/grpc-opts:/reality-opts:/headers:)这种情况;
// 明确不支持行内list(比如alpn写成 "- h2\n- http/1.1"这种独立成行的),这类值
// 会被当成字符串"null"/跳过,不影响6个协议需要的核心字段。
function parseMappingLines(lines) {
  if (!lines.length) return {};
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const { indent, text } of lines) {
    if (text.startsWith('- ')) continue; // 行内list项,本模块不需要,跳过不报错
    const colonIdx = text.indexOf(':');
    if (colonIdx === -1) continue;
    const key = unquote(text.slice(0, colonIdx));
    const valueRaw = text.slice(colonIdx + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;

    if (valueRaw === '') {
      const nested = {};
      parent[key] = nested;
      stack.push({ indent, obj: nested });
    } else {
      parent[key] = coerceScalar(valueRaw);
    }
  }
  return root;
}

function extractAllProxyObjects(rawText) {
  const blockLines = extractProxiesBlockLines(rawText);
  const blocks = splitIntoProxyBlocks(blockLines);
  return blocks.map(parseMappingLines);
}

// ---------- 各协议:clash proxy对象 -> 标准分享链接 ----------
// 目标格式跟 proxy-parse.js 的解析逻辑对齐,保证转换出来的链接后面能被正常解析。

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function buildQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

function convertShadowsocks(p) {
  const server = p.server;
  const port = p.port;
  const method = pick(p, 'cipher', 'method');
  const password = p.password;
  if (!server || !port || !method || password === undefined) return null;
  const userInfo = Buffer.from(`${method}:${password}`, 'utf-8').toString('base64');
  const tag = encodeURIComponent(p.name || 'node');
  return `ss://${userInfo}@${server}:${port}#${tag}`;
}

function convertVmess(p) {
  const server = p.server;
  const port = p.port;
  const uuid = p.uuid;
  if (!server || !port || !uuid) return null;
  const network = (pick(p, 'network') || 'tcp').toLowerCase();
  const tlsOn = p.tls === true || p.tls === 'true';
  const sni = pick(p, 'servername', 'sni') || server;

  let wsPath, wsHost;
  if (network === 'ws' && p['ws-opts']) {
    wsPath = p['ws-opts'].path;
    wsHost = p['ws-opts'].headers && p['ws-opts'].headers.Host;
  }
  let grpcServiceName;
  if (network === 'grpc' && p['grpc-opts']) {
    grpcServiceName = p['grpc-opts']['grpc-service-name'];
  }

  const cfg = {
    v: '2',
    ps: p.name || '',
    add: server,
    port: String(port),
    id: uuid,
    aid: String(pick(p, 'alterId', 'alterID', 'alter_id') || 0),
    net: network,
    tls: tlsOn ? 'tls' : '',
    sni: tlsOn ? sni : '',
    // 对齐proxy-parse.js里 parseVmess 的实现细节:grpc场景服务名读的是cfg.path
    path: network === 'grpc' ? (grpcServiceName || '') : (wsPath || ''),
    host: wsHost || ''
  };
  const b64 = Buffer.from(JSON.stringify(cfg), 'utf-8').toString('base64');
  return `vmess://${b64}`;
}

function convertTrojan(p) {
  const server = p.server;
  const port = p.port;
  const password = p.password;
  if (!server || !port || password === undefined) return null;
  const network = (pick(p, 'network') || 'tcp').toLowerCase();
  const sni = pick(p, 'sni', 'servername') || server;
  const insecure = p['skip-cert-verify'] === true;

  let wsPath, wsHost, grpcServiceName;
  if (network === 'ws' && p['ws-opts']) {
    wsPath = p['ws-opts'].path;
    wsHost = p['ws-opts'].headers && p['ws-opts'].headers.Host;
  }
  if (network === 'grpc' && p['grpc-opts']) {
    grpcServiceName = p['grpc-opts']['grpc-service-name'];
  }

  const query = buildQuery({
    type: network !== 'tcp' ? network : undefined,
    sni,
    path: wsPath,
    host: wsHost,
    serviceName: grpcServiceName,
    allowInsecure: insecure ? '1' : undefined,
    alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : p.alpn
  });
  const tag = encodeURIComponent(p.name || 'node');
  return `trojan://${encodeURIComponent(password)}@${server}:${port}${query ? '?' + query : ''}#${tag}`;
}

function convertVless(p) {
  const server = p.server;
  const port = p.port;
  const uuid = p.uuid;
  if (!server || !port || !uuid) return null;
  const network = (pick(p, 'network') || 'tcp').toLowerCase();
  const tls = pick(p, 'tls'); // clash里可能是 true/false,或者用reality-opts的存在来判断
  const realityOpts = p['reality-opts'];
  const security = realityOpts ? 'reality' : (tls === true || tls === 'true' ? 'tls' : 'none');
  const sni = pick(p, 'servername', 'sni') || server;

  let wsPath, wsHost, grpcServiceName;
  if (network === 'ws' && p['ws-opts']) {
    wsPath = p['ws-opts'].path;
    wsHost = p['ws-opts'].headers && p['ws-opts'].headers.Host;
  }
  if (network === 'grpc' && p['grpc-opts']) {
    grpcServiceName = p['grpc-opts']['grpc-service-name'];
  }

  if (security === 'reality' && (!realityOpts || !realityOpts['public-key'])) return null; // reality缺pbk判定为解析失败,跟proxy-parse.js的口径一致

  const query = buildQuery({
    security: security !== 'none' ? security : undefined,
    type: network !== 'tcp' ? network : undefined,
    sni: security !== 'none' ? sni : undefined,
    fp: pick(p, 'client-fingerprint'),
    pbk: realityOpts ? realityOpts['public-key'] : undefined,
    sid: realityOpts ? realityOpts['short-id'] : undefined,
    flow: p.flow,
    path: wsPath,
    host: wsHost,
    serviceName: grpcServiceName
  });
  const tag = encodeURIComponent(p.name || 'node');
  return `vless://${uuid}@${server}:${port}${query ? '?' + query : ''}#${tag}`;
}

function convertHysteria2(p) {
  const server = p.server;
  const port = p.port;
  const password = pick(p, 'password', 'auth', 'auth-str');
  if (!server || !port || password === undefined) return null;
  const sni = pick(p, 'sni', 'servername') || server;
  const insecure = p['skip-cert-verify'] === true;

  const query = buildQuery({
    sni,
    insecure: insecure ? '1' : undefined,
    obfs: p.obfs,
    'obfs-password': pick(p, 'obfs-password')
  });
  const tag = encodeURIComponent(p.name || 'node');
  return `hysteria2://${encodeURIComponent(password)}@${server}:${port}${query ? '?' + query : ''}#${tag}`;
}

function convertTuic(p) {
  const server = p.server;
  const port = p.port;
  const uuid = p.uuid;
  const password = pick(p, 'password');
  if (!server || !port || !uuid || password === undefined) return null;
  const sni = pick(p, 'sni', 'servername') || server;
  const congestion = pick(p, 'congestion-controller', 'congestion-control') || 'bbr';
  const alpn = Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || 'h3');

  const query = buildQuery({ sni, congestion_control: congestion, alpn });
  const tag = encodeURIComponent(p.name || 'node');
  return `tuic://${uuid}:${encodeURIComponent(password)}@${server}:${port}${query ? '?' + query : ''}#${tag}`;
}

const CONVERTERS = {
  ss: convertShadowsocks,
  shadowsocks: convertShadowsocks,
  vmess: convertVmess,
  trojan: convertTrojan,
  vless: convertVless,
  hysteria2: convertHysteria2,
  tuic: convertTuic
  // 修复记录(本轮核实时发现的真实问题,不是原方案就有的设计):此前这里把
  // clash的"hysteria"(v1协议)也映射到convertHysteria2,注释写"尽量兼容解一次"——
  // 但hysteria v1和hysteria2是两个不同协议,字段语义和链接格式都不一样(v1的
  // 认证/带宽协商方式跟v2完全不同),硬套converter产出的链接不是"能凑合用",
  // 是"必然错误",而且下游proxy-parse.js本身也只认hysteria2://这一种scheme
  // (见该文件注释),v1链接送进去也只会在alive层必然失败——等于每次都白白
  // 制造一批注定测不过的候选,浪费三层检测的资源。这里改成明确不支持:
  // clash类型是"hysteria"(v1)的proxy条目会因为CONVERTERS里查不到对应转换器
  // 直接跳过(计入total但不计入converted),不产生错误链接,交给以后如果真的
  // 需要支持hysteria v1时再单独写一个转换器,不是现在硬凑。
};

// 主入口:输入原始文本,尝试当clash yaml解析,输出 { links, total, converted }。
// total = 识别到的proxy条目数(不管转不转得出来);converted = 成功转换成分享链接的数量。
// 找不到"proxies:"或者一条都解析不出来,返回 links: []——调用方(repo-fetch.js)
// 会把这种情况当成"这个文件不是clash订阅"处理,不当错误。
function extractLinksFromClashYaml(rawText) {
  let proxyObjects = [];
  try {
    proxyObjects = extractAllProxyObjects(rawText);
  } catch (err) {
    return { links: [], total: 0, converted: 0 };
  }

  const links = [];
  for (const p of proxyObjects) {
    const type = (p.type || '').toLowerCase();
    const converter = CONVERTERS[type];
    if (!converter) continue;
    try {
      const link = converter(p);
      if (link) links.push(link);
    } catch (err) {
      // 单条proxy转换失败不影响其他proxy,跳过即可
    }
  }

  return {
    links: Array.from(new Set(links)),
    total: proxyObjects.length,
    converted: links.length
  };
}

module.exports = {
  extractLinksFromClashYaml,
  // 导出内部转换函数,方便下一步针对6协议单独写更细的单元测试
  _internal: { convertShadowsocks, convertVmess, convertTrojan, convertVless, convertHysteria2, convertTuic }
};
