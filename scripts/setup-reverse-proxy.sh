#!/usr/bin/env bash
# 自动配置"能直接在浏览器/手机上打开"的面板访问方式，被 install.sh 在最后一步调用。
#
# 用法：bash setup-reverse-proxy.sh <domain|nodomain> [域名]
# 依赖：NN_LANG（语言）、NN_PANEL_PORT（面板内部端口）应已由调用方 export。
#
# 目前状态：这个脚本还没有在真实服务器上跑通过完整流程（沙盒环境没有网络权限跑
# apt/certbot），逻辑是按 Nginx/certbot 标准用法写的，但第一次在真实服务器上用
# 时请留意输出，如果某一步失败，脚本会打印到哪一步失败，不会静默吞掉错误。

set -e

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$INSTALL_DIR/scripts/i18n.sh"
NN_LANG="${NN_LANG:-zh}"

MODE="$1"
DOMAIN="$2"

CONFIG_PATH="$INSTALL_DIR/config/config.json"
PANEL_PORT=$(node -e "console.log(require('$CONFIG_PATH').panel.port)")
PANEL_PASSWORD=$(node -e "console.log(require('$CONFIG_PATH').panel.password || '')")

# 新装的系统（尤其 Ubuntu 24.04 首次开机）几乎必然会自己跑 unattended-upgrades，
# 占着 dpkg lock 几分钟。之前的版本一撞上这个锁就直接失败退出，而这个锁本身只是
# 暂时的、不是真正的错误，所以这里改成等待+重试，而不是第一次拿不到锁就放弃。
wait_for_dpkg_lock() {
  local waited=0
  local max_wait=300 # 最多等5分钟，避免万一锁一直不释放时卡死不退出
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
    if [ "$waited" -eq 0 ]; then
      echo "[setup-reverse-proxy] dpkg 锁被占用（常见于系统刚装好、unattended-upgrades 在后台跑），等待释放..."
    fi
    if [ "$waited" -ge "$max_wait" ]; then
      echo "[setup-reverse-proxy] 等了 ${max_wait} 秒锁还没释放，放弃等待，继续尝试（大概率会失败，失败后请手动重跑本脚本）"
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done
}

ensure_nginx() {
  if ! command -v nginx >/dev/null 2>&1; then
    echo "[setup-reverse-proxy] installing nginx..."
    wait_for_dpkg_lock
    apt-get update -y >/dev/null 2>&1 || true
    wait_for_dpkg_lock
    apt-get install -y nginx
  fi
}

# 找一个当前没被占用的随机高位端口，减少被扫描器直接撞见的概率。
# 参数：调用方可以传入一个或多个"已经选中但还没真正开始监听"的端口号，跟这次
# 结果排重——ss 只能看到已经在监听的端口，看不到"刚被上一次调用选中、还没启动
# nginx"的端口，一次性起两个端口（本脚本 nodomain 模式就是这样）时如果不排重，
# 存在极小概率两次随机到同一个号。
pick_free_port() {
  local avoid=("$@")
  local tries=0
  local candidate
  local clash
  while [ "$tries" -lt 30 ]; do
    candidate=$(( (RANDOM % 40000) + 20000 ))
    clash=0
    for a in "${avoid[@]}"; do
      if [ "$candidate" = "$a" ]; then
        clash=1
        break
      fi
    done
    if [ "$clash" -eq 0 ] && ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${candidate}\$"; then
      echo "$candidate"
      return 0
    fi
    tries=$((tries + 1))
  done
  echo "28787" # 兜底：极小概率 30 次都撞上占用端口
}

setup_domain_mode() {
  echo "[setup-reverse-proxy] mode=domain domain=$DOMAIN"
  ensure_nginx
  if ! command -v certbot >/dev/null 2>&1; then
    wait_for_dpkg_lock
    apt-get install -y certbot python3-certbot-nginx
  fi

  cat > /etc/nginx/conf.d/nodenanny.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  nginx -t && systemctl reload nginx

  # 没有域名邮箱验证需求，用 --register-unsafely-without-email 避免多问一步；
  # 这只影响证书到期提醒邮件，不影响证书本身有效性。
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos \
    --register-unsafely-without-email || {
    echo "[setup-reverse-proxy] certbot failed — most likely the domain isn't pointing at this server's IP yet, or port 80 isn't reachable from the internet. HTTP-only access on port 80 still works while you fix DNS, then re-run: certbot --nginx -d ${DOMAIN}"
  }

  nginx -t && systemctl reload nginx
  echo "NODENANNY_ACCESS_URL=https://${DOMAIN}"
}

setup_nodomain_mode() {
  echo "[setup-reverse-proxy] mode=nodomain"
  ensure_nginx

  local EXT_PORT
  EXT_PORT=$(pick_free_port)

  mkdir -p /etc/nodenanny/ssl
  if [ ! -f /etc/nodenanny/ssl/cert.pem ]; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nodenanny/ssl/key.pem \
      -out /etc/nodenanny/ssl/cert.pem \
      -subj "/CN=nodenanny" >/dev/null 2>&1
  fi

  # Nginx 层再加一道密码（跟面板登录密码相同，用户只需要记一个密码）。
  # 用 openssl passwd 生成 htpasswd 兼容的哈希，避免额外安装 apache2-utils。
  local HTPASSWD_FILE="/etc/nodenanny/ssl/htpasswd"
  local HASH
  HASH=$(openssl passwd -apr1 "${PANEL_PASSWORD:-nodenanny}")
  echo "nodenanny:${HASH}" > "$HTPASSWD_FILE"

  # 发现23 修复（用户真机第四轮测试新发现，创始人拍板方向A）：自签证书这条路，浏览器能手动点
  # "继续访问"绕过去，但 Shadowrocket 这类靠 App 自动发 HTTP 请求拉订阅内容的客户端，遇到自签
  # 证书直接判定失败、没有任何"信任例外"入口——装系统级证书信任对非技术用户又太麻烦，违背"用户
  # 要能看懂、自己拿主意"这条核心目标。权衡后拍板：面板本体（人用浏览器访问、需要登录密码）继续
  # 走自签 HTTPS；但 /sub/:token 这个订阅接口单独开一个明文 HTTP 端口，只暴露这一个路径，其它
  # 路径一律拒绝。风险仅限于：如果有人在同一段网络里监听流量，理论上能看到这条订阅链接里的节点
  # UUID，对个人兴趣项目场景可接受（真出问题重新生成一下节点 UUID 就好，不涉及面板密码泄露）。
  local SUB_PORT
  SUB_PORT=$(pick_free_port "$EXT_PORT")

  cat > /etc/nginx/conf.d/nodenanny.conf <<EOF
server {
    listen ${EXT_PORT} ssl;
    server_name _;

    ssl_certificate     /etc/nodenanny/ssl/cert.pem;
    ssl_certificate_key /etc/nodenanny/ssl/key.pem;

    auth_basic "NodeNanny";
    auth_basic_user_file ${HTPASSWD_FILE};

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen ${SUB_PORT};
    server_name _;

    # 只放行 /sub/:token 这一个路径，其它路径（面板页面、/api/*）在这个明文端口上一律拒绝，
    # 避免有人绕开上面那个 HTTPS+Basic Auth 的端口、直接从这个明文端口访问面板本体或管理接口。
    location /sub/ {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
    }

    location / {
        return 404;
    }
}
EOF
  nginx -t && systemctl reload nginx

  local SERVER_IP
  SERVER_IP=$(curl -fsSL -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

  # 把这个专用的明文订阅地址写进 config.json 的 access.subUrlBase 字段，面板后端
  # （core/panel-server.js 的 /api/subscription-info）会优先用这个字段拼订阅链接，
  # 而不是从当前请求（走 HTTPS 那个端口）反推，避免拼出协议/端口都不对的地址。
  node -e "
    const fs = require('fs');
    const p = '$CONFIG_PATH';
    const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
    c.access = c.access || {};
    c.access.subUrlBase = 'http://${SERVER_IP}:${SUB_PORT}';
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  "

  echo "NODENANNY_ACCESS_URL=https://${SERVER_IP}:${EXT_PORT}"
  echo "NODENANNY_ACCESS_NOTE=selfsigned"
  echo "NODENANNY_SUB_URL_BASE=http://${SERVER_IP}:${SUB_PORT}"
}

case "$MODE" in
  domain) setup_domain_mode ;;
  nodomain) setup_nodomain_mode ;;
  *) echo "unknown mode: $MODE" >&2; exit 1 ;;
esac
