#!/usr/bin/env bash
# NodeNanny 卸载脚本
set -e

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== NodeNanny 卸载 =="

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete nodenanny-monitor 2>/dev/null || true
  pm2 delete nodenanny-panel 2>/dev/null || true
  # 修复(自查发现,不在原方案里):项目在批次三之后其实是三个常驻PM2进程
  # (见ecosystem.config.js:monitor/panel/pool),但这个卸载脚本一直只删了前两个,
  # 是流量池那批加进来之后卸载脚本没有同步更新导致的——执行卸载后nodenanny-pool
  # (流量池定时刷新进程)会被落下继续跑，不是真正意义上的卸载干净。
  pm2 delete nodenanny-pool 2>/dev/null || true
  pm2 save
  echo "已停止并移除 PM2 中的 NodeNanny 进程。"
else
  echo "未检测到 PM2，跳过进程清理。"
fi

read -r -p "是否同时删除配置文件和历史数据（config/config.json、data/）？[y/N] " confirm
if [[ "$confirm" =~ ^[Yy]$ ]]; then
  rm -f "$INSTALL_DIR/config/config.json"
  rm -rf "$INSTALL_DIR/data"
  echo "配置文件和历史数据已删除。"
else
  echo "已保留配置文件和历史数据，仅停止了运行中的进程。"
fi

echo ""
echo "注意：本脚本不会卸载 Xray/sing-box 节点本体，也不会卸载 Node.js/PM2（它们可能被其他项目使用）。"
echo "如需彻底删除 NodeNanny 项目文件，请手动执行：rm -rf $INSTALL_DIR"
