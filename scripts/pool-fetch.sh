#!/usr/bin/env bash
# pool-fetch.sh —— 流量池抓取的执行入口
#
# 作用：进到本地已经装好的 wzdnzd/aggregator 目录，跑一次抓取命令，
# 把抓到的节点链接文件内容打印到 stdout，交给 core/pool.js 读取解析。
#
# 【诚实说明，务必看完】
# aggregator 是 Python 项目，抓取命令、输出文件名会随它自己的版本变化，
# 沙盒环境没有网络、没有真实跑过这个脚本，下面的命令和文件名是根据
# aggregator 官方 README 目前公开的用法写的（本地模式：
# `python subscribe/collect.py -s`，默认输出在 data/ 目录下的 v2ray.txt），
# 但没有在真实环境验证过，跑不通是预期内可能发生的情况，不代表 NodeNanny
# 其它部分有问题。如果在你的服务器上文件名或命令对不上，改这一个文件就够了，
# 不需要动 core/pool.js。
#
# 用法：pool-fetch.sh <aggregator目录> <抓取命令> <输出文件相对路径>
# 例：  pool-fetch.sh /root/aggregator "python3 subscribe/collect.py -s" data/v2ray.txt

set -uo pipefail

AGG_DIR="${1:-}"
FETCH_CMD="${2:-python3 subscribe/collect.py -s}"
OUT_FILE="${3:-data/v2ray.txt}"

if [ -z "$AGG_DIR" ]; then
  echo "[pool-fetch] Missing aggregator directory argument" >&2
  exit 1
fi

if [ ! -d "$AGG_DIR" ]; then
  echo "[pool-fetch] Directory does not exist: $AGG_DIR (backup pool requires wzdnzd/aggregator to be installed first, see README)" >&2
  exit 1
fi

cd "$AGG_DIR" || exit 1

# 抓取命令本身允许失败（比如某个上游源临时抓不到），
# 只要输出文件里还有上次成功抓到的节点，就继续用旧数据，不整体判失败。
eval "$FETCH_CMD" >/tmp/nodenanny-pool-fetch.log 2>&1
FETCH_EXIT=$?

if [ ! -f "$OUT_FILE" ]; then
  echo "[pool-fetch] Fetch command exited with code $FETCH_EXIT, and output file not found: $AGG_DIR/$OUT_FILE" >&2
  echo "[pool-fetch] Fetch log: /tmp/nodenanny-pool-fetch.log" >&2
  exit 2
fi

# 成功与否都把当前文件内容吐出去（哪怕是旧数据，也好过完全没有备用节点）
cat "$OUT_FILE"

if [ "$FETCH_EXIT" -ne 0 ]; then
  echo "[pool-fetch] Warning: fetch command exited with non-zero code ($FETCH_EXIT); the above is stale data from the last successful fetch" >&2
fi

exit 0
