#!/usr/bin/env bash
# NodeNanny 一键安装脚本
# 支持：Ubuntu 20.04/22.04/24.04、Debian 11/12
set -e

# 发现27修复（本轮真机测试发现）：真机上出现过安装到"流量池"这种耗时步骤
# （git clone + pip install）时，纯粹的网络抖动导致 SSH 连接断开
# （已用 uptime -s / last reboot / dmesg 排除是服务器自动重启或 OOM，
# 单纯就是网络断了），此时终端断开会给前台进程发 SIGHUP，
# 如果不处理，整个 install.sh 会被直接杀死，装到一半的东西不上不下。
# 这里忽略 SIGHUP：网络断线不会再杀死安装进程本身，它会在服务器上继续跑完；
# 如果断线时后面还有问答步骤没人来得及回答，会因为读不到输入自动走默认值
# 跳过/使用默认选项，不会卡死。仅靠这个不能保证"体验"完整
# （断线期间看不到过程输出），更稳妥的做法仍然是在服务器上用 tmux/screen
# 起一个会话再跑本脚本，这样断线重连后能 attach 回去继续看。
#
# 发现28修复（本轮真机测试发现）：只忽略 SIGHUP 还不够——233boy 装机那步是
# `bash <(curl ...) | tee "$NN_PROXY_LOG"`，输出同时写终端和写日志文件。断线时
# 终端(tty)会被关闭，tee 写终端这一路会触发 SIGPIPE，默认处理是直接终止 tee 进程；
# tee 一死，管道另一端的 233boy 安装脚本再往这个已经没有读端的管道写东西，也会
# 收到 SIGPIPE 被杀死——整个装节点流程就断在中间，日志文件自然是不完整的，
# 订阅链接抓不到，面板"原始节点订阅地址"显示未检测到，本质原因在这里，
# 不是解析正则的问题。这里把 SIGPIPE 也一并忽略，断线时 tee/233boy
# 写终端这一路失败也不会把整个进程杀死，能继续把完整日志写进文件。
trap '' HUP PIPE

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MIN_MAJOR=18

# shellcheck source=scripts/i18n.sh
source "$INSTALL_DIR/scripts/i18n.sh"

# ---------- 非交互/AI友好模式（v40新增）----------
# 详细设计说明和ask/ask_secret/ask_yn helper函数本体都在scripts/i18n.sh里
# （跟choose_language放在一起，因为两者都是"要不要真的调read"这同一层判断）。
# 这里只放一句面向阅读代码的人的提示：本文件从这里往下，所有原本的
# `read -rp`/`read -rsp` 都已经换成 `ask`/`ask_secret`/`ask_yn`，行为在
# NN_NONINTERACTIVE!=true时跟原来的read完全一样；NN_NONINTERACTIVE=true
# （或者stdin本来就不是终端）时才会走非交互分支。
choose_language

echo ""
m title
m installdir "$INSTALL_DIR"
echo ""
m safety_note
echo ""
# 本轮修复(复查发现:此前交接文档记录"已经加了终端提醒"，但实际检查代码后发现
# 从来没有真正接线——上面第6-24行的SIGHUP/SIGPIPE处理说明只写在代码注释里，
# 从来没有在这里调用m把它打印给终端里的人看过。断线重连后看到"安装完成"，
# 完全不知道中间有问答被默认值悄悄接管了。这里把它显示出来，不改变已有的
# "忽略SIGHUP/SIGPIPE、断线不杀进程"这个设计本身。)
m disconnect_warning
echo ""

if [ "$EUID" -ne 0 ]; then
  m root_required
  exit 1
fi

# ---------- 1. 检测系统 ----------
if [ -f /etc/os-release ]; then
  . /etc/os-release
  m os_detected "$PRETTY_NAME"
  case "$ID" in
    ubuntu|debian) ;;
    *) m os_warn_untested ;;
  esac
else
  m os_warn_unknown
fi

# ---------- 2. 安装 Node.js（如未安装或版本过低） ----------
need_install_node=true
if command -v node >/dev/null 2>&1; then
  current_major=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$current_major" -ge "$NODE_MIN_MAJOR" ]; then
    m node_found "$(node -v)"
    need_install_node=false
  else
    m node_low "$(node -v)"
  fi
fi

if [ "$need_install_node" = true ]; then
  m node_installing
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# ---------- 3. 安装 PM2 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  m pm2_installing
  npm install -g pm2
else
  m pm2_found
fi

# ---------- 3.5 安装编译工具链（build-essential/python3） ----------
# 本轮修复（全新服务器真机部署中发现的真实缺口）：在线终端功能依赖的 node-pty
# 是需要本地编译的原生模块（依赖 node-gyp），全新服务器上通常还没装 make/gcc
# 这类编译工具，导致下面"安装项目依赖"这一步 npm install 直接失败、整个安装
# 中断。这里提前检测，缺了就自动装上 build-essential + python3，装失败也不
# 中断整个安装流程（继续往下走，让人自己看到提示后手动补装）。
if command -v make >/dev/null 2>&1 && command -v gcc >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  m buildtools_found
else
  m buildtools_installing
  if ! (apt-get update -y && apt-get install -y build-essential python3) >/tmp/nodenanny-buildtools-install.log 2>&1; then
    m buildtools_install_failed
  fi
fi

# ---------- 4. 安装项目依赖 ----------
m deps_installing
cd "$INSTALL_DIR"
npm install --omit=dev

# 流量池的三层检测器(存活/测速/真实性验证)需要 sing-box 二进制作为检测后端
# (core/pool-checker.js 里硬依赖，缺了它每个候选节点都会在存活层直接报错)。
# 本轮修复(遗留欠账，之前几轮交接文档都记录过、一直没接线):不管流量池是通过
# 5b(legacy aggregator)还是5c(GitHub候选来源发现)哪一条路径启用的，都需要
# 这个二进制，所以做成一个幂等的独立函数，两边谁先启用了流量池就调用一次，
# 已经装过的话 command -v 直接短路，不会重复安装。
# 安装方式跟历史真机部署一致：SagerNet 官方 apt 源(deb.sagernet.org)，不是
# 第三方一键脚本。
# v21修复:这个函数定义本轮从"5b小节内部"挪到了脚本顶层作用域——原因见下面
# 5b/5c挪出大if块的说明,函数必须在任何执行路径下都存在,不能只在"config.json
# 还不存在"这条分支里才被定义。
install_singbox_if_needed() {
  if command -v sing-box >/dev/null 2>&1; then
    m singbox_found "$(sing-box version 2>/dev/null | head -1)"
    return 0
  fi
  m singbox_installing
  if (
    set -e
    command -v curl >/dev/null 2>&1 || (apt-get update -y && apt-get install -y curl)
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://sing-box.app/gpg.key -o /etc/apt/keyrings/sagernet.asc
    chmod a+r /etc/apt/keyrings/sagernet.asc
    {
      echo "Types: deb"
      echo "URIs: https://deb.sagernet.org/"
      echo "Suites: *"
      echo "Components: *"
      echo "Enabled: yes"
      echo "Signed-By: /etc/apt/keyrings/sagernet.asc"
    } | tee /etc/apt/sources.list.d/sagernet.sources >/dev/null
    apt-get update -y
    apt-get install -y sing-box
  ) >/tmp/nodenanny-singbox-install.log 2>&1; then
    m singbox_install_ok
    return 0
  else
    m singbox_install_failed
    return 1
  fi
}

# ---------- 5. 初始化配置文件（交互式问答，不需要手动编辑任何文件）----------
if [ ! -f "$INSTALL_DIR/config/config.json" ]; then
  echo ""
  echo "=================================================================="
  m config_intro
  echo "=================================================================="
  echo ""

  ask NN_NODE_NAME "$(m node_name_prompt)" "$(m node_name_default)"
  export NN_NODE_NAME="${NN_NODE_NAME:-$(m node_name_default)}"

  # ---------- 5a.（可选）自动部署 Xray 节点（233boy 一键脚本）----------
  # 发现1 修复（v14.0 真机测试）：此前这里用 233boy 脚本的退出码（exit code）当唯一开关，
  # 退出码非零就整体跳过端口/订阅链接解析——真机验证证明这个假设不成立：233boy 明明已经
  # 把节点信息完整打印出来了，退出码却是非零的。现在把"判断退出码"和"从日志内容解析信息"
  # 这两件事彻底解耦：不管退出码是什么，都先尝试正则解析；只有正则也解析不到任何东西时，
  # 退出码才用来决定要不要多打一句"确认失败"的警告。解析失败不会中断安装，只会退回手动输入。
  NN_DETECTED_PORT=""
  NN_SUBSCRIPTION_URL=""
  NN_PROXY_SKIPPED=""
  echo ""
  m proxy_title
  m proxy_explain
  ask_yn NN_PROXY_CHOICE "$(m proxy_ask)" "N"
  if [[ "$NN_PROXY_CHOICE" =~ ^[Yy]$ ]]; then
    m proxy_installing
    NN_PROXY_LOG="/tmp/nodenanny-proxy-install.log"
    bash <(curl -fsSL https://raw.githubusercontent.com/233boy/Xray/main/install.sh) 2>&1 | tee "$NN_PROXY_LOG"
    NN_PROXY_EXIT="${PIPESTATUS[0]}"

    # 发现15 修复（批次四第三轮真机测试）：此前这里先用"port|端口"模糊正则去日志全文里
    # 抓端口号，真机验证暴露出严重问题——这个正则只要求日志里出现"port"这四个字母连在一起，
    # 不要求是独立单词，import/support/report/transport 等无关英文词中间一旦附近有数字就会被
    # 误当成端口号抓走（真实案例：真实端口 29071，被误抓成 "41"）。错误端口写进 config.json
    # 后会导致 NodeNanny 永远监控一个不存在的端口、把好节点误判成坏节点、不断触发失败重启。
    # 现在改成优先从订阅链接（vless://user@host:port?...)里直接抠端口号——这个来源结构固定、
    # 远比在自由文本里做模糊正则可靠；只有链接本身解析不到端口时，才退回旧的模糊正则兜底。

    # 顺手从同一份 233boy 安装日志里解析出完整的订阅分享链接（vless:// 等），
    # 写入 NN_SUBSCRIPTION_URL，供下面的 write-config.js 写进 config.node.subscriptionUrl。
    # 只取日志里出现的第一条链接：233boy 一次装一个节点，理论上日志里只会有一条。
    #
    # 发现18 修复（批次四第三轮真机测试）：233boy 的终端输出带颜色，如果颜色重置符
    # （\x1b[0m 等 ANSI 控制符）紧跟在链接/标签后面、中间没有空白字符，会被下面这条
    # "抓到空白字符为止"的正则一起当成链接的一部分抓进来，最终变成节点名称显示时
    # 结尾拖着一截"[0m"的乱码尾巴。这里在抓取之前，先把整份日志里的 ANSI 颜色控制符
    # 统一剥离干净，再做后续解析，从根源上避免这类控制字符混进节点标签。
    NN_PROXY_LOG_CLEAN="$(sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$NN_PROXY_LOG")"
    NN_SUBSCRIPTION_URL="$(printf '%s\n' "$NN_PROXY_LOG_CLEAN" | grep -oE '(vless|vmess|ss|ssr|trojan|hysteria2?|tuic)://[^[:space:]]+' | head -n1)"
    if [ -n "$NN_SUBSCRIPTION_URL" ]; then
      export NN_SUBSCRIPTION_URL
      m proxy_sub_detected
    else
      m proxy_sub_not_detected
    fi

    # 优先尝试：从订阅链接的 host:port 部分直接抠出端口号。
    # 链接形如 scheme://uuid@host:port?query#fragment（IPv6 host 会带中括号 [::1]:port），
    # 先去掉 "scheme://uuid@" 前缀，再去掉第一个 /、?、# 之后的内容，剩下 host:port，
    # 最后取末尾连续数字即为端口——不管 host 是 IPv4/域名还是带中括号的 IPv6 都成立。
    NN_DETECTED_PORT=""
    if [ -n "$NN_SUBSCRIPTION_URL" ]; then
      NN_HOSTPORT="$(printf '%s' "$NN_SUBSCRIPTION_URL" \
        | sed -E 's#^[A-Za-z0-9+.-]+://[^@]*@##' \
        | sed -E 's#[/?#].*$##')"
      NN_DETECTED_PORT="$(printf '%s' "$NN_HOSTPORT" | grep -oE '[0-9]{1,5}$')"
    fi

    # 兜底：订阅链接没解析到、或者链接里没解析到端口，才退回旧的模糊正则在日志全文里找。
    # 这套正则仍然可能因为"port"子串误命中而抓错，只作为最后手段，不再是首选来源。
    if [ -z "$NN_DETECTED_PORT" ]; then
      # 注意 NN_PROXY_LOG_CLEAN 是已经读进内存的字符串，不是文件路径，
      # 要用 printf 管道传给 grep，不能直接当文件名传进去。
      NN_DETECTED_PORT="$(printf '%s\n' "$NN_PROXY_LOG_CLEAN" | grep -oiE '(port|端口)[^0-9]{0,10}[0-9]{2,5}' | grep -oE '[0-9]{2,5}' | head -n1)"
    fi

    if [ -n "$NN_DETECTED_PORT" ]; then
      m proxy_port_detected "$NN_DETECTED_PORT"
    else
      m proxy_port_not_detected
    fi

    # 退出码只在"内容也确实没解析到任何东西"时才用来提示彻底失败；
    # 如果退出码非零但内容里已经解析到了端口或订阅链接，只提醒一句，不当成失败处理。
    if [ "$NN_PROXY_EXIT" -ne 0 ]; then
      if [ -z "$NN_DETECTED_PORT" ] && [ -z "$NN_SUBSCRIPTION_URL" ]; then
        m proxy_install_failed
      else
        m proxy_exit_nonzero_but_parsed
      fi
    fi
  else
    m proxy_skip_note
    NN_PROXY_SKIPPED=1
  fi

  # 发现10 修复（本轮真机测试新发现）：跳过233boy自动装节点时，port_prompt 之前一直
  # 承诺"下一步会帮你自动查"，但代码里从没真正实现过端口自动检测——check-service.sh
  # 只查服务名/容器名，不查端口，导致用户直接回车会静默拿到错误的默认端口443（跟发现2
  # 是同一类问题）。这里补一次轻量的端口自动检测：用 ss -tlnp 找匹配关键词的代理进程
  # 正在监听的端口，找不到再如实告诉用户自动检测失败，而不是继续承诺代码做不到的事。
  #
  # 发现20 修复（用户真机第二轮测试新发现）：xray-core 常见部署会同时监听两个端口——
  # 一个是只绑在 127.0.0.1（回环地址）上的内部端口（通常给自己的统计/API用，不对外），
  # 另一个才是绑在 0.0.0.0/* 或具体公网IP上、真正对外服务的端口。真机上出现过：
  # ss -tlnp 里 127.0.0.1:57565（内部）排在 *:4629（真实对外端口）前面，旧逻辑直接
  # head -n1 抓第一条，抓到的是内部端口，跟发现15是同一类"抓到看起来像但其实不对的
  # 端口"问题，只是触发路径不同（这次是走 ss 扫描分支，不是走日志正则分支）。
  # 修复方式：扫描时先排除本地地址是 127.0.0.1 或 [::1]（IPv6回环）的行，只在剩下的
  # "对外监听"候选里取第一个端口。
  if [ -z "$NN_DETECTED_PORT" ]; then
    NN_PORT_SCAN="$(ss -tlnp 2>/dev/null \
      | grep -Ei 'xray|sing-box|singbox|v2ray|hysteria|trojan|shadowsocks|ss-|clash' \
      | grep -v '127\.0\.0\.1:' | grep -v '\[::1\]:' \
      | grep -oE ':[0-9]{2,5}[[:space:]]' | grep -oE '[0-9]{2,5}' | head -n1)"
    if [ -n "$NN_PORT_SCAN" ]; then
      NN_DETECTED_PORT="$NN_PORT_SCAN"
      m proxy_port_detected_by_scan "$NN_DETECTED_PORT"
    fi
  fi

  # 发现11 修复（批次四第三轮真机测试）：如果用户选择跳过233boy一键装节点（选N），
  # 脚本以前会无条件相信用户"已经自己装好了代理"，不做任何验证。真实情况可能是裸机，
  # 这样的话端口/服务名/订阅链接后面全会是空的或瞎填的，NodeNanny会一直监控不存在的东西、
  # 持续判定异常、不断触发失败重启——跟发现2/10是同一类"没验证就往下走"的问题。
  # 这里只在"用户选择跳过"且"ss扫描也确实什么都没扫到"这两个条件同时成立时才二次确认，
  # 避免对已经真机验证过、扫描到端口的正常情况多此一问。
  if [ -n "$NN_PROXY_SKIPPED" ] && [ -z "$NN_DETECTED_PORT" ]; then
    echo ""
    m proxy_skip_no_service_found
    ask_yn NN_SKIP_CONFIRM "$(m proxy_skip_confirm_prompt)" "N"
    if [[ ! "$NN_SKIP_CONFIRM" =~ ^[Yy]$ ]]; then
      m proxy_skip_abort
      if [ "$NN_NONINTERACTIVE" = "true" ]; then
        echo "[nodenanny] 非交互模式下检测不到任何代理服务、也没有显式设置 NN_SKIP_CONFIRM=Y，出于安全默认不继续（避免装出一个监控着不存在端口的实例）。确认要继续的话，加上 NN_SKIP_CONFIRM=Y 重跑。" >&2
      fi
      exit 1
    fi
  fi

  if [ -n "$NN_DETECTED_PORT" ]; then
    ask NN_CHECK_PORT "$(m port_prompt_detected "$NN_DETECTED_PORT")" "$NN_DETECTED_PORT"
    export NN_CHECK_PORT="${NN_CHECK_PORT:-$NN_DETECTED_PORT}"
  else
    ask NN_CHECK_PORT "$(m port_prompt)" "443"
    export NN_CHECK_PORT="${NN_CHECK_PORT:-443}"
  fi
  export NN_CHECK_HOST="127.0.0.1"

  echo ""
  m checking_services_title
  bash "$INSTALL_DIR/scripts/check-service.sh" || true
  echo ""

  # 发现3 修复：读取 check-service.sh 扫描到的候选 systemd 服务名，
  # 把它直接带进选项文案和默认值里，而不是让用户自己去把"刚才看到的服务名"跟"选项1"对上号。
  NN_CANDIDATE_FILE="/tmp/nodenanny-check-service-candidate.txt"
  NN_CANDIDATE_SERVICE=""
  if [ -f "$NN_CANDIDATE_FILE" ]; then
    NN_CANDIDATE_SERVICE="$(cat "$NN_CANDIDATE_FILE" 2>/dev/null)"
    rm -f "$NN_CANDIDATE_FILE"
  fi

  m mgmt_question
  if [ -n "$NN_CANDIDATE_SERVICE" ]; then
    m mgmt_opt1_candidate "$NN_CANDIDATE_SERVICE"
  else
    m mgmt_opt1
  fi
  m mgmt_opt2
  m mgmt_opt3
  ask NN_MGMT_TYPE "$(m mgmt_choose)" "1"
  NN_MGMT_TYPE="${NN_MGMT_TYPE:-1}"

  case "$NN_MGMT_TYPE" in
    2)
      ask NN_SERVICE_NAME "$(m docker_name_prompt)" "xray"
      export NN_SERVICE_NAME="${NN_SERVICE_NAME:-xray}"
      export NN_RESTART_CMD="docker restart ${NN_SERVICE_NAME}"
      # 修复记录：核验这个容器名是不是真的存在，不存在就警告+二次确认，
      # 跟下面 systemd 分支、以及已有的自定义命令路径检查是同一个模式。
      # 非交互模式说明：这里不是while循环，只会执行一次，所以不存在"卡死重复问"
      # 的风险——ask_yn默认给Y（继续用检测不到的这个名字），跟原来"人直接按回车
      # 走默认值"效果一致，不会无限循环，只是没有人能在这一步真的换一个更对的名字。
      if command -v docker >/dev/null 2>&1; then
        if ! docker inspect "$NN_SERVICE_NAME" >/dev/null 2>&1; then
          docker ps -a --format '  - {{.Names}}' 2>/dev/null
          m mgmt_docker_not_found "$NN_SERVICE_NAME"
          ask_yn NN_MGMT_CONFIRM "$(m custom_cmd_confirm_anyway)" "Y"
          if [[ ! "$NN_MGMT_CONFIRM" =~ ^[Yy]$ ]]; then
            ask NN_SERVICE_NAME "$(m docker_name_prompt)" "xray"
            export NN_SERVICE_NAME="${NN_SERVICE_NAME:-xray}"
            export NN_RESTART_CMD="docker restart ${NN_SERVICE_NAME}"
          fi
        fi
      else
        m mgmt_docker_unavailable "$NN_SERVICE_NAME"
      fi
      ;;
    3)
      ask NN_SERVICE_NAME "$(m custom_name_prompt)" "xray"
      export NN_SERVICE_NAME="${NN_SERVICE_NAME:-xray}"
      m custom_cmd_prompt
      # 发现3(b) 修复：如果填的是一条看起来像文件路径的命令，且这个路径在文件系统里
      # 并不存在，给一次二次确认，拦住"把题目示例文本原样抄成真实命令"这类低级错误。
      #
      # 非交互模式的真实风险点，本轮加固：这是本文件里唯一一处"校验失败就continue
      # 回去重新问"的while循环。如果NN_RESTART_CMD通过环境变量被设成了一个不存在的
      # 路径、且NN_CMD_CONFIRM又被显式设成非Y——ask()在非交互模式下不会真的重新
      # 读到不同的值（环境变量已经有值就不会被覆盖），会导致原本"continue回去再问
      # 一遍"的设计在这里变成真正的死循环。加一个明确的非交互模式出口：这种情况下
      # 不再continue，直接报错退出，而不是卡死。
      while true; do
        ask NN_RESTART_CMD "> " ""
        NN_CMD_FIRST_TOKEN="${NN_RESTART_CMD%% *}"
        if [[ "$NN_CMD_FIRST_TOKEN" == /* ]] && [ ! -e "$NN_CMD_FIRST_TOKEN" ]; then
          m custom_cmd_path_not_found "$NN_CMD_FIRST_TOKEN"
          ask_yn NN_CMD_CONFIRM "$(m custom_cmd_confirm_anyway)" "Y"
          if [[ "$NN_CMD_CONFIRM" =~ ^[Yy]$ ]]; then
            break
          fi
          if [ "$NN_NONINTERACTIVE" = "true" ]; then
            echo "[nodenanny] 非交互模式下 NN_RESTART_CMD=\"$NN_RESTART_CMD\" 指向的路径不存在，且 NN_CMD_CONFIRM 被显式设为否，没有人能在这里重新输入一个更对的命令，安装中止。请通过环境变量提供一个真实存在的 NN_RESTART_CMD 后重跑。" >&2
            exit 1
          fi
          continue
        fi
        break
      done
      export NN_RESTART_CMD
      ;;
    *)
      if [ -n "$NN_CANDIDATE_SERVICE" ]; then
        ask NN_SERVICE_NAME "$(m systemd_name_prompt_candidate "$NN_CANDIDATE_SERVICE")" "$NN_CANDIDATE_SERVICE"
        export NN_SERVICE_NAME="${NN_SERVICE_NAME:-$NN_CANDIDATE_SERVICE}"
      else
        ask NN_SERVICE_NAME "$(m systemd_name_prompt)" "xray"
        export NN_SERVICE_NAME="${NN_SERVICE_NAME:-xray}"
      fi
      export NN_RESTART_CMD="systemctl restart ${NN_SERVICE_NAME}"
      # 修复记录：核验这个 systemd 服务名是不是真的存在（systemctl cat 对不存在的
      # unit 会返回非零退出码，不管这个服务当前是运行中还是已停止都能正确识别存在性）。
      # 不存在就警告+二次确认，避免打错字直接静默往下走、装完才发现在监控一个不存在的服务。
      # (非交互模式说明同docker分支：这里不是while循环，只执行一次，ask_yn默认Y
      # 不会造成死循环。)
      if ! systemctl cat "$NN_SERVICE_NAME" >/dev/null 2>&1; then
        m mgmt_systemd_not_found "$NN_SERVICE_NAME"
        ask_yn NN_MGMT_CONFIRM "$(m custom_cmd_confirm_anyway)" "Y"
        if [[ ! "$NN_MGMT_CONFIRM" =~ ^[Yy]$ ]]; then
          ask NN_SERVICE_NAME "$(m systemd_name_prompt)" "xray"
          export NN_SERVICE_NAME="${NN_SERVICE_NAME:-xray}"
          export NN_RESTART_CMD="systemctl restart ${NN_SERVICE_NAME}"
        fi
      fi
      ;;
  esac

  echo ""
  m panel_pw_title
  # 面板密码是安全关键字段，非交互模式下不能沿用"没填就悄悄用空密码"这种退让——
  # 面板没密码等于服务器管理界面直接对公网敞开。这里单独处理：非交互模式必须
  # 已经通过环境变量 NN_PANEL_PASSWORD 提供了非空密码，没提供就直接报错退出，
  # 不静默继续；提供了就不需要再走"确认一遍"那道交互专属的手误保护（没有人在
  # 打字，也就没有"手滑打错第二遍"这个问题）。
  if [ "$NN_NONINTERACTIVE" = "true" ]; then
    if [ -z "${NN_PANEL_PASSWORD:-}" ]; then
      echo "[nodenanny] 非交互模式下必须通过环境变量 NN_PANEL_PASSWORD 提供一个非空的面板密码，不允许留空（留空等于面板对公网完全不设防）。请设置后重跑，例如：NN_NONINTERACTIVE=true NN_PANEL_PASSWORD='你的密码' bash install.sh" >&2
      exit 1
    fi
    printf '[non-interactive] NN_PANEL_PASSWORD = (已从环境变量读取，内容不打印)\n' >&2
  else
    while true; do
      read -rsp "$(m panel_pw_prompt)" NN_PANEL_PASSWORD
      echo ""
      if [ -z "$NN_PANEL_PASSWORD" ]; then
        m panel_pw_empty
        continue
      fi
      read -rsp "$(m panel_pw_confirm)" NN_PANEL_PASSWORD_CONFIRM
      echo ""
      if [ "$NN_PANEL_PASSWORD" != "$NN_PANEL_PASSWORD_CONFIRM" ]; then
        m panel_pw_mismatch
        continue
      fi
      break
    done
  fi
  export NN_PANEL_PASSWORD
  export NN_PANEL_PORT=8787
  export NN_PANEL_BINDHOST="127.0.0.1"

  echo ""
  m smtp_title
  m smtp_opt1
  m smtp_opt2
  m smtp_opt3
  m smtp_opt4
  m smtp_opt5
  ask SMTP_CHOICE "$(m smtp_choose)" "5"
  SMTP_CHOICE="${SMTP_CHOICE:-5}"

  case "$SMTP_CHOICE" in
    1) export NN_SMTP_HOST="smtp.qq.com"; export NN_SMTP_PORT=465; export NN_SMTP_SECURE=true
       m smtp_qq_note ;;
    2) export NN_SMTP_HOST="smtp.163.com"; export NN_SMTP_PORT=465; export NN_SMTP_SECURE=true
       m smtp_163_note ;;
    3) export NN_SMTP_HOST="smtp.gmail.com"; export NN_SMTP_PORT=465; export NN_SMTP_SECURE=true
       m smtp_gmail_note ;;
    4)
       # 发现7 修复：如果用户在"服务器地址（host）"这一项里填的内容包含 @ 符号，
       # 大概率是把"发信邮箱地址"当成了"SMTP 服务器地址"两个问题填混了，给一次警告确认。
       #
       # 非交互模式风险点，跟前面自定义重启命令那处一样：这是本文件第二处、
       # 也是最后一处"校验失败就continue回去重新问"的while循环。同样加一个
       # 非交互模式的明确出口，避免NN_SMTP_HOST_CONFIRM被显式设成非Y时死循环。
       while true; do
         ask NN_SMTP_HOST "$(m smtp_host_prompt)" ""
         if [[ "$NN_SMTP_HOST" == *"@"* ]]; then
           m smtp_host_looks_like_email "$NN_SMTP_HOST"
           ask_yn NN_SMTP_HOST_CONFIRM "$(m smtp_host_confirm_anyway)" "Y"
           if [[ "$NN_SMTP_HOST_CONFIRM" =~ ^[Yy]$ ]]; then
             break
           fi
           if [ "$NN_NONINTERACTIVE" = "true" ]; then
             echo "[nodenanny] 非交互模式下 NN_SMTP_HOST=\"$NN_SMTP_HOST\" 看起来是邮箱地址而不是SMTP服务器地址，且 NN_SMTP_HOST_CONFIRM 被显式设为否，没有人能在这里重新输入，安装中止。请通过环境变量提供正确的 NN_SMTP_HOST 后重跑。" >&2
             exit 1
           fi
           continue
         fi
         break
       done
       export NN_SMTP_HOST
       ask NN_SMTP_PORT "$(m smtp_port_prompt)" "465"; export NN_SMTP_PORT="${NN_SMTP_PORT:-465}"
       ask NN_SMTP_SECURE "$(m smtp_secure_prompt)" "true"
       export NN_SMTP_SECURE="${NN_SMTP_SECURE:-true}" ;;
    *) m smtp_skip_note ;;
  esac

  if [ "$SMTP_CHOICE" != "5" ]; then
    ask NN_SMTP_USER "$(m smtp_user_prompt)" ""
    export NN_SMTP_USER
    ask_secret NN_SMTP_PASS "$(m smtp_pass_prompt)" ""
    export NN_SMTP_PASS
    ask NN_SMTP_TO "$(m smtp_to_prompt)" "$NN_SMTP_USER"
    export NN_SMTP_TO="${NN_SMTP_TO:-$NN_SMTP_USER}"
    if [ "$NN_NONINTERACTIVE" = "true" ] && { [ -z "$NN_SMTP_USER" ] || [ -z "$NN_SMTP_PASS" ]; }; then
      echo "[nodenanny] 提示：SMTP已选择启用（SMTP_CHOICE=$SMTP_CHOICE），但 NN_SMTP_USER/NN_SMTP_PASS 至少有一项没有从环境变量拿到值——config.json里SMTP相关字段会先留空写入，装完之后记得手动补上再重启 nodenanny-monitor，否则邮件通知发不出去。" >&2
    fi
  fi

  echo ""
  m ai_title
  m ai_explain
  ask_yn NN_AI_CHOICE "$(m ai_ask)" "N"
  if [[ "$NN_AI_CHOICE" =~ ^[Yy]$ ]]; then
    export NN_AI_ENABLED=true
    m ai_opt1
    m ai_opt2
    ask NN_AI_PROVIDER_CHOICE "$(m ai_provider_choose)" "1"
    case "$NN_AI_PROVIDER_CHOICE" in
      2) export NN_AI_PROVIDER="openai" ;;
      *) export NN_AI_PROVIDER="anthropic" ;;
    esac
    ask_secret NN_AI_APIKEY "$(m ai_apikey_prompt)" ""
    export NN_AI_APIKEY
    ask NN_AI_MODEL "$(m ai_model_prompt)" ""
    export NN_AI_MODEL
    ask NN_AI_TRIGGER_AFTER "$(m ai_trigger_prompt)" "3"
    export NN_AI_TRIGGER_AFTER="${NN_AI_TRIGGER_AFTER:-3}"
    m ai_enabled_note
    if [ "$NN_NONINTERACTIVE" = "true" ] && [ -z "$NN_AI_APIKEY" ]; then
      echo "[nodenanny] 提示：AI诊断已选择启用，但 NN_AI_APIKEY 没有从环境变量拿到值——config.json里会先写成空key，AI诊断这个功能实际不会生效，装完后记得手动补上API Key再重启 nodenanny-panel。" >&2
    fi
  else
    export NN_AI_ENABLED=false
    m ai_skip_note
  fi

  # 发现8 修复：写入 config.json 之前，把关键字段汇总打印一遍，让用户有机会在写入前
  # 发现自己填错了（此前发现3、发现7都是"填错了但没有任何撤回机会"这同一个根源）。
  # 完整的"选N之后回到具体某一问重新填"实现起来会让整个脚本结构复杂很多，
  # 这里采用退而求其次的方案：选N就直接安全退出（config.json此时还没写入，
  # 重新运行一遍 install.sh 即可从头再答一遍，不会有残留的半成品配置）。
  echo ""
  echo "=================================================================="
  m confirm_summary_title
  echo "=================================================================="
  m confirm_summary_node "$NN_NODE_NAME"
  m confirm_summary_port "$NN_CHECK_PORT"
  m confirm_summary_service "$NN_SERVICE_NAME" "$NN_RESTART_CMD"
  if [ -n "$NN_PANEL_PASSWORD" ]; then
    m confirm_summary_panel_pw_set
  fi
  if [ "$SMTP_CHOICE" != "5" ]; then
    m confirm_summary_smtp "$NN_SMTP_HOST"
  else
    m confirm_summary_smtp_skipped
  fi
  if [ "$NN_AI_ENABLED" = "true" ]; then
    m confirm_summary_ai_on
  else
    m confirm_summary_ai_off
  fi
  echo ""
  ask NN_CONFIRM_SUMMARY "$(m confirm_summary_ask)" "Y"
  NN_CONFIRM_SUMMARY="${NN_CONFIRM_SUMMARY:-Y}"
  if [[ ! "$NN_CONFIRM_SUMMARY" =~ ^[Yy]$ ]]; then
    echo ""
    m confirm_summary_restart_hint
    exit 0
  fi

  echo ""
  node "$INSTALL_DIR/scripts/write-config.js"
  m config_written
else
  m config_exists_skip
fi

# ---------- 5b. 流量池（默认开启，不再询问是否启用）----------
# v21修复,对应两个真实问题:
# 1)【真实bug】此前5b/5c是写在"config.json不存在"这个大if块内部的——config.json
#   其实在5b/5c之前(write-config.js那一步)就已经生成了,如果5b(装aggregator,
#   git clone+pip install,耗时几分钟)执行到一半SSH断线,重连重跑install.sh时,
#   脚本检测到config.json已存在,会把5b/5c这一整段问答全部跳过,连问都不问,
#   流量池永远没机会真正装上——这正是这次真机复现的情况。改法:5b/5c挪到
#   config.json大if块外面,不再用"文件存不存在"当完成标记,改成直接读config.json
#   里pool.enabled当前的真实值——已经成功装过的话跳过、不重复装；没成功的话
#   (不管是这次全新装的、还是断线重跑的)都会重新尝试，具备断点续跑能力。
# 2)【创始人本轮明确要求】流量池默认开启，不再询问"要不要启用"，跳过这个选项，
#   直接尝试安装；GitHub候选来源发现(5c)属于"进阶功能"，保留原来的单独询问。
POOL_ALREADY_ENABLED="$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/config/config.json', 'utf-8'));
    console.log(c.pool && c.pool.enabled ? 'true' : 'false');
  } catch (e) {
    console.log('false');
  }
")"
if [ "$POOL_ALREADY_ENABLED" = "true" ]; then
  m pool_already_enabled
else
  echo ""
  m pool_title
  m pool_explain
  m pool_installing
  POOL_DIR="/root/aggregator"
  if (
    set -e
    command -v git >/dev/null 2>&1 || (apt-get update -y && apt-get install -y git)
    # 发现25修复：不能只在 python3 缺失时才装 python3-pip。
    # 真机上出现过 python3 本来就存在（系统自带），但 pip3 命令并不存在的情况，
    # 旧逻辑会因为"python3 已经找到"而跳过安装，导致后面 pip3 直接失败。
    # 这里改成分别检查 python3 和 pip3 两个命令本身。
    command -v python3 >/dev/null 2>&1 || (apt-get update -y && apt-get install -y python3)
    command -v pip3 >/dev/null 2>&1 || (apt-get update -y && apt-get install -y python3-pip)
    if [ ! -d "$POOL_DIR" ]; then
      git clone --depth 1 https://github.com/wzdnzd/aggregator.git "$POOL_DIR"
    fi
    cd "$POOL_DIR"
    pip3 install -r requirements.txt --break-system-packages 2>/dev/null || pip3 install -r requirements.txt
    # 本轮真机测试确认修复：即使上面这行看起来跑完了，requirements.txt 里的
    # tqdm 依赖仍然可能没有真正装上（真实报错：ModuleNotFoundError: tqdm，
    # 发生在实际执行 collect.py -s 时，不只是理论推测）。之前只加了下面的
    # --help 自检，这次真机验证不够可靠，这里额外显式补装一次 tqdm 兜底，
    # 不依赖 requirements.txt 这一份文件本身是否完整。
    pip3 install tqdm --break-system-packages 2>/dev/null || pip3 install tqdm
    # 发现26修复：pip install 退出码为0，不代表脚本真的能跑起来（真机实测过
    # ModuleNotFoundError: tqdm 这种要等 import 阶段才暴露的问题）。
    # 这里额外跑一次轻量的功能性自检：只触发 collect.py 的参数解析/顶层 import，
    # 不会真的跑完整抓取，能提前捕捉缺依赖的情况。
    # 诚实说明：--help 是否被 collect.py 支持，沙盒没有网络、没有真机验证过；
    # 如果真机上这一步报的是"unrecognized arguments"而不是 ModuleNotFoundError，
    # 说明自检参数本身需要调整，不代表依赖没装好，以 selfcheck 日志内容为准。
    python3 subscribe/collect.py --help >/tmp/nodenanny-pool-selfcheck.log 2>&1
    if grep -qi "ModuleNotFoundError\|ImportError" /tmp/nodenanny-pool-selfcheck.log; then
      echo "[pool-install] 功能性自检发现缺失的 Python 依赖，详见 /tmp/nodenanny-pool-selfcheck.log" >&2
      exit 1
    fi
  ) >/tmp/nodenanny-pool-install.log 2>&1; then
    NN_POOL_ENABLED=true node -e "
      const fs=require('fs');
      const p='$INSTALL_DIR/config/config.json';
      const c=JSON.parse(fs.readFileSync(p,'utf-8'));
      c.pool.enabled=true;
      c.pool.aggregatorDir='$POOL_DIR';
      fs.writeFileSync(p, JSON.stringify(c,null,2));
    "
    m pool_install_ok
    install_singbox_if_needed || true
  else
    m pool_install_failed
  fi
fi

# ---------- 5c. GitHub候选来源自动发现（可选，进阶功能，自愈生态，试验性功能）----------
# 跟5b彼此独立：这个功能本身不依赖wzdnzd/aggregator，是批次三新增的"自愈生态"能力
# (GitHub扫描+试用期状态机)。v21同样挪到大if块外面、改用config.json里discovery.enabled
# 的真实值当完成标记(原因同5b:避免断线重跑后被"文件已存在"误判成"已经问过了")。
# 这是"进阶功能"，创始人本轮明确要求保留询问，不跟5b一起默认开启。
DISCOVERY_ALREADY_ENABLED="$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/config/config.json', 'utf-8'));
    console.log(c.pool && c.pool.discovery && c.pool.discovery.enabled ? 'true' : 'false');
  } catch (e) {
    console.log('false');
  }
")"
if [ "$DISCOVERY_ALREADY_ENABLED" = "true" ]; then
  m discovery_already_enabled
else
  echo ""
  m discovery_title
  m discovery_explain
  ask_yn NN_DISCOVERY_CHOICE "$(m discovery_ask)" "N"
  if [[ "$NN_DISCOVERY_CHOICE" =~ ^[Yy]$ ]]; then
    m discovery_token_explain
    ask_secret NN_GITHUB_TOKEN "$(m discovery_token_ask)" ""
    # 用环境变量传给node -e，不在shell里把token拼进JS字符串——原因跟write-config.js
    # 顶部注释一样：token内容不可控，直接拼字符串遇到引号/反斜杠会把JSON拼坏。
    NN_GITHUB_TOKEN="${NN_GITHUB_TOKEN:-}" node -e "
      const fs=require('fs');
      const p='$INSTALL_DIR/config/config.json';
      const c=JSON.parse(fs.readFileSync(p,'utf-8'));
      c.pool.enabled=true;
      c.pool.discovery.enabled=true;
      c.pool.discovery.githubToken=process.env.NN_GITHUB_TOKEN || '';
      fs.writeFileSync(p, JSON.stringify(c,null,2));
    "
    m discovery_enabled_note
    install_singbox_if_needed || true
  else
    m discovery_skip_note
  fi
fi

# ---------- 5d. 手动种子来源（可选，跟5c的GitHub自动发现彼此独立）----------
# 本轮修复的真实缺口(交接文档反复记录过、此前一直没接线):config.example.json里
# 样例默认值其实已经带了几条创始人自己验证过的社区订阅(旺财等),但write-config.js
# 从来没写过manualSources这个字段,install.sh也从来没问过用户要不要用——导致
# 只有"手动改已经部署好的服务器config.json"这一条路能用上,新装的服务器永远
# 拿不到这几条来源。这里补上一个独立的问答步骤,跟5c一样用config.json里的真实值
# (而不是文件是否存在)当完成标记,支持断线重跑续接。
MANUAL_SOURCES_ALREADY_SET="$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/config/config.json', 'utf-8'));
    console.log((c.pool && Array.isArray(c.pool.manualSources) && c.pool.manualSources.length > 0) ? 'true' : 'false');
  } catch (e) {
    console.log('false');
  }
")"
if [ "$MANUAL_SOURCES_ALREADY_SET" = "true" ]; then
  m manual_source_already_enabled
else
  echo ""
  m manual_source_title
  m manual_source_explain
  ask_yn NN_MANUAL_SOURCE_CHOICE "$(m manual_source_ask)" "N"
  if [[ "$NN_MANUAL_SOURCE_CHOICE" =~ ^[Yy]$ ]]; then
    NN_POOL_MANUAL_SOURCES_ENABLED=true node -e "
      const fs=require('fs');
      const path=require('path');
      const p='$INSTALL_DIR/config/config.json';
      const c=JSON.parse(fs.readFileSync(p,'utf-8'));
      let manualSources=[];
      try {
        const example=JSON.parse(fs.readFileSync(path.join('$INSTALL_DIR','config','config.example.json'),'utf-8'));
        manualSources=(example.pool && Array.isArray(example.pool.manualSources)) ? example.pool.manualSources : [];
      } catch (e) {}
      c.pool.enabled=true;
      c.pool.manualSources=manualSources;
      fs.writeFileSync(p, JSON.stringify(c,null,2));
    "
    m manual_source_enabled_note
  else
    m manual_source_skip_note
  fi
fi


# ---------- 6. （已在 5a 步实现，此处不再需要）----------
# 233boy 一键装 Xray 的接入已经挪到第 5a 步（节点命名之后、端口问答之前），
# 会自动尝试跑 233boy 脚本并解析 xray info 输出取端口。
# 首次真机验证时如果发现 233boy 脚本参数/输出格式跟这里假设的不一样，改第 5a 步，不要在这里重新加逻辑。

# ---------- 7. 用 PM2 启动 ----------
m starting
pm2 start "$INSTALL_DIR/ecosystem.config.js"
pm2 save

# 发现"pm2 startup cosmetic bug"的真机验证结论：
# 老写法是 `pm2 startup ... | tail -n 1 | bash`，假设最后一行永远是一条要执行的 sudo 命令。
# 真机上用的是新版 PM2（7.0.3），它自己就会把 systemd 配置做完（内部执行 systemctl enable），
# 最后一行打印的其实是"如何撤销这个配置"的提示文字（例如 `$ pm2 unstartup systemd`），
# 不是要执行的命令——旧写法把这行提示喂给 bash 会报一个无害但吓人的错误。
# 这里改成：只有输出里真的出现一行以 sudo 开头的命令时，才去执行它（这是老版本 PM2
# 需要用户手动执行 sudo 命令的情况）；新版 PM2 自动处理完的情况，不再额外执行任何东西。
PM2_STARTUP_OUTPUT=$(pm2 startup systemd -u root --hp /root 2>&1) || true
echo "$PM2_STARTUP_OUTPUT"
SUDO_CMD=$(echo "$PM2_STARTUP_OUTPUT" | grep -m1 '^sudo ' || true)
if [ -n "$SUDO_CMD" ]; then
  eval "$SUDO_CMD" || true
fi
# 不管上面走了哪条分支，最后都重新冻结一次当前进程列表，
# 确保"服务器/PM2 重启后自动恢复"这件事真的生效，不依赖人手动再跑一次 pm2 save。
pm2 save

PANEL_PORT=$(node -e "console.log(require('$INSTALL_DIR/config/config.json').panel.port)")

echo ""
m install_done
m pm2_hint
echo ""

# ---------- 8. 自动配置面板访问方式（解决"装完看不到面板"的问题）----------
m access_title
m access_intro
echo ""
m access_opt1
m access_opt2
m access_opt3
ask NN_ACCESS_CHOICE "$(m access_choose)" "2"
NN_ACCESS_CHOICE="${NN_ACCESS_CHOICE:-2}"

SERVER_IP_HINT=$(curl -fsSL -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
ACCESS_OUTPUT=""
ACCESS_ATTEMPTED=false
ACCESS_STATUS=0
ACCESS_RETRY_CMD=""

case "$NN_ACCESS_CHOICE" in
  1)
    ask NN_DOMAIN "$(m access_domain_prompt)" ""
    # 域名没有一个"安全的默认值"可以兜底（不像端口/服务名那些至少有个合理猜测），
    # 非交互模式下如果选了"域名模式"却没给域名，与其往下传一个空字符串让
    # setup-reverse-proxy.sh用一种未经测试过的方式失败，不如在这里就报清楚。
    if [ "$NN_NONINTERACTIVE" = "true" ] && [ -z "$NN_DOMAIN" ]; then
      echo "[nodenanny] 非交互模式下 NN_ACCESS_CHOICE=1（域名模式）但没有提供 NN_DOMAIN，无法继续。请通过环境变量提供域名，或改用 NN_ACCESS_CHOICE=2（IP模式，无需域名）后重跑。" >&2
      exit 1
    fi
    ACCESS_ATTEMPTED=true
    ACCESS_RETRY_CMD="bash \"$INSTALL_DIR/scripts/setup-reverse-proxy.sh\" domain \"$NN_DOMAIN\""
    # 发现26修复（本轮真机测试发现）：原来这里用 `... || true`，子脚本因为
    # apt-get/dpkg 被占用等原因提前退出时，失败会被整个吞掉，下面的代码只看
    # "$ACCESS_OUTPUT 是否非空"，哪怕子脚本只吐出了一两行还没配置完的日志就
    # 挂了，也会被当成"跑过了"，导致后面无条件打印"已重启面板进程"，造成假成功。
    # 现在用 if 结构真实拿到 exit code，不再用 || true 掩盖。
    if ACCESS_OUTPUT=$(NN_LANG="$NN_LANG" bash "$INSTALL_DIR/scripts/setup-reverse-proxy.sh" domain "$NN_DOMAIN"); then
      ACCESS_STATUS=0
    else
      ACCESS_STATUS=$?
    fi
    ;;
  3)
    echo ""
    m ssh_tunnel_hint "$PANEL_PORT"
    echo "  ssh -L ${PANEL_PORT}:127.0.0.1:${PANEL_PORT} root@${SERVER_IP_HINT}"
    ;;
  *)
    ACCESS_ATTEMPTED=true
    ACCESS_RETRY_CMD="bash \"$INSTALL_DIR/scripts/setup-reverse-proxy.sh\" nodomain"
    if ACCESS_OUTPUT=$(NN_LANG="$NN_LANG" bash "$INSTALL_DIR/scripts/setup-reverse-proxy.sh" nodomain); then
      ACCESS_STATUS=0
    else
      ACCESS_STATUS=$?
    fi
    ;;
esac

if [ "$ACCESS_ATTEMPTED" = true ]; then
  [ -n "$ACCESS_OUTPUT" ] && echo "$ACCESS_OUTPUT"
  ACCESS_URL=$(echo "$ACCESS_OUTPUT" | grep 'NODENANNY_ACCESS_URL=' | cut -d= -f2-)
  ACCESS_NOTE=$(echo "$ACCESS_OUTPUT" | grep 'NODENANNY_ACCESS_NOTE=' | cut -d= -f2-)

  # 只有真的拿到 NODENANNY_ACCESS_URL 这一行，才算配置成功——不再仅凭
  # "子脚本跑过、没报错退出 install.sh" 就当作成功（ACCESS_STATUS 非0时
  # 也可能有部分输出，同样不能算成功，必须以有没有这一行为准）。
  if [ "$ACCESS_STATUS" -eq 0 ] && [ -n "$ACCESS_URL" ]; then
    echo ""
    echo "=================================================================="
    echo " $ACCESS_URL"
    echo "=================================================================="
    if [ "$ACCESS_NOTE" = "selfsigned" ]; then
      m selfsigned_note
    fi
    echo "$ACCESS_URL" > "$INSTALL_DIR/PANEL_ACCESS_URL.txt"
    m url_saved "$INSTALL_DIR/PANEL_ACCESS_URL.txt"

    # 修复记录(本轮真机测试发现)：nodenanny-panel 在上面第7步已经用 PM2 启动，把当时的
    # config.json 读进了内存缓存；setup-reverse-proxy.sh 是在那之后才运行、才把订阅专用
    # 地址(access.subUrlBase，nodomain 模式下才会写)写进 config.json 的。面板进程不会自动
    # 重新读取配置文件，如果不重启，会一直使用旧配置、订阅链接退回到错误的地址(跟面板本体
    # 同一个自签HTTPS端口)——这正好绕开了"发现23"当初专门为兼容 Shadowrocket 这类客户端
    # 做的方案。这里补一次重启：只有确认上面真的拿到访问地址、配置成功了才重启，
    # 避免子脚本压根没跑完时也去重启面板、还打印"已重启"这种误导性的成功提示。
    pm2 restart nodenanny-panel >/dev/null 2>&1 || true
    m panel_restarted_for_sub
  else
    echo ""
    echo "=================================================================="
    echo " [nodenanny] 面板访问方式没有配置成功（reverse-proxy 脚本提前退出，exit=${ACCESS_STATUS}）"
    echo " 面板进程本身仍在正常运行（PM2 没有动它），只是还不能从浏览器/手机直接访问。"
    echo " 常见原因：apt/dpkg 被其它进程占用（比如系统自带的 unattended-upgrades 正在跑），"
    echo " 等它结束或确认锁已释放后，手动重跑下面这条命令即可，不需要重装或重跑整个 install.sh："
    echo ""
    echo "   $ACCESS_RETRY_CMD"
    echo ""
    echo " 重跑后请确认输出里出现了 NODENANNY_ACCESS_URL= 这一行，才算真正配置成功。"
    echo "=================================================================="
  fi
fi

echo ""
m panel_pw_reminder
