# AGENTS.md

This file is for AI coding assistants working on this repository. It is committed to
the repo and meant to be read on first clone, independent of any chat session or
handoff document. It states facts and invariants, not narrative history — for the
full story behind any decision below, check `git log` and commit messages, not this
file.

## Project identity

NodeNanny is a caretaker tool for **one non-technical person self-hosting one proxy
node, alone**. It does not deploy the node itself (existing one-click installer
scripts do that) — it takes over after deployment: uptime monitoring, automatic
restart, failure emails, optional advisory-only AI failure diagnosis (using the
user's own API key), and a status panel in 5 languages (zh/en/ja/de/ru).

It is explicitly **not** a multi-user/multi-node management panel and does not
compete with Marzban/3X-UI/Remnawave. Multi-node/fleet management has been proposed
and explicitly rejected by the maintainer before — do not re-propose it without the
maintainer explicitly reopening the topic.

The maintainer is non-technical, manages the server alone, and communicates in
Chinese. If you are drafting anything the maintainer will read directly (chat
replies, commit messages meant for them, doc updates aimed at them), use Chinese.
This file itself is English because it's aimed at AI assistants, not the maintainer.

## Working model — read this before touching anything

The AI assistant in a chat session has **no SSH access to any server and no git push
credentials**. Every server-side command and every git command must be run by the
maintainer himself, one command at a time, in a terminal he explicitly opens. If you
are an AI assistant with actual tool access to this repo (e.g. an agentic coding
tool with shell access), you may still lack the credentials to push or deploy —
check what you actually have access to before assuming you can complete the full
workflow end to end.

Standard workflow for any code change:
1. Edit in a sandbox, cloned fresh from GitHub (`https://github.com/yibentq/nodenanny`,
   public, AGPL-3.0) — never trust an uploaded zip's `.git` state as current without
   checking `git log` / `git status` yourself first.
2. Hand changed files to the maintainer.
3. Maintainer copies them into the local working copy, runs `git add` / `git commit`
   / `git push` himself.
4. Maintainer `scp`s changed files to the experimental server and restarts the
   relevant PM2 process(es) himself.

Do not assume any file is "live" anywhere (local working copy, GitHub, or the
server) until this full chain is confirmed. These three locations can and have
drifted out of sync before.

## Servers

- **Production**: `186.241.91.103` — legacy, long untouched, `pool.enabled=false`.
  **Do not touch.**
- **Experimental**: `186.244.208.32` — the live, working deployment.
  `ssh root@186.244.208.32:22`. Code lives at `/root/nodenanny`, deployed via `scp`
  — **it is not a git checkout on the server**. PM2 process names:
  `nodenanny-monitor`, `nodenanny-panel`, `nodenanny-pool`.

## File → PM2 process map

Grep `require()` chains before assuming which process(es) load a file you're
changing — don't guess from the list below if it's ambiguous.

- `core/pool.js`, `core/proxy-parse.js`, `core/repo-fetch.js`,
  `core/telegram-fetch.js`, `core/source-list-sync.js`, `core/pool-checker.js`,
  `core/source-trust.js` → restart `nodenanny-pool`.
- `core/panel-server.js`, `public/*.html` → restart `nodenanny-panel`.
- `core/checker.js`, `core/notify.js`, `core/ai-provider.js` → required by **both**
  `nodenanny-monitor` and `nodenanny-panel`.

## Config

`config/config.json` is gitignored (it holds secrets — SMTP credentials, API keys,
panel password). `config/config.example.json` is the committed template. **Never**
write real secrets into this file, into a commit, or into any handoff/chat document.

## Invariants — do not break these without the maintainer's explicit sign-off

- `manualSources` entries with `"fixed": true` are exempt from the
  trial→trusted→blacklisted state machine (`resolveManualSourceTrust()` in
  `core/pool.js`). No sync/merge mechanism may ever overwrite or strip `fixed: true`
  off a source it didn't create.
- `core/source-list-sync.js` tracks which ids it created in
  `data/source-list-sync-state.json` (a ledger of managed ids). Any local id not on
  that ledger is always treated as a conflict and skipped, never overwritten.
- Auto-fetched sources (Telegram, GitHub discovery) do **not** get `fixed: true` —
  they earn trust through the normal state machine like any other source. This was
  an explicit maintainer decision: a human picking the source does not pre-vet its
  content.
- **sing-box** is the verification backend for `core/pool-checker.js`. It has no SSR
  outbound support. Do not add an SSR parser to `core/proxy-parse.js` unless the
  maintainer decides to switch checking engines — an SSR parser would produce
  output nothing downstream can actually test.
- `core/proxy-parse.js` currently supports: `vless`, `vmess`, `ss`, `trojan`,
  `hysteria2`/`hy2`, `hysteria` (v1), `tuic`, `anytls`, `socks5`, `http`, `https`.
  `ssr` and `shadowtls` are deliberately excluded — see in-file comments for why
  before attempting to add either.
- `core/telegram-fetch.js`'s `document_attachment` path is confirmed
  non-functional: Telegram's public, login-free preview page (`t.me/s/<channel>`)
  exposes only a message permalink for file attachments, not a real download URL.
  This was live-verified against a real channel, not assumed. Only the
  `message_text_link` path (plain links pasted in message text) is viable, and even
  that has not been live-verified against a real channel end to end. Do not attempt
  to fix `document_attachment` without the maintainer explicitly approving new
  credentials (a bot added as channel admin by the channel owner, or a full MTProto
  user login) — both are out of scope until then, and for a third-party channel the
  maintainer doesn't own, bot-admin access usually isn't obtainable at all.
- `install.sh` supports non-interactive mode (`NN_NONINTERACTIVE=true`, or
  automatically when stdin isn't a tty) plus per-field `NN_*` environment variables
  (see `scripts/i18n.sh`'s `ask`/`ask_secret`/`ask_yn` helpers). `NN_PANEL_PASSWORD`
  is mandatory in non-interactive mode — the script exits non-zero if it's unset or
  empty. This is intentional; do not relax it.

## Permanently out of scope

Do not implement or re-propose the following without the maintainer explicitly
reopening the topic (a past AI proposing multi-node support once, and it being
rejected, is exactly the kind of history this file exists to prevent repeating):
AI node panels, node-pool aggregation as a headline feature, multi-region/
multi-cloud failover, multiple payment channels, a self-trained AI model, code
obfuscation, paid tiers, ads, growth hacking, multi-node/fleet management.

"Non-GitHub traffic-pool sources" was previously excluded but this specific
exclusion **was lifted** by the maintainer to allow Telegram channels as backup-pool
sources — that reopening already happened; don't ask again on that specific point.
All other exclusions above remain in force.

## Before you start any session

1. Don't trust a document's or an uploaded zip's claims about current state at face
   value — run `git log --oneline -5` and `git status` yourself if you have file
   access, and reconcile any conflicting claims against that ground truth.
2. Check the current open-items list (kept in the chat-pasted handoff document the
   maintainer provides each session, not duplicated here) before starting new work.
3. If scope for a requested task is ambiguous (e.g. "update the README" with no
   further detail), ask the maintainer what's in scope before writing — don't guess
   at scope for anything that will be presented back to end users.
