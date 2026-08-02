#!/usr/bin/env bash
# NodeNanny 安装流程的终端多语言词典（中/英/日/德/俄）。
# 被 install.sh 和 setup-reverse-proxy.sh source 使用，不要单独执行。
#
# 用法：
#   source "$(dirname "$0")/i18n.sh"
#   choose_language          # 交互式选语言，写入全局变量 NN_LANG
#   m key                    # 打印 key 对应当前语言的文案
#   m key arg1 arg2          # 部分文案带占位符 %s，会按顺序替换
#
# 加新文案时：五种语言都要补，宁可先写一个粗糙的机翻占位，也不要漏掉某个语言
# （面板本体 public/index.html 的 I18N 字典同理，两边保持语言代码一致：zh/en/ja/de/ru）。

declare -A MSG

# ---------- 非交互/AI友好模式（v40新增，此前一直在交接文档"明确范围外"清单里，
# 本轮由founder亲口要求实现）----------
# 背景：install.sh从头到尾是纯交互式的——十几处read -rp/read -rsp，专门给"人坐在
# 终端前一步步回答"设计。如果AI/脚本想自动化跑这个安装（比如CI、批量部署、或者
# 别的AI agent代掉人去操作），没有任何办法跳过这些问答，卡在第一个read就动不了。
#
# 设计思路：不改变默认行为——什么都不设置的时候，跟以前一模一样，正常交互问答。
# 只有满足下面任一条件才会切换成非交互模式：
#   1) 显式设置 NN_NONINTERACTIVE=true（推荐：AI/脚本调用方明确声明意图，而不是
#      靠环境自动猜，这样行为可预期、可复现）；
#   2) stdin本身就不是一个真终端（[ ! -t 0 ]，比如整个install.sh是被管道/heredoc/
#      CI runner调用的）——这种情况下就算不显式声明，read也读不到真人输入，
#      与其卡死等一个永远不会来的回车，不如自动退到非交互模式，这也是很多成熟
#      安装脚本（比如nvm、rustup的--yes）的通行做法。
# 非交互模式下的核心原则：
#   - 任何一个问答，如果调用install.sh之前已经通过环境变量（NN_XXX=... bash install.sh）
#     把值传进来了，尊重这个值，不覆盖；
#   - 没传的，退到该问题原本就有的默认值（跟交互模式下直接按回车走默认值的效果
#     完全一致，只是不用人真的按回车）；
#   - 每一步实际用了什么值，都打印到stderr（不是"静默魔法"，运行日志里能看到
#     每个变量最终生效的值，方便排查是不是传参传错了）；密码/API Key类字段只
#     打印"有没有拿到"，不打印内容本身。
#   - 有效性校验失败又没法再问一遍人的情况（比如自定义命令路径不存在、docker
#     容器名不存在），非交互模式下不阻塞死等，改成打印醒目警告后继续（跟founder
#     一贯"宁可不阻断整个安装流程，让人自己看提示后续手动处理"的原则一致）——
#     具体在install.sh里每个校验循环内部单独处理，这里的通用helper只负责
#     "要不要真的调read"这一层。
# 诚实说明：这一整套非交互模式的每个分支逻辑，本轮都用纯bash做过脱离真实服务器
# 环境的行为验证（模拟各种环境变量组合、跑ask/ask_secret/ask_yn本身的判断逻辑），
# 但没有在真实全新服务器上完整跑过一遍non-interactive的install.sh——这跟这个
# 项目里其它"沙盒里验证过逻辑、真机效果待确认"的改动是同一个诚实标准，不是说
# 逻辑本身没有被检查过。
NN_NONINTERACTIVE="${NN_NONINTERACTIVE:-false}"
if [ ! -t 0 ] && [ "$NN_NONINTERACTIVE" != "true" ]; then
  NN_NONINTERACTIVE=true
fi
export NN_NONINTERACTIVE

# ---------- 问答提示颜色（本轮founder要求新增）----------
# 只在真正的终端上启用（[ -t 1 ]），避免输出被重定向到日志文件时，文件里混进
# 一堆看不懂的 ANSI 转义码。分两级：
#   黄色：密码/API Key/Token 这类需要妥善保管的输入提示（ask_secret 自动套用）；
#   红色：风险确认类问题——检测到的东西看起来不太对，但要不要仍然继续
#     （比如没检测到代理服务、自定义命令路径不存在、SMTP host看起来像邮箱），
#     单独用 ask_yn_risky 调用，跟普通"要不要开启某功能"的问题区分开。
# 非交互模式下不会真的 read，不需要颜色，两个 helper 内部只在交互分支里用色。
if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_YELLOW=$'\033[1;33m'
  C_RED=$'\033[1;31m'
else
  C_RESET=''
  C_YELLOW=''
  C_RED=''
fi

# ask <变量名> "<交互提示文字>" ["<非交互模式下的默认值>"]
# 交互模式：跟原来的 `read -rp "$prompt" VAR` 完全一样。
# 非交互模式：不调用read（不去猜stdin里到底有没有内容、猜错了行为诡异），
# 变量原本已经有值（说明调用方通过环境变量传进来了）就保留，没有就用默认值，
# 然后把最终值打印到stderr方便查日志。用bash的nameref（`local -n`，
# bash 4.3+都支持，Ubuntu 20.04/Debian 11起自带的bash都够新）实现变量间接赋值，
# 不用eval拼字符串（更不容易因为值里带特殊字符而拼出语法错误）。
ask() {
  local -n __ask_ref="$1"
  local __ask_prompt="$2"
  local __ask_default="${3-}"
  if [ "$NN_NONINTERACTIVE" = "true" ]; then
    if [ -z "${__ask_ref:-}" ]; then __ask_ref="$__ask_default"; fi
    printf '[non-interactive] %s = %s\n' "$1" "${__ask_ref:-<空>}" >&2
  else
    read -rp "$__ask_prompt" __ask_ref
    # 本轮修复（Addendum 8 bug#1）：此前交互模式下直接按回车、不输入任何内容时，
    # __ask_ref 会是空字符串，第三个参数指定的默认值从未被应用——跟非交互分支的
    # 行为不一致，也跟提示文字里写的"[默认：xxx]"对不上。这里补上跟非交互分支
    # 完全一致的空值回退逻辑，让"交互模式按回车"和"非交互模式不传值"最终效果相同。
    if [ -z "${__ask_ref:-}" ]; then __ask_ref="$__ask_default"; fi
  fi
}

# ask_secret：跟ask一样，但适用于密码/API Key这类不该出现在任何日志里的字段——
# 非交互模式下只打印"有没有拿到值"，绝不打印值本身；交互模式下跟原来的
# `read -rsp` 一样不回显输入。
ask_secret() {
  local -n __asks_ref="$1"
  local __asks_prompt="$2"
  local __asks_default="${3-}"
  if [ "$NN_NONINTERACTIVE" = "true" ]; then
    if [ -z "${__asks_ref:-}" ]; then __asks_ref="$__asks_default"; fi
    if [ -n "${__asks_ref:-}" ]; then
      printf '[non-interactive] %s = (已从环境变量读取，内容不打印)\n' "$1" >&2
    else
      printf '[non-interactive] %s = (未设置，留空)\n' "$1" >&2
    fi
  else
    read -rsp "${C_YELLOW}${__asks_prompt}${C_RESET}" __asks_ref
    echo ""
  fi
}

# ask_yn：跟ask一样，专门给Y/n这类确认型问题用，第三个参数是非交互模式下的
# 默认答案（"Y"或"N"这种，跟原脚本里各处判断`[[ "$X" =~ ^[Yy]$ ]]`保持同一套写法）。
ask_yn() {
  local -n __asky_ref="$1"
  local __asky_prompt="$2"
  local __asky_default="${3:-N}"
  if [ "$NN_NONINTERACTIVE" = "true" ]; then
    if [ -z "${__asky_ref:-}" ]; then __asky_ref="$__asky_default"; fi
    printf '[non-interactive] %s = %s\n' "$1" "${__asky_ref}" >&2
  else
    read -rp "$__asky_prompt" __asky_ref
    # 本轮修复（Addendum 8 bug#1，同ask()）：交互模式按回车时补上默认值回退。
    if [ -z "${__asky_ref:-}" ]; then __asky_ref="$__asky_default"; fi
  fi
}

# ask_yn_risky：跟ask_yn完全一样，只是交互模式下提示文字会用红色高亮——专门给
# "检测到的东西看起来不太对，但还是要不要继续"这类风险确认用（比如没检测到代理
# 服务、自定义命令路径不存在、SMTP host看起来像邮箱地址），跟普通的"要不要开启
# 某个功能"问题区分开，方便用户一眼看出这里要多想一下再回答，不要习惯性回车。
ask_yn_risky() {
  local -n __askyr_ref="$1"
  local __askyr_prompt="$2"
  local __askyr_default="${3:-N}"
  if [ "$NN_NONINTERACTIVE" = "true" ]; then
    if [ -z "${__askyr_ref:-}" ]; then __askyr_ref="$__askyr_default"; fi
    printf '[non-interactive] %s = %s\n' "$1" "${__askyr_ref}" >&2
  else
    read -rp "${C_RED}${__askyr_prompt}${C_RESET}" __askyr_ref
    # 本轮修复（Addendum 8 bug#1，同ask()）：交互模式按回车时补上默认值回退。
    if [ -z "${__askyr_ref:-}" ]; then __askyr_ref="$__askyr_default"; fi
  fi
}

choose_language() {
  # 非交互模式：不弹语言选择菜单（没有人看得到，弹了也没意义）。
  # 直接尊重外部预先设置的NN_LANG（校验必须是五种支持语言之一，否则退回zh），
  # 没设置就默认中文——理由：founder是中文母语，这个脚本的主要真实使用场景
  # 目前还是中文用户，中文兜底比英文兜底更符合实际；如果调用方是别的语言的
  # 用户/AI，本来就应该显式传NN_LANG，不依赖这个默认值。
  if [ "$NN_NONINTERACTIVE" = "true" ]; then
    case "${NN_LANG:-}" in
      zh|en|ja|de|ru) : ;; # 已经是合法值，不动
      *) NN_LANG=zh ;;
    esac
    export NN_LANG
    printf '[non-interactive] NN_LANG = %s\n' "$NN_LANG" >&2
    return 0
  fi
  echo ""
  echo "Choose language / 选择语言 / 言語を選択 / Sprache wählen / Выберите язык"
  echo "  1) 中文"
  echo "  2) English"
  echo "  3) 日本語"
  echo "  4) Deutsch"
  echo "  5) Русский"
  read -rp "[1-5, default 1]: " _lang_choice
  case "${_lang_choice:-1}" in
    2) NN_LANG=en ;;
    3) NN_LANG=ja ;;
    4) NN_LANG=de ;;
    5) NN_LANG=ru ;;
    *) NN_LANG=zh ;;
  esac
  export NN_LANG
}

# m <key> [args...] —— 取当前语言文案，缺失则回退英文，再缺失则原样打印 key
m() {
  local key="$1"; shift || true
  local text="${MSG[${NN_LANG}:${key}]}"
  if [ -z "$text" ]; then text="${MSG[en:${key}]}"; fi
  if [ -z "$text" ]; then text="$key"; fi
  if [ "$#" -gt 0 ]; then
    printf "$text\n" "$@"
  else
    printf "%s\n" "$text"
  fi
}

# ---------- 通用 / 安装流程 ----------
MSG[zh:title]="== NodeNanny 安装开始 =="
MSG[en:title]="== NodeNanny Setup =="
MSG[ja:title]="== NodeNanny セットアップ開始 =="
MSG[de:title]="== NodeNanny-Einrichtung =="
MSG[ru:title]="== Установка NodeNanny =="

MSG[zh:installdir]="安装目录：%s"
MSG[en:installdir]="Install directory: %s"
MSG[ja:installdir]="インストール先: %s"
MSG[de:installdir]="Installationsverzeichnis: %s"
MSG[ru:installdir]="Каталог установки: %s"

MSG[zh:safety_note]="这个脚本是开源代码（可以打开 install.sh 用记事本/nano 看内容），需要 root 权限是因为要装软件、开端口、重启服务，属于正常操作，不会做其他事情。"
MSG[en:safety_note]="This script is open source (open install.sh in any text editor to read it). It needs root only to install packages, open a port, and restart services — nothing else."
MSG[ja:safety_note]="このスクリプトはオープンソースです（install.sh をテキストエディタで開けば内容を確認できます）。root権限が必要なのはソフトのインストール・ポート開放・サービス再起動のためだけで、それ以外のことはしません。"
MSG[de:safety_note]="Dieses Skript ist Open Source (öffne install.sh in einem Texteditor, um es zu lesen). Root wird nur benötigt, um Pakete zu installieren, einen Port zu öffnen und Dienste neu zu starten – sonst nichts."
MSG[ru:safety_note]="Этот скрипт с открытым исходным кодом (можно открыть install.sh в текстовом редакторе и прочитать). Права root нужны только для установки пакетов, открытия порта и перезапуска служб — больше ничего."

MSG[zh:disconnect_warning]="提示：如果安装过程中和服务器断开连接（比如网络抖动），脚本不会被中断，会在服务器上自动继续跑完；但断线期间如果正好卡在某个问答步骤，会因为读不到你的输入自动按默认值处理，不会等你重连后再问。建议用 tmux 或 screen 开一个会话再运行本脚本——这样断线重连后可以用 tmux attach 接回去，不会错过任何一步问答。"
MSG[en:disconnect_warning]="Note: if you get disconnected from the server during install (e.g. a network blip), the script will NOT stop -- it keeps running on the server. But any prompt that comes up while you're disconnected will silently fall back to its default answer, since it can't wait for input that isn't there. It's a good idea to run this script inside tmux or screen, so you can reconnect and 'tmux attach' back into the same session without missing any prompts."
MSG[ja:disconnect_warning]="注意：インストール中にサーバーとの接続が切れても（回線の一時的な不調など）、スクリプトは停止せずサーバー上で実行を続けます。ただし切断中に入力待ちの質問があった場合、入力を受け取れないため自動的にデフォルトの回答が使われ、再接続を待ってはくれません。tmux や screen でセッションを開いてからこのスクリプトを実行することをおすすめします。再接続後に tmux attach で同じセッションに戻れば、質問を見逃さずに済みます。"
MSG[de:disconnect_warning]="Hinweis: Wenn die Verbindung zum Server waehrend der Installation abbricht (z. B. durch eine kurze Netzwerkstoerung), wird das Skript NICHT gestoppt -- es laeuft auf dem Server einfach weiter. Allerdings wird jede Abfrage, die waehrend der Trennung erscheint, automatisch mit ihrem Standardwert beantwortet, da keine Eingabe moeglich ist; sie wartet nicht auf deine Wiederverbindung. Es empfiehlt sich, dieses Skript innerhalb von tmux oder screen auszufuehren, damit du dich nach dem Wiederverbinden per 'tmux attach' wieder in dieselbe Sitzung einklinken kannst, ohne eine Abfrage zu verpassen."
MSG[ru:disconnect_warning]="Обратите внимание: если соединение с сервером прервётся во время установки (например, из-за кратковременного сбоя сети), скрипт НЕ остановится — он продолжит выполняться на сервере. Но любой вопрос, возникший во время разрыва связи, автоматически получит ответ по умолчанию, так как ввод недоступен, и скрипт не будет ждать вашего повторного подключения. Рекомендуется запускать этот скрипт внутри tmux или screen — тогда после повторного подключения можно будет вернуться в ту же сессию командой tmux attach и не пропустить ни одного вопроса."

MSG[zh:root_required]="请用 root 权限运行本脚本（sudo bash install.sh）"
MSG[en:root_required]="Please run this script as root (sudo bash install.sh)"
MSG[ja:root_required]="root権限で実行してください（sudo bash install.sh）"
MSG[de:root_required]="Bitte führe dieses Skript als root aus (sudo bash install.sh)"
MSG[ru:root_required]="Запустите скрипт от root (sudo bash install.sh)"

MSG[zh:os_detected]="检测到系统：%s"
MSG[en:os_detected]="Detected OS: %s"
MSG[ja:os_detected]="検出したOS: %s"
MSG[de:os_detected]="Erkanntes System: %s"
MSG[ru:os_detected]="Обнаружена система: %s"

MSG[zh:os_warn_untested]="警告：本脚本主要在 Ubuntu/Debian 上测试过，其他系统可能需要手动调整。"
MSG[en:os_warn_untested]="Warning: this script is mainly tested on Ubuntu/Debian; other systems may need manual tweaks."
MSG[ja:os_warn_untested]="警告：このスクリプトは主にUbuntu/Debianでテストされています。他のOSでは手動調整が必要な場合があります。"
MSG[de:os_warn_untested]="Warnung: Dieses Skript wurde hauptsächlich unter Ubuntu/Debian getestet, andere Systeme benötigen evtl. manuelle Anpassungen."
MSG[ru:os_warn_untested]="Внимание: скрипт тестировался в основном на Ubuntu/Debian, для других систем может понадобиться ручная настройка."

MSG[zh:os_warn_unknown]="警告：无法识别系统类型，继续尝试安装。"
MSG[en:os_warn_unknown]="Warning: could not detect OS type, continuing anyway."
MSG[ja:os_warn_unknown]="警告：OSの種類を認識できませんでした。続行します。"
MSG[de:os_warn_unknown]="Warnung: Systemtyp konnte nicht erkannt werden, Installation wird trotzdem fortgesetzt."
MSG[ru:os_warn_unknown]="Внимание: не удалось определить тип системы, установка продолжится."

MSG[zh:node_found]="已检测到 Node.js %s，跳过安装。"
MSG[en:node_found]="Found Node.js %s, skipping install."
MSG[ja:node_found]="Node.js %s を検出済みのため、インストールをスキップします。"
MSG[de:node_found]="Node.js %s gefunden, Installation wird übersprungen."
MSG[ru:node_found]="Найден Node.js %s, установка пропущена."

MSG[zh:node_low]="检测到 Node.js 版本过低（%s），将重新安装更新版本。"
MSG[en:node_low]="Node.js version too old (%s), installing a newer version."
MSG[ja:node_low]="Node.js のバージョンが古いです（%s）。新しいバージョンを再インストールします。"
MSG[de:node_low]="Node.js-Version zu alt (%s), es wird eine neuere Version installiert."
MSG[ru:node_low]="Версия Node.js устарела (%s), будет установлена новая версия."

MSG[zh:node_installing]="-- 安装 Node.js 20.x --"
MSG[en:node_installing]="-- Installing Node.js 20.x --"
MSG[ja:node_installing]="-- Node.js 20.x をインストール中 --"
MSG[de:node_installing]="-- Node.js 20.x wird installiert --"
MSG[ru:node_installing]="-- Установка Node.js 20.x --"

MSG[zh:pm2_installing]="-- 安装 PM2 --"
MSG[en:pm2_installing]="-- Installing PM2 --"
MSG[ja:pm2_installing]="-- PM2 をインストール中 --"
MSG[de:pm2_installing]="-- PM2 wird installiert --"
MSG[ru:pm2_installing]="-- Установка PM2 --"

MSG[zh:pm2_found]="已检测到 PM2，跳过安装。"
MSG[en:pm2_found]="PM2 already installed, skipping."
MSG[ja:pm2_found]="PM2 は既にインストールされています。スキップします。"
MSG[de:pm2_found]="PM2 bereits installiert, wird übersprungen."
MSG[ru:pm2_found]="PM2 уже установлен, пропускаем."

MSG[zh:deps_installing]="-- 安装项目依赖 --"
MSG[en:deps_installing]="-- Installing dependencies --"
MSG[ja:deps_installing]="-- 依存パッケージをインストール中 --"
MSG[de:deps_installing]="-- Abhängigkeiten werden installiert --"
MSG[ru:deps_installing]="-- Установка зависимостей --"

MSG[zh:buildtools_found]="已检测到编译工具链（build-essential/python3），跳过安装。"
MSG[en:buildtools_found]="Found build toolchain (build-essential/python3), skipping install."
MSG[ja:buildtools_found]="ビルドツールチェーン（build-essential/python3）を検出済みのため、インストールをスキップします。"
MSG[de:buildtools_found]="Build-Toolchain (build-essential/python3) gefunden, Installation wird übersprungen."
MSG[ru:buildtools_found]="Инструменты сборки (build-essential/python3) уже установлены, пропускаем."

MSG[zh:buildtools_installing]="-- 安装编译工具链（build-essential/python3）--（在线终端功能依赖的 node-pty 组件需要现场编译，全新服务器上通常还没装这些工具，这一步是为了避免下一步「安装项目依赖」因为缺编译器而失败）"
MSG[en:buildtools_installing]="-- Installing build toolchain (build-essential/python3) -- (The node-pty component used by the in-browser terminal needs to compile from source, and a fresh server usually doesn't have these tools yet. This step avoids the next \"installing dependencies\" step failing for lack of a compiler.)"
MSG[ja:buildtools_installing]="-- ビルドツールチェーン（build-essential/python3）をインストール中 --（オンライン端末機能が依存する node-pty はその場でコンパイルが必要で、新規サーバーには通常これらのツールが入っていません。この手順は次の「依存パッケージのインストール」がコンパイラ不足で失敗するのを防ぐためのものです）"
MSG[de:buildtools_installing]="-- Installiere Build-Toolchain (build-essential/python3) -- (Die von der Weboberflächen-Terminal-Funktion verwendete Komponente node-pty muss aus dem Quellcode kompiliert werden, und ein frischer Server hat diese Tools meist noch nicht. Dieser Schritt verhindert, dass der nächste Schritt „Abhängigkeiten installieren“ mangels Compiler fehlschlägt.)"
MSG[ru:buildtools_installing]="-- Установка инструментов сборки (build-essential/python3) -- (Компонент node-pty, используемый функцией веб-терминала, нужно компилировать из исходников, а на новом сервере эти инструменты обычно ещё не установлены. Этот шаг предотвращает сбой следующего шага «установка зависимостей» из-за отсутствия компилятора.)"

MSG[zh:buildtools_install_failed]="编译工具链安装失败，下一步安装项目依赖时如果因为缺少编译器而报错，需要手动执行：apt-get update && apt-get install -y build-essential python3"
MSG[en:buildtools_install_failed]="Build toolchain installation failed. If the next \"installing dependencies\" step fails for lack of a compiler, run manually: apt-get update && apt-get install -y build-essential python3"
MSG[ja:buildtools_install_failed]="ビルドツールチェーンのインストールに失敗しました。次の依存パッケージのインストールがコンパイラ不足でエラーになった場合は、手動で次を実行してください: apt-get update && apt-get install -y build-essential python3"
MSG[de:buildtools_install_failed]="Installation der Build-Toolchain fehlgeschlagen. Falls der nächste Schritt „Abhängigkeiten installieren“ mangels Compiler fehlschlägt, bitte manuell ausführen: apt-get update && apt-get install -y build-essential python3"
MSG[ru:buildtools_install_failed]="Не удалось установить инструменты сборки. Если следующий шаг «установка зависимостей» завершится ошибкой из-за отсутствия компилятора, выполните вручную: apt-get update && apt-get install -y build-essential python3"

# ---------- 配置问答 ----------
MSG[zh:config_intro]="接下来回答几个问题，配置文件会自动生成，全程不需要你编辑任何文件。每个问题都有默认值，看不懂的话直接回车用默认值就行。"
MSG[en:config_intro]="Next, answer a few questions and the config file will be generated for you — you never need to edit any file by hand. Every question has a default; if unsure, just press Enter."
MSG[ja:config_intro]="これからいくつか質問します。回答すると設定ファイルが自動生成されるので、ファイルを直接編集する必要はありません。どの質問にもデフォルト値があるので、わからなければEnterキーだけで進められます。"
MSG[de:config_intro]="Als Nächstes beantwortest du ein paar Fragen, die Konfigurationsdatei wird automatisch erstellt — du musst nie eine Datei manuell bearbeiten. Jede Frage hat einen Standardwert; im Zweifel einfach Enter drücken."
MSG[ru:config_intro]="Далее ответьте на несколько вопросов, файл конфигурации будет создан автоматически — редактировать файлы вручную не потребуется. У каждого вопроса есть значение по умолчанию; если не уверены, просто нажмите Enter."

MSG[zh:node_name_prompt]="给这个节点起个名字 [默认：我的节点]: "
MSG[en:node_name_prompt]="Name this node [default: My Node]: "
MSG[ja:node_name_prompt]="このノードの名前を入力 [デフォルト: My Node]: "
MSG[de:node_name_prompt]="Name für diesen Knoten [Standard: My Node]: "
MSG[ru:node_name_prompt]="Название узла [по умолчанию: My Node]: "

MSG[zh:node_name_default]="我的节点"
MSG[en:node_name_default]="My Node"
MSG[ja:node_name_default]="My Node"
MSG[de:node_name_default]="My Node"
MSG[ru:node_name_default]="My Node"

MSG[zh:proxy_title]="-- 部署代理节点（可选）--"
MSG[en:proxy_title]="-- Deploy Proxy Node (optional) --"
MSG[ja:proxy_title]="-- プロキシノードのデプロイ（任意）--"
MSG[de:proxy_title]="-- Proxy-Knoten bereitstellen (optional) --"
MSG[ru:proxy_title]="-- Развернуть прокси-узел (опционально) --"

MSG[zh:proxy_explain]="NodeNanny 是看护层，不是代理协议本身。如果你这台服务器还没装任何代理，可以在这里用 233boy 的一键脚本自动装一个 Xray（默认 VLESS-Reality 协议）。如果你已经自己装好了代理，选择跳过即可，NodeNanny 会继续用你现有的节点。"
MSG[en:proxy_explain]="NodeNanny is a watchdog layer, not the proxy protocol itself. If this server has no proxy installed yet, you can auto-install Xray (default VLESS-Reality) here using 233boy's one-click script. If you already have a proxy set up, skip this and NodeNanny will use your existing node."
MSG[ja:proxy_explain]="NodeNanny は監視レイヤーであり、プロキシプロトコル本体ではありません。このサーバーにまだプロキシが入っていない場合、ここで 233boy のワンクリックスクリプトを使って Xray（デフォルトで VLESS-Reality）を自動インストールできます。既にプロキシを用意済みならスキップしてください。NodeNanny は既存のノードを使い続けます。"
MSG[de:proxy_explain]="NodeNanny ist eine Überwachungsebene, nicht das Proxy-Protokoll selbst. Falls auf diesem Server noch kein Proxy installiert ist, kannst du hier mit dem 233boy-Ein-Klick-Skript automatisch Xray installieren (Standard: VLESS-Reality). Hast du bereits einen Proxy eingerichtet, überspringe diesen Schritt — NodeNanny nutzt dann deinen bestehenden Knoten."
MSG[ru:proxy_explain]="NodeNanny — это уровень наблюдения, а не сам протокол прокси. Если на этом сервере ещё не установлен прокси, здесь можно автоматически установить Xray (по умолчанию VLESS-Reality) через скрипт 233boy в один клик. Если прокси уже настроен, пропустите этот шаг — NodeNanny будет использовать существующий узел."

MSG[zh:proxy_ask]="要现在用一键脚本自动装 Xray 吗？如果你已经自己装好了代理，请选 N [y/N]: "
MSG[en:proxy_ask]="Auto-install Xray now with the one-click script? If you already set up a proxy, choose N [y/N]: "
MSG[ja:proxy_ask]="ワンクリックスクリプトで今すぐ Xray を自動インストールしますか？既にプロキシを用意済みなら N を選んでください [y/N]: "
MSG[de:proxy_ask]="Jetzt Xray automatisch mit dem Ein-Klick-Skript installieren? Falls du bereits einen Proxy eingerichtet hast, wähle N [y/N]: "
MSG[ru:proxy_ask]="Установить Xray автоматически прямо сейчас с помощью скрипта в один клик? Если прокси уже настроен, выберите N [y/N]: "

MSG[zh:proxy_installing]="正在安装 Xray（可能需要几分钟，请耐心等待）..."
MSG[en:proxy_installing]="Installing Xray (this may take a few minutes, please wait)..."
MSG[ja:proxy_installing]="Xray をインストール中です（数分かかる場合があります。お待ちください）..."
MSG[de:proxy_installing]="Xray wird installiert (kann einige Minuten dauern, bitte warten)..."
MSG[ru:proxy_installing]="Установка Xray (это может занять несколько минут, подождите)..."

MSG[zh:proxy_install_failed]="警告：Xray 自动安装未能确认成功，请稍后自行执行 xray info 查看，并在下一步手动输入正确端口。"
MSG[en:proxy_install_failed]="Warning: could not confirm Xray installed successfully. Please run 'xray info' manually later and enter the correct port in the next step."
MSG[ja:proxy_install_failed]="警告：Xray のインストール成功を確認できませんでした。後で 'xray info' を実行して確認し、次のステップで正しいポートを手動入力してください。"
MSG[de:proxy_install_failed]="Warnung: Die erfolgreiche Installation von Xray konnte nicht bestätigt werden. Führe später 'xray info' manuell aus und gib im nächsten Schritt den richtigen Port ein."
MSG[ru:proxy_install_failed]="Внимание: не удалось подтвердить успешную установку Xray. Выполните позже 'xray info' вручную и введите правильный порт на следующем шаге."

MSG[zh:proxy_exit_nonzero_but_parsed]="提示：233boy 脚本退出时的状态码看起来不太对劲，但已经从输出内容里读到了端口/订阅信息，通常可以放心继续；如果面板后续显示异常，再回来对照这份安装日志排查。"
MSG[en:proxy_exit_nonzero_but_parsed]="Note: the 233boy script's exit status looked off, but the port/subscription info was still found in its output — it's usually safe to continue. If the panel later shows the node as unhealthy, come back and check this install log."
MSG[ja:proxy_exit_nonzero_but_parsed]="注記：233boy スクリプトの終了コードは正常に見えませんでしたが、出力内容からポート／サブスクリプション情報は取得できました。通常はこのまま続けて問題ありません。後でパネルが異常を表示したら、このインストールログを見直してください。"
MSG[de:proxy_exit_nonzero_but_parsed]="Hinweis: Der Exit-Status des 233boy-Skripts sah nicht korrekt aus, aber Port-/Abo-Informationen wurden trotzdem in der Ausgabe gefunden — es ist meist sicher, fortzufahren. Zeigt das Panel später einen Fehler an, prüfe dieses Installationsprotokoll erneut."
MSG[ru:proxy_exit_nonzero_but_parsed]="Примечание: код завершения скрипта 233boy выглядел некорректно, но порт/данные подписки всё же были найдены в выводе — обычно можно спокойно продолжать. Если позже панель покажет ошибку узла, вернитесь и проверьте этот журнал установки."

MSG[zh:proxy_port_detected]="已检测到 Xray 监听端口：%s，下一步会自动帮你填好。"
MSG[en:proxy_port_detected]="Detected Xray listening port: %s — it'll be pre-filled in the next step."
MSG[ja:proxy_port_detected]="Xray の待受ポートを検出しました：%s。次のステップで自動入力されます。"
MSG[de:proxy_port_detected]="Xray-Lauschport erkannt: %s — wird im nächsten Schritt automatisch eingetragen."
MSG[ru:proxy_port_detected]="Обнаружен порт прослушивания Xray: %s — будет подставлен автоматически на следующем шаге."

MSG[zh:proxy_port_not_detected]="未能自动识别端口，请稍后执行 xray info 查看，并在下一步手动输入。"
MSG[en:proxy_port_not_detected]="Could not auto-detect the port. Please run 'xray info' later and enter it manually in the next step."
MSG[ja:proxy_port_not_detected]="ポートを自動検出できませんでした。後で 'xray info' を実行し、次のステップで手動入力してください。"
MSG[de:proxy_port_not_detected]="Der Port konnte nicht automatisch erkannt werden. Führe später 'xray info' aus und gib ihn im nächsten Schritt manuell ein."
MSG[ru:proxy_port_not_detected]="Не удалось автоматически определить порт. Выполните позже 'xray info' и введите его вручную на следующем шаге."

MSG[zh:proxy_sub_detected]="已从安装日志中解析到节点订阅链接，将自动写入配置，面板首页会展示（下一批加）。"
MSG[en:proxy_sub_detected]="Detected a node subscription link from the install log — it will be saved to your config automatically."
MSG[ja:proxy_sub_detected]="インストールログからノードのサブスクリプションリンクを検出しました。設定に自動保存されます。"
MSG[de:proxy_sub_detected]="Ein Node-Abonnementlink wurde im Installationsprotokoll erkannt und wird automatisch in der Konfiguration gespeichert."
MSG[ru:proxy_sub_detected]="В журнале установки обнаружена ссылка подписки узла — она будет автоматически сохранена в конфигурации."

MSG[zh:proxy_sub_not_detected]="未能从安装日志中解析到订阅链接，node.subscriptionUrl 暂时留空，需要之后手动补充。"
MSG[en:proxy_sub_not_detected]="Could not detect a subscription link from the install log — node.subscriptionUrl will stay empty until you add it manually."
MSG[ja:proxy_sub_not_detected]="インストールログからサブスクリプションリンクを検出できませんでした。node.subscriptionUrl は空のままです。後で手動で追加してください。"
MSG[de:proxy_sub_not_detected]="Es konnte kein Abonnementlink im Installationsprotokoll erkannt werden — node.subscriptionUrl bleibt leer, bis er manuell ergänzt wird."
MSG[ru:proxy_sub_not_detected]="Не удалось обнаружить ссылку подписки в журнале установки — node.subscriptionUrl останется пустым, пока вы не добавите её вручную."

MSG[zh:proxy_skip_note]="已跳过自动装节点，假设你已有现成节点在运行。"
MSG[en:proxy_skip_note]="Skipped auto-install, assuming you already have a node running."
MSG[ja:proxy_skip_note]="自動インストールをスキップしました。既存のノードが稼働している前提で進めます。"
MSG[de:proxy_skip_note]="Automatische Installation übersprungen — es wird angenommen, dass bereits ein Knoten läuft."
MSG[ru:proxy_skip_note]="Автоустановка пропущена, предполагается, что узел уже запущен."

# 发现11 修复（批次四第三轮真机测试）：跳过233boy一键装节点后，如果扫描不到任何正在监听的
# 代理进程，很可能服务器其实是裸机——不做二次确认的话，NodeNanny会一直监控一个根本不存在的
# 东西，持续判定异常、不断触发失败重启。这里加一句二次确认，让用户自己确认清楚再继续。
MSG[zh:proxy_skip_no_service_found]="没有检测到任何代理服务在运行，你确定已经自己装好了吗？"
MSG[en:proxy_skip_no_service_found]="No proxy service was detected running. Are you sure you already have one set up?"
MSG[ja:proxy_skip_no_service_found]="稼働中のプロキシサービスが検出されませんでした。本当に既にセットアップ済みですか？"
MSG[de:proxy_skip_no_service_found]="Es wurde kein laufender Proxy-Dienst erkannt. Bist du sicher, dass bereits einer eingerichtet ist?"
MSG[ru:proxy_skip_no_service_found]="Не обнаружено ни одной работающей прокси-службы. Вы уверены, что уже всё настроили?"

MSG[zh:proxy_skip_confirm_prompt]="确认继续吗？（继续=y，回去重新用一键脚本装=n）[y/N]: "
MSG[en:proxy_skip_confirm_prompt]="Continue anyway? (y = continue, n = go back and use the one-click script instead) [y/N]: "
MSG[ja:proxy_skip_confirm_prompt]="このまま続けますか？（続ける=y、ワンクリックスクリプトに戻る=n）[y/N]: "
MSG[de:proxy_skip_confirm_prompt]="Trotzdem fortfahren? (y = fortfahren, n = zurück und Ein-Klick-Skript verwenden) [y/N]: "
MSG[ru:proxy_skip_confirm_prompt]="Всё равно продолжить? (y — продолжить, n — вернуться и использовать скрипт в один клик) [y/N]: "

MSG[zh:proxy_skip_abort]="好的，已终止安装。请先自己确认代理服务已经在运行，或者重新运行本脚本并选择一键装。"
MSG[en:proxy_skip_abort]="OK, installation stopped. Please make sure a proxy service is actually running first, or re-run this script and choose the one-click install."
MSG[ja:proxy_skip_abort]="了解しました。インストールを中止しました。プロキシサービスが実際に稼働しているか確認するか、本スクリプトを再実行してワンクリックインストールを選んでください。"
MSG[de:proxy_skip_abort]="OK, die Installation wurde gestoppt. Stelle sicher, dass tatsächlich ein Proxy-Dienst läuft, oder führe dieses Skript erneut aus und wähle die Ein-Klick-Installation."
MSG[ru:proxy_skip_abort]="Хорошо, установка остановлена. Убедитесь, что прокси-служба действительно запущена, либо запустите скрипт заново и выберите установку в один клик."


MSG[zh:port_prompt_detected]="节点监听的端口是多少？已检测到：%s，直接回车即可使用该值: "
MSG[en:port_prompt_detected]="Which port does your node listen on? Detected: %s — just press Enter to use it: "
MSG[ja:port_prompt_detected]="ノードの待受ポートは？検出値：%s。Enterでそのまま使用できます: "
MSG[de:port_prompt_detected]="Auf welchem Port lauscht dein Knoten? Erkannt: %s — Enter drücken, um ihn zu übernehmen: "
MSG[ru:port_prompt_detected]="На каком порту слушает ваш узел? Обнаружено: %s — нажмите Enter, чтобы использовать: "

MSG[zh:port_prompt]="节点监听的端口是多少？（已经自动扫描过一次但没能识别出来，需要你自己确认，可以用 ss -tlnp 或 xray info 查看）[默认：443，但很可能不对，建议自己填]: "
MSG[en:port_prompt]="Which port does your node listen on? (An automatic scan already ran but couldn't identify it — please confirm yourself, e.g. with ss -tlnp or xray info) [default: 443, likely wrong — please fill it in yourself]: "
MSG[ja:port_prompt]="ノードが待ち受けているポート番号は？（自動スキャンを試しましたが特定できませんでした。ss -tlnp や xray info で確認の上、自分で入力してください）[デフォルト: 443、おそらく間違っています]: "
MSG[de:port_prompt]="Auf welchem Port lauscht dein Knoten? (Ein automatischer Scan wurde bereits versucht, konnte ihn aber nicht ermitteln — bitte selbst bestätigen, z. B. mit ss -tlnp oder xray info) [Standard: 443, vermutlich falsch — bitte selbst eintragen]: "
MSG[ru:port_prompt]="На каком порту слушает ваш узел? (Автосканирование уже было выполнено, но не смогло его определить — подтвердите сами, например через ss -tlnp или xray info) [по умолчанию: 443, вероятно неверно — укажите сами]: "

MSG[zh:proxy_port_detected_by_scan]="虽然跳过了一键装节点，但通过端口扫描检测到一个可能对应的监听端口：%s（仅供参考，请务必自己核实这确实是你的代理端口）"
MSG[en:proxy_port_detected_by_scan]="Even though you skipped the one-click install, a port scan detected a possible listening port: %s (for reference only — please verify it's really your proxy port)"
MSG[ja:proxy_port_detected_by_scan]="ワンクリックインストールをスキップしましたが、ポートスキャンで待ち受けポートの候補を検出しました：%s（参考情報です。実際にプロキシのポートであるか必ず確認してください）"
MSG[de:proxy_port_detected_by_scan]="Obwohl die Ein-Klick-Installation übersprungen wurde, hat ein Port-Scan einen möglichen lauschenden Port erkannt: %s (nur zur Referenz — bitte selbst bestätigen, dass dies wirklich dein Proxy-Port ist)"
MSG[ru:proxy_port_detected_by_scan]="Хотя установка в один клик была пропущена, сканирование портов обнаружило возможный прослушиваемый порт: %s (только для справки — обязательно проверьте, что это действительно порт вашего прокси)"

MSG[zh:checking_services_title]="-- 帮你查一下服务器上真实在跑的代理服务，方便下一步填对 --"
MSG[en:checking_services_title]="-- Scanning your server for a running proxy service, so the next step is easier to answer correctly --"
MSG[ja:checking_services_title]="-- サーバー上で実際に動いているプロキシサービスを確認します。次の質問に正しく答えやすくなります --"
MSG[de:checking_services_title]="-- Der Server wird nach einem laufenden Proxy-Dienst durchsucht, damit die nächste Frage leichter zu beantworten ist --"
MSG[ru:checking_services_title]="-- Проверяем сервер на наличие запущенного прокси-сервиса, чтобы легче ответить на следующий вопрос --"

MSG[zh:mgmt_question]="你的代理服务是怎么管理的？看不懂上面输出就选 1，直接用检测到的默认值最省事；选 3 需要你自己手动填写完整的重启命令，风险较高，拿不准的话不建议选。"
MSG[en:mgmt_question]="How is your proxy service managed? If the scan output above doesn't make sense, pick option 1 and use the detected default — that's the easiest path. Option 3 requires you to type the full restart command yourself and carries more risk; don't pick it if you're not sure."
MSG[ja:mgmt_question]="プロキシサービスはどのように管理されていますか？上の出力の意味がわからなければ1を選び、検出されたデフォルト値をそのまま使うのが一番簡単です。3は再起動コマンドを自分で完全に入力する必要があり、リスクが高いため、自信がなければ選ばないことをおすすめします。"
MSG[de:mgmt_question]="Wie wird dein Proxy-Dienst verwaltet? Wenn die Ausgabe oben unklar ist, wähle Option 1 und nutze den erkannten Standardwert — das ist am einfachsten. Option 3 verlangt, dass du den vollständigen Neustart-Befehl selbst eingibst, und ist riskanter; wähle sie nicht, wenn du dir unsicher bist."
MSG[ru:mgmt_question]="Как управляется ваш прокси-сервис? Если вывод выше непонятен, выберите вариант 1 и используйте обнаруженное значение по умолчанию — это самый простой путь. Вариант 3 требует, чтобы вы сами ввели полную команду перезапуска, и связан с большим риском; не выбирайте его, если не уверены."

MSG[zh:mgmt_opt1]="  1) systemd 服务（比如 systemctl status xray 能看到）"
MSG[en:mgmt_opt1]="  1) systemd service (e.g. visible via systemctl status xray)"
MSG[ja:mgmt_opt1]="  1) systemdサービス（例：systemctl status xray で確認できる）"
MSG[de:mgmt_opt1]="  1) systemd-Dienst (z. B. sichtbar über systemctl status xray)"
MSG[ru:mgmt_opt1]="  1) служба systemd (видна через systemctl status xray)"

MSG[zh:mgmt_opt1_candidate]="  1) systemd 服务（检测到候选：%s，直接回车确认即可）"
MSG[en:mgmt_opt1_candidate]="  1) systemd service (detected candidate: %s — just press Enter to confirm)"
MSG[ja:mgmt_opt1_candidate]="  1) systemdサービス（候補を検出：%s。Enterでそのまま確定できます）"
MSG[de:mgmt_opt1_candidate]="  1) systemd-Dienst (Kandidat erkannt: %s — Enter drücken zum Bestätigen)"
MSG[ru:mgmt_opt1_candidate]="  1) служба systemd (обнаружен кандидат: %s — нажмите Enter для подтверждения)"

MSG[zh:mgmt_opt2]="  2) Docker 容器（比如 docker ps 能看到）"
MSG[en:mgmt_opt2]="  2) Docker container (e.g. visible via docker ps)"
MSG[ja:mgmt_opt2]="  2) Dockerコンテナ（例：docker ps で確認できる）"
MSG[de:mgmt_opt2]="  2) Docker-Container (z. B. sichtbar über docker ps)"
MSG[ru:mgmt_opt2]="  2) контейнер Docker (виден через docker ps)"

MSG[zh:mgmt_opt3]="  3) 不确定 / 都不是 / 我自己填完整的重启命令"
MSG[en:mgmt_opt3]="  3) Not sure / neither / I'll type the full restart command myself"
MSG[ja:mgmt_opt3]="  3) わからない／どちらでもない／完全な再起動コマンドを自分で入力する"
MSG[de:mgmt_opt3]="  3) Unsicher / keins von beiden / ich gebe den vollständigen Neustart-Befehl selbst ein"
MSG[ru:mgmt_opt3]="  3) Не уверен / ни то, ни другое / введу команду перезапуска сам"

MSG[zh:mgmt_choose]="选一个 [默认：1]: "
MSG[en:mgmt_choose]="Choose one [default: 1]: "
MSG[ja:mgmt_choose]="選択してください [デフォルト: 1]: "
MSG[de:mgmt_choose]="Wähle eine Option [Standard: 1]: "
MSG[ru:mgmt_choose]="Выберите вариант [по умолчанию: 1]: "

MSG[zh:systemd_name_prompt]="上面服务名那一列，把对应的名字原样抄过来（不用打 .service）[默认：xray]: "
MSG[en:systemd_name_prompt]="Copy the service name from the list above exactly (no need to type .service) [default: xray]: "
MSG[ja:systemd_name_prompt]="上のリストからサービス名をそのままコピーしてください（.serviceは不要）[デフォルト: xray]: "
MSG[de:systemd_name_prompt]="Kopiere den Dienstnamen genau aus der Liste oben (kein .service nötig) [Standard: xray]: "
MSG[ru:systemd_name_prompt]="Скопируйте имя службы из списка выше как есть (без .service) [по умолчанию: xray]: "

MSG[zh:systemd_name_prompt_candidate]="服务名，检测到候选：%s，直接回车即可使用该值（不用打 .service）: "
MSG[en:systemd_name_prompt_candidate]="Service name — detected candidate: %s, just press Enter to use it (no need to type .service): "
MSG[ja:systemd_name_prompt_candidate]="サービス名。候補を検出：%s。Enterでそのまま使用できます（.serviceは不要）: "
MSG[de:systemd_name_prompt_candidate]="Dienstname — Kandidat erkannt: %s, Enter drücken, um ihn zu übernehmen (kein .service nötig): "
MSG[ru:systemd_name_prompt_candidate]="Имя службы — обнаружен кандидат: %s, нажмите Enter, чтобы использовать (без .service): "

MSG[zh:docker_name_prompt]="上面容器名那一列，把对应的名字原样抄过来 [默认：xray]: "
MSG[en:docker_name_prompt]="Copy the container name from the list above exactly [default: xray]: "
MSG[ja:docker_name_prompt]="上のリストからコンテナ名をそのままコピーしてください [デフォルト: xray]: "
MSG[de:docker_name_prompt]="Kopiere den Containernamen genau aus der Liste oben [Standard: xray]: "
MSG[ru:docker_name_prompt]="Скопируйте имя контейнера из списка выше как есть [по умолчанию: xray]: "

MSG[zh:custom_name_prompt]="给这个服务起个名字（仅用于面板显示，随便填）[默认：xray]: "
MSG[en:custom_name_prompt]="Give this service a display name (just for the panel, anything works) [default: xray]: "
MSG[ja:custom_name_prompt]="このサービスの表示名を入力（パネル表示用、何でもOK）[デフォルト: xray]: "
MSG[de:custom_name_prompt]="Gib diesem Dienst einen Anzeigenamen (nur fürs Panel, beliebig) [Standard: xray]: "
MSG[ru:custom_name_prompt]="Придумайте имя для этой службы (только для панели, любое) [по умолчанию: xray]: "

MSG[zh:custom_cmd_prompt]="完整的重启命令是什么？原样输入，比如：/opt/xray/restart.sh"
MSG[en:custom_cmd_prompt]="What's the full restart command? Type it exactly, e.g.: /opt/xray/restart.sh"
MSG[ja:custom_cmd_prompt]="完全な再起動コマンドを入力してください（例：/opt/xray/restart.sh）"
MSG[de:custom_cmd_prompt]="Wie lautet der vollständige Neustart-Befehl? Genau eingeben, z. B.: /opt/xray/restart.sh"
MSG[ru:custom_cmd_prompt]="Введите полную команду перезапуска, например: /opt/xray/restart.sh"

MSG[zh:custom_cmd_path_not_found]="警告：「%s」看起来是一个文件路径，但服务器上目前并不存在这个文件——如果这是从上面的示例文本原样抄过来的，很可能填错了。"
MSG[en:custom_cmd_path_not_found]="Warning: \"%s\" looks like a file path, but that file doesn't currently exist on this server — if you copied this from the example text above, it's likely wrong."
MSG[ja:custom_cmd_path_not_found]="警告：「%s」はファイルパスのようですが、このサーバー上に該当ファイルは存在しません。上の例文をそのままコピーした場合、誤って入力している可能性があります。"
MSG[de:custom_cmd_path_not_found]="Warnung: \"%s\" sieht wie ein Dateipfad aus, aber diese Datei existiert auf diesem Server derzeit nicht — falls das aus dem Beispieltext oben kopiert wurde, ist es wahrscheinlich falsch."
MSG[ru:custom_cmd_path_not_found]="Внимание: «%s» похоже на путь к файлу, но такого файла на сервере сейчас нет — если это скопировано из примера выше, скорее всего, это ошибка."

MSG[zh:custom_cmd_confirm_anyway]="确定就这样填吗？[y/N]（选 N 会让你重新输入）: "
MSG[en:custom_cmd_confirm_anyway]="Keep it as-is anyway? [y/N] (choosing N lets you re-enter it): "
MSG[ja:custom_cmd_confirm_anyway]="このまま使用しますか？[y/N]（Nを選ぶと再入力できます）: "
MSG[de:custom_cmd_confirm_anyway]="Trotzdem so übernehmen? [y/N] (bei N kannst du es erneut eingeben): "
MSG[ru:custom_cmd_confirm_anyway]="Всё равно оставить как есть? [y/N] (при N можно ввести заново): "

MSG[zh:panel_pw_title]="-- 设置面板登录密码（打开面板网页时要输入的密码，跟服务器密码是两回事）--"
MSG[en:panel_pw_title]="-- Set a panel login password (this is for opening the web panel — different from your server password) --"
MSG[ja:panel_pw_title]="-- パネルのログインパスワードを設定（Webパネルを開く時に使うパスワードで、サーバーのパスワードとは別物です）--"
MSG[de:panel_pw_title]="-- Panel-Passwort festlegen (zum Öffnen des Web-Panels — nicht dasselbe wie das Serverpasswort) --"
MSG[ru:panel_pw_title]="-- Задайте пароль для входа в панель (это пароль для открытия веб-панели, он отличается от пароля сервера) --"

MSG[zh:panel_pw_prompt]="设置一个面板登录密码（输入时不显示，回车确认）: "
MSG[en:panel_pw_prompt]="Set a panel password (hidden while typing, press Enter to confirm): "
MSG[ja:panel_pw_prompt]="パネルのパスワードを設定してください（入力中は表示されません、Enterで確定）: "
MSG[de:panel_pw_prompt]="Panel-Passwort festlegen (wird beim Tippen nicht angezeigt, Enter zum Bestätigen): "
MSG[ru:panel_pw_prompt]="Задайте пароль панели (ввод скрыт, нажмите Enter для подтверждения): "

MSG[zh:panel_pw_empty]="密码不能为空，再输一次。"
MSG[en:panel_pw_empty]="Password can't be empty, try again."
MSG[ja:panel_pw_empty]="パスワードは空にできません。もう一度入力してください。"
MSG[de:panel_pw_empty]="Passwort darf nicht leer sein, bitte erneut eingeben."
MSG[ru:panel_pw_empty]="Пароль не может быть пустым, попробуйте снова."

MSG[zh:panel_pw_confirm]="再输入一次确认: "
MSG[en:panel_pw_confirm]="Type it again to confirm: "
MSG[ja:panel_pw_confirm]="確認のためもう一度入力してください: "
MSG[de:panel_pw_confirm]="Zur Bestätigung erneut eingeben: "
MSG[ru:panel_pw_confirm]="Введите ещё раз для подтверждения: "

MSG[zh:panel_pw_mismatch]="两次输入不一致，再来一次。"
MSG[en:panel_pw_mismatch]="The two entries don't match, let's try again."
MSG[ja:panel_pw_mismatch]="入力内容が一致しません。もう一度お試しください。"
MSG[de:panel_pw_mismatch]="Die beiden Eingaben stimmen nicht überein, bitte erneut versuchen."
MSG[ru:panel_pw_mismatch]="Пароли не совпадают, попробуйте ещё раз."

MSG[zh:smtp_title]="-- 邮件通知（节点异常/恢复时给你发邮件，不配也能先用，以后随时可以补）--"
MSG[en:smtp_title]="-- Email notifications (get an email when the node goes down/recovers — optional, you can set this up later too) --"
MSG[ja:smtp_title]="-- メール通知（ノード異常時・復旧時にメールが届きます。設定しなくても使えます。後からでも設定可）--"
MSG[de:smtp_title]="-- E-Mail-Benachrichtigungen (Mail bei Ausfall/Wiederherstellung — optional, kann auch später eingerichtet werden) --"
MSG[ru:smtp_title]="-- Уведомления по email (письмо при сбое/восстановлении узла — необязательно, можно настроить позже) --"

MSG[zh:smtp_opt1]="  1) QQ 邮箱"
MSG[en:smtp_opt1]="  1) QQ Mail"
MSG[ja:smtp_opt1]="  1) QQメール"
MSG[de:smtp_opt1]="  1) QQ Mail"
MSG[ru:smtp_opt1]="  1) QQ Почта"

MSG[zh:smtp_opt2]="  2) 163 邮箱"
MSG[en:smtp_opt2]="  2) 163 Mail"
MSG[ja:smtp_opt2]="  2) 163メール"
MSG[de:smtp_opt2]="  2) 163 Mail"
MSG[ru:smtp_opt2]="  2) 163 Почта"

MSG[zh:smtp_opt3]="  3) Gmail"
MSG[en:smtp_opt3]="  3) Gmail"
MSG[ja:smtp_opt3]="  3) Gmail"
MSG[de:smtp_opt3]="  3) Gmail"
MSG[ru:smtp_opt3]="  3) Gmail"

MSG[zh:smtp_opt4]="  4) 其他/自建邮箱服务（自己填 host/port）"
MSG[en:smtp_opt4]="  4) Other / self-hosted mail service (enter host/port yourself)"
MSG[ja:smtp_opt4]="  4) その他／自前のメールサービス（host/portを自分で入力）"
MSG[de:smtp_opt4]="  4) Andere / selbst gehosteter Mail-Dienst (Host/Port selbst eingeben)"
MSG[ru:smtp_opt4]="  4) Другое / собственный почтовый сервис (укажите host/port сами)"

MSG[zh:smtp_opt5]="  5) 先跳过，以后再配"
MSG[en:smtp_opt5]="  5) Skip for now, set up later"
MSG[ja:smtp_opt5]="  5) 今はスキップ、後で設定"
MSG[de:smtp_opt5]="  5) Vorerst überspringen, später einrichten"
MSG[ru:smtp_opt5]="  5) Пропустить, настроить позже"

MSG[zh:smtp_choose]="选一个 [默认：5]: "
MSG[en:smtp_choose]="Choose one [default: 5]: "
MSG[ja:smtp_choose]="選択してください [デフォルト: 5]: "
MSG[de:smtp_choose]="Wähle eine Option [Standard: 5]: "
MSG[ru:smtp_choose]="Выберите вариант [по умолчанию: 5]: "

MSG[zh:smtp_qq_note]="QQ 邮箱要用「授权码」，不是你的QQ登录密码 —— 在 QQ 邮箱网页版「设置 → 账户」里申请，是一串英文字母，跟你平时登录QQ的密码完全不一样。"
MSG[en:smtp_qq_note]="QQ Mail needs an \"authorization code\", NOT your QQ login password — generate it under Settings → Account on the QQ Mail website. It's a string of letters, completely different from your usual QQ password."
MSG[ja:smtp_qq_note]="QQメールには「認証コード」が必要です。QQのログインパスワードとは違います — QQメールのWeb版「設定→アカウント」から発行してください。英字の文字列で、普段のQQログインパスワードとは全く異なります。"
MSG[de:smtp_qq_note]="QQ Mail benötigt einen \"Autorisierungscode\", NICHT dein QQ-Login-Passwort — erstelle ihn unter Einstellungen → Konto auf der QQ-Mail-Webseite. Es ist eine Buchstabenfolge, komplett anders als dein normales QQ-Passwort."
MSG[ru:smtp_qq_note]="Для QQ Mail нужен «код авторизации», а НЕ пароль от QQ — получите его в Настройки → Аккаунт на сайте QQ Mail. Это набор букв, полностью отличается от обычного пароля QQ."

MSG[zh:smtp_163_note]="163 邮箱要用「授权码」，不是登录密码 —— 在 163 邮箱网页版设置里申请。"
MSG[en:smtp_163_note]="163 Mail needs an \"authorization code\", NOT your login password — generate it in the 163 Mail website settings."
MSG[ja:smtp_163_note]="163メールには「認証コード」が必要です。ログインパスワードとは違います — 163メールのWeb版設定から発行してください。"
MSG[de:smtp_163_note]="163 Mail benötigt einen \"Autorisierungscode\", NICHT dein Login-Passwort — erstelle ihn in den Einstellungen der 163-Mail-Webseite."
MSG[ru:smtp_163_note]="Для 163 Mail нужен «код авторизации», а НЕ пароль входа — получите его в настройках сайта 163 Mail."

MSG[zh:smtp_gmail_note]="Gmail 要用「应用专用密码」，不是 Google 账号登录密码 —— 需要先在 Google 账号里开启两步验证才能生成，网址：myaccount.google.com/apppasswords"
MSG[en:smtp_gmail_note]="Gmail needs an \"App Password\", NOT your Google account password — you must enable 2-Step Verification first to generate one, at: myaccount.google.com/apppasswords"
MSG[ja:smtp_gmail_note]="Gmailには「アプリパスワード」が必要です。Googleアカウントのログインパスワードとは違います — 生成には二段階認証を先に有効にする必要があります。URL：myaccount.google.com/apppasswords"
MSG[de:smtp_gmail_note]="Gmail benötigt ein \"App-Passwort\", NICHT dein Google-Konto-Passwort — dafür muss zuerst die 2-Schritt-Verifizierung aktiviert werden, unter: myaccount.google.com/apppasswords"
MSG[ru:smtp_gmail_note]="Для Gmail нужен «пароль приложения», а НЕ пароль аккаунта Google — сначала включите двухэтапную аутентификацию, затем создайте пароль на: myaccount.google.com/apppasswords"

MSG[zh:smtp_host_prompt]="SMTP 服务器地址（host）: "
MSG[en:smtp_host_prompt]="SMTP server address (host): "
MSG[ja:smtp_host_prompt]="SMTPサーバーアドレス（host）: "
MSG[de:smtp_host_prompt]="SMTP-Serveradresse (Host): "
MSG[ru:smtp_host_prompt]="Адрес SMTP-сервера (host): "

MSG[zh:smtp_host_looks_like_email]="这看起来像一个邮箱地址（%s），而不是服务器地址——服务器地址通常长得像 smtp.example.com，不应该包含 @ 符号。是不是跟下一题「发信邮箱地址」填混了？"
MSG[en:smtp_host_looks_like_email]="This looks like an email address (%s), not a server address — a server address usually looks like smtp.example.com and shouldn't contain an @. Did you mix this up with the next question (\"sender email address\")?"
MSG[ja:smtp_host_looks_like_email]="これはメールアドレス（%s）のように見えますが、サーバーアドレスではありません——サーバーアドレスは通常 smtp.example.com のような形式で、@ 記号は含みません。次の質問「送信元メールアドレス」と混同していませんか？"
MSG[de:smtp_host_looks_like_email]="Das sieht wie eine E-Mail-Adresse aus (%s), nicht wie eine Serveradresse — eine Serveradresse sieht normalerweise wie smtp.example.com aus und sollte kein @ enthalten. Hast du das mit der nächsten Frage (\"Absender-E-Mail-Adresse\") verwechselt?"
MSG[ru:smtp_host_looks_like_email]="Это похоже на адрес электронной почты (%s), а не на адрес сервера — адрес сервера обычно выглядит как smtp.example.com и не должен содержать @. Возможно, вы перепутали это со следующим вопросом («адрес отправителя»)?"

MSG[zh:smtp_host_confirm_anyway]="确定就这样填吗？[y/N]（选 N 会让你重新输入）: "
MSG[en:smtp_host_confirm_anyway]="Keep it as-is anyway? [y/N] (choosing N lets you re-enter it): "
MSG[ja:smtp_host_confirm_anyway]="このまま使用しますか？[y/N]（Nを選ぶと再入力できます）: "
MSG[de:smtp_host_confirm_anyway]="Trotzdem so übernehmen? [y/N] (bei N kannst du es erneut eingeben): "
MSG[ru:smtp_host_confirm_anyway]="Всё равно оставить как есть? [y/N] (при N можно ввести заново): "

MSG[zh:smtp_port_prompt]="SMTP 端口 [默认：465]: "
MSG[en:smtp_port_prompt]="SMTP port [default: 465]: "
MSG[ja:smtp_port_prompt]="SMTPポート [デフォルト: 465]: "
MSG[de:smtp_port_prompt]="SMTP-Port [Standard: 465]: "
MSG[ru:smtp_port_prompt]="SMTP-порт [по умолчанию: 465]: "

MSG[zh:smtp_secure_prompt]="是否用 SSL（465 端口通常填 true，587 端口填 false）[默认：true]: "
MSG[en:smtp_secure_prompt]="Use SSL? (usually true for port 465, false for port 587) [default: true]: "
MSG[ja:smtp_secure_prompt]="SSLを使用しますか？（通常ポート465はtrue、587はfalse）[デフォルト: true]: "
MSG[de:smtp_secure_prompt]="SSL verwenden? (meist true bei Port 465, false bei Port 587) [Standard: true]: "
MSG[ru:smtp_secure_prompt]="Использовать SSL? (обычно true для порта 465, false для 587) [по умолчанию: true]: "

MSG[zh:smtp_skip_note]="先跳过，config.json 里 smtp 字段会是占位值，想用的时候在面板设置里再补。"
MSG[en:smtp_skip_note]="Skipping for now — the smtp field in config.json will be a placeholder; you can fill it in later from the panel settings."
MSG[ja:smtp_skip_note]="今はスキップします。config.json のsmtpフィールドはプレースホルダーになります。後でパネル設定から入力できます。"
MSG[de:smtp_skip_note]="Wird vorerst übersprungen — das smtp-Feld in config.json bleibt ein Platzhalter, du kannst es später in den Panel-Einstellungen ausfüllen."
MSG[ru:smtp_skip_note]="Пока пропускаем — поле smtp в config.json останется placeholder’ом, заполнить можно позже в настройках панели."

MSG[zh:smtp_user_prompt]="发信邮箱地址: "
MSG[en:smtp_user_prompt]="Sender email address: "
MSG[ja:smtp_user_prompt]="送信元メールアドレス: "
MSG[de:smtp_user_prompt]="Absender-E-Mail-Adresse: "
MSG[ru:smtp_user_prompt]="Адрес электронной почты отправителя: "

MSG[zh:smtp_pass_prompt]="邮箱密码/授权码（输入时不显示）: "
MSG[en:smtp_pass_prompt]="Email password / authorization code (hidden while typing): "
MSG[ja:smtp_pass_prompt]="メールパスワード／認証コード（入力中は非表示）: "
MSG[de:smtp_pass_prompt]="E-Mail-Passwort / Autorisierungscode (wird beim Tippen nicht angezeigt): "
MSG[ru:smtp_pass_prompt]="Пароль почты / код авторизации (ввод скрыт): "

MSG[zh:smtp_to_prompt]="通知发到哪个邮箱？[默认：跟发信邮箱一样]: "
MSG[en:smtp_to_prompt]="Which email should receive notifications? [default: same as sender]: "
MSG[ja:smtp_to_prompt]="通知はどのメールアドレスに送りますか？[デフォルト: 送信元と同じ]: "
MSG[de:smtp_to_prompt]="An welche E-Mail sollen Benachrichtigungen gehen? [Standard: gleich wie Absender]: "
MSG[ru:smtp_to_prompt]="На какой email отправлять уведомления? [по умолчанию: тот же, что отправитель]: "

# ---------- AI 故障诊断（可选）----------
MSG[zh:ai_title]="-- AI 故障诊断（节点持续异常时，给你一段可能原因和排查建议，仅供参考，不会自动执行任何操作）--"
MSG[en:ai_title]="-- AI diagnosis (when the node stays down, get a suggested cause and next steps — advice only, nothing is executed automatically) --"
MSG[ja:ai_title]="-- AI故障診断（ノードが継続的に異常な場合、考えられる原因と対処案を提示します。あくまで参考で、自動実行は一切しません）--"
MSG[de:ai_title]="-- KI-Diagnose (bei anhaltendem Ausfall bekommst du eine mögliche Ursache und nächste Schritte vorgeschlagen — nur ein Hinweis, es wird nichts automatisch ausgeführt) --"
MSG[ru:ai_title]="-- ИИ-диагностика (при длительном сбое узла вы получите предполагаемую причину и рекомендации — это только совет, ничего не выполняется автоматически) --"

MSG[zh:ai_explain]="需要你自己的 Anthropic 或 OpenAI API Key（NodeNanny 不经手、不收费，直接用你的 Key 连官方 API）。现在跳过的话，以后随时可以手动编辑 config.json 里的 ai 字段来开启。"
MSG[en:ai_explain]="Needs your own Anthropic or OpenAI API Key (NodeNanny never touches or charges for it — it connects to the official API directly with your key). You can skip this now and enable it later by editing the ai field in config.json."
MSG[ja:ai_explain]="あなた自身の Anthropic または OpenAI の API キーが必要です（NodeNanny はキーを預からず、課金もしません。あなたのキーで公式APIに直接接続します）。今はスキップしても、後で config.json の ai フィールドを編集すればいつでも有効化できます。"
MSG[de:ai_explain]="Erfordert deinen eigenen Anthropic- oder OpenAI-API-Key (NodeNanny fasst ihn nie an und berechnet nichts dafür — es verbindet sich mit deinem Key direkt zur offiziellen API). Du kannst das jetzt überspringen und später aktivieren, indem du das ai-Feld in config.json bearbeitest."
MSG[ru:ai_explain]="Требуется ваш собственный API-ключ Anthropic или OpenAI (NodeNanny никогда не получает и не тарифицирует его — подключение к официальному API идёт напрямую с вашим ключом). Можно пропустить сейчас и включить позже, отредактировав поле ai в config.json."

MSG[zh:ai_ask]="要现在启用 AI 故障诊断吗？[y/N]: "
MSG[en:ai_ask]="Enable AI diagnosis now? [y/N]: "
MSG[ja:ai_ask]="今、AI故障診断を有効にしますか？[y/N]: "
MSG[de:ai_ask]="KI-Diagnose jetzt aktivieren? [y/N]: "
MSG[ru:ai_ask]="Включить ИИ-диагностику сейчас? [y/N]: "

MSG[zh:ai_opt1]="  1) Anthropic（Claude）"
MSG[en:ai_opt1]="  1) Anthropic (Claude)"
MSG[ja:ai_opt1]="  1) Anthropic（Claude）"
MSG[de:ai_opt1]="  1) Anthropic (Claude)"
MSG[ru:ai_opt1]="  1) Anthropic (Claude)"

MSG[zh:ai_opt2]="  2) OpenAI（GPT）"
MSG[en:ai_opt2]="  2) OpenAI (GPT)"
MSG[ja:ai_opt2]="  2) OpenAI（GPT）"
MSG[de:ai_opt2]="  2) OpenAI (GPT)"
MSG[ru:ai_opt2]="  2) OpenAI (GPT)"

# 本轮新增（Addendum 8 bug#2修复）：第三方/自定义OpenAI兼容接口选项——代码里
# ai-provider.js的diagnoseWithOpenAICompatible()早就支持这条路径（智谱/DeepSeek/
# Moonshot等），但install.sh一直没有入口选它，导致选OpenAI的用户如果实际用的是
# 第三方key，请求会打到真正的api.openai.com上，收到401。
MSG[zh:ai_opt3]="  3) 第三方/自定义接口（OpenAI兼容，例如智谱GLM、DeepSeek等）"
MSG[en:ai_opt3]="  3) Third-party / custom endpoint (OpenAI-compatible, e.g. Zhipu GLM, DeepSeek, etc.)"
MSG[ja:ai_opt3]="  3) サードパーティ/カスタムエンドポイント（OpenAI互換、例：智譜GLM、DeepSeekなど）"
MSG[de:ai_opt3]="  3) Drittanbieter / benutzerdefinierter Endpunkt (OpenAI-kompatibel, z. B. Zhipu GLM, DeepSeek usw.)"
MSG[ru:ai_opt3]="  3) Сторонний / произвольный endpoint (OpenAI-совместимый, напр. Zhipu GLM, DeepSeek и т.д.)"

MSG[zh:ai_provider_choose]="选一个 [默认：1]: "
MSG[en:ai_provider_choose]="Choose one [default: 1]: "
MSG[ja:ai_provider_choose]="選択してください [デフォルト: 1]: "
MSG[de:ai_provider_choose]="Wähle eine Option [Standard: 1]: "
MSG[ru:ai_provider_choose]="Выберите вариант [по умолчанию: 1]: "

MSG[zh:ai_baseurl_prompt]="接口的域名是什么？（只填域名，${C_YELLOW}不带 http(s):// 前缀${C_RESET}，例如智谱填 open.bigmodel.cn）: "
MSG[en:ai_baseurl_prompt]="What's the endpoint's domain? (hostname only, ${C_YELLOW}no http(s):// prefix${C_RESET}, e.g. open.bigmodel.cn for Zhipu): "
MSG[ja:ai_baseurl_prompt]="エンドポイントのドメインは？（ホスト名のみ、${C_YELLOW}http(s)://は不要${C_RESET}。例：智譜なら open.bigmodel.cn）: "
MSG[de:ai_baseurl_prompt]="Wie lautet die Domain des Endpunkts? (nur Hostname, ${C_YELLOW}ohne http(s)://-Präfix${C_RESET}, z. B. open.bigmodel.cn für Zhipu): "
MSG[ru:ai_baseurl_prompt]="Каков домен эндпоинта? (только hostname, ${C_YELLOW}без http(s)://${C_RESET}, напр. open.bigmodel.cn для Zhipu): "

# apiPath默认走config.example.json里已经文档化的OpenAI标准路径/v1/chat/completions；
# 不是每个第三方接口都用这个路径（智谱实测是/api/paas/v4/chat/completions），
# 所以这里必须让用户自己确认，不能替他们悄悄假设一个可能是错的默认值。
MSG[zh:ai_apipath_prompt]="接口路径是什么？不确定就直接回车，默认用 OpenAI 标准路径 /v1/chat/completions（${C_YELLOW}部分第三方接口不一样，比如智谱是 /api/paas/v4/chat/completions，请去对应服务商文档确认${C_RESET}）: "
MSG[en:ai_apipath_prompt]="What's the API path? Press Enter to use the OpenAI-standard default /v1/chat/completions if unsure (${C_YELLOW}some third-party providers differ — e.g. Zhipu uses /api/paas/v4/chat/completions — check your provider's docs${C_RESET}): "
MSG[ja:ai_apipath_prompt]="APIパスは？わからなければEnterでOpenAI標準の/v1/chat/completionsを使用します（${C_YELLOW}一部のサードパーティは異なります。例：智譜は/api/paas/v4/chat/completions。提供元のドキュメントで確認してください${C_RESET}）: "
MSG[de:ai_apipath_prompt]="Wie lautet der API-Pfad? Bei Unsicherheit Enter drücken für den OpenAI-Standardpfad /v1/chat/completions (${C_YELLOW}manche Drittanbieter weichen ab — z. B. Zhipu nutzt /api/paas/v4/chat/completions — bitte die Doku des Anbieters prüfen${C_RESET}): "
MSG[ru:ai_apipath_prompt]="Каков путь API? Если не уверены, нажмите Enter для стандартного OpenAI-пути /v1/chat/completions (${C_YELLOW}у некоторых сторонних провайдеров он другой — напр. у Zhipu /api/paas/v4/chat/completions — уточните в документации провайдера${C_RESET}): "

MSG[zh:ai_apikey_prompt]="粘贴你的 API Key（输入时不显示，回车确认）: "
MSG[en:ai_apikey_prompt]="Paste your API Key (hidden while typing, press Enter to confirm): "
MSG[ja:ai_apikey_prompt]="APIキーを貼り付けてください（入力中は表示されません、Enterで確定）: "
MSG[de:ai_apikey_prompt]="API-Key einfügen (wird beim Tippen nicht angezeigt, Enter zum Bestätigen): "
MSG[ru:ai_apikey_prompt]="Вставьте ваш API-ключ (ввод скрыт, нажмите Enter для подтверждения): "

MSG[zh:ai_model_prompt]="要指定具体模型吗？（Anthropic 默认：claude-sonnet-4-6，OpenAI 默认：gpt-4o-mini，不确定直接回车）: "
MSG[en:ai_model_prompt]="Specify a model? (Anthropic default: claude-sonnet-4-6, OpenAI default: gpt-4o-mini — press Enter to use the default): "
MSG[ja:ai_model_prompt]="モデルを指定しますか？（Anthropicのデフォルト: claude-sonnet-4-6、OpenAIのデフォルト: gpt-4o-mini。わからなければEnterでデフォルトを使用）: "
MSG[de:ai_model_prompt]="Ein bestimmtes Modell angeben? (Anthropic-Standard: claude-sonnet-4-6, OpenAI-Standard: gpt-4o-mini — Enter für Standard): "
MSG[ru:ai_model_prompt]="Указать модель? (Anthropic по умолчанию: claude-sonnet-4-6, OpenAI по умолчанию: gpt-4o-mini — Enter для значения по умолчанию): "

# 本轮新增：openai-compatible分支专用，跟上面ai_model_prompt不一样——那个可以
# 直接回车走运行时兜底默认值，这个不行（ai-provider.js对这条路径没有默认模型名，
# 留空会直接诊断失败），所以提示文字和校验逻辑都单独区分开，不能共用同一个key。
MSG[zh:ai_model_required_prompt]="填写模型名称（第三方接口没有默认模型，${C_YELLOW}必须填写${C_RESET}，例如智谱填 glm-4.7-flash）: "
MSG[en:ai_model_required_prompt]="Enter the model name (${C_YELLOW}required${C_RESET} for third-party endpoints — there's no default, e.g. glm-4.7-flash for Zhipu): "
MSG[ja:ai_model_required_prompt]="モデル名を入力してください（サードパーティ接続にはデフォルトがないため${C_YELLOW}必須です${C_RESET}。例：智譜なら glm-4.7-flash）: "
MSG[de:ai_model_required_prompt]="Modellnamen eingeben (bei Drittanbieter-Endpunkten ${C_YELLOW}erforderlich${C_RESET}, es gibt keinen Standard, z. B. glm-4.7-flash für Zhipu): "
MSG[ru:ai_model_required_prompt]="Введите название модели (${C_YELLOW}обязательно${C_RESET} для сторонних endpoint'ов — значения по умолчанию нет, напр. glm-4.7-flash для Zhipu): "

MSG[zh:ai_model_required_empty_warn]="${C_RED}模型名称不能为空——第三方接口没有默认模型可用，留空会导致 AI 诊断在运行时直接报错。请重新输入: ${C_RESET}"
MSG[en:ai_model_required_empty_warn]="${C_RED}Model name can't be empty — third-party endpoints have no default model, leaving it blank will make AI diagnosis fail at runtime. Please enter it again: ${C_RESET}"
MSG[ja:ai_model_required_empty_warn]="${C_RED}モデル名は空にできません——サードパーティ接続にはデフォルトモデルがなく、空のままだとAI診断が実行時にエラーになります。もう一度入力してください: ${C_RESET}"
MSG[de:ai_model_required_empty_warn]="${C_RED}Der Modellname darf nicht leer sein — Drittanbieter-Endpunkte haben kein Standardmodell, ein leeres Feld führt dazu, dass die KI-Diagnose zur Laufzeit fehlschlägt. Bitte erneut eingeben: ${C_RESET}"
MSG[ru:ai_model_required_empty_warn]="${C_RED}Название модели не может быть пустым — у сторонних endpoint'ов нет модели по умолчанию, пустое поле приведёт к сбою ИИ-диагностики во время работы. Введите снова: ${C_RESET}"


MSG[zh:ai_enabled_note]="AI 故障诊断已启用。诊断内容和报错都会用你刚才选择的界面语言生成，想改的话去 config.json 里的 ai.language 字段调整。"
MSG[en:ai_enabled_note]="AI diagnosis is enabled. Diagnosis text and error messages will be generated in the interface language you just chose — change this later via the ai.language field in config.json."
MSG[ja:ai_enabled_note]="AI故障診断が有効になりました。診断内容とエラーメッセージは、先ほど選択したインターフェース言語で生成されます。変更したい場合は config.json の ai.language フィールドを編集してください。"
MSG[de:ai_enabled_note]="KI-Diagnose ist aktiviert. Diagnosetext und Fehlermeldungen werden in der gerade gewählten Oberflächensprache erzeugt — das lässt sich später über das Feld ai.language in config.json ändern."
MSG[ru:ai_enabled_note]="ИИ-диагностика включена. Текст диагностики и сообщения об ошибках будут создаваться на только что выбранном языке интерфейса — изменить это можно позже в поле ai.language в config.json."

MSG[zh:ai_skip_note]="已跳过，AI 故障诊断保持关闭，其余功能不受影响，以后随时可以在 config.json 里手动开启。"
MSG[en:ai_skip_note]="Skipped — AI diagnosis stays disabled, nothing else is affected; you can enable it later by editing config.json."
MSG[ja:ai_skip_note]="スキップしました。AI故障診断は無効のままで、他の機能には影響ありません。後で config.json を編集すればいつでも有効化できます。"
MSG[de:ai_skip_note]="Übersprungen — die KI-Diagnose bleibt deaktiviert, alles andere ist nicht betroffen; du kannst sie später über config.json aktivieren."
MSG[ru:ai_skip_note]="Пропущено — ИИ-диагностика остаётся выключенной, на остальное это не влияет; включить её можно позже, отредактировав config.json."

MSG[zh:confirm_summary_title]="-- 写入配置前，最后确认一遍刚才填的关键信息 --"
MSG[en:confirm_summary_title]="-- Before writing the config, please confirm the key answers you just gave --"
MSG[ja:confirm_summary_title]="-- 設定を書き込む前に、先ほど入力した重要な情報を最終確認します --"
MSG[de:confirm_summary_title]="-- Vor dem Schreiben der Konfiguration: letzte Bestätigung der soeben gegebenen Antworten --"
MSG[ru:confirm_summary_title]="-- Перед записью конфигурации подтвердите только что введённые ключевые данные --"

MSG[zh:confirm_summary_node]="节点名称：%s"
MSG[en:confirm_summary_node]="Node name: %s"
MSG[ja:confirm_summary_node]="ノード名：%s"
MSG[de:confirm_summary_node]="Knotenname: %s"
MSG[ru:confirm_summary_node]="Название узла: %s"

MSG[zh:confirm_summary_port]="监控端口：%s"
MSG[en:confirm_summary_port]="Monitored port: %s"
MSG[ja:confirm_summary_port]="監視ポート：%s"
MSG[de:confirm_summary_port]="Überwachter Port: %s"
MSG[ru:confirm_summary_port]="Отслеживаемый порт: %s"

MSG[zh:confirm_summary_service]="服务名：%s　重启命令：%s"
MSG[en:confirm_summary_service]="Service name: %s   Restart command: %s"
MSG[ja:confirm_summary_service]="サービス名：%s　再起動コマンド：%s"
MSG[de:confirm_summary_service]="Dienstname: %s   Neustart-Befehl: %s"
MSG[ru:confirm_summary_service]="Имя службы: %s   Команда перезапуска: %s"

MSG[zh:confirm_summary_panel_pw_set]="面板密码：已设置（不显示具体内容）"
MSG[en:confirm_summary_panel_pw_set]="Panel password: set (not shown here)"
MSG[ja:confirm_summary_panel_pw_set]="パネルパスワード：設定済み（内容は表示しません）"
MSG[de:confirm_summary_panel_pw_set]="Panel-Passwort: gesetzt (wird hier nicht angezeigt)"
MSG[ru:confirm_summary_panel_pw_set]="Пароль панели: установлен (не показывается)"

MSG[zh:confirm_summary_smtp]="邮件通知：SMTP 服务器地址 %s"
MSG[en:confirm_summary_smtp]="Email notifications: SMTP host %s"
MSG[ja:confirm_summary_smtp]="メール通知：SMTPサーバーアドレス %s"
MSG[de:confirm_summary_smtp]="E-Mail-Benachrichtigungen: SMTP-Host %s"
MSG[ru:confirm_summary_smtp]="Уведомления по email: SMTP-хост %s"

MSG[zh:confirm_summary_smtp_skipped]="邮件通知：已跳过，以后可在面板设置里补上"
MSG[en:confirm_summary_smtp_skipped]="Email notifications: skipped, can be added later in panel settings"
MSG[ja:confirm_summary_smtp_skipped]="メール通知：スキップ済み。後でパネル設定から追加できます"
MSG[de:confirm_summary_smtp_skipped]="E-Mail-Benachrichtigungen: übersprungen, kann später in den Panel-Einstellungen ergänzt werden"
MSG[ru:confirm_summary_smtp_skipped]="Уведомления по email: пропущено, можно добавить позже в настройках панели"

MSG[zh:confirm_summary_ai_on]="AI 故障诊断：已开启"
MSG[en:confirm_summary_ai_on]="AI diagnosis: enabled"
MSG[ja:confirm_summary_ai_on]="AI故障診断：有効"
MSG[de:confirm_summary_ai_on]="KI-Diagnose: aktiviert"
MSG[ru:confirm_summary_ai_on]="ИИ-диагностика: включена"

MSG[zh:confirm_summary_ai_off]="AI 故障诊断：未开启"
MSG[en:confirm_summary_ai_off]="AI diagnosis: disabled"
MSG[ja:confirm_summary_ai_off]="AI故障診断：無効"
MSG[de:confirm_summary_ai_off]="KI-Diagnose: deaktiviert"
MSG[ru:confirm_summary_ai_off]="ИИ-диагностика: отключена"

MSG[zh:confirm_summary_ask]="以上信息正确吗？[Y/n]: "
MSG[en:confirm_summary_ask]="Is the above correct? [Y/n]: "
MSG[ja:confirm_summary_ask]="上記の内容で正しいですか？[Y/n]: "
MSG[de:confirm_summary_ask]="Ist das oben Genannte korrekt? [Y/n]: "
MSG[ru:confirm_summary_ask]="Всё указанное выше верно? [Y/n]: "

MSG[zh:confirm_summary_restart_hint]="好的，config.json 还没有写入任何内容，直接重新运行一遍「sudo bash install.sh」就能重新回答这些问题。"
MSG[en:confirm_summary_restart_hint]="OK — nothing has been written to config.json yet. Just run \"sudo bash install.sh\" again to answer these questions from scratch."
MSG[ja:confirm_summary_restart_hint]="了解しました。config.json にはまだ何も書き込まれていません。「sudo bash install.sh」をもう一度実行すれば、最初から質問に答え直せます。"
MSG[de:confirm_summary_restart_hint]="OK — in config.json wurde noch nichts geschrieben. Führe einfach erneut \"sudo bash install.sh\" aus, um die Fragen von vorn zu beantworten."
MSG[ru:confirm_summary_restart_hint]="Хорошо — в config.json пока ничего не записано. Просто запустите «sudo bash install.sh» ещё раз, чтобы ответить на вопросы заново."

MSG[zh:config_written]="面板密码、邮箱账号等信息已经写进 config/config.json，不需要你再手动编辑。"
MSG[en:config_written]="Panel password, email account, etc. have been written to config/config.json — you never need to edit it by hand."
MSG[ja:config_written]="パネルパスワードやメールアカウントなどの情報は config/config.json に自動保存されました。手動で編集する必要はありません。"
MSG[de:config_written]="Panel-Passwort, E-Mail-Konto usw. wurden in config/config.json geschrieben — du musst sie nie manuell bearbeiten."
MSG[ru:config_written]="Пароль панели, email и т.д. записаны в config/config.json — редактировать вручную не нужно."

MSG[zh:config_exists_skip]="检测到已有配置文件 config/config.json，跳过问答，直接沿用现有配置。"
MSG[en:config_exists_skip]="Found an existing config/config.json, skipping questions and reusing it."
MSG[ja:config_exists_skip]="既存の config/config.json を検出しました。質問はスキップし、既存設定を使用します。"
MSG[de:config_exists_skip]="Vorhandene config/config.json gefunden, Fragen werden übersprungen und die bestehende Konfiguration verwendet."
MSG[ru:config_exists_skip]="Найден существующий config/config.json, вопросы пропущены, используется текущая конфигурация."

# ---------- 流量池（可选，应急安全气囊）----------
MSG[zh:pool_title]="-- 流量池（默认开启，应急兜底功能） --"
MSG[en:pool_title]="-- Backup Node Pool (enabled by default) --"
MSG[ja:pool_title]="-- 予備ノードプール（デフォルトで有効） --"
MSG[de:pool_title]="-- Notfall-Knotenpool (standardmäßig aktiviert) --"
MSG[ru:pool_title]="-- Резервный пул узлов (включён по умолчанию) --"

MSG[zh:pool_explain]="流量池是应急兜底：你的节点异常时，临时借用开源抓取的陌生节点顶一下，恢复后自动切回。这些是别人的服务器，安全性未知，只做临时应急。这个功能默认会尝试自动安装（需要能访问 GitHub/pip 源，网络受限的服务器可能装不上，装不上也不影响其它功能），不需要你手动选择；如果想关掉，之后随时可以把 config.json 里的 pool.enabled 改成 false。"
MSG[en:pool_explain]="The backup pool is an optional safety net: if your own node goes down, NodeNanny can temporarily fall back to openly-crawled nodes from strangers, then switch back once you recover. These are other people's servers with unknown safety — for emergencies only. This is now installed automatically by default (needs access to GitHub/pip; may fail on restricted networks without affecting anything else). No need to choose — you can disable it later by setting pool.enabled to false in config.json."
MSG[ja:pool_explain]="予備ノードプールは緊急用の機能です。あなたのノードが異常になった際、一時的にオープンソースで収集した見知らぬ人のノードを使い、復旧後は自動的に戻ります。これらは他人のサーバーで安全性は保証されません。緊急時のみの利用です。この機能はデフォルトで自動的にインストールが試みられます（GitHub/pip へのアクセスが必要で、ネットワーク制限のあるサーバーでは失敗する場合がありますが、他の機能には影響しません）。選択は不要です。後で無効にしたい場合は config.json の pool.enabled を false にしてください。"
MSG[de:pool_explain]="Der Notfall-Pool ist ein Sicherheitsnetz: Fällt dein eigener Knoten aus, kann NodeNanny vorübergehend auf offen gecrawlte Knoten fremder Server zurückgreifen und nach der Wiederherstellung automatisch zurückschalten. Das sind fremde Server mit unbekannter Sicherheit — nur für Notfälle. Diese Funktion wird jetzt standardmäßig automatisch installiert (benötigt Zugriff auf GitHub/pip; kann bei eingeschränktem Netzwerk fehlschlagen, ohne andere Funktionen zu beeinträchtigen). Keine Auswahl nötig — später kannst du sie deaktivieren, indem du pool.enabled in config.json auf false setzt."
MSG[ru:pool_explain]="Резервный пул — подстраховка на случай сбоя: если ваш узел выйдет из строя, NodeNanny временно переключится на открыто собранные узлы чужих серверов, а после восстановления вернётся обратно. Это чужие серверы с неизвестной безопасностью — только для экстренных случаев. Теперь эта функция по умолчанию устанавливается автоматически (нужен доступ к GitHub/pip; на серверах с ограниченной сетью может не сработать, это не повлияет на остальное). Выбирать ничего не нужно — отключить можно позже, поставив pool.enabled в config.json в false."

MSG[zh:pool_already_enabled]="检测到流量池此前已经成功启用过，跳过重复安装。"
MSG[en:pool_already_enabled]="Backup pool was already enabled previously — skipping reinstall."
MSG[ja:pool_already_enabled]="予備ノードプールは以前に既に有効化されているため、再インストールをスキップします。"
MSG[de:pool_already_enabled]="Der Notfall-Pool wurde bereits zuvor aktiviert — erneute Installation wird übersprungen."
MSG[ru:pool_already_enabled]="Резервный пул уже был включён ранее — повторная установка пропущена."

# v21:pool_ask 已移除——流量池改成默认自动尝试安装，不再询问是否启用(见install.sh 5b节说明)

MSG[zh:pool_installing]="正在尝试安装 wzdnzd/aggregator（git clone + pip install，可能需要几分钟）…"
MSG[en:pool_installing]="Attempting to install wzdnzd/aggregator (git clone + pip install, may take a few minutes)…"
MSG[ja:pool_installing]="wzdnzd/aggregator のインストールを試みています（git clone + pip install、数分かかる場合があります）…"
MSG[de:pool_installing]="Versuche, wzdnzd/aggregator zu installieren (git clone + pip install, kann einige Minuten dauern)…"
MSG[ru:pool_installing]="Пытаемся установить wzdnzd/aggregator (git clone + pip install, может занять несколько минут)…"

MSG[zh:pool_install_failed]="安装失败，这不影响 NodeNanny 其它功能正常使用。流量池功能已保持关闭（config.json 里 pool.enabled=false），你可以之后手动装好 aggregator 再改配置启用。失败日志：/tmp/nodenanny-pool-install.log"
MSG[en:pool_install_failed]="Install failed — this does not affect any other NodeNanny feature. The pool stays disabled (pool.enabled=false in config.json); you can install aggregator manually later and flip it on. Failure log: /tmp/nodenanny-pool-install.log"
MSG[ja:pool_install_failed]="インストールに失敗しました。これは他のNodeNanny機能には影響しません。プール機能は無効のままです（config.jsonのpool.enabled=false）。後で手動でaggregatorをインストールしてから有効化できます。失敗ログ：/tmp/nodenanny-pool-install.log"
MSG[de:pool_install_failed]="Installation fehlgeschlagen — das beeinträchtigt keine andere NodeNanny-Funktion. Der Pool bleibt deaktiviert (pool.enabled=false in config.json); du kannst aggregator später manuell installieren und dann aktivieren. Fehlerprotokoll: /tmp/nodenanny-pool-install.log"
MSG[ru:pool_install_failed]="Установка не удалась — это не влияет на остальные функции NodeNanny. Пул остаётся выключенным (pool.enabled=false в config.json); можно установить aggregator вручную позже и включить. Лог ошибки: /tmp/nodenanny-pool-install.log"

MSG[zh:pool_install_ok]="wzdnzd/aggregator 安装完成，流量池功能已启用。首次抓取会在面板/守护进程启动后自动跑一次，也可以在面板里手动触发。请注意：目前抓取默认不做可用性筛选，属于\"未经筛选的应急兜底\"，节点质量无法保证，仅建议在主节点异常的短时间内临时使用。"
MSG[en:pool_install_ok]="wzdnzd/aggregator installed. The backup pool is now enabled. The first fetch runs automatically once the services start; you can also trigger it manually from the panel. Note: fetched nodes are currently NOT quality-filtered — this is an unfiltered emergency fallback with no quality guarantee, meant only for short-term use while your main node is down."
MSG[ja:pool_install_ok]="wzdnzd/aggregator のインストールが完了しました。予備ノードプール機能が有効になりました。初回の取得はサービス起動後に自動実行されます。パネルから手動実行することもできます。注意：現在の取得はデフォルトで可用性フィルタリングを行っておらず、「未選別の緊急用フォールバック」です。品質は保証されないため、メインノードが異常な間の一時的な利用にとどめてください。"
MSG[de:pool_install_ok]="wzdnzd/aggregator installiert. Der Notfall-Pool ist jetzt aktiviert. Der erste Abruf läuft automatisch, sobald die Dienste starten; du kannst ihn auch manuell im Panel auslösen. Hinweis: Abgerufene Knoten werden derzeit NICHT auf Qualität geprüft — dies ist ein ungefilterter Notfall-Fallback ohne Qualitätsgarantie, nur für die kurzzeitige Nutzung gedacht, während dein Hauptknoten ausfällt."
MSG[ru:pool_install_ok]="wzdnzd/aggregator установлен. Резервный пул теперь включён. Первая загрузка запустится автоматически при старте сервисов; можно также запустить вручную из панели. Внимание: полученные узлы сейчас НЕ проходят проверку качества — это нефильтрованный аварийный резерв без гарантии качества, предназначен только для кратковременного использования, пока основной узел не работает."

MSG[zh:singbox_found]="检测到 sing-box 已安装（%s），跳过安装。"
MSG[en:singbox_found]="sing-box already installed (%s), skipping install."
MSG[ja:singbox_found]="sing-box は既にインストール済みです（%s）。インストールをスキップします。"
MSG[de:singbox_found]="sing-box ist bereits installiert (%s), Installation wird übersprungen."
MSG[ru:singbox_found]="sing-box уже установлен (%s), установка пропущена."

MSG[zh:singbox_installing]="流量池的三层检测（存活/测速/真实性验证）需要 sing-box 作为检测后端，正在通过官方 apt 源安装 sing-box（可能需要一两分钟）…"
MSG[en:singbox_installing]="The pool's three-layer check (alive/speed/authenticity) needs sing-box as its backend. Installing sing-box via the official apt repo (may take a minute or two)…"
MSG[ja:singbox_installing]="プールの三層検査（生存確認/速度測定/真正性検証）には検出バックエンドとして sing-box が必要です。公式 apt リポジトリから sing-box をインストールしています（1〜2分かかる場合があります）…"
MSG[de:singbox_installing]="Die dreistufige Prüfung des Pools (Erreichbarkeit/Geschwindigkeit/Echtheit) benötigt sing-box als Backend. Installiere sing-box über das offizielle apt-Repository (kann ein bis zwei Minuten dauern)…"
MSG[ru:singbox_installing]="Трёхуровневая проверка пула (доступность/скорость/подлинность) требует sing-box в качестве бэкенда. Устанавливаем sing-box из официального apt-репозитория (может занять пару минут)…"

MSG[zh:singbox_install_ok]="sing-box 安装完成，流量池的三层检测功能可以正常工作了。"
MSG[en:singbox_install_ok]="sing-box installed. The pool's three-layer check is now fully functional."
MSG[ja:singbox_install_ok]="sing-box のインストールが完了しました。プールの三層検査機能が正常に動作するようになりました。"
MSG[de:singbox_install_ok]="sing-box installiert. Die dreistufige Prüfung des Pools ist jetzt voll funktionsfähig."
MSG[ru:singbox_install_ok]="sing-box установлен. Трёхуровневая проверка пула теперь полностью работоспособна."

MSG[zh:singbox_install_failed]="sing-box 自动安装失败，这不影响 NodeNanny 主监控功能，但流量池抓到的候选节点会因为缺少检测后端全部无法通过三层检测（表现为一直选不出任何备用节点）。安装日志：/tmp/nodenanny-singbox-install.log。可以之后参考 https://sing-box.sagernet.org/installation/package-manager/ 手动安装，装好后执行 pm2 restart nodenanny-pool 即可生效，不需要重新跑一遍安装脚本。"
MSG[en:singbox_install_failed]="Automatic sing-box install failed. This does not affect NodeNanny's main monitoring, but candidate nodes fetched by the pool will all fail the three-layer check for lack of a detection backend (you'll see the pool never producing any backup node). Install log: /tmp/nodenanny-singbox-install.log. You can install it manually later following https://sing-box.sagernet.org/installation/package-manager/, then run pm2 restart nodenanny-pool — no need to rerun this installer."
MSG[ja:singbox_install_failed]="sing-box の自動インストールに失敗しました。これは NodeNanny の主要な監視機能には影響しませんが、検出バックエンドがないため、プールが取得した候補ノードはすべて三層検査に通らなくなります（予備ノードが一向に選出されない状態になります）。インストールログ：/tmp/nodenanny-singbox-install.log。後で https://sing-box.sagernet.org/installation/package-manager/ を参考に手動インストールし、pm2 restart nodenanny-pool を実行すれば反映されます。インストーラーを再実行する必要はありません。"
MSG[de:singbox_install_failed]="Die automatische Installation von sing-box ist fehlgeschlagen. Das beeinträchtigt nicht die Hauptüberwachung von NodeNanny, aber alle vom Pool abgerufenen Kandidatenknoten scheitern mangels Prüf-Backend an der dreistufigen Prüfung (der Pool liefert dann nie einen Ersatzknoten). Installationsprotokoll: /tmp/nodenanny-singbox-install.log. Du kannst es später manuell installieren, siehe https://sing-box.sagernet.org/installation/package-manager/, und danach pm2 restart nodenanny-pool ausführen — das Installationsskript muss nicht erneut laufen."
MSG[ru:singbox_install_failed]="Автоматическая установка sing-box не удалась. Это не влияет на основной мониторинг NodeNanny, но все узлы-кандидаты, полученные пулом, не пройдут трёхуровневую проверку из-за отсутствия бэкенда проверки (пул никогда не выдаст резервный узел). Лог установки: /tmp/nodenanny-singbox-install.log. Можно установить вручную позже по инструкции https://sing-box.sagernet.org/installation/package-manager/, затем выполнить pm2 restart nodenanny-pool — повторно запускать установщик не нужно."

MSG[zh:pool_skip_note]="已跳过，流量池功能保持关闭，其余功能不受影响。"
MSG[en:pool_skip_note]="Skipped — the backup pool stays disabled, nothing else is affected."
MSG[ja:pool_skip_note]="スキップしました。予備ノードプール機能は無効のままで、他の機能には影響ありません。"
MSG[de:pool_skip_note]="Übersprungen — der Notfall-Pool bleibt deaktiviert, alles andere ist nicht betroffen."
MSG[ru:pool_skip_note]="Пропущено — резервный пул остаётся выключенным, на остальное это не влияет."

# ---------- 批次三新增：GitHub候选来源自动发现（自愈生态，试验性功能）----------
MSG[zh:discovery_title]="-- GitHub 候选来源自动发现（可选，自愈生态，试验性功能）--"
MSG[en:discovery_title]="-- GitHub Candidate Source Discovery (optional, self-healing pool, experimental) --"
MSG[ja:discovery_title]="-- GitHub 候補ソース自動発見（任意、自己修復エコシステム、試験的機能）--"
MSG[de:discovery_title]="-- Automatische Quellenerkennung via GitHub (optional, selbstheilender Pool, experimentell) --"
MSG[ru:discovery_title]="-- Автопоиск источников на GitHub (опционально, самовосстанавливающийся пул, экспериментально) --"

MSG[zh:discovery_explain]="这是流量池的进阶功能：定期自动扫描 GitHub 上公开的节点分享仓库，发现新的候选来源后先观察一段时间（约42小时/7轮检测），持续产出可用节点才会正式启用，通过率不达标会自动淘汰，全程不需要你手动管理。这个功能还比较新（试验性），会额外消耗一些服务器 CPU 和出站流量去检测候选节点，2H2G 这类小规格服务器请留意资源占用。跳过的话流量池仍然正常可用（只是没有这个自动发现新来源的能力），以后随时可以去 config.json 里的 pool.discovery.enabled 手动打开。"
MSG[en:discovery_explain]="This is an advanced pool feature: it periodically scans public node-sharing repos on GitHub, then puts newly found sources through a trial period (about 42 hours / 7 checks) before trusting them — sources that keep failing get automatically dropped, no manual management needed. This feature is still fairly new (experimental) and uses some extra server CPU and outbound traffic to check candidate nodes — worth watching on small 2GB-RAM servers. Skipping this still leaves the backup pool fully usable (just without automatic discovery of new sources); you can turn it on later anytime via pool.discovery.enabled in config.json."
MSG[ja:discovery_explain]="これは予備ノードプールの上級機能です。GitHub上で公開されているノード共有リポジトリを定期的にスキャンし、新しく見つけた候補ソースはまず試用期間（約42時間・7回の検査）を経てから正式に信頼します。通過率が基準に届かなければ自動的に除外され、手動管理は不要です。この機能はまだ新しく（試験的）、候補ノードの検査にサーバーのCPUと送信トラフィックを追加で消費するため、2H2Gのような小規模サーバーではリソース状況に注意してください。スキップしても予備ノードプール自体は問題なく使えます（新しいソースの自動発見機能がないだけです）。後で config.json の pool.discovery.enabled からいつでも手動で有効化できます。"
MSG[de:discovery_explain]="Dies ist eine fortgeschrittene Pool-Funktion: Sie durchsucht regelmäßig öffentliche Node-Sharing-Repos auf GitHub und stellt neu gefundene Quellen zunächst auf eine Testphase (ca. 42 Stunden / 7 Prüfzyklen), bevor sie ihnen vertraut — Quellen, die dauerhaft durchfallen, werden automatisch aussortiert, ganz ohne manuellen Eingriff. Die Funktion ist noch recht neu (experimentell) und verbraucht zusätzliche Server-CPU und ausgehenden Traffic für die Prüfung der Kandidaten-Knoten — bei kleinen 2GB-RAM-Servern im Auge behalten. Wenn du das überspringst, bleibt der Notfall-Pool trotzdem voll nutzbar (nur ohne automatische Erkennung neuer Quellen); du kannst es später jederzeit über pool.discovery.enabled in config.json manuell aktivieren."
MSG[ru:discovery_explain]="Это продвинутая функция пула: он периодически сканирует публичные репозитории с узлами на GitHub, а новые найденные источники сначала проходят испытательный период (около 42 часов / 7 проверок), прежде чем им начнут доверять — источники, которые постоянно не проходят проверку, автоматически отсеиваются, без ручного управления. Функция пока довольно новая (экспериментальная) и расходует дополнительные ресурсы CPU и исходящий трафик сервера на проверку узлов-кандидатов — на маленьких серверах с 2 ГБ ОЗУ стоит следить за нагрузкой. Если пропустить этот шаг, резервный пул всё равно будет полностью рабочим (просто без автопоиска новых источников); включить можно в любой момент позже через pool.discovery.enabled в config.json."

MSG[zh:discovery_ask]="要现在启用这个功能吗？[y/N]: "
MSG[en:discovery_ask]="Enable this feature now? [y/N]: "
MSG[ja:discovery_ask]="今、この機能を有効にしますか？[y/N]: "
MSG[de:discovery_ask]="Diese Funktion jetzt aktivieren? [y/N]: "
MSG[ru:discovery_ask]="Включить эту функцию сейчас? [y/N]: "

MSG[zh:discovery_already_enabled]="检测到 GitHub 候选来源发现功能此前已经启用过，跳过重复询问。"
MSG[en:discovery_already_enabled]="GitHub source discovery was already enabled previously — skipping the question."
MSG[ja:discovery_already_enabled]="GitHub 候補ソース自動発見機能は以前に既に有効化されているため、質問をスキップします。"
MSG[de:discovery_already_enabled]="Die GitHub-Quellenerkennung wurde bereits zuvor aktiviert — die Frage wird übersprungen."
MSG[ru:discovery_already_enabled]="Автопоиск источников на GitHub уже был включён ранее — вопрос пропущен."

MSG[zh:discovery_token_explain]="GitHub 有两种扫描方式：按标签（topic）搜索不需要令牌；按文件名搜索需要一个 GitHub token 才能用（这是 GitHub 自己的接口限制，免费账号生成的 token 就够，不涉及付费）。不提供 token 的话功能依然会运行，只是少了按文件名搜索这一种方式，发现的候选会相应少一些。现在没有 token、也不想去生成的话，直接回车跳过即可，以后随时可以去 config.json 里的 pool.discovery.githubToken 补上。"
MSG[en:discovery_token_explain]="GitHub scanning works two ways: topic search needs no token; filename search requires a GitHub token (that's GitHub's own API restriction — a free account's token is enough, no payment involved). Without a token the feature still runs, just without filename search, so it'll find somewhat fewer candidates. If you don't have one and don't want to generate one now, just press Enter to skip — you can add it later via pool.discovery.githubToken in config.json."
MSG[ja:discovery_token_explain]="GitHub のスキャン方式は2種類あります。トピック検索はトークン不要、ファイル名検索には GitHub token が必要です（これは GitHub 側 API の制限で、無料アカウントで発行した token で十分、課金は不要です）。token を指定しなくても機能自体は動きますが、ファイル名検索の分だけ発見できる候補が少なくなります。今 token がなく、生成したくない場合はそのまま Enter でスキップしてください。後で config.json の pool.discovery.githubToken からいつでも追加できます。"
MSG[de:discovery_token_explain]="GitHub-Scans funktionieren auf zwei Arten: Themen-Suche braucht kein Token; Dateinamen-Suche benötigt ein GitHub-Token (das ist eine API-Einschränkung von GitHub selbst — ein Token eines kostenlosen Accounts reicht aus, keine Kosten). Ohne Token läuft die Funktion trotzdem, nur ohne Dateinamen-Suche, wodurch etwas weniger Kandidaten gefunden werden. Falls du gerade keins hast und keins erstellen willst, einfach Enter drücken zum Überspringen — du kannst es später jederzeit über pool.discovery.githubToken in config.json ergänzen."
MSG[ru:discovery_token_explain]="Сканирование GitHub работает двумя способами: поиск по темам (topic) не требует токена; поиск по имени файла требует GitHub-токен (это ограничение самого API GitHub — токена бесплатного аккаунта достаточно, оплата не нужна). Без токена функция всё равно будет работать, просто без поиска по имени файла, поэтому кандидатов найдётся немного меньше. Если сейчас токена нет и генерировать не хочется, просто нажмите Enter, чтобы пропустить — добавить можно позже через pool.discovery.githubToken в config.json."

MSG[zh:discovery_token_ask]="GitHub token（可选，直接回车跳过）: "
MSG[en:discovery_token_ask]="GitHub token (optional, press Enter to skip): "
MSG[ja:discovery_token_ask]="GitHub token（任意、そのまま Enter でスキップ）: "
MSG[de:discovery_token_ask]="GitHub-Token (optional, Enter zum Überspringen): "
MSG[ru:discovery_token_ask]="GitHub token (необязательно, Enter — пропустить): "

MSG[zh:discovery_enabled_note]="已启用。第一次扫描会在流量池下次刷新时自动进行，不需要你再做任何事。"
MSG[en:discovery_enabled_note]="Enabled. The first scan runs automatically the next time the pool refreshes — nothing else for you to do."
MSG[ja:discovery_enabled_note]="有効になりました。初回スキャンは次回の予備ノードプール更新時に自動実行されます。他に何もする必要はありません。"
MSG[de:discovery_enabled_note]="Aktiviert. Der erste Scan läuft automatisch bei der nächsten Pool-Aktualisierung — du musst nichts weiter tun."
MSG[ru:discovery_enabled_note]="Включено. Первое сканирование запустится автоматически при следующем обновлении пула — больше ничего делать не нужно."

MSG[zh:discovery_skip_note]="已跳过，流量池只使用你自己安装的固定来源，不受影响。"
MSG[en:discovery_skip_note]="Skipped — the pool still uses only your own installed fixed source, unaffected."
MSG[ja:discovery_skip_note]="スキップしました。予備ノードプールは自分でインストールした固定ソースのみを使用し、影響はありません。"
MSG[de:discovery_skip_note]="Übersprungen — der Pool nutzt weiterhin nur deine selbst installierte feste Quelle, unbeeinflusst."
MSG[ru:discovery_skip_note]="Пропущено — пул по-прежнему использует только вашу собственную установленную фиксированную источник, это не затронуто."

MSG[zh:manual_source_title]="-- 手动种子来源（可选，几条社区分享的免费订阅，跟GitHub自动发现彼此独立）--"
MSG[en:manual_source_title]="-- Manual Seed Sources (optional, a few community-shared free subscriptions, independent of GitHub auto-discovery) --"
MSG[ja:manual_source_title]="-- 手動シードソース（任意、コミュニティ共有の無料サブスクリプション数件、GitHub自動発見とは独立）--"
MSG[de:manual_source_title]="-- Manuelle Seed-Quellen (optional, einige von der Community geteilte kostenlose Abos, unabhängig von der GitHub-Auto-Erkennung) --"
MSG[ru:manual_source_title]="-- Ручные исходные источники (опционально, несколько бесплатных подписок из сообщества, независимо от автопоиска на GitHub) --"

MSG[zh:manual_source_explain]="这是几条项目维护者自己验证过、来自社区分享的免费订阅链接（不是你自己的服务器，是别人维护的免费机场/订阅）。启用后，这几条来源会跟GitHub自动发现来源一样，走同一套试用期/信任状态机——不会因为是内置的就直接给永久信任，一样要先过检测、按实测通过率决定要不要转正，持续不达标会被自动降级/拉黑。这类免费来源的可用性、运营者是否可信都无法完全保证，只作为流量池的补充候选，不建议长期依赖。跳过的话流量池仍然正常可用，以后随时可以去 config.json 里的 pool.manualSources 手动添加。"
MSG[en:manual_source_explain]="These are a few free subscription links shared by the community that the project maintainer has personally verified (not your own server — someone else's free proxy/subscription). If enabled, these sources go through the exact same trial/trust state machine as GitHub-discovered sources — being built-in doesn't grant permanent trust; they still have to pass detection and earn trust based on actual pass rate, and get downgraded/blacklisted automatically if they keep failing. The availability and trustworthiness of these free sources can't be fully guaranteed — they're just supplementary candidates for the pool, not something to rely on long-term. Skipping this still leaves the pool fully usable; you can add sources later anytime via pool.manualSources in config.json."
MSG[ja:manual_source_explain]="これらはプロジェクト管理者本人が確認済みの、コミュニティで共有されている無料サブスクリプションリンク数件です（あなた自身のサーバーではなく、他人が運用する無料の共有ノード/サブスクリプションです）。有効にすると、これらのソースもGitHub発見ソースと全く同じ試用期間・信頼状態マシンを経ます——組み込みだからといって無条件で永久信頼されるわけではなく、検出を通過し、実際の通過率に基づいて信頼を得る必要があり、基準を満たさなければ自動的に降格・除外されます。これら無料ソースの可用性や運営者の信頼性は完全には保証できず、あくまで予備ノードプールの補助的候補であり、長期的に依存することはおすすめしません。スキップしても予備ノードプールは問題なく使えます。後で config.json の pool.manualSources からいつでも手動で追加できます。"
MSG[de:manual_source_explain]="Das sind einige kostenlose Abo-Links, die von der Community geteilt und vom Projektbetreuer persönlich geprüft wurden (nicht dein eigener Server — ein von jemand anderem betriebenes kostenloses Proxy/Abo). Bei Aktivierung durchlaufen diese Quellen genau denselben Test-/Vertrauens-Zustandsautomaten wie von GitHub entdeckte Quellen — eingebaut zu sein verleiht kein dauerhaftes Vertrauen; sie müssen die Prüfung bestehen und sich das Vertrauen anhand der tatsächlichen Erfolgsquote verdienen, und werden bei anhaltendem Versagen automatisch herabgestuft/gesperrt. Verfügbarkeit und Vertrauenswürdigkeit dieser kostenlosen Quellen können nicht vollständig garantiert werden — sie sind nur ergänzende Kandidaten für den Pool, nicht etwas, worauf man sich langfristig verlassen sollte. Wenn du das überspringst, bleibt der Pool trotzdem voll nutzbar; du kannst Quellen später jederzeit über pool.manualSources in config.json hinzufügen."
MSG[ru:manual_source_explain]="Это несколько бесплатных ссылок на подписки, которыми поделилось сообщество и которые лично проверил разработчик проекта (это не ваш собственный сервер, а чей-то чужой бесплатный прокси/подписка). При включении эти источники проходят точно такой же испытательный период / систему доверия, что и источники, найденные через GitHub — то, что источник встроенный, не даёт постоянного доверия; ему всё равно нужно пройти проверку и заслужить доверие на основе реального процента успешных проверок, а при постоянных сбоях он автоматически понижается/блокируется. Доступность и надёжность этих бесплатных источников нельзя полностью гарантировать — это лишь дополнительные кандидаты для пула, не то, на что стоит полагаться долгосрочно. Если пропустить этот шаг, пул всё равно будет полностью рабочим; источники можно добавить позже через pool.manualSources в config.json."

# 本轮修复：文字之前是[y/N]，但install.sh里ask_yn传的第三个参数一直是"Y"——
# 文字和代码实际默认值本来就对不上，这里改成[Y/n]让文字如实反映真正的默认行为
# （founder本轮也确认了希望这条默认开启，跟代码原意一致）。
MSG[zh:manual_source_ask]="要现在启用这几条手动种子来源吗？[Y/n]: "
MSG[en:manual_source_ask]="Enable these manual seed sources now? [Y/n]: "
MSG[ja:manual_source_ask]="今、この手動シードソースを有効にしますか？[Y/n]: "
MSG[de:manual_source_ask]="Diese manuellen Seed-Quellen jetzt aktivieren? [Y/n]: "
MSG[ru:manual_source_ask]="Включить эти ручные исходные источники сейчас? [Y/n]: "

MSG[zh:manual_source_already_enabled]="检测到手动种子来源此前已经配置过，跳过重复询问。"
MSG[en:manual_source_already_enabled]="Manual seed sources were already configured previously — skipping the question."
MSG[ja:manual_source_already_enabled]="手動シードソースは以前に既に設定されているため、質問をスキップします。"
MSG[de:manual_source_already_enabled]="Manuelle Seed-Quellen wurden bereits zuvor konfiguriert — die Frage wird übersprungen."
MSG[ru:manual_source_already_enabled]="Ручные исходные источники уже были настроены ранее — вопрос пропущен."

MSG[zh:manual_source_enabled_note]="已启用。这几条来源会在流量池下次刷新时跟其它来源一起接受检测，不需要你再做任何事。"
MSG[en:manual_source_enabled_note]="Enabled. These sources will be checked alongside the others the next time the pool refreshes — nothing else for you to do."
MSG[ja:manual_source_enabled_note]="有効になりました。これらのソースは次回の予備ノードプール更新時に他のソースと一緒に検査されます。他に何もする必要はありません。"
MSG[de:manual_source_enabled_note]="Aktiviert. Diese Quellen werden bei der nächsten Pool-Aktualisierung zusammen mit den anderen geprüft — du musst nichts weiter tun."
MSG[ru:manual_source_enabled_note]="Включено. Эти источники будут проверены вместе с остальными при следующем обновлении пула — больше ничего делать не нужно."

MSG[zh:manual_source_skip_note]="已跳过，流量池不会使用这几条手动种子来源，不影响其它功能。"
MSG[en:manual_source_skip_note]="Skipped — the pool won't use these manual seed sources; other features are unaffected."
MSG[ja:manual_source_skip_note]="スキップしました。予備ノードプールはこれらの手動シードソースを使用しません。他の機能には影響ありません。"
MSG[de:manual_source_skip_note]="Übersprungen — der Pool nutzt diese manuellen Seed-Quellen nicht; andere Funktionen sind nicht betroffen."
MSG[ru:manual_source_skip_note]="Пропущено — пул не будет использовать эти ручные исходные источники; на остальные функции это не влияет."

# ---------- 5e. 在线终端（本轮新增，修复"部署过程从未问过终端密码"的缺口）----------
MSG[zh:terminal_title]="在线终端（可选功能，涉及安全，请谨慎开启）"
MSG[en:terminal_title]="Online Terminal (optional, security-sensitive — enable with care)"
MSG[ja:terminal_title]="オンラインターミナル（任意機能、セキュリティに関わるため慎重に有効化してください）"
MSG[de:terminal_title]="Online-Terminal (optional, sicherheitsrelevant — mit Bedacht aktivieren)"
MSG[ru:terminal_title]="Онлайн-терминал (опционально, связано с безопасностью — включайте осторожно)"

MSG[zh:terminal_explain]="面板里有一个网页版终端，能让你不用 SSH 客户端、直接在浏览器里对服务器敲命令。开启后除了面板登录密码，打开终端前还要单独输入一次这里设置的密码，作为多一层保护。如果你不确定要不要用，选「否」就好，以后随时可以手动改配置文件再开启。"
MSG[en:terminal_explain]="The panel includes a browser-based terminal so you can run commands on the server without an SSH client. If enabled, opening it requires a separate password (on top of your panel login) as an extra layer of protection. If you're not sure, choose \"No\" — you can always turn it on later by editing the config file."
MSG[ja:terminal_explain]="パネルにはブラウザから直接サーバーにコマンドを打てるWeb版ターミナルがあります。有効にすると、パネルのログインパスワードとは別に、ターミナルを開く前にここで設定するパスワードをもう一度入力する必要があり、追加の保護層になります。迷う場合は「いいえ」を選んでください。後からいつでも設定ファイルを編集して有効化できます。"
MSG[de:terminal_explain]="Das Panel enthält ein browserbasiertes Terminal, mit dem du Befehle auf dem Server ausführen kannst, ohne einen SSH-Client zu benötigen. Wenn aktiviert, muss vor dem Öffnen zusätzlich zum Panel-Login-Passwort ein hier festgelegtes Passwort eingegeben werden — eine zusätzliche Schutzschicht. Bei Unsicherheit wähle \"Nein\" — du kannst es später jederzeit durch Bearbeiten der Konfigurationsdatei aktivieren."
MSG[ru:terminal_explain]="В панели есть веб-терминал, позволяющий выполнять команды на сервере прямо из браузера, без SSH-клиента. При включении перед открытием терминала потребуется отдельно ввести пароль, заданный здесь (в дополнение к паролю входа в панель) — как дополнительный уровень защиты. Если не уверены, выберите «Нет» — включить можно в любой момент позже, отредактировав файл конфигурации."

# 本轮修改（founder本轮要求的默认值变更）：从默认关闭改成默认开启。注意——
# 这只是改了"按回车时选哪个"，并没有削弱密码强制要求：install.sh里紧跟着的
# ask_secret NN_TERMINAL_PASSWORD逻辑不变，密码留空时仍然不会写enabled:true，
# 不会出现"默认开了终端但没有密码保护"的情况。
MSG[zh:terminal_ask]="要不要现在开启在线终端功能？[Y/n]: "
MSG[en:terminal_ask]="Enable the online terminal now? [Y/n]: "
MSG[ja:terminal_ask]="今すぐオンラインターミナルを有効にしますか？ [Y/n]: "
MSG[de:terminal_ask]="Online-Terminal jetzt aktivieren? [Y/n]: "
MSG[ru:terminal_ask]="Включить онлайн-терминал сейчас? [Y/n]: "

MSG[zh:terminal_password_prompt]="请设置终端解锁密码（跟面板登录密码可以设成一样，方便记；输入时不会显示）: "
MSG[en:terminal_password_prompt]="Set an unlock password for the terminal (can be the same as your panel password, for convenience; input is hidden): "
MSG[ja:terminal_password_prompt]="ターミナルのロック解除パスワードを設定してください（パネルのログインパスワードと同じでも構いません。入力内容は表示されません）: "
MSG[de:terminal_password_prompt]="Lege ein Entsperrpasswort für das Terminal fest (kann zur Vereinfachung mit dem Panel-Passwort identisch sein; die Eingabe wird nicht angezeigt): "
MSG[ru:terminal_password_prompt]="Задайте пароль разблокировки терминала (можно такой же, как пароль панели, для удобства; ввод не отображается): "

MSG[zh:terminal_already_enabled]="在线终端已经开启过了，跳过这一步。"
MSG[en:terminal_already_enabled]="The online terminal is already enabled — skipping this step."
MSG[ja:terminal_already_enabled]="オンラインターミナルはすでに有効になっています。このステップをスキップします。"
MSG[de:terminal_already_enabled]="Das Online-Terminal ist bereits aktiviert — dieser Schritt wird übersprungen."
MSG[ru:terminal_already_enabled]="Онлайн-терминал уже включён — этот шаг пропускается."

MSG[zh:terminal_password_confirm_prompt]="请再输入一遍刚才的密码，确认没打错（输入时不会显示）: "
MSG[en:terminal_password_confirm_prompt]="Enter the same password again to confirm there's no typo (input is hidden): "
MSG[ja:terminal_password_confirm_prompt]="打ち間違いがないか確認するため、もう一度同じパスワードを入力してください（入力内容は表示されません）: "
MSG[de:terminal_password_confirm_prompt]="Gib das Passwort zur Bestätigung erneut ein, um Tippfehler auszuschließen (die Eingabe wird nicht angezeigt): "
MSG[ru:terminal_password_confirm_prompt]="Введите тот же пароль ещё раз для подтверждения, что не было опечатки (ввод не отображается): "

MSG[zh:terminal_password_mismatch_warn]="${C_RED}两次输入的密码不一样，请重新设置。${C_RESET}"
MSG[en:terminal_password_mismatch_warn]="${C_RED}The two passwords didn't match. Please set it again.${C_RESET}"
MSG[ja:terminal_password_mismatch_warn]="${C_RED}2回入力したパスワードが一致しません。もう一度設定してください。${C_RESET}"
MSG[de:terminal_password_mismatch_warn]="${C_RED}Die beiden Passwörter stimmen nicht überein. Bitte erneut festlegen.${C_RESET}"
MSG[ru:terminal_password_mismatch_warn]="${C_RED}Введённые пароли не совпадают. Пожалуйста, задайте пароль ещё раз.${C_RESET}"

MSG[zh:terminal_enabled_note]="已开启在线终端，密码已写入配置。"
MSG[en:terminal_enabled_note]="Online terminal enabled; the password has been written to the config."
MSG[ja:terminal_enabled_note]="オンラインターミナルを有効にしました。パスワードは設定に書き込まれました。"
MSG[de:terminal_enabled_note]="Online-Terminal aktiviert; das Passwort wurde in die Konfiguration geschrieben."
MSG[ru:terminal_enabled_note]="Онлайн-терминал включён; пароль записан в конфигурацию."

MSG[zh:terminal_password_missing_warn]="没有拿到有效的密码，为安全起见，这次先不开启在线终端（避免一个没有密码保护的终端暴露出去）。以后想用的话，手动在 config/config.json 的 terminal 字段里填上 enabled: true 和一个密码，再重启 nodenanny-panel 进程即可。"
MSG[en:terminal_password_missing_warn]="No valid password was provided, so the online terminal will NOT be enabled this time (to avoid exposing an unprotected terminal). To enable it later, manually set \"enabled\": true and a password under the \"terminal\" section of config/config.json, then restart the nodenanny-panel process."
MSG[ja:terminal_password_missing_warn]="有効なパスワードを取得できなかったため、安全のため今回はオンラインターミナルを有効にしません（パスワード保護のないターミナルが公開されるのを防ぐため）。後で使いたい場合は、config/config.json の terminal 項目で enabled を true にしてパスワードを設定し、nodenanny-panel プロセスを再起動してください。"
MSG[de:terminal_password_missing_warn]="Es wurde kein gültiges Passwort angegeben, daher wird das Online-Terminal dieses Mal NICHT aktiviert (um ein ungeschütztes offenes Terminal zu vermeiden). Um es später zu aktivieren, setze manuell \"enabled\": true und ein Passwort im Abschnitt \"terminal\" von config/config.json und starte den Prozess nodenanny-panel neu."
MSG[ru:terminal_password_missing_warn]="Не удалось получить корректный пароль, поэтому на этот раз онлайн-терминал НЕ будет включён (чтобы избежать незащищённого открытого терминала). Чтобы включить его позже, вручную установите \"enabled\": true и пароль в разделе \"terminal\" файла config/config.json, затем перезапустите процесс nodenanny-panel."

MSG[zh:terminal_skip_note]="好的，跳过在线终端功能。以后想用的话，重跑这一步，或者手动改 config/config.json 里的 terminal 字段再重启 nodenanny-panel。"
MSG[en:terminal_skip_note]="Okay, skipping the online terminal. You can enable it later by re-running this step, or by editing the \"terminal\" section of config/config.json and restarting nodenanny-panel."
MSG[ja:terminal_skip_note]="了解しました。オンラインターミナルはスキップします。後で使いたい場合は、このステップを再実行するか、config/config.json の terminal 項目を編集して nodenanny-panel を再起動してください。"
MSG[de:terminal_skip_note]="Okay, Online-Terminal wird übersprungen. Du kannst es später aktivieren, indem du diesen Schritt erneut ausführst oder den Abschnitt \"terminal\" in config/config.json bearbeitest und nodenanny-panel neu startest."
MSG[ru:terminal_skip_note]="Хорошо, онлайн-терминал пропускается. Чтобы включить его позже, повторно запустите этот шаг или отредактируйте раздел \"terminal\" в config/config.json и перезапустите nodenanny-panel."

# ---------- 5f. 内容同步来源（本轮新增，修复"kbSync/wikiSync已经做好但没写入配置"的缺口）----------
MSG[zh:sync_title]="内容同步来源（Wiki 百科 + 知识库，默认对接官方仓库）"
MSG[en:sync_title]="Content sync sources (Wiki + knowledge base, defaults to the official repo)"
MSG[ja:sync_title]="コンテンツ同期元（Wiki百科事典＋ナレッジベース、デフォルトで公式リポジトリを参照）"
MSG[de:sync_title]="Inhalts-Synchronisationsquellen (Wiki + Wissensdatenbank, standardmäßig das offizielle Repo)"
MSG[ru:sync_title]="Источники синхронизации контента (Wiki + база знаний, по умолчанию — официальный репозиторий)"

MSG[zh:sync_explain]="面板里的 Wiki 百科和故障知识库支持一键从 GitHub 拉取更新，默认指向 NodeNanny 官方仓库，跟你自己的部署没有冲突，也不涉及任何密钥。如果你是 fork 出来自己维护内容的，可以选「否」，以后自己去 config.json 里改成你自己的仓库地址。"
MSG[en:sync_explain]="The panel's Wiki and troubleshooting knowledge base can pull updates from GitHub with one click. By default this points at the official NodeNanny repo, doesn't conflict with your own deployment, and involves no secrets. If you forked the project and maintain your own content, choose \"No\" and point it at your own repo later in config.json."
MSG[ja:sync_explain]="パネルのWiki百科事典とトラブルシューティング・ナレッジベースは、ワンクリックでGitHubから更新を取得できます。デフォルトではNodeNanny公式リポジトリを参照し、あなた自身のデプロイと競合せず、シークレットも一切関係しません。プロジェクトをフォークして独自にコンテンツを管理している場合は「いいえ」を選び、後でconfig.jsonに自分のリポジトリを設定してください。"
MSG[de:sync_explain]="Das Wiki und die Troubleshooting-Wissensdatenbank im Panel können mit einem Klick Updates von GitHub abrufen. Standardmäßig verweist das auf das offizielle NodeNanny-Repo, kollidiert nicht mit deiner eigenen Installation und erfordert keine Geheimnisse. Falls du das Projekt geforkt hast und eigene Inhalte pflegst, wähle \"Nein\" und trage später dein eigenes Repo in config.json ein."
MSG[ru:sync_explain]="Wiki и база знаний по устранению неполадок в панели могут получать обновления с GitHub в один клик. По умолчанию это указывает на официальный репозиторий NodeNanny, не конфликтует с вашим собственным развёртыванием и не требует никаких секретов. Если вы сделали форк проекта и ведёте собственный контент, выберите «Нет» и позже укажите свой репозиторий в config.json."

MSG[zh:sync_ask]="要不要现在启用内容同步，指向官方仓库？[Y/n]: "
MSG[en:sync_ask]="Enable content sync now, pointing at the official repo? [Y/n]: "
MSG[ja:sync_ask]="今すぐ公式リポジトリを参照するコンテンツ同期を有効にしますか？ [Y/n]: "
MSG[de:sync_ask]="Inhalts-Synchronisation jetzt aktivieren, verweisend auf das offizielle Repo? [Y/n]: "
MSG[ru:sync_ask]="Включить синхронизацию контента сейчас, указав на официальный репозиторий? [Y/n]: "

MSG[zh:sync_already_enabled]="内容同步来源已经配置过了，跳过这一步。"
MSG[en:sync_already_enabled]="Content sync sources are already configured — skipping this step."
MSG[ja:sync_already_enabled]="コンテンツ同期元はすでに設定済みです。このステップをスキップします。"
MSG[de:sync_already_enabled]="Inhalts-Synchronisationsquellen sind bereits konfiguriert — dieser Schritt wird übersprungen."
MSG[ru:sync_already_enabled]="Источники синхронизации контента уже настроены — этот шаг пропускается."

MSG[zh:sync_enabled_note]="已启用内容同步，默认指向官方仓库，你可以随时在面板里点「检查更新」查看差异后再决定要不要合并。"
MSG[en:sync_enabled_note]="Content sync enabled, pointing at the official repo. You can always click \"Check for updates\" in the panel to review the diff before merging."
MSG[ja:sync_enabled_note]="コンテンツ同期を有効にし、公式リポジトリを参照するよう設定しました。パネルの「更新を確認」からいつでも差分を確認してからマージできます。"
MSG[de:sync_enabled_note]="Inhalts-Synchronisation aktiviert, verweist auf das offizielle Repo. Du kannst jederzeit im Panel auf \"Auf Updates prüfen\" klicken, um den Diff vor dem Zusammenführen zu prüfen."
MSG[ru:sync_enabled_note]="Синхронизация контента включена и указывает на официальный репозиторий. В любое время можно нажать «Проверить обновления» в панели, чтобы посмотреть diff перед слиянием."

MSG[zh:sync_skip_note]="好的，跳过内容同步。以后想用的话，去 config/config.json 里手动填 kbSync.rawUrl 和 wikiSync.owner/repo 即可。"
MSG[en:sync_skip_note]="Okay, skipping content sync. To enable it later, manually set kbSync.rawUrl and wikiSync.owner/repo in config/config.json."
MSG[ja:sync_skip_note]="了解しました。コンテンツ同期はスキップします。後で使いたい場合は、config/config.json に kbSync.rawUrl と wikiSync.owner/repo を手動で設定してください。"
MSG[de:sync_skip_note]="Okay, Inhalts-Synchronisation wird übersprungen. Um sie später zu aktivieren, setze manuell kbSync.rawUrl und wikiSync.owner/repo in config/config.json."
MSG[ru:sync_skip_note]="Хорошо, синхронизация контента пропускается. Чтобы включить её позже, вручную задайте kbSync.rawUrl и wikiSync.owner/repo в config/config.json."

MSG[zh:starting]="-- 启动 NodeNanny --"
MSG[en:starting]="-- Starting NodeNanny --"
MSG[ja:starting]="-- NodeNanny を起動中 --"
MSG[de:starting]="-- NodeNanny wird gestartet --"
MSG[ru:starting]="-- Запуск NodeNanny --"

MSG[zh:install_done]="== 安装完成 =="
MSG[en:install_done]="== Setup complete =="
MSG[ja:install_done]="== セットアップ完了 =="
MSG[de:install_done]="== Einrichtung abgeschlossen =="
MSG[ru:install_done]="== Установка завершена =="

MSG[zh:pm2_hint]="监控进程和面板已通过 PM2 启动并设置为开机自启。查看运行状态：pm2 status　查看日志：pm2 logs nodenanny-monitor"
MSG[en:pm2_hint]="The monitor and panel are running under PM2 and set to start on boot. Check status: pm2 status　View logs: pm2 logs nodenanny-monitor"
MSG[ja:pm2_hint]="監視プロセスとパネルはPM2経由で起動し、起動時自動実行も設定済みです。状態確認：pm2 status　ログ確認：pm2 logs nodenanny-monitor"
MSG[de:pm2_hint]="Monitor und Panel laufen über PM2 und starten automatisch beim Booten. Status prüfen: pm2 status　Logs ansehen: pm2 logs nodenanny-monitor"
MSG[ru:pm2_hint]="Монитор и панель запущены через PM2 и настроены на автозапуск. Статус: pm2 status　Логи: pm2 logs nodenanny-monitor"

# ---------- 访问方式（自动反代）----------
MSG[zh:access_title]="-- 接下来设置怎么在浏览器/手机上看到面板 --"
MSG[en:access_title]="-- Now let's set up how you'll view the panel in a browser or on your phone --"
MSG[ja:access_title]="-- 次に、ブラウザやスマホでパネルを見る方法を設定します --"
MSG[de:access_title]="-- Als Nächstes richten wir ein, wie du das Panel im Browser oder am Handy siehst --"
MSG[ru:access_title]="-- Теперь настроим доступ к панели из браузера или с телефона --"

MSG[zh:access_intro]="面板进程本身只监听服务器内部（更安全），不能直接用 IP:端口 打开。下面帮你自动配置一个能直接访问的地址，不需要你自己去装 Nginx。"
MSG[en:access_intro]="The panel process only listens locally on the server (safer) — you can't open it directly via IP:port. We'll now auto-configure a URL you can actually visit, no manual Nginx setup needed."
MSG[ja:access_intro]="パネルのプロセス自体はサーバー内部のみで待ち受けています（より安全）。IP:ポートで直接開くことはできません。これから、直接アクセスできるURLを自動設定します。Nginxを自分でインストールする必要はありません。"
MSG[de:access_intro]="Der Panel-Prozess lauscht nur lokal auf dem Server (sicherer) — du kannst ihn nicht direkt über IP:Port öffnen. Wir richten jetzt automatisch eine erreichbare Adresse ein, ohne dass du Nginx manuell einrichten musst."
MSG[ru:access_intro]="Процесс панели слушает только локально на сервере (безопаснее) — открыть его напрямую через IP:порт нельзя. Сейчас мы автоматически настроим адрес, по которому можно зайти, без ручной настройки Nginx."

MSG[zh:access_opt1]="  1) 我有域名，已经把它解析到这台服务器的 IP 了"
MSG[en:access_opt1]="  1) I have a domain and already pointed it to this server's IP"
MSG[ja:access_opt1]="  1) ドメインがあり、既にこのサーバーのIPに向けている"
MSG[de:access_opt1]="  1) Ich habe eine Domain und sie bereits auf die IP dieses Servers gerichtet"
MSG[ru:access_opt1]="  1) У меня есть домен, и он уже указывает на IP этого сервера"

MSG[zh:access_opt2]="  2) 我没有域名，先用 IP 访问（会自动配好加密和密码保护）"
MSG[en:access_opt2]="  2) I don't have a domain, just use the IP for now (encryption + password protection will be set up automatically)"
MSG[ja:access_opt2]="  2) ドメインはないので、とりあえずIPでアクセス（暗号化とパスワード保護は自動設定されます）"
MSG[de:access_opt2]="  2) Ich habe keine Domain, vorerst über IP zugreifen (Verschlüsselung + Passwortschutz werden automatisch eingerichtet)"
MSG[ru:access_opt2]="  2) У меня нет домена, буду заходить по IP (шифрование и защита паролем настроятся автоматически)"

MSG[zh:access_opt3]="  3) 先跳过，我自己用 SSH 隧道看（技术用户选项）"
MSG[en:access_opt3]="  3) Skip for now, I'll use an SSH tunnel myself (for technical users)"
MSG[ja:access_opt3]="  3) 今はスキップ、自分でSSHトンネルを使う（技術者向けオプション）"
MSG[de:access_opt3]="  3) Vorerst überspringen, ich nutze selbst einen SSH-Tunnel (für technisch versierte Nutzer)"
MSG[ru:access_opt3]="  3) Пропустить, буду использовать SSH-туннель сам (для технических пользователей)"

MSG[zh:access_choose]="选一个 [默认：2]: "
MSG[en:access_choose]="Choose one [default: 2]: "
MSG[ja:access_choose]="選択してください [デフォルト: 2]: "
MSG[de:access_choose]="Wähle eine Option [Standard: 2]: "
MSG[ru:access_choose]="Выберите вариант [по умолчанию: 2]: "

MSG[zh:access_domain_prompt]="输入你的域名（比如 nanny.example.com）: "
MSG[en:access_domain_prompt]="Enter your domain (e.g. nanny.example.com): "
MSG[ja:access_domain_prompt]="ドメインを入力してください（例：nanny.example.com）: "
MSG[de:access_domain_prompt]="Gib deine Domain ein (z. B. nanny.example.com): "
MSG[ru:access_domain_prompt]="Введите ваш домен (например, nanny.example.com): "

MSG[zh:ssh_tunnel_hint]="以后想看面板时，在你自己的电脑（不是服务器）上执行下面这行命令，然后打开浏览器访问 http://localhost:%s ："
MSG[en:ssh_tunnel_hint]="Whenever you want to view the panel, run this command on your own computer (not the server), then open http://localhost:%s in a browser:"
MSG[ja:ssh_tunnel_hint]="パネルを見たい時は、自分のパソコン（サーバーではなく）で以下のコマンドを実行し、ブラウザで http://localhost:%s を開いてください："
MSG[de:ssh_tunnel_hint]="Wenn du das Panel sehen möchtest, führe diesen Befehl auf deinem eigenen Computer (nicht dem Server) aus und öffne dann http://localhost:%s im Browser:"
MSG[ru:ssh_tunnel_hint]="Когда захотите посмотреть панель, выполните эту команду на своём компьютере (не на сервере), затем откройте в браузере http://localhost:%s :"

# ---------- check-service.sh 探测提示 ----------
MSG[zh:scan_systemd_title]="正在查找看起来像代理节点的 systemd 服务"
MSG[en:scan_systemd_title]="Scanning for systemd services that look like a proxy node"
MSG[ja:scan_systemd_title]="プロキシノードらしきsystemdサービスを検索中"
MSG[de:scan_systemd_title]="Suche nach systemd-Diensten, die wie ein Proxy-Knoten aussehen"
MSG[ru:scan_systemd_title]="Поиск служб systemd, похожих на прокси-узел"

MSG[zh:scan_systemd_found]="上面这些看起来是候选。记下最左边那一列的服务名（不含 .service 后缀），比如显示 xray.service，下一步就填 xray。"
MSG[en:scan_systemd_found]="These look like candidates above. Note the service name in the leftmost column (without the .service suffix) — e.g. if it shows xray.service, enter xray in the next step."
MSG[ja:scan_systemd_found]="上記が候補です。一番左のサービス名（.service を除く）を控えてください。例：xray.service と表示されていれば、次のステップで xray と入力します。"
MSG[de:scan_systemd_found]="Die oben genannten sehen wie Kandidaten aus. Notiere den Dienstnamen in der linken Spalte (ohne .service) — z. B. bei xray.service gibst du im nächsten Schritt xray ein."
MSG[ru:scan_systemd_found]="Выше — вероятные кандидаты. Запишите имя службы в крайнем левом столбце (без .service) — например, если видите xray.service, на следующем шаге введите xray."

MSG[zh:scan_systemd_none]="没有自动匹配到常见 systemd 服务名。"
MSG[en:scan_systemd_none]="No common systemd service name matched automatically."
MSG[ja:scan_systemd_none]="一般的なsystemdサービス名は自動検出できませんでした。"
MSG[de:scan_systemd_none]="Kein gängiger systemd-Dienstname automatisch erkannt."
MSG[ru:scan_systemd_none]="Не удалось автоматически найти распространённое имя службы systemd."

MSG[zh:scan_docker_title]="正在查找看起来像代理节点的 Docker 容器"
MSG[en:scan_docker_title]="Scanning for Docker containers that look like a proxy node"
MSG[ja:scan_docker_title]="プロキシノードらしきDockerコンテナを検索中"
MSG[de:scan_docker_title]="Suche nach Docker-Containern, die wie ein Proxy-Knoten aussehen"
MSG[ru:scan_docker_title]="Поиск контейнеров Docker, похожих на прокси-узел"

MSG[zh:scan_docker_not_installed]="本机没有安装 docker 命令，跳过容器检测。"
MSG[en:scan_docker_not_installed]="Docker isn't installed on this machine, skipping container scan."
MSG[ja:scan_docker_not_installed]="このマシンにはdockerコマンドがインストールされていません。コンテナ検出をスキップします。"
MSG[de:scan_docker_not_installed]="Docker ist auf diesem Rechner nicht installiert, Container-Scan wird übersprungen."
MSG[ru:scan_docker_not_installed]="Docker не установлен на этой машине, проверка контейнеров пропущена."

MSG[zh:scan_docker_columns]="容器名                镜像                        状态"
MSG[en:scan_docker_columns]="NAME                  IMAGE                       STATUS"
MSG[ja:scan_docker_columns]="コンテナ名             イメージ                     状態"
MSG[de:scan_docker_columns]="NAME                  IMAGE                       STATUS"
MSG[ru:scan_docker_columns]="ИМЯ                   ОБРАЗ                       СТАТУС"

MSG[zh:scan_docker_found]="上面这些看起来是候选。记下最左边那一列的容器名，比如显示 my-xray，下一步就填 my-xray。"
MSG[en:scan_docker_found]="These look like candidates above. Note the container name in the leftmost column — e.g. if it shows my-xray, enter my-xray in the next step."
MSG[ja:scan_docker_found]="上記が候補です。一番左のコンテナ名を控えてください。例：my-xray と表示されていれば、次のステップで my-xray と入力します。"
MSG[de:scan_docker_found]="Die oben genannten sehen wie Kandidaten aus. Notiere den Containernamen in der linken Spalte — z. B. bei my-xray gibst du im nächsten Schritt my-xray ein."
MSG[ru:scan_docker_found]="Выше — вероятные кандидаты. Запишите имя контейнера в крайнем левом столбце — например, my-xray, и введите его на следующем шаге."

MSG[zh:scan_docker_none]="没有自动匹配到常见容器名/镜像名。"
MSG[en:scan_docker_none]="No common container/image name matched automatically."
MSG[ja:scan_docker_none]="一般的なコンテナ名／イメージ名は自動検出できませんでした。"
MSG[de:scan_docker_none]="Kein gängiger Container-/Image-Name automatisch erkannt."
MSG[ru:scan_docker_none]="Не удалось автоматически найти распространённое имя контейнера/образа."

MSG[zh:scan_docker_list_all]="如果你确定是用 Docker 部署的，往下看完整运行中的容器列表自己找："
MSG[en:scan_docker_list_all]="If you're sure it's Docker-based, check the full list of running containers below:"
MSG[ja:scan_docker_list_all]="Dockerでデプロイしていることが確実なら、以下の実行中コンテナ一覧から探してください："
MSG[de:scan_docker_list_all]="Wenn du sicher bist, dass es auf Docker basiert, sieh dir unten die vollständige Liste der laufenden Container an:"
MSG[ru:scan_docker_list_all]="Если вы уверены, что используется Docker, посмотрите полный список запущенных контейнеров ниже:"

MSG[zh:scan_nothing_found]="两种方式都没自动匹配到。可能你的服务名/容器名比较特殊，往下看完整运行中的 systemd 服务列表自己找："
MSG[en:scan_nothing_found]="Neither method matched automatically. Your service/container name might be unusual — check the full list of running systemd services below:"
MSG[ja:scan_nothing_found]="どちらの方法でも自動検出できませんでした。サービス名／コンテナ名が特殊な可能性があります。以下の実行中systemdサービス一覧から探してください："
MSG[de:scan_nothing_found]="Bei keiner Methode gab es einen automatischen Treffer. Dein Dienst-/Containername könnte ungewöhnlich sein — sieh dir unten die vollständige Liste der laufenden systemd-Dienste an:"
MSG[ru:scan_nothing_found]="Ни один способ не дал совпадений автоматически. Возможно, имя вашей службы/контейнера необычное — посмотрите полный список запущенных служб systemd ниже:"

MSG[zh:scan_verify_title]="找到候选后，务必手动验证一遍，而不是直接信任"
MSG[en:scan_verify_title]="Once you find a candidate, always verify it manually — don't just trust it blindly"
MSG[ja:scan_verify_title]="候補が見つかったら、そのまま信頼せず必ず手動で確認してください"
MSG[de:scan_verify_title]="Wenn du einen Kandidaten gefunden hast, überprüfe ihn immer manuell — vertraue ihm nicht blind"
MSG[ru:scan_verify_title]="Найдя кандидата, обязательно проверьте его вручную — не доверяйте слепо"

MSG[zh:scan_verify_systemd]="如果是 systemd 服务：
  1. 先看当前状态：   systemctl status <检测到的服务名>
  2. 再手动重启一次： systemctl restart <检测到的服务名>
  3. 重启后确认还是 active (running)，且你的节点客户端还能正常连。"
MSG[en:scan_verify_systemd]="If it's a systemd service:
  1. Check current status:   systemctl status <detected name>
  2. Restart it manually:    systemctl restart <detected name>
  3. Confirm it's still active (running) and your client can still connect."
MSG[ja:scan_verify_systemd]="systemdサービスの場合：
  1. 現在の状態を確認：   systemctl status <検出されたサービス名>
  2. 手動で再起動：       systemctl restart <検出されたサービス名>
  3. 再起動後も active (running) で、クライアントが正常に接続できることを確認。"
MSG[de:scan_verify_systemd]="Falls es ein systemd-Dienst ist:
  1. Aktuellen Status prüfen:  systemctl status <erkannter Name>
  2. Manuell neu starten:      systemctl restart <erkannter Name>
  3. Bestätigen, dass er weiterhin active (running) ist und dein Client verbinden kann."
MSG[ru:scan_verify_systemd]="Если это служба systemd:
  1. Проверьте статус:        systemctl status <обнаруженное имя>
  2. Перезапустите вручную:   systemctl restart <обнаруженное имя>
  3. Убедитесь, что статус active (running) и клиент по-прежнему подключается."

MSG[zh:scan_verify_docker]="如果是 Docker 容器：
  1. 先看当前状态：   docker ps --filter name=<检测到的容器名>
  2. 再手动重启一次： docker restart <检测到的容器名>
  3. 重启后确认容器状态是 Up，且你的节点客户端还能正常连。"
MSG[en:scan_verify_docker]="If it's a Docker container:
  1. Check current status:   docker ps --filter name=<detected name>
  2. Restart it manually:    docker restart <detected name>
  3. Confirm the container status is Up and your client can still connect."
MSG[ja:scan_verify_docker]="Dockerコンテナの場合：
  1. 現在の状態を確認：   docker ps --filter name=<検出されたコンテナ名>
  2. 手動で再起動：       docker restart <検出されたコンテナ名>
  3. 再起動後コンテナ状態が Up で、クライアントが正常に接続できることを確認。"
MSG[de:scan_verify_docker]="Falls es ein Docker-Container ist:
  1. Aktuellen Status prüfen:  docker ps --filter name=<erkannter Name>
  2. Manuell neu starten:      docker restart <erkannter Name>
  3. Bestätigen, dass der Container-Status Up ist und dein Client verbinden kann."
MSG[ru:scan_verify_docker]="Если это контейнер Docker:
  1. Проверьте статус:        docker ps --filter name=<обнаруженное имя>
  2. Перезапустите вручную:   docker restart <обнаруженное имя>
  3. Убедитесь, что статус контейнера Up и клиент по-прежнему подключается."

MSG[zh:scan_verify_next]="验证没问题后，接下来 install.sh 会问你是 systemd 还是 Docker，把这里确认过的服务名/容器名填进去就行，不需要自己拼 restartCommand。"
MSG[en:scan_verify_next]="Once verified, install.sh will ask whether it's systemd or Docker — just enter the name you confirmed here, no need to construct the restartCommand yourself."
MSG[ja:scan_verify_next]="確認が済んだら、install.sh がsystemdかDockerかを尋ねます。ここで確認した名前を入力するだけで、restartCommandを自分で組み立てる必要はありません。"
MSG[de:scan_verify_next]="Nach der Bestätigung fragt install.sh, ob es systemd oder Docker ist — gib einfach den hier bestätigten Namen ein, du musst den restartCommand nicht selbst zusammenbauen."
MSG[ru:scan_verify_next]="После проверки install.sh спросит, systemd это или Docker — просто введите подтверждённое здесь имя, собирать restartCommand вручную не нужно."

MSG[zh:selfsigned_note]="（浏览器会提示证书不受信任，这是自签证书的正常现象，不影响加密效果，点「继续访问/高级」即可。打开后还会弹出一次浏览器自带的登录框，要求输入用户名和密码——用户名固定填 nodenanny，密码就是你刚才设置的那个面板密码，这是 Nginx 层额外加的一道保护，跟等下 NodeNanny 自己的登录页是两回事。）"
MSG[en:selfsigned_note]="(Your browser will warn that the certificate is not trusted — this is expected for self-signed certs, encryption still works fine. Click 'Advanced / Proceed anyway'. You'll then see a browser login popup asking for a username and password — the username is always nodenanny, and the password is the same panel password you just set. This is an extra layer added by Nginx, separate from NodeNanny's own login page that follows.)"
MSG[ja:selfsigned_note]="（ブラウザが証明書の信頼性を警告しますが、これは自己署名証明書では正常です。暗号化は問題なく機能します。「詳細設定 / 続行」をクリックしてください。その後、ブラウザ標準のログインポップアップが表示され、ユーザー名とパスワードを求められます——ユーザー名は常に nodenanny、パスワードは先ほど設定したパネルパスワードと同じです。これは Nginx 層が追加した保護で、この後に出てくる NodeNanny 自体のログインページとは別物です。）"
MSG[de:selfsigned_note]="(Dein Browser warnt, dass das Zertifikat nicht vertrauenswürdig ist — das ist bei selbst signierten Zertifikaten normal, die Verschlüsselung funktioniert trotzdem. Klicke auf 'Erweitert / Trotzdem fortfahren'. Danach erscheint ein browsereigenes Login-Popup, das nach Benutzername und Passwort fragt — der Benutzername ist immer nodenanny, das Passwort ist dasselbe Panel-Passwort, das du gerade gesetzt hast. Das ist eine zusätzliche Schutzschicht von Nginx, getrennt von der eigentlichen NodeNanny-Login-Seite, die danach folgt.)"
MSG[ru:selfsigned_note]="(Браузер предупредит, что сертификат не доверенный — для самоподписанных сертификатов это нормально, шифрование работает. Нажмите «Дополнительно / Продолжить». Затем появится встроенное окно входа браузера с запросом имени пользователя и пароля — имя пользователя всегда nodenanny, пароль совпадает с паролем от панели, который вы только что задали. Это дополнительный уровень защиты от Nginx, отдельный от собственной страницы входа NodeNanny, которая появится после.)"

# 修复记录：setup-reverse-proxy.sh 会往 config.json 写入订阅专用地址(access.subUrlBase)，
# 但面板进程在这一步之前已经启动、把旧配置缓存在内存里，不会自动感知这次改动，需要重启一次
# 才能生效——否则订阅链接会退回错误的地址，兼容 Shadowrocket 的设计就白做了。
MSG[zh:panel_restarted_for_sub]="已重启面板进程，让它读取到刚刚生成的订阅专用地址（否则订阅链接会一直用错误的地址，导入 Shadowrocket 等客户端可能会失败）。"
MSG[en:panel_restarted_for_sub]="Restarted the panel process so it picks up the dedicated subscription address just generated (otherwise the subscription link would keep using the wrong address, which can break imports into clients like Shadowrocket)."
MSG[ja:panel_restarted_for_sub]="パネルプロセスを再起動し、先ほど生成された購読専用アドレスを読み込ませました（そうしないと購読リンクが誤ったアドレスのままになり、Shadowrocket などへのインポートが失敗する可能性があります）。"
MSG[de:panel_restarted_for_sub]="Der Panel-Prozess wurde neu gestartet, damit die soeben erzeugte spezielle Abo-Adresse übernommen wird (sonst würde der Abo-Link weiterhin die falsche Adresse verwenden, was den Import in Clients wie Shadowrocket fehlschlagen lassen kann)."
MSG[ru:panel_restarted_for_sub]="Процесс панели перезапущен, чтобы подхватить только что сгенерированный отдельный адрес подписки (иначе ссылка подписки продолжила бы использовать неверный адрес, что может привести к сбою импорта в такие клиенты, как Shadowrocket)."

# 修复记录：装机问答此前对"用户手打的 systemd 服务名/docker 容器名"完全不做真实性核验，
# 直接写进配置就宣告安装完成——如果名字打错，NodeNanny 装完就会开始监控一个不存在的东西，
# 持续判定异常、反复尝试重启失败，用户要等到打开面板才会发现。这里补一次轻量核验，跟已有的
# "自定义命令路径不存在"确认逻辑（custom_cmd_confirm_anyway）是同一个模式。
MSG[zh:mgmt_systemd_not_found]="警告：系统里没有找到名叫「%s」的 systemd 服务——如果这个名字打错了，NodeNanny 装完会一直监控一个不存在的服务、反复重启失败。"
MSG[en:mgmt_systemd_not_found]="Warning: no systemd service named \"%s\" was found on this system — if this name is wrong, NodeNanny will keep monitoring a service that doesn't exist and repeatedly fail to restart it."
MSG[ja:mgmt_systemd_not_found]="警告：「%s」という名前の systemd サービスが見つかりません——この名前が間違っている場合、NodeNanny はインストール後も存在しないサービスを監視し続け、再起動に繰り返し失敗します。"
MSG[de:mgmt_systemd_not_found]="Warnung: Es wurde kein systemd-Dienst namens \"%s\" auf diesem System gefunden — falls dieser Name falsch ist, überwacht NodeNanny weiterhin einen nicht existierenden Dienst und scheitert wiederholt beim Neustart."
MSG[ru:mgmt_systemd_not_found]="Внимание: служба systemd с именем «%s» на этой системе не найдена — если имя указано неверно, NodeNanny будет постоянно отслеживать несуществующую службу и раз за разом не сможет её перезапустить."

MSG[zh:mgmt_docker_not_found]="警告：没有找到名叫「%s」的 docker 容器（当前存在的容器列表在上面）——如果这个名字打错了，NodeNanny 装完会一直监控一个不存在的容器、反复重启失败。"
MSG[en:mgmt_docker_not_found]="Warning: no docker container named \"%s\" was found (existing containers are listed above) — if this name is wrong, NodeNanny will keep monitoring a container that doesn't exist and repeatedly fail to restart it."
MSG[ja:mgmt_docker_not_found]="警告：「%s」という名前の docker コンテナが見つかりません（既存のコンテナ一覧は上に表示されています）——この名前が間違っている場合、NodeNanny はインストール後も存在しないコンテナを監視し続け、再起動に繰り返し失敗します。"
MSG[de:mgmt_docker_not_found]="Warnung: Es wurde kein docker-Container namens \"%s\" gefunden (vorhandene Container sind oben aufgelistet) — falls dieser Name falsch ist, überwacht NodeNanny weiterhin einen nicht existierenden Container und scheitert wiederholt beim Neustart."
MSG[ru:mgmt_docker_not_found]="Внимание: контейнер docker с именем «%s» не найден (список существующих контейнеров показан выше) — если имя указано неверно, NodeNanny будет постоянно отслеживать несуществующий контейнер и раз за разом не сможет его перезапустить."

MSG[zh:mgmt_docker_unavailable]="警告：这台服务器上没有装 docker，没法验证「%s」这个容器名是否真的存在。"
MSG[en:mgmt_docker_unavailable]="Warning: docker isn't installed on this server, so \"%s\" can't be verified as a real container."
MSG[ja:mgmt_docker_unavailable]="警告：このサーバーには docker がインストールされていないため、「%s」というコンテナが実在するか確認できません。"
MSG[de:mgmt_docker_unavailable]="Warnung: docker ist auf diesem Server nicht installiert, daher kann \"%s\" nicht als echter Container verifiziert werden."
MSG[ru:mgmt_docker_unavailable]="Внимание: docker не установлен на этом сервере, поэтому невозможно проверить, существует ли контейнер «%s» на самом деле."

MSG[zh:url_saved]="（这个地址也保存在了 %s，忘了随时可以打开这个文件查看）"
MSG[en:url_saved]="(This URL has also been saved to %s — you can open that file any time if you forget it)"
MSG[ja:url_saved]="（このURLは %s にも保存されています。忘れた場合はそのファイルを開いてください）"
MSG[de:url_saved]="(Diese URL wurde auch in %s gespeichert — du kannst die Datei jederzeit öffnen, wenn du sie vergisst)"
MSG[ru:url_saved]="(Этот адрес также сохранён в %s — откройте этот файл в любое время, если забудете)"

MSG[zh:panel_pw_reminder]="面板登录密码就是刚才你设置的那个密码，不是服务器密码。"
MSG[en:panel_pw_reminder]="The panel login password is the one you set a moment ago — not your server/SSH password."
MSG[ja:panel_pw_reminder]="パネルのログインパスワードは、先ほど設定したパスワードです。サーバーのSSHパスワードではありません。"
MSG[de:panel_pw_reminder]="Das Panel-Anmeldepasswort ist das, das du gerade gesetzt hast — nicht dein Server-/SSH-Passwort."
MSG[ru:panel_pw_reminder]="Пароль для входа в панель — тот, что вы только что задали, а не пароль SSH/сервера."
