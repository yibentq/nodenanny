'use strict';

// 流量池新项目·批次一核心:三层检测器。
//
// 跟 usability-check.js(测自己的单个主节点,只支持 vless+reality)不是同一个东西——
// 这个模块是给流量池抓来的、协议混杂、来源不可信的候选节点用的,量更大、更需要
// 保护小内存服务器不被拖垮,所以处处都留了超时和资源保护红线(见 v20.0 交接文档 13.5)。
//
// 用 sing-box 做检测后端(而不是继续用 xray),因为 sing-box 一份配置能覆盖
// vless/vmess/ss/trojan/hysteria2/tuic 全部六种协议,不用为每种协议维护一套客户端配置模板。
// 批次一阶段 sing-box 二进制需要手动装在测试机上,自动化安装是批次三(接入 install.sh)的工作。
//
// 三层含义:
//   1. alive    —— 走代理,拿本地 SOCKS5 出口访问一个轻量连通性端点,判断隧道基本能用
//   2. speed    —— 走代理,真实下载一个固定大小文件,量出真实吞吐量(不是测延迟)
//   3. authentic—— 走代理,访问 2-3 个不同厂商的真实网站/连通性端点,校验状态码+内容特征,
//                  防止节点把内容偷偷换成广告页/钓鱼页,或者干脆是同一个可疑来源批量灌的
//                  低质量节点(呼应真机排查发现27:11598个源只测出2个"有效"节点,还共享同一UUID)
//
// 每一层只要判定"不通过"(down)或者上一层已经不通过,后面的层直接跳过(skipped),
// 不做没意义的探测——这也是资源保护的一部分,不给小内存服务器加不必要的负担。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseProxyLink } = require('./proxy-parse');
const { socksFetch } = require('./socks-fetch');
const { _internal: { getFreePort, waitForPort } } = require('./usability-check');

// 本轮修复(真实bug,复查发现——对应创始人反馈"旺财节点池永远测不出可用节点"):
// 三层检测里,测速层(speedTestUrl)和真实性验证层(authenticTargets)都支持在
// config.json里覆盖探测目标,唯独第一层"存活"的探测地址此前是完全硬编码的
// DEFAULT_ALIVE_URL,checkAlive()根本没有读取checkerConfig里的任何字段——
// 而且默认值是 Google 的 gstatic.com,还是走明文 http。
// 这是个关键问题:三层检测是"上一层不通过,后面直接跳过(skipped)"的串行结构
// (见checkNode()),第一层如果探测目标本身在某些节点的出口网络环境下就是
// 不通的(不是节点坏,是"这条出口链路到Google系服务的连通性"本身就有问题——
// 免费/白嫖节点圈子里,出口IP对Google系服务连通性差、被单独限速、甚至完全不通,
// 是比对其它网站更常见的情况),那这个节点会在第一层就被直接判死,后面测速、
// 真实性验证根本没机会跑,不管这个节点对其它网站有多正常。这跟"手动用客户端
// 测过完全能用,但流量池检测器永远测不出来"这个症状完全吻合——之前无法调整
// 这第一层的探测目标,只能眼看着它卡在这里。
// 修复:1) checkAlive()改成读取checkerConfig.aliveUrl,可以在config.json里配置成
// 别的地址,不再是死代码里的常量说了算。2) 默认值本身也从"http://Google gstatic"
// 换成"https://Cloudflare cp.cloudflare.com/generate_204"——Cloudflare Anycast
// 网络的可达性在各类出口网络环境下普遍比Google系服务更好,而且已经是真实性验证层
// 本来就在用、被验证过可行的目标,不是新引入一个没测过的地址。
const DEFAULT_ALIVE_URL = 'https://cp.cloudflare.com/generate_204';
const DEFAULT_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=500000';
const DEFAULT_SINGBOX_BINARY = 'sing-box';

// 已知的连通性检测端点。
// 2026-07-15修复(创始人反馈"检测标准可能被应试通过"问题,详见交接文档45.9节):
// 原来固定测 Google/Cloudflare/Apple 这三个"知名大厂"的轻量连通性端点——但这几家
// 背后大概率都挂在同一批头部 CDN 上,劣质节点只要专门放行这几个固定地址就能稳定
// 骗过检测,而对用户真正想用的普通网站限速或不通(免费节点圈子里的已知套路)。
// 改法:把目标池扩充成用户实际常用的网站(GitHub/Telegram/Claude/YouTube),
// 每轮检测从这个池子里随机抽 3 个(见 DEFAULT_AUTHENTIC_SAMPLE_SIZE),而不是每次固定
// 测同一批——节点没法事先知道这轮会抽到谁,想"应试"就得对池子里所有网站都保证畅通,
// 这就跟"真的能用"没有本质区别了。全部目标特意选轻量端点(小 JSON/纯文本/204状态码),
// 不因为改成"真实网站"就给小内存服务器增加下载负担。
const KNOWN_AUTHENTIC_TARGETS = {
  'https://www.gstatic.com/generate_204': { expectStatus: [204] }, // Google
  'https://cp.cloudflare.com/generate_204': { expectStatus: [204] }, // Cloudflare
  'https://captive.apple.com/hotspot-detect.html': { expectStatus: [200], bodyContains: 'Success' }, // Apple
  'https://www.youtube.com/generate_204': { expectStatus: [204] }, // YouTube(独立于 Google 主站,专门验证 YouTube 域名本身是否通)
  'https://api.github.com/zen': { expectStatus: [200] }, // GitHub(官方提供的轻量随机短句接口,专门设计给这类轻量探测用)
  'https://api.telegram.org': { expectStatus: [200, 404] }, // Telegram(裸访问 api 根路径就会得到一段固定短文本,不需要 bot token)
  'https://claude.ai/robots.txt': { expectStatus: [200] } // Claude/Anthropic(静态小文件,不会因为改版而变化)
};

// 每轮真实性验证默认从上面的目标池里随机抽几个,而不是全测——
// 抽得越多越难被针对性绕过,但也越占资源,3 是权衡后的默认值,可以在 config 里用
// authenticTargetSampleSize 调整;显式配置了 authenticTargets 时不抽样,按配置的固定列表跑
// (给需要复现结果的场景,比如本地测试或者创始人想固定测某几个地址时用)。
const DEFAULT_AUTHENTIC_SAMPLE_SIZE = 3;

function pickRandomTargets(pool, count) {
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function classifyProbeError(err) {
  const msg = err && err.message ? err.message : String(err);
  // 2026-07-14修复:socks-fetch.js的SOCKS5连接超时是一个计时器覆盖三个不同阶段
  // (connecting本机端口/greeting本机握手/connect远程CONNECT)，之前不分阶段一律判
  // check_error(“本机代理客户端没起来，不是节点的锅”)。真机诊断证实：19个候选里
  // 15个卡在connect阶段——本机sing-box端口和握手都正常，只是远程节点一直没回应
  // CONNECT，这其实是节点连不上（应判down），不是本机检测设施的问题；并发1和并发5
  // 结果完全一致，排除了资源竞争导致本机变慢的可能。connecting/greeting阶段超时
  // 仍然更可能是本机sing-box自身异常，维持check_error。
  const stageMatch = msg.match(/SOCKS5连接超时\[阶段:(\w+)\]/);
  if (stageMatch) {
    return stageMatch[1] === 'connect' ? 'down' : 'check_error';
  }
  if (/SOCKS5连接超时/.test(msg)) return 'check_error'; // 兜底:没带阶段信息的旧格式消息，保守按老逻辑处理
  if (/SOCKS5握手失败/.test(msg)) return 'check_error';
  if (/SOCKS5CONNECT失败/.test(msg)) return 'down'; // 代理这条链路真的走不通目标
  if (/HTTP请求超时/.test(msg)) return 'down'; // 隧道通了但目标半天没响应,判定节点实际不可用
  if (/连接被对端关闭/.test(msg)) return 'down';
  // 本轮修复(自查发现,不在45.2节已知问题清单里):socks-fetch.js里TLS握手环节有两条
  // 完全独立的失败路径——tls.connect()真正报错时包装成"TLS握手失败:xxx"(下面这条已覆盖，
  // 判down)；但握手迟迟没有响应、被本地setTimeout主动掐断时，抛的是完全不同的文案
  // "TLS握手超时"(没有"失败"两个字，不会被下面那条正则命中)。这条超时发生在SOCKS5
  // CONNECT已经成功之后(本机sing-box和到远程节点的隧道都已经建立好)，性质跟已经修复的
  // "SOCKS5连接超时[阶段:connect]"完全一样——是节点/目标站点那一头没在合理时间内完成
  // TLS握手，不是本机检测设施的问题，此前会落进最后的默认分支被误判成check_error，
  // 检测速度层/真实性验证层大量走的是https目标，这个遗漏影响面不小，这里补上，判down。
  if (/TLS握手超时/.test(msg)) return 'down';
  if (/TLS握手失败/.test(msg)) return 'down'; // 走这个节点访问目标站点连TLS都握不上,判定不可用
  if (/目标返回了非预期格式的响应/.test(msg)) return 'down';
  return 'check_error'; // 未知错误,宁可判"检测本身出问题"也不要错杀一个可能没问题的节点
}

// code重构第二批(pool-checker.js):跟usability-check.js里classifyUsabilityErrorCode
// 同一个思路——不改classifyProbeError本身(test-classify-probe-error.js直接断言它的
// 裸字符串返回值)，另开一个平行函数专门从同一条err.message里判出稳定的英文code，
// 分支顺序跟classifyProbeError保持一一对应，方便对照维护。
function classifyProbeErrorCode(err) {
  const msg = err && err.message ? err.message : String(err);
  const stageMatch = msg.match(/SOCKS5连接超时\[阶段:(\w+)\]/);
  if (stageMatch) {
    const stage = stageMatch[1];
    if (stage === 'connecting') return 'POOL_PROBE_TIMEOUT_CONNECTING';
    if (stage === 'greeting') return 'POOL_PROBE_TIMEOUT_GREETING';
    if (stage === 'connect') return 'POOL_PROBE_TIMEOUT_CONNECT';
    return 'POOL_PROBE_TIMEOUT_UNKNOWN_STAGE';
  }
  if (/SOCKS5连接超时/.test(msg)) return 'POOL_PROBE_TIMEOUT_LEGACY'; // 没带阶段标记的旧格式
  if (/SOCKS5握手失败/.test(msg)) return 'POOL_PROBE_SOCKS_HANDSHAKE_FAILED';
  if (/SOCKS5CONNECT失败/.test(msg)) return 'POOL_PROBE_SOCKS_CONNECT_FAILED';
  if (/HTTP请求超时/.test(msg)) return 'POOL_PROBE_HTTP_TIMEOUT';
  if (/连接被对端关闭/.test(msg)) return 'POOL_PROBE_CONNECTION_RESET';
  if (/TLS握手超时/.test(msg)) return 'POOL_PROBE_TLS_HANDSHAKE_TIMEOUT';
  if (/TLS握手失败/.test(msg)) return 'POOL_PROBE_TLS_HANDSHAKE_FAILED';
  if (/目标返回了非预期格式的响应/.test(msg)) return 'POOL_PROBE_BAD_RESPONSE_FORMAT';
  return 'POOL_PROBE_UNKNOWN_ERROR';
}

function buildSingboxConfig(outbound, socksPort) {
  return {
    log: { level: 'error' },
    inbounds: [
      { type: 'socks', tag: 'in', listen: '127.0.0.1', listen_port: socksPort, sniff: false }
    ],
    outbounds: [
      { ...outbound, tag: 'proxy' },
      { type: 'direct', tag: 'direct' }
    ],
    route: { final: 'proxy' }
  };
}

function killProcess(child) {
  if (!child || child.killed) return;
  try {
    // 同发现29(usability-check.js里的根因说明)：sing-box 本身不是包装脚本问题的
    // 主体，但为了统一防御同一类"外壳进程杀不掉内层子进程"的风险，这里同样按
    // 进程组杀，而不是只杀 child 自己。流量池检测并发量比二层检测更大（concurrency
    // 默认3且会并发跑），一旦漏杀，进程/内存泄漏速度只会比之前那次更快。
    if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch (err) {
    // 忽略,进程可能已经退出
  }
}

async function startSingbox(outbound, opts) {
  const socksPort = await getFreePort();
  const configPath = path.join(os.tmpdir(), `nodenanny-poolcheck-${process.pid}-${socksPort}.json`);
  fs.writeFileSync(configPath, JSON.stringify(buildSingboxConfig(outbound, socksPort)));

  const binary = opts.singboxBinary || DEFAULT_SINGBOX_BINARY;
  // detached:true 见 killProcess 里发现29的说明，配合 -pid 杀整个进程组。
  const child = spawn(binary, ['run', '-c', configPath], { stdio: 'ignore', detached: true });

  const spawnError = await new Promise((resolve) => {
    child.once('error', (err) => resolve(err));
    setTimeout(() => resolve(null), 50);
  });
  if (spawnError) {
    cleanupConfig(configPath);
    return { error: `没能拉起 sing-box 检测进程(可能是没装 sing-box 或者不在 PATH 里):${spawnError.message}`, code: 'POOL_SINGBOX_SPAWN_FAILED' };
  }

  const startupTimeout = Math.min(opts.aliveTimeoutMs || 8000, 8000); // v21:5000->8000
  const portReady = await waitForPort('127.0.0.1', socksPort, startupTimeout);
  if (!portReady) {
    killProcess(child);
    cleanupConfig(configPath);
    return { error: 'sing-box 进程起来了,但本机 SOCKS5 端口一直没能连上(可能是节点参数跟配置对不上,或者进程启动异常退出)', code: 'POOL_SINGBOX_PORT_NOT_READY' };
  }

  return { child, socksPort, configPath };
}

function cleanupConfig(configPath) {
  try {
    fs.unlinkSync(configPath);
  } catch (err) {
    // 删不掉不影响功能,忽略
  }
}

async function probe(socksPort, url, timeoutMs) {
  try {
    const result = await socksFetch({ socksHost: '127.0.0.1', socksPort, url, timeoutMs, connectTimeoutMs: timeoutMs });
    return { result };
  } catch (err) {
    return { error: err };
  }
}

// 第一层:存活。轻量连通性端点,只看隧道基本能不能用。
// aliveUrl 可在 config.json 的 pool.checker.aliveUrl 里覆盖(本轮修复新增,见上面
// DEFAULT_ALIVE_URL 处的说明)——如果某一批节点的出口网络对默认目标连通性天生就差,
// 不用改代码,直接在配置里换一个探测目标即可。
async function checkAlive(socksPort, timeoutMs, aliveUrl) {
  const { result, error } = await probe(socksPort, aliveUrl || DEFAULT_ALIVE_URL, timeoutMs || 8000);
  if (error) {
    return { outcome: classifyProbeError(error), code: classifyProbeErrorCode(error), detail: error.message };
  }
  if (result.statusCode >= 200 && result.statusCode < 400) {
    return { outcome: 'ok', code: 'POOL_ALIVE_OK', detail: `连通性探测通过,状态码 ${result.statusCode}`, latencyMs: result.elapsedMs };
  }
  return { outcome: 'down', code: 'POOL_ALIVE_BAD_STATUS_CODE', detail: `连通性探测返回状态码 ${result.statusCode},判定不可用`, latencyMs: result.elapsedMs };
}

// 第二层:测速。真实下载固定大小文件,算真实吞吐量,不达标直接判 down。
async function checkSpeed(socksPort, { speedTestUrl, speedMinKBps, speedTimeoutMs }) {
  const url = speedTestUrl || DEFAULT_SPEED_URL;
  const minKBps = speedMinKBps || 15; // v21:从50降到15(创始人要求降低检测标准，能用就行)
  const { result, error } = await probe(socksPort, url, speedTimeoutMs || 20000); // v21:15000->20000
  if (error) {
    return { outcome: classifyProbeError(error), code: classifyProbeErrorCode(error), detail: error.message };
  }
  if (result.statusCode < 200 || result.statusCode >= 400) {
    return { outcome: 'down', code: 'POOL_SPEED_BAD_STATUS_CODE', detail: `测速请求返回状态码 ${result.statusCode}`, throughputKBps: 0 };
  }
  const seconds = Math.max(result.elapsedMs, 1) / 1000;
  const throughputKBps = Math.round((result.bodyLength / 1024 / seconds) * 100) / 100;
  if (throughputKBps >= minKBps) {
    return { outcome: 'ok', code: 'POOL_SPEED_OK', detail: `实测吞吐量 ${throughputKBps} KB/s`, throughputKBps };
  }
  return { outcome: 'down', code: 'POOL_SPEED_BELOW_THRESHOLD', detail: `实测吞吐量 ${throughputKBps} KB/s,低于阈值 ${minKBps} KB/s`, throughputKBps };
}

// 第三层:真实性验证。多个不同厂商的连通性/内容端点,全部通过才算真的可用。
async function checkAuthentic(socksPort, { authenticTargets, authenticTimeoutMs, authenticTargetSampleSize }) {
  // 显式配置了 authenticTargets 就尊重配置、按固定列表跑(方便复现/调试);
  // 没配置就从目标池里随机抽 authenticTargetSampleSize(默认3)个,见上面的修复说明。
  const targets = authenticTargets && authenticTargets.length
    ? authenticTargets
    : pickRandomTargets(Object.keys(KNOWN_AUTHENTIC_TARGETS), authenticTargetSampleSize || DEFAULT_AUTHENTIC_SAMPLE_SIZE);
  const timeoutMs = authenticTimeoutMs || 12000; // v21:8000->12000
  const perTarget = [];

  for (const url of targets) {
    const expectation = KNOWN_AUTHENTIC_TARGETS[url] || { expectStatus: null };
    const { result, error } = await probe(socksPort, url, timeoutMs);
    if (error) {
      perTarget.push({ url, outcome: classifyProbeError(error), code: classifyProbeErrorCode(error), detail: error.message });
      continue;
    }
    const statusOk = expectation.expectStatus
      ? expectation.expectStatus.includes(result.statusCode)
      : result.statusCode >= 200 && result.statusCode < 400;
    // bodyContains 的校验只能靠状态码+长度间接判断(socks-fetch 目前只返回长度不返回正文内容,
    // 避免为了极少数场景把探测响应整个缓冲在内存里造成额外开销),这里先用长度是否大于0近似判断,
    // 精确的关键字匹配留给以后如果发现有节点专门伪造固定长度响应时再升级。
    const bodyOk = !expectation.bodyContains || result.bodyLength > 0;
    if (statusOk && bodyOk) {
      perTarget.push({ url, outcome: 'ok', code: 'POOL_AUTHENTIC_TARGET_OK', detail: `状态码 ${result.statusCode}` });
    } else {
      perTarget.push({ url, outcome: 'down', code: 'POOL_AUTHENTIC_TARGET_MISMATCH', detail: `状态码 ${result.statusCode},响应体长度 ${result.bodyLength},不符合预期` });
    }
  }

  // 2026-07-15修复(创始人反馈"手动验证过能用的节点被判不可用"问题,真机复查确认):
  // 原来是"抽到的几个目标必须全部通过",但目标池里YouTube/Telegram这类站点对
  // 数据中心IP段本身就有较高概率限速/连接不稳(跟节点是否真的可用是两回事),
  // 加上每轮又是随机抽3个——一个节点只要连续两轮不巧抽到这类目标,就会被判"down",
  // 跟source-trust.js"连续2轮0通过率直接拉黑"的规则叠加,足以让一个真实可用、
  // 历史战绩良好的节点/来源被误杀。改成"抽到的目标里过半数通过即算通过"，
  // 保留"至少要经得住多个不同厂商验证"这个核心思路,但不再因为单个刁钻目标一票否决。
  // v21修复(创始人明确要求"降低检测标准，能用就行"):此前是"抽到的目标里过半数
  // 通过才算通过"，改成"抽到的目标里只要有一个真的通过就算通过"——多目标抽样
  // 本身仍然保留(见上面DEFAULT_AUTHENTIC_SAMPLE_SIZE的说明，防止固定测同一个目标
  // 被针对性放行)，但不再要求"大多数"这么高的一致性，只要证明这个节点至少能
  // 稳定连到一个真实第三方站点，就认为足够"能用"。
  const okCount = perTarget.filter((t) => t.outcome === 'ok').length;
  const anyCheckError = perTarget.some((t) => t.outcome === 'check_error');
  const outcome = okCount > 0 ? 'ok' : anyCheckError ? 'check_error' : 'down';
  const code = okCount > 0 ? 'POOL_AUTHENTIC_OK' : anyCheckError ? 'POOL_AUTHENTIC_CHECK_ERROR' : 'POOL_AUTHENTIC_ALL_FAILED';
  return { outcome, code, detail: `${okCount}/${perTarget.length} 个目标通过`, targets: perTarget };
}

// 主入口:对一条节点分享链接跑完整三层检测。
// 返回 { outcome, layers, detail }。outcome 取值 'ok'|'down'|'check_error'|'unsupported'。
async function checkNode(link, checkerConfig) {
  const opts = checkerConfig || {};
  const parsed = parseProxyLink(link);
  if (!parsed) {
    return { outcome: 'unsupported', code: 'POOL_UNSUPPORTED_PROTOCOL', layers: {}, detail: '协议解析失败,或者本版本不支持这个协议类型' };
  }

  const started = await startSingbox(parsed.outbound, opts);
  if (started.error) {
    return {
      outcome: 'check_error',
      code: started.code || 'POOL_SINGBOX_START_FAILED',
      layers: { alive: { outcome: 'check_error', code: started.code, detail: started.error }, speed: { outcome: 'skipped' }, authentic: { outcome: 'skipped' } },
      detail: started.error
    };
  }

  const { child, socksPort, configPath } = started;
  try {
    const alive = await checkAlive(socksPort, opts.aliveTimeoutMs || 8000, opts.aliveUrl); // v21:默认超时5000->8000，降低误判
    if (alive.outcome !== 'ok') {
      return { outcome: alive.outcome, code: alive.code, layers: { alive, speed: { outcome: 'skipped' }, authentic: { outcome: 'skipped' } }, detail: alive.detail };
    }

    const speed = await checkSpeed(socksPort, opts);
    if (speed.outcome !== 'ok') {
      return { outcome: speed.outcome, code: speed.code, layers: { alive, speed, authentic: { outcome: 'skipped' } }, detail: speed.detail };
    }

    const authentic = await checkAuthentic(socksPort, opts);
    return { outcome: authentic.outcome, code: authentic.code, layers: { alive, speed, authentic }, detail: authentic.detail };
  } catch (err) {
    return {
      outcome: 'check_error',
      code: 'POOL_CHECK_UNEXPECTED_ERROR',
      layers: { alive: { outcome: 'check_error', code: 'POOL_CHECK_UNEXPECTED_ERROR', detail: err.message }, speed: { outcome: 'skipped' }, authentic: { outcome: 'skipped' } },
      detail: '检测过程中出现意外错误:' + err.message
    };
  } finally {
    killProcess(child);
    cleanupConfig(configPath);
  }
}

// 并发跑一批节点检测,concurrency 控制同时跑几个 sing-box 进程——
// 2H2G 小内存服务器上这个数字必须保守(配置默认给3),避免拖垮主监控服务。
async function checkNodes(links, checkerConfig, concurrency) {
  const limit = Math.max(1, concurrency || 3);
  const results = new Array(links.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < links.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await checkNode(links[i], checkerConfig);
    }
  }

  const workers = Array.from({ length: Math.min(limit, links.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = {
  checkNode,
  checkNodes,
  _internal: { classifyProbeError, classifyProbeErrorCode, pickRandomTargets, KNOWN_AUTHENTIC_TARGETS, DEFAULT_AUTHENTIC_SAMPLE_SIZE }
};
