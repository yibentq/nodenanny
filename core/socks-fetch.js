'use strict';

// 流量池新项目·批次一:通用 SOCKS5 出口探测工具。
//
// 现有 usability-check.js 里手写的 socksHttpProbe 只支持明文 http——当时的场景
// 只是"测一下 gstatic 的 204 端点",够用。但三层检测器要测速(下载真实文件)和
// 真实性验证(访问真实网站),这年头几乎所有正经网站/CDN 都是强制 https,
// 明文 http 探测器测不了。
//
// 好消息是不需要像 SOCKS5 握手那样手写 TLS——Node 内置的 tls 模块支持
// tls.connect({ socket }) 直接在一条已经建立好的原始 socket 上做 TLS 握手,
// 相当于"套壳"而不是重新实现协议。SOCKS5 CONNECT 拿到的那条隧道,套上 tls 就是
// 一条到目标网站的加密连接,跟直连没有本质区别。
//
// 本模块只依赖 Node 内置的 net / tls,不引入任何 npm 依赖。

const net = require('net');
const tls = require('tls');

// 走 SOCKS5 CONNECT,拿到一条到 targetHost:targetPort 的原始隧道 socket。
function socksConnect({ socksHost, socksPort, targetHost, targetPort, connectTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socksPort, socksHost);
    let stage = 'connecting';
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners('error');
      socket.removeAllListeners('data');
      resolve(socket);
    };

    // 阶段信息(connecting/greeting/connect)一起带进错误消息里,供上层(pool-checker.js的
    // classifyProbeError)区分"本机代理客户端自己没起来"和"本机代理正常、只是远程节点一直没接通"
    // 这两种完全不同的情况——见2026-07-14排查记录:19个候选里15个卡在connect阶段,
    // 用真机诊断证实这是节点本身连不上，不是本机资源/并发问题(并发1和并发5结果完全一致)。
    const timer = setTimeout(() => fail(new Error(`SOCKS5连接超时[阶段:${stage}]`)), connectTimeoutMs);

    socket.on('error', (err) => fail(err));
    socket.on('connect', () => {
      stage = 'greeting';
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    socket.on('data', (chunk) => {
      if (stage === 'greeting') {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          return fail(new Error('SOCKS5握手失败(本机代理客户端没起来或配置有误)'));
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
          return fail(new Error('SOCKS5CONNECT失败(节点这条链路实际走不通)'));
        }
        return succeed();
      }
    });
  });
}

// 在一条隧道(可能是原始 tcp,也可能是套了 tls 的)上发一段 HTTP/1.1 请求,
// 读完整个响应体(靠 Connection: close 或 Content-Length 判断结束),返回状态码/字节数/耗时。
function httpOverSocket(socket, { hostHeader, requestPath, timeoutMs, method }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let responseChunks = [];
    let totalBytes = 0;
    let headerParsed = false;
    let statusCode = null;
    let contentLength = null;
    let headerEndIdx = -1;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve({ statusCode, bodyLength: totalBytes, elapsedMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      // 测速场景下,即使没读满 Content-Length,超时时已经收到的字节数也是有效的
      // 吞吐量样本——只要已经拿到状态行,就按超时时刻的进度算一次"部分成功"。
      if (statusCode !== null) return succeed();
      fail(new Error('HTTP请求超时'));
    }, timeoutMs);

    socket.on('error', (err) => fail(err));
    socket.on('close', () => {
      if (statusCode !== null) return succeed();
      fail(new Error('连接被对端关闭,且没有收到任何HTTP响应'));
    });

    socket.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (!headerParsed) {
        responseChunks.push(chunk);
        const buf = Buffer.concat(responseChunks);
        const idx = buf.indexOf('\r\n\r\n');
        if (idx !== -1) {
          headerParsed = true;
          headerEndIdx = idx;
          const headerText = buf.slice(0, idx).toString('latin1');
          const statusLine = headerText.split('\r\n')[0];
          const m = statusLine.match(/^HTTP\/1\.[01] (\d{3})/);
          if (!m) return fail(new Error('目标返回了非预期格式的响应:' + statusLine.slice(0, 100)));
          statusCode = Number(m[1]);
          const clMatch = headerText.match(/content-length:\s*(\d+)/i);
          if (clMatch) contentLength = Number(clMatch[1]);
          totalBytes = buf.length - idx - 4; // 只统计 body 部分,不算 header 长度
          if (contentLength !== null && totalBytes >= contentLength) return succeed();
        }
        return;
      }
      if (contentLength !== null && totalBytes >= contentLength) return succeed();
    });

    // Referer 头:speed.cloudflare.com 对 bytes>=1e8(约100MB)的请求会做来源校验,
    // 缺少 Referer 的非浏览器客户端(curl/wget/本探测器等)会被直接返回403
    // (参考社区同类项目 subs-check 的踩坑记录)。当前默认测速量(500KB)远低于这个
    // 门槛所以还没触发,但这里提前把 Referer 带上,以后调大测速量也不会突然失败。
    const req = `${method || 'GET'} ${requestPath} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\nUser-Agent: NodeNanny-PoolChecker\r\nReferer: https://${hostHeader}/\r\nAccept: */*\r\n\r\n`;
    socket.write(req);
  });
}

// 主入口:通过本机 SOCKS5 出口,请求一个 http:// 或 https:// 的 URL。
// 返回 { statusCode, bodyLength, elapsedMs }。
// https 目标会在 SOCKS5 隧道上再套一层 tls.connect,insecure=true 时不校验证书链
// (陌生节点后面的目标站点证书链条正常情况下没问题,这里给个开关避免个别边缘情况误报)。
async function socksFetch({ socksHost, socksPort, url, timeoutMs, connectTimeoutMs, insecureTls, method }) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const targetPort = Number(target.port) || (isHttps ? 443 : 80);
  const requestPath = (target.pathname || '/') + (target.search || '');

  const rawSocket = await socksConnect({
    socksHost,
    socksPort,
    targetHost: target.hostname,
    targetPort,
    connectTimeoutMs: connectTimeoutMs || 8000
  });

  if (!isHttps) {
    return httpOverSocket(rawSocket, { hostHeader: target.hostname, requestPath, timeoutMs, method });
  }

  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket: rawSocket,
      servername: target.hostname,
      rejectUnauthorized: !insecureTls
    });
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error('TLS握手超时'));
    }, connectTimeoutMs || 8000);
    tlsSocket.once('secureConnect', () => {
      clearTimeout(timer);
      httpOverSocket(tlsSocket, { hostHeader: target.hostname, requestPath, timeoutMs, method }).then(resolve, reject);
    });
    tlsSocket.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error('TLS握手失败:' + err.message));
    });
  });
}

module.exports = { socksFetch, _internal: { socksConnect, httpOverSocket } };
