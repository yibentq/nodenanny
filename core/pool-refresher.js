'use strict';

// 独立的常驻进程，只负责"定时刷新流量池"，跟 monitor.js 的存活检测完全分开。
// 就算这个进程挂了、卡住，也不影响节点监控/自愈/面板这条主链路。

const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const store = require('./store');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[pool-refresher] 找不到配置文件：${CONFIG_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// 发现28修复：真机实测过一次完整抓取（11598个源）耗时约25分钟。
// 如果 refreshIntervalHours 配置得比实际耗时短，旧代码没有任何保护，
// 会出现"上一轮还没跑完，下一轮定时任务又被触发"的重叠执行。
// 这里加一个简单的内存互斥锁：正在跑的时候，新触发的 tick 直接跳过，不排队、不堆积。
let isRefreshing = false;

async function tick(config) {
  if (!config.pool || !config.pool.enabled) {
    // 流量池功能没开启时，这个进程只是安静地待机，不做任何事、不占资源。
    return;
  }
  if (isRefreshing) {
    console.log(`[pool-refresher] ${new Date().toLocaleString('zh-CN')} 上一轮刷新还没跑完，本次触发被跳过（避免重叠执行）`);
    store.addEvent('pool_refresh_skipped_overlap', {});
    return;
  }
  isRefreshing = true;
  console.log(`[pool-refresher] ${new Date().toLocaleString('zh-CN')} 开始刷新流量池…`);
  try {
    const result = await pool.refreshPool(config);
    if (result.ok) {
      store.addEvent('pool_refreshed', { count: result.count });
      console.log(`[pool-refresher] 刷新完成，当前池子节点数：${result.count}`);
    } else if (!result.skipped) {
      store.addEvent('pool_refresh_failed', { error: result.error });
      console.error(`[pool-refresher] 刷新失败：${result.error}`);
    }
  } catch (err) {
    store.addEvent('pool_refresh_failed', { error: err.message });
    console.error('[pool-refresher] 刷新出错：', err);
  } finally {
    isRefreshing = false;
  }
}

async function main() {
  const config = loadConfig();

  if (!config.pool || !config.pool.enabled) {
    console.log('[pool-refresher] 流量池功能未启用（config.pool.enabled=false），进程待机中。');
  } else {
    console.log(
      `[pool-refresher] 流量池自动抓取已启动，每 ${config.pool.refreshIntervalHours || 6} 小时刷新一次`
    );
  }

  // 待机状态下也保持较长的检查间隔（1小时），这样如果用户后续手动把 config.pool.enabled 改成 true
  // 并重启进程，能在合理时间内生效；同时避免频繁读取配置文件。
  const idleIntervalMs = 60 * 60 * 1000;

  // 本轮修复(真实bug,复查发现):此前用的是一次性的 setInterval,轮询间隔在进程启动时
  // 就按当时的 config.pool.enabled 状态"定死"了——如果启动时pool是关闭的(走 idleIntervalMs
  // 也就是1小时),之后哪怕用户把 config.pool.enabled 改成 true、refreshIntervalHours 配成
  // 比如6小时,这个进程也只会继续每1小时轮询一次,永远不会变成6小时一次(tick()内部虽然
  // 每次都会重新loadConfig,能正确判断"现在该不该刷新",但外层轮询频率本身从没跟着变过)。
  // 后果:一次完整抓取实测要跑20~25分钟,配置里6小时一次的本意是要错开、节流,结果变成
  // 每小时都要跑一次完整抓取,跟文档里反复强调的"小内存服务器资源保护"直接矛盾。
  // 改成自我重新调度的 setTimeout 循环,每一轮结束后都重新读取最新配置,用当时真实的
  // enabled/refreshIntervalHours 决定下一次等多久,配置变化不需要重启进程就能生效。
  async function loop() {
    const freshConfig = loadConfig();
    await tick(freshConfig);
    const nextDelayMs = freshConfig.pool && freshConfig.pool.enabled
      ? (freshConfig.pool.refreshIntervalHours || 6) * 3600 * 1000
      : idleIntervalMs;
    setTimeout(loop, nextDelayMs);
  }

  await tick(config);
  const firstDelayMs = config.pool && config.pool.enabled
    ? (config.pool.refreshIntervalHours || 6) * 3600 * 1000
    : idleIntervalMs;
  setTimeout(loop, firstDelayMs);
}

main();
