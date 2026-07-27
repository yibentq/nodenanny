'use strict';

const fs = require('fs');
const path = require('path');
const { runCheck } = require('./checker');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(
      `[monitor] 找不到配置文件：${CONFIG_PATH}\n` +
      '请先复制 config/config.example.json 为 config/config.json 并填好内容。'
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

async function tick(config) {
  try {
    const result = await runCheck(config);
    console.log(`[monitor] ${new Date().toLocaleString('zh-CN')} 检测完成，状态：${result.status}`);
  } catch (err) {
    console.error('[monitor] 本次检测出错：', err);
  }
}

async function main() {
  const config = loadConfig();
  const intervalMs = (config.monitor.checkIntervalMinutes || 5) * 60 * 1000;

  console.log(`[monitor] NodeNanny 监控已启动，节点：${config.node.name}，检测间隔 ${config.monitor.checkIntervalMinutes} 分钟`);

  // 启动后立即跑一次，不用等第一个间隔
  await tick(config);
  setInterval(() => tick(config), intervalMs);
}

main();
