'use strict';

// 流量池自愈生态·第五批·第一步:GeoIP国家码模块。
//
// 定位:给一个节点的服务器地址(可能是IP,也可能是域名),尽力查出它的国家二字码
// (ISO 3166-1 alpha-2,比如"US"/"JP"),用于星图/名册展示国旗。查不出来就返回null,
// 不抛异常、不阻塞流量池主体功能——这是创始人在方案讨论里明确要求的("下载时机...
// 失败就显示'未知'、不影响其它功能",详见交接文档v30续篇1.5节)。
//
// 数据源选择(已跟创始人确认,详见续篇1.5节):@ip-location-db/geo-whois-asn-country-mmdb
// 这个npm包——country级别(不是city级别,体积小一个数量级),PDDL/CC0协议(公有领域,
// 免费、不需要注册账号、不需要在UI上加署名),随项目现有的npm install流程一起装,
// 不需要额外写下载脚本、也不用担心sapics/ip-location-db那次改过GitHub Releases分发
// 方式导致下载链接失效的问题(2026年6月18日那次改动,详见续篇1.5节备注)。
//
// 本轮新增的一个复杂点(设计讨论时没提到,是写代码时才发现的):节点地址不一定是IP,
// 很多aggregator抓来的节点用的是域名——mmdb只能查IP,查域名得先做一次DNS解析。
// 这里的处理方式:
//   1. 如果地址本身就是IP(v4/v6),直接查mmdb,不用走DNS。
//   2. 如果是域名,做一次DNS解析(带超时保护,默认2秒,避免个别域名解析慢拖慢整体
//      刷新流程),解析成功再查mmdb;解析失败/超时,返回null(前端显示"未知")。
//   3. 域名的解析结果按地址本身做内存缓存(不落盘,进程重启后重新查,反正开销很小),
//      避免同一批节点里出现同一个域名时重复发起DNS请求。
//
// 对外只暴露一个函数:resolveCountryCode(hostOrAddress) -> Promise<string|null>

const path = require('path');
const dns = require('dns');
const net = require('net');

const DNS_TIMEOUT_MS = 2000;
const MMDB_RELATIVE_PATH = path.join(
  '..', 'node_modules', '@ip-location-db', 'geo-whois-asn-country-mmdb', 'geo-whois-asn-country.mmdb'
);

let lookupPromise = null; // maxmind Reader 实例的懒加载缓存(只加载一次)
let mmdbUnavailable = false; // 一旦确认加载失败(比如包没装成功),后续直接短路,不重复尝试打开文件
const dnsCache = new Map(); // host -> 解析出的IP(或null,代表解析失败过),进程内存缓存,不落盘

function getLookup() {
  if (mmdbUnavailable) return Promise.resolve(null);
  if (!lookupPromise) {
    lookupPromise = (async () => {
      try {
        const maxmind = require('maxmind');
        const mmdbPath = path.join(__dirname, MMDB_RELATIVE_PATH);
        return await maxmind.open(mmdbPath);
      } catch (err) {
        // 常见原因:npm install没装成功、或者maxmind包缺失。这里不抛异常,只记一次日志,
        // 后续所有查询都直接返回null(不会每次都重复报错刷屏)。
        console.error('[geoip] mmdb加载失败,国家码功能本轮不可用(不影响流量池其它功能):', err.message);
        mmdbUnavailable = true;
        return null;
      }
    })();
  }
  return lookupPromise;
}

function isIpAddress(str) {
  return net.isIP(str) !== 0;
}

// 带超时保护的DNS解析,超时/失败都返回null,不抛异常。
function resolveDnsWithTimeout(hostname) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, DNS_TIMEOUT_MS);

    dns.lookup(hostname, (err, address) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(err ? null : address);
    });
  });
}

async function resolveIpFor(hostOrAddress) {
  if (isIpAddress(hostOrAddress)) return hostOrAddress;
  if (dnsCache.has(hostOrAddress)) return dnsCache.get(hostOrAddress);
  const ip = await resolveDnsWithTimeout(hostOrAddress);
  dnsCache.set(hostOrAddress, ip);
  return ip;
}

// 主入口:给一个节点地址(IP或域名),返回国家二字码,查不出来返回null。
// 这个函数本身承诺不抛异常——调用方(pool.js)不需要额外套try/catch,查不出来就是null,
// 不应该因为GeoIP这个锦上添花的功能查失败,就影响流量池主体的节点检测/加权抽取流程。
async function resolveCountryCode(hostOrAddress) {
  if (!hostOrAddress || typeof hostOrAddress !== 'string') return null;
  try {
    const lookup = await getLookup();
    if (!lookup) return null;
    const ip = await resolveIpFor(hostOrAddress);
    if (!ip) return null;
    const result = lookup.get(ip);
    return (result && result.country_code) || null;
  } catch (err) {
    console.error('[geoip] resolveCountryCode 查询失败(已忽略,不影响调用方):', err.message);
    return null;
  }
}

module.exports = { resolveCountryCode };
