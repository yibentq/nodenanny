#!/usr/bin/env bash
# 帮你查出服务器上真实在跑的代理服务，不管它是 systemd 管理的还是 Docker 容器，
# 这样 config.json 里的 node.restartCommand 才不是瞎填的。
#
# 用法：bash scripts/check-service.sh
# 语言跟随调用方 export 的 NN_LANG（install.sh 会自动传递），独立运行时默认中文。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=i18n.sh
source "$SCRIPT_DIR/i18n.sh"
NN_LANG="${NN_LANG:-zh}"

KEYWORDS='xray|sing-box|singbox|v2ray|hysteria|trojan|shadowsocks|ss-|clash'

echo "== $(m scan_systemd_title) =="
echo ""

SYSTEMD_FOUND=$(systemctl list-units --type=service --all --no-legend 2>/dev/null \
  | grep -Ei "$KEYWORDS")

# 发现3 修复：把扫描到的第一个候选 systemd 服务名写到一个约定的临时文件里，
# 供 install.sh 读取后直接带进问答的默认值/选项文案里，而不是只打印给人看却不复用。
# 只取第一列（服务名，形如 xray.service），去掉 .service 后缀。
CANDIDATE_FILE="/tmp/nodenanny-check-service-candidate.txt"
rm -f "$CANDIDATE_FILE"

if [ -n "$SYSTEMD_FOUND" ]; then
  echo "$SYSTEMD_FOUND"
  echo ""
  m scan_systemd_found
  FIRST_UNIT=$(echo "$SYSTEMD_FOUND" | head -n1 | awk '{print $1}' | sed 's/\.service$//')
  if [ -n "$FIRST_UNIT" ]; then
    echo "$FIRST_UNIT" > "$CANDIDATE_FILE"
  fi
else
  m scan_systemd_none
fi

echo ""
echo "== $(m scan_docker_title) =="
echo ""

if ! command -v docker >/dev/null 2>&1; then
  m scan_docker_not_installed
  DOCKER_FOUND=""
else
  # 容器名或镜像名任意一个匹配到关键词都算候选
  DOCKER_FOUND=$(docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null \
    | grep -Ei "$KEYWORDS")

  if [ -n "$DOCKER_FOUND" ]; then
    m scan_docker_columns
    echo "$DOCKER_FOUND"
    echo ""
    m scan_docker_found
  else
    m scan_docker_none
    m scan_docker_list_all
    echo ""
    docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null
  fi
fi

if [ -z "$SYSTEMD_FOUND" ] && [ -z "$DOCKER_FOUND" ]; then
  echo ""
  m scan_nothing_found
  echo ""
  systemctl list-units --type=service --state=running --no-legend
fi

echo ""
m scan_verify_title
m scan_verify_systemd
m scan_verify_docker
echo ""
m scan_verify_next
