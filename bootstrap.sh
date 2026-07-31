#!/usr/bin/env bash
# NodeNanny 一键引导脚本 —— 给一台全新服务器用的最小起点。
#
# 推荐用法（一行命令，全新服务器上用 root 跑）：
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/yibentq/nodenanny/main/bootstrap.sh)
#
# 为什么必须用 `bash <(curl ...)` 这种"进程替换"写法，而不是更常见的
# `curl ... | bash` 管道写法：如果用管道，本脚本的内容本身会占用掉 stdin，
# 后面 install.sh 里十几处 `read`（问节点信息、SMTP、AI Key 等）会读不到你的
# 键盘输入，要么读到空值、要么直接卡住——这正是"一键部署"最容易踩的坑。
# 用进程替换的写法，脚本内容通过一个临时文件描述符传入，stdin 全程保持是你的
# 真实终端，跟直接下载脚本再手动运行效果完全一样。
#
# 这个脚本本身只做三件事：确认 git 存在（没有就自动装）-> clone 仓库 -> cd 进去
# 交给 install.sh。真正的安装问答（节点信息/SMTP/AI诊断/流量池/在线终端等）
# 全部在 install.sh 里，这里不重复、也不提前拦截任何问题。

set -e

REPO_URL="https://github.com/yibentq/nodenanny.git"
TARGET_DIR="${NN_BOOTSTRAP_DIR:-$HOME}/nodenanny"

echo "[nodenanny-bootstrap] ============================================"
echo "[nodenanny-bootstrap] NodeNanny 一键引导：git -> clone -> install.sh"
echo "[nodenanny-bootstrap] ============================================"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "[nodenanny-bootstrap] 请用 root 权限运行本脚本，例如：" >&2
  echo "  sudo bash <(curl -fsSL https://raw.githubusercontent.com/yibentq/nodenanny/main/bootstrap.sh)" >&2
  exit 1
fi

echo "[nodenanny-bootstrap] 步骤 1/3：检查 git 是否已安装"
if command -v git >/dev/null 2>&1; then
  echo "[nodenanny-bootstrap] git 已存在，跳过安装。"
else
  echo "[nodenanny-bootstrap] 没有找到 git，正在自动安装..."
  if command -v apt-get >/dev/null 2>&1; then
    # 跟install.sh同样的修复：关掉apt交互确认，避免needrestart弹窗看起来像卡住。
    export DEBIAN_FRONTEND=noninteractive
    export NEEDRESTART_MODE=a
    apt-get update -y
    apt-get install -y git
  else
    echo "[nodenanny-bootstrap] 这台服务器看起来不是基于 apt 的系统（不是 Ubuntu/Debian），" >&2
    echo "[nodenanny-bootstrap] 没法自动安装 git。请手动安装 git 后，重新运行这条命令。" >&2
    exit 1
  fi
fi

echo ""
echo "[nodenanny-bootstrap] 步骤 2/3：拉取 NodeNanny 代码到 $TARGET_DIR"
if [ -d "$TARGET_DIR/.git" ]; then
  echo "[nodenanny-bootstrap] 发现 $TARGET_DIR 已经是一个 git 仓库了，跳过 clone，直接使用现有目录。"
  echo "[nodenanny-bootstrap] （如果你想要全新 clone 一份，先把这个文件夹改名/删掉，再重跑这条命令。）"
elif [ -e "$TARGET_DIR" ]; then
  echo "[nodenanny-bootstrap] $TARGET_DIR 已经存在，但不是一个 git 仓库——为避免覆盖你已有的东西，" >&2
  echo "[nodenanny-bootstrap] 这里中止安装。可以设置 NN_BOOTSTRAP_DIR=/其他路径 后重跑，" >&2
  echo "[nodenanny-bootstrap] 或者自己确认后删掉/改名这个目录再重跑。" >&2
  exit 1
else
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

echo ""
echo "[nodenanny-bootstrap] 步骤 3/3：进入目录，交给 install.sh 继续"
echo "[nodenanny-bootstrap] 接下来会开始正常的安装问答（节点信息/SMTP/AI诊断/流量池/在线终端等）。"
echo ""
cd "$TARGET_DIR"
exec bash install.sh
