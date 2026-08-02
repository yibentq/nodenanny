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
  `nodenanny-monitor`, `nodenanny-panel`, `nodenanny-pool`. **The maintainer's actual
  day-to-day access is `https://186.244.208.32:49769` (self-signed cert + HTTP Basic
  Auth), not an SSH tunnel** — see `deploy/experimental-server-access-notes.md` for
  the full access setup (a second port, `35319`, exposes only the subscription path,
  no auth). That file also documents that the panel-login / terminal-unlock /
  port-`49769` Basic-Auth passwords are **deliberately identical** — a maintainer
  choice on a zero-budget solo project, not an oversight; don't "fix" it unprompted.
  None of these credentials are ever written into this file or any git-tracked file.

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

## Running the test suite in a sandbox

`node-pty` (needed for the terminal feature) is a native module and typically fails
to compile in a throwaway sandbox with no matching prebuilt binary. If you need to
run `npm install` in a sandbox to execute the test suite, temporarily remove
`node-pty` from `package.json`'s dependencies first, run the tests, then restore it
and confirm a clean `git diff` on `package.json`/`package-lock.json` before handing
anything back — don't let a sandbox workaround leak into a real commit.

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
  This was live-verified against a real channel, not assumed. Do not attempt
  to fix `document_attachment` without the maintainer explicitly approving new
  credentials (a bot added as channel admin by the channel owner, or a full MTProto
  user login) — both are out of scope until then, and for a third-party channel the
  maintainer doesn't own, bot-admin access usually isn't obtainable at all.
- `message_text_link` (plain-text links) and `message_text_code_link` (links inside
  a `<code>`/`<pre>` block) are both live-verified working sub-paths. Code/pre-block
  links take priority over plain-text `<a href>` links across the whole scanned
  message window — real channels in this genre consistently paste the actual
  subscription link in a code block for easy mobile copy/paste, while plain-text
  links in the same messages are more often unrelated promotional content. `t.me`/
  `telegram.me` links and any candidate URL containing `@` (userinfo@host — this
  matches individual raw node URIs like `vless://uuid@host:port` sometimes pasted
  with an `https://` typo prefix, not real subscription API URLs) are excluded as
  candidates.
- `telegramFetch.extractRawNodeLinks()` separately harvests raw node URIs
  (`vless/vmess/ss/trojan/hysteria2/hy2/hysteria/tuic/anytls/socks5://`, no `ssr`)
  pasted directly in a channel's message text — this is independent of whether a
  subscription link was found on the same fetch. `fetchLatestFileUrl()` returns
  `rawHtml` on every path (success or failure) precisely so callers can harvest
  these without a second network request.
- **Trust identity for Telegram-resolved subscription links is domain-based, not
  channel-based.** `core/pool.js`'s `fetchFromManualSource()` uses a `trustSourceId`
  (`manual-tg-sub:<hostname>`) that is separate from the display `sourceId`
  (`manual:<channel-id>`, still used for panel roster/star-map/pool-events display
  and for `passedNodes[].sourceId`). This exists because these subscription links
  carry per-request/per-day rotating tokens — using the full URL as trust identity
  would mean trial progress resets constantly and 7-round promotion could never
  complete. **Anomaly detection is computed and logged as normal but does *not* feed
  into blacklisting for `manual-tg-sub:*` identities** (`anomalyForTrust` is forced
  `false` for this namespace only) — a legitimate multi-region subscription service
  showing the same account identity on multiple servers is expected behavior, not
  fraud. Non-Telegram manual sources (`trustSourceId` still `manual:<id>`) are
  unaffected — anomaly detection blacklists them normally. **This anomaly-suppression
  default was an AI judgment call during the redesign, not something the maintainer
  has explicitly signed off on** — he was asked and said he doesn't understand the
  mechanism well enough to have an opinion yet, so treat it as "current behavior,
  revisit if it ever causes a real problem or he raises it," not as settled product
  policy.
- Raw nodes harvested across *all* Telegram-channel manual sources in one refresh
  round are pooled together into a single shared source, `telegram-raw-pool`
  (constant `TELEGRAM_RAW_POOL_SOURCE_ID` in `core/pool.js`) — deliberately **not**
  merged into `aggregator-default` (confirmed useless, consistently 0 passes) and
  deliberately **not** given a fixed/configurable weight override — it goes through
  the normal trial→trusted→blacklisted state machine like any other non-fixed
  source. Anomaly detection is *not* suppressed for this pool (unlike the
  `manual-tg-sub:*` case above) — raw nodes pasted by different channels colliding
  on identity doesn't have the same "legitimate multi-region service" justification.
- `parseSubscriptionContent()` (`core/repo-fetch.js`) reports `format: 'unrecognized'`
  whenever zero usable links come out the other end — **including** when the input
  actually is valid Clash YAML but every proxy entry uses an unsupported protocol
  (e.g. all-SSR). Seeing `unrecognized` in logs for a Telegram/GitHub source does not
  by itself mean the parser failed to recognize the format; check `yamlTotal` vs
  `yamlConverted` (when present) or inspect the raw content before assuming a parser
  bug.
- `core/clash-yaml.js`'s `extractProxiesBlockLines()` supports **both** YAML list
  styles for the `proxies:` block — the conventional indented-dash style
  (`proxies:\n  - name: ...`) and the equally-valid flush-left style
  (`proxies:\n- name: ...`, list items at the *same* indentation as the key). It
  derives the list's actual indentation from the first item found rather than
  assuming a fixed relationship to the `proxies:` key's own indentation. If this
  ever needs touching again, don't reintroduce the fixed-relationship assumption —
  it silently produces an empty block (and therefore `format: 'unrecognized'`) for
  any flush-left file, which is common among real channels tested (clashv8,
  wxdy666).
- `core/repo-fetch.js`'s `fetchText()` has a fallback path for
  `UND_ERR_HEADERS_OVERFLOW` (Node's default header-size ceiling, hit when a 3xx
  redirect's `Location` header is itself huge — some subscription services encode
  the entire node list into the redirect target URL rather than a normal response
  body). On that specific error it retries via Node's built-in `http`/`https` module
  with a raised `maxHeaderSize`, manually following redirects (Node's built-in
  modules don't auto-follow them the way `fetch()`/`curl -L` do). This is a narrow,
  specific fallback for one known failure mode — don't broaden it into a blanket
  catch-and-retry for other error types.
- **Panel's online terminal requires a WebSocket-upgrade-aware reverse proxy.**
  `scripts/setup-reverse-proxy.sh`'s generated Nginx config must include
  `proxy_http_version 1.1;`, `proxy_set_header Upgrade $http_upgrade;`, and
  `proxy_set_header Connection "upgrade";` on the panel's `location /` block —
  without these, the terminal connects (auth succeeds) and then closes immediately,
  because Nginx never actually upgrades the connection to a WebSocket. If a
  maintainer reports "terminal unlocks then disconnects instantly," check the
  reverse-proxy config for these three lines before suspecting `core/terminal.js`
  itself.
- `public/wiki.html`'s internal-link resolver must strip the numeric order-prefix
  (e.g. `04-` in `04-compliance-and-risk`) from a cross-category relative link's
  category segment before matching — the backend's `categoryId` never includes this
  prefix (see `stripOrderPrefix` in `core/wiki-manager.js`). Same-category links
  (`./slug`) don't hit this path and worked before the fix; only cross-category
  links (`../<numbered-category>/slug`) were affected.
- `core/source-list-sync.js` (config field `sourceListSync.owner/repo/ref/path`,
  panel section "节点来源列表同步") deliberately strips any `fixed` field from
  remote-supplied entries regardless of what the remote JSON contains — every
  source it merges in enters the normal trial state machine, mirroring the
  "auto-fetched sources don't get `fixed: true`" invariant above. It is now offered
  in `install.sh`'s interactive content-sync bundle alongside `kbSync`/`wikiSync`
  (installed configs get all three pointed at the maintainer's own repo by default);
  fresh installs are covered, but this does **not** retroactively populate
  `sourceListSync` on an already-running server's `config.json` — that still needs a
  manual edit + `nodenanny-panel` restart, same as `kbSync`/`wikiSync`'s equivalent
  gap.
- `panel-server.js`'s `config` object (including `sourceListSync`/`kbSync`/
  `wikiSync`/general settings) is loaded **once** at process startup into a closure
  variable, **not** re-read per request. Any `config.json` edit intended to affect
  panel behavior requires an `nodenanny-panel` restart to take effect — this is not
  specific to `sourceListSync`, it's how the whole file is loaded.
- Terminal-password setup (`ask_secret` in `scripts/i18n.sh`, used by `install.sh`)
  now asks twice and retry-loops on mismatch before accepting — a typo during setup
  used to go completely undetected until the maintainer tried to actually use the
  terminal later and got locked out without knowing why.
- `install.sh` supports non-interactive mode (`NN_NONINTERACTIVE=true`, or
  automatically when stdin isn't a tty) plus per-field `NN_*` environment variables
  (see `scripts/i18n.sh`'s `ask`/`ask_secret`/`ask_yn` helpers). `NN_PANEL_PASSWORD`
  is mandatory in non-interactive mode — the script exits non-zero if it's unset or
  empty. This is intentional; do not relax it.

- Manual backup-pool switch (`state.poolManualOverride` in `core/store.js`, endpoint
  `POST /api/pool/manual-toggle` in `core/panel-server.js`) is a human-triggered
  override, not automatic failover — when active, `core/checker.js`'s normal
  pool→self auto-revert-on-recovery is suppressed until the maintainer manually
  toggles back. Blocks (400 `pool_empty`) rather than allowing an empty-pool switch.
  This is a deliberately separate mechanism from the trial/trusted/blacklisted
  source-trust state machine above — don't conflate the two.
- `install.sh`'s AI-provider setup supports a third option, `openai-compatible`
  (any OpenAI-compatible third-party endpoint — the maintainer's real diagnosis
  provider, Zhipu/GLM, is configured this way: `baseUrl: "open.bigmodel.cn"`,
  `apiPath: "/api/paas/v4/chat/completions"` — note this is **not** the
  OpenAI-standard default path, don't assume a third-party provider uses
  `/v1/chat/completions` without checking its docs). Unlike `anthropic`/`openai`
  (which have runtime fallback model defaults in `core/ai-provider.js`,
  `claude-sonnet-4-6`/`gpt-4o-mini`), `openai-compatible` has no universal default
  model and `diagnoseWithOpenAICompatible()` throws if `model` is empty — the
  installer enforces a non-empty answer for this path specifically (interactive
  mode retry-loops; non-interactive mode warns loudly to stderr rather than hanging).

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
