'use strict';

// 二层"真实可用性检测"：TCP 端口通≠代理真的能用（进程健在但被墙、或握手失败这类情况，
// 纯端口探测完全看不出来）。这里参考 kutovoys/xray-checker 的思路：
// 不去猜"能不能连 127.0.0.1:检测端口"，而是真的临时拉起一个 xray 客户端进程
// （复用系统已装好的 xray 二进制，不新增任何 npm 依赖），让它作为一个本机 SOCKS5
// 出口，通过它去请求一个外部地址，看能不能拿到预期响应。
//
// 范围说明（如实写在这里，别指望这个模块万能）：
// - 只支持 vless + reality（parseVlessReality 解析不出来就直接跳过，返回 unsupported）。
// - 依赖 config.node.subscriptionUrl 有值（批次一已经打通这条链路，装机走过 233boy 流程就会有）。
// - 依赖系统 PATH 或指定路径下能找到 xray 可执行文件，找不到就报 check_error，不是 down。
// - 外部探测目标本身抽风（比如 gstatic 被临时墙/网络波动）时，应该报 check_error 而不是 down，
//   避免把"探测手段失效"误判成"节点故障"，这一点在下面 runUsabilityCheck 里专门做了区分。

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseVlessReality } = require('./vless-parse');

// v21修复(跟pool-checker.js的alive层是同一个思路,这次轮到主节点自己的可用性检测):
// 默认探测目标此前是Google的gstatic(还是明文http)。创始人反馈过主节点的这项检测
// 会间歇性"未通过"，跟流量池那次"旺财测不出"是同一类问题——出口网络对Google系
// 服务的连通性天生就不如对Cloudflare稳定，不是节点真的时好时坏。换成Cloudflare的
// 端点，跟pool-checker.js里已经验证过可行的目标保持一致。仍然可以通过
// config.json的usabilityCheck.targetUrl覆盖，不强制。
//
// 2026-07-23修复:v21把目标换成Cloudflare时误写成了https://，但下面
// runUsabilityCheck里的探测器是手写的最小化SOCKS+HTTP实现，本身没有实现TLS
// 握手，遇到https://目标一律判USABILITY_TARGET_MUST_BE_HTTP(check_error)。
// 也就是说没手动覆盖targetUrl的话，二层检测从v21起就一直在报这个配置错误，
// 从未真正探测过。cp.cloudflare.com本身同时支持明文http和https(实测http也
// 返回204)，这里只改协议，不换目标，维持原来"避开Google系连通性问题"的决策。
// 如果之后发现这个host本身不稳定(社区里零星有反馈)，可以考虑换成同样支持明文
// http+204的备选:http://www.msftconnecttest.com/connecttest.txt 或
// http://detectportal.firefox.com/success.txt。
const DEFAULT_TARGET = 'http://cp.cloudflare.com/generate_204';
const DEFAULT_XRAY_BINARY = 'xray';
const DEFAULT_TIMEOUT_MS = 8000;

// 找一个当前空闲的本机端口，给临时 xray 客户端的 socks 入站用。
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// 反复尝试连接，直到 xray 客户端进程把 socks 端口开起来，或者超时。
function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const socket = new net.Socket();
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (ok) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryOnce, 150);
      };
      socket.setTimeout(500);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, host);
    };
    tryOnce();
  });
}

function buildXrayClientConfig(vlessParams, socksPort) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      { listen: '127.0.0.1', port: socksPort, protocol: 'socks', settings: { udp: false, auth: 'noauth' } }
    ],
    outbounds: [
      {
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: vlessParams.address,
              port: vlessParams.port,
              users: [
                { id: vlessParams.uuid, encryption: vlessParams.encryption || 'none', flow: vlessParams.flow || '' }
              ]
            }
          ]
        },
        streamSettings: {
          network: vlessParams.network || 'tcp',
          security: 'reality',
          realitySettings: vlessParams.realitySettings
        }
      },
      { protocol: 'freedom', tag: 'direct' }
    ]
  };
}

// 手写一个最小化的 SOCKS5 客户端握手（CONNECT，无认证），换取一条到目标地址的隧道，
// 之后在同一条 TCP 连接上直接发一段裸的 HTTP/1.1 请求。不引入 socks/http-proxy 之类的
// npm 依赖——协议本身很简单，没必要为这几十行手写代码加一个包。
function socksHttpProbe({ socksHost, socksPort, targetHost, targetPort, requestPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socksPort, socksHost);
    let stage = 'greeting';
    let responseChunks = [];
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const succeed = (statusCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ statusCode });
    };

    // 2026-07-15修复:原来不管卡在哪个阶段,超时都抛同一句"探测请求超时",调用方
    // 只能笼统地把它当成check_error(检测手段本身的问题)处理。但跟pool-checker.js里
    // 修过的同类问题(SOCKS5连接超时/TLS握手超时按阶段区分down还是check_error)是同一种性质：
    // greeting阶段超时,是本机xray客户端自己没反应,才算真的是检测设施问题;
    // connect/http阶段超时,说明本机到xray客户端这段已经通了,是远程节点这条链路
    // 没能在合理时间内连上目标或者响应,应该判定节点真的不可用。这里带上阶段标记,
    // 具体分类逻辑在下面 runUsabilityCheck 的 catch 分支里处理。
    const timer = setTimeout(() => fail(new Error(`Probe timed out [stage:${stage}]`)), timeoutMs);

    socket.on('error', (err) => fail(err));

    socket.on('connect', () => {
      // SOCKS5 greeting：版本5，1 种认证方式，无需认证。
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on('data', (chunk) => {
      if (stage === 'greeting') {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          return fail(new Error('SOCKS5 handshake failed (xray client may not have started, or config mismatch)'));
        }
        stage = 'connect';
        const hostBuf = Buffer.from(targetHost, 'utf8');
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
        ]);
        socket.write(req);
        return;
      }
      if (stage === 'connect') {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          return fail(new Error('SOCKS5 CONNECT failed, proxy could not reach the target address (likely the node is actually down)'));
        }
        stage = 'http';
        const req = `GET ${requestPath} HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\nUser-Agent: NodeNanny-UsabilityCheck\r\n\r\n`;
        socket.write(req);
        return;
      }
      // stage === 'http'：攒 HTTP 响应，只需要状态行就够判断了。
      responseChunks.push(chunk);
      const buf = Buffer.concat(responseChunks).toString('latin1');
      const lineEnd = buf.indexOf('\r\n');
      if (lineEnd !== -1) {
        const statusLine = buf.slice(0, lineEnd);
        const m = statusLine.match(/^HTTP\/1\.[01] (\d{3})/);
        if (m) {
          succeed(Number(m[1]));
        } else {
          fail(new Error('Target returned an unexpected response format: ' + statusLine.slice(0, 100)));
        }
      }
    });
  });
}

function killProcess(child) {
  if (!child || child.killed) return;
  try {
    // 发现29根因：/usr/local/bin/xray 在部分安装方式（233boy 脚本）下是一个 source 调用
    // 内层真实二进制的 bash 包装脚本，不是 exec 调用。SIGTERM 发给 child.pid 只会杀死
    // 这层外壳 bash，内层真正的 xray 子进程杀不掉，逐次检测都会漏杀一个，长期运行会
    // 把小内存服务器的内存耗尽（真机上曾观测到306个孤儿xray进程、内存占用98%+）。
    // 修法：spawn 时加 detached:true 把子进程放进独立进程组，这里用负数 pid
    // （process.kill(-pid, sig)是杀整个进程组的标准写法）连壳带内层子进程一起杀掉；
    // 如果拿不到 pid（理论上不该发生）就退回杀 child 本身，保底不报错。
    if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch (err) {
    // 忽略，进程可能已经退出
  }
}

// 把 socksHttpProbe 抛出的错误分类成 'down' 或 'check_error'。
// 2026-07-15新增(此前这段逻辑内联在 runUsabilityCheck 的 catch 里，只认 "CONNECT 失败"
// 这一种情况，没有区分超时发生在哪个阶段，见上面 socksHttpProbe 里的修复说明)。
function classifyUsabilityError(err) {
  const msg = err && err.message ? err.message : String(err);
  const stageMatch = msg.match(/Probe timed out \[stage:(\w+)\]/);
  if (stageMatch) {
    // greeting阶段超时 = 本机xray客户端没反应,是检测设施问题;
    // connect/http阶段超时 = 隧道已经往前走了一段,是节点/目标那头的问题。
    return stageMatch[1] === 'greeting' ? 'check_error' : 'down';
  }
  if (/CONNECT failed/.test(msg)) return 'down';
  return 'check_error'; // 兜底:含糊不清的错误,宁可判"检测本身有问题"也不错杀节点
}

// code重构第一批(usability-check.js):给classifyUsabilityError覆盖的同一批错误
// 补一个稳定的英文code，跟上面classifyUsabilityError分开写、不改它的返回值，
// 避免动到已有的test-usability-classify.js(那边断言的是裸字符串'down'/'check_error')。
// 这个函数只负责"这条错误具体是哪一种"，不负责outcome判定，两者在调用处一起挂到
// 返回对象上。以后知识库要按code精确匹配detail时，就从这里取，不用再猜正则。
function classifyUsabilityErrorCode(err) {
  const msg = err && err.message ? err.message : String(err);
  const stageMatch = msg.match(/Probe timed out \[stage:(\w+)\]/);
  if (stageMatch) {
    const stage = stageMatch[1];
    if (stage === 'greeting') return 'USABILITY_PROBE_TIMEOUT_GREETING';
    if (stage === 'connect') return 'USABILITY_PROBE_TIMEOUT_CONNECT';
    if (stage === 'http') return 'USABILITY_PROBE_TIMEOUT_HTTP';
    return 'USABILITY_PROBE_TIMEOUT_UNKNOWN_STAGE';
  }
  if (/Probe timed out/.test(msg)) return 'USABILITY_PROBE_TIMEOUT_LEGACY'; // 没带阶段标记的旧格式（理论上不会再出现，兜底保留）
  if (/CONNECT failed/.test(msg)) return 'USABILITY_PROBE_SOCKS_CONNECT_FAILED';
  if (/handshake failed/.test(msg)) return 'USABILITY_PROBE_SOCKS_HANDSHAKE_FAILED';
  if (/unexpected response format/.test(msg)) return 'USABILITY_PROBE_BAD_RESPONSE_FORMAT';
  return 'USABILITY_PROBE_UNKNOWN_ERROR';
}

// 主入口：给定节点配置 + 已经解析出来的 vless 订阅链接，跑一次完整的二层检测。
// 返回值统一是 { outcome, detail }，outcome 取值：
//   'ok'           —— 真的通过代理拿到了预期的外部响应
//   'down'         —— 代理隧道建立了，但请求没拿到预期结果（判定为节点真的不可用）
//   'check_error'  —— 检测手段本身出问题了（xray 二进制缺失、进程没起来、外部探测目标超时等），
//                     不代表节点故障，调用方不应该据此触发重启/通知
//   'unsupported'  —— 当前订阅链接不是 vless+reality，或者完全没有订阅链接，本版本跳过二层检测
async function runUsabilityCheck(config) {
  const node = config.node || {};
  const opts = config.usabilityCheck || {};
  if (opts.enabled === false) {
    return { outcome: 'unsupported', code: 'USABILITY_DISABLED', detail: 'Layer-2 usability check is disabled' };
  }

  const vlessParams = parseVlessReality(node.subscriptionUrl);
  if (!vlessParams) {
    return { outcome: 'unsupported', code: 'USABILITY_UNSUPPORTED_PROTOCOL', detail: 'Subscription link is empty, or not vless+reality (this version only supports that combination)' };
  }

  const targetUrl = (() => {
    try {
      return new URL(opts.targetUrl || DEFAULT_TARGET);
    } catch (err) {
      return new URL(DEFAULT_TARGET);
    }
  })();
  const targetPort = Number(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
  if (targetUrl.protocol === 'https:') {
    // 手写的探测器只实现了明文 HTTP（避免还要在 SOCKS 隧道里再手搓一层 TLS），
    // 所以强制要求探测目标是 http://，配置了 https:// 直接当配置错误处理。
    return { outcome: 'check_error', code: 'USABILITY_TARGET_MUST_BE_HTTP', detail: 'Probe target must be an http:// address (this version cannot do a TLS handshake inside the tunnel)' };
  }

  const xrayBinary = opts.xrayBinary || DEFAULT_XRAY_BINARY;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  let socksPort;
  try {
    socksPort = await getFreePort();
  } catch (err) {
    return { outcome: 'check_error', code: 'USABILITY_NO_FREE_PORT', detail: 'Could not find a free local port for the temporary xray client: ' + err.message };
  }

  const tmpConfigPath = path.join(os.tmpdir(), `nodenanny-usability-${process.pid}-${socksPort}.json`);
  const xrayConfig = buildXrayClientConfig(vlessParams, socksPort);

  let child;
  try {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(xrayConfig));

    // detached:true 让这个子进程成为独立进程组的组长（pid === 进程组id），
    // 这样即使 xrayBinary 实际是个 source 调用内层二进制的包装脚本，killProcess
    // 用 -pid 杀整个组时也能连内层子进程一起杀掉，见 killProcess 里发现29的说明。
    child = spawn(xrayBinary, ['run', '-config', tmpConfigPath], { stdio: 'ignore', detached: true });
    const spawnError = await new Promise((resolve) => {
      child.once('error', (err) => resolve(err));
      // 没有报错事件的话，给个短暂窗口让 spawn 真正跑起来再继续。
      setTimeout(() => resolve(null), 50);
    });
    if (spawnError) {
      return { outcome: 'check_error', code: 'USABILITY_XRAY_SPAWN_FAILED', detail: `Failed to launch the temporary xray client process (xray may not be installed, or not on PATH): ${spawnError.message}` };
    }

    const portReady = await waitForPort('127.0.0.1', socksPort, Math.min(timeoutMs, 5000));
    if (!portReady) {
      return { outcome: 'check_error', code: 'USABILITY_SOCKS_PORT_NOT_READY', detail: 'The temporary xray client process started, but the local socks port never became reachable (vless/reality params may not match the node\'s actual config)' };
    }

    try {
      const { statusCode } = await socksHttpProbe({
        socksHost: '127.0.0.1',
        socksPort,
        targetHost: targetUrl.hostname,
        targetPort,
        requestPath: targetUrl.pathname + targetUrl.search,
        timeoutMs
      });
      if (statusCode >= 200 && statusCode < 400) {
        return { outcome: 'ok', code: 'USABILITY_OK', detail: `Got an external response through the proxy, status code ${statusCode}` };
      }
      return { outcome: 'down', code: 'USABILITY_BAD_STATUS_CODE', detail: `Requested the external address through the proxy but got status code ${statusCode} — treated as the node actually being down` };
    } catch (err) {
      // outcome判定沿用原classifyUsabilityError(避免动到已有测试)，code另外从
      // classifyUsabilityErrorCode取，两者基于同一条err.message分别判断，不冲突。
      return { outcome: classifyUsabilityError(err), code: classifyUsabilityErrorCode(err), detail: err.message };
    }
  } catch (err) {
    return { outcome: 'check_error', code: 'USABILITY_UNEXPECTED_ERROR', detail: 'Unexpected error during the layer-2 check: ' + err.message };
  } finally {
    killProcess(child);
    try {
      fs.unlinkSync(tmpConfigPath);
    } catch (err) {
      // 临时文件删不掉不影响功能，忽略
    }
  }
}

module.exports = {
  runUsabilityCheck,
  // 以下几个仅供本地测试用（比如拿假的 SOCKS5/HTTP 服务器验证手写协议逻辑对不对），
  // 正常运行路径不需要外部直接调用这几个内部函数。
  _internal: { getFreePort, waitForPort, socksHttpProbe, classifyUsabilityError, classifyUsabilityErrorCode }
};
