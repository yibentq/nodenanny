# NodeNanny

**You buy the server. NodeNanny watches it for you.**

> **The three-sentence version (for people who don't know anything technical):**
> 1. You spend a few dollars on a "server" (a VPS), install proxy software on it, and use it alone — this is more private and safer than using some random free app from an unknown source.
> 2. But servers misbehave from time to time (the process crashes, the protocol gets fingerprinted and blocked) — and if you're not technical, you have no way to notice, let alone fix it.
> 3. NodeNanny is the "nanny" that watches this server for you: if it goes down, NodeNanny restarts it automatically, emails you about it, and gives you a simple web page where you can check whether everything is healthy — you never need to read a single line of code.

NodeNanny is an automated caretaker tool for people who self-host a proxy node but don't do sysadmin work. It doesn't help you deploy the node itself (the existing one-click scripts already do that well) — it takes over **after** deployment: uptime monitoring, automatic restarts, failure emails, and a status page you can actually understand.

If you're at the "I've heard of self-hosting a proxy, but I don't even have a server yet and have never touched a terminal" stage, read the two "Before You Start" sections below first, and skip the more technical parts until you actually get stuck.

## What this is NOT

- Not a panel for managing a proxy business (Marzban, 3X-UI, and Remnawave already do that well — competing head-on would be pointless).
- Not a node-pool aggregator.
- Not built for proxy sellers ("airport" operators) or companies.

If you need to manage many nodes for many users, use [Remnawave](https://remna.st/) or [Marzban](https://github.com/Gozargah/Marzban) instead. NodeNanny only serves the "one server, one node, one non-technical person" scenario.

## Before You Start, Part 1: What You'll Need

This is the honest, complete checklist. Read it once before you start the install script, so nothing surprises you halfway through.

**Required, no way around it:**
- **A VPS (a small cloud server)** — see the section below on where to get one. The cheapest tier (roughly 1 vCPU / 1GB RAM) is plenty.
- **A terminal on your own computer** to SSH into that server. macOS/Linux already have one built in; Windows 10/11 also has one built in (PowerShell/Windows Terminal). No extra software needed.
- **Your VPS's IP address, username (almost always `root`), and password** — these are the only three things you get from your VPS provider and the only three things you need to log in.

**Optional, only if you want the matching feature — the installer will ask about each of these, and you can always say no and fill them in later:**
- **An email account with SMTP access**, if you want failure notifications by email. This is the one prerequisite that's honestly a bit rough for non-technical users — see the dedicated "Configuring Email" section below for exactly why, and what we do to make it less painful.
- **An Anthropic or OpenAI API key**, if you want the optional AI failure-diagnosis feature. You use *your own* key, billed to your own account — NodeNanny never sees or charges for it. Get one at [console.anthropic.com](https://console.anthropic.com/) or [platform.openai.com](https://platform.openai.com/).
- **A GitHub personal access token**, if you want the optional "backup node pool" self-healing feature (an experimental fallback system — see the dedicated section below). A token with **zero scopes/permissions checked** is enough; it's only used to raise your GitHub API rate limit, not to access anything private. Generate one at `github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)`.
- **The real subscription link your one-click node-deploy script gave you** (e.g. from the 233boy Xray installer), if you want the backup-pool auto-switch feature to work. If you used the installer's built-in "auto deploy Xray" step, NodeNanny already has this — you don't need to hunt for it yourself.

Nothing above costs anything by itself (some VPS providers charge for the server, obviously, but every NodeNanny feature itself is free and there's no NodeNanny account to sign up for).

## Before You Start, Part 2: Getting a Server

NodeNanny doesn't sell servers — you need to buy a "VPS" (Virtual Private Server, essentially a computer you can remotely control that belongs only to you) first. The bare minimum you need to know:

- **Where to buy**: search "VPS" or "cloud server". Any reasonably reputable provider works — you don't need to compare thirty of them.
- **What spec to pick**: this workload is very light. The cheapest tier (usually ~1 vCPU, ~1GB RAM) is enough — no need to overpay "just in case."
- **Which region**: pick one physically close to you, or one the provider advertises as "network-optimized" for your region. Not a big decision for a beginner, and you can switch later if you picked wrong.
- **Which OS**: pick **Ubuntu 22.04** or **24.04** at checkout (NodeNanny also supports Ubuntu 20.04 and Debian 11/12, if that's all that's offered).
- **What you get after buying**: an IP address, a username (almost always `root`), and a password (sometimes emailed to you, sometimes shown in a "login info / reset password" page in your provider's dashboard). These three things are the only credentials you need going forward — **never share them with anyone who claims they'll "deploy it for you," or with any tool whose source you can't verify.**

Once you have these three things, move on to the next section to connect to the server.

## Before You Start, Part 3: Connecting to the Server (SSH)

The server has no screen or keyboard. You connect to it remotely from a "terminal" app on your own computer, using SSH. It's not point-and-click like normal software, but it only takes one line of typing.

**Windows:**
1. Press `Win`, search for and open "Terminal" or "PowerShell" (built into Windows 10/11, nothing extra to install).
2. Type (replacing `your-server-ip` with the IP address from your VPS purchase):
   ```bash
   ssh root@your-server-ip
   ```
3. On first connection you'll be asked whether to trust this host — type `yes` and press Enter.
4. When asked for the password, paste it (terminals usually show nothing while you type/paste a password — that's normal, not a glitch; just press Enter after).

**Mac:**
1. Press `Command + Space`, search for and open "Terminal" (built into macOS).
2. Everything else is identical to Windows: `ssh root@your-server-ip`.

Once connected, your prompt will change to something like `root@your-server:~#` — you're now inside the server, and can follow the "Installation" section below.

> If you see `Connection refused` or `timed out`: the server is probably still booting (a freshly-bought machine sometimes takes a few minutes) or you mistyped the IP. Double-check, then try again in a few minutes.

## What It Does

- **Uptime monitoring**: checks whether your node's port is reachable every few minutes.
- **Automatic restart**: runs your restart command automatically when it detects a problem.
- **Email notifications**: emails you when the node goes down, and again when it recovers — you don't need to keep watching it.
- **Status panel**: a web page showing node status, uptime, and recent events, in Chinese/English/Japanese/German/Russian.
- **AI failure diagnosis (optional)**: when the node is down for a while, uses your own Anthropic/OpenAI API key to suggest possible causes and next steps — advisory only, it never takes any action on your behalf.
- **Password-protected panel**: if you expose the panel through Nginx, a password is required before anyone can see it.

The panel process itself only listens on the server's own loopback address (`127.0.0.1`) — either use an SSH tunnel to peek at it occasionally, or set up the Nginx reverse proxy + password from the "Accessing the Panel" section below for regular use.

## Installation

```bash
git clone <your-repo-url> nodenanny
cd nodenanny
sudo bash install.sh
```

> **Brand-new server that doesn't even have git yet?** Use this one-liner instead — it checks for/installs git, clones the repo, then hands off to `install.sh`:
> ```bash
> sudo bash <(curl -fsSL https://raw.githubusercontent.com/yibentq/nodenanny/main/bootstrap.sh)
> ```
> Make sure to use `bash <(curl ...)` exactly like that, not `curl ... | bash` — piping would leave `install.sh`'s later interactive prompts unable to read your keyboard input.

The script will, in order: install Node.js / PM2, walk you through an interactive setup (node info, SMTP email, AI diagnosis, the backup node pool, the online terminal, and content sync can all be configured right here, or skipped and filled in later in `config.json`), start three background processes with PM2, and finally help you set up how you'll access the panel (domain / bare IP / SSH tunnel — your choice). **You only run this once.**

Supported OS: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12.

## Configuration Reference

Copy `config/config.example.json` to `config/config.json`, then edit:

| Field | What it means |
|---|---|
| `node.checkHost` / `node.checkPort` | The address and port your node listens on |
| `node.restartCommand` | The command run when the node is unhealthy. For a systemd deployment: `systemctl restart xray`. For Docker: `docker restart xray`. If you're not sure of the exact service/container name, run `bash scripts/check-service.sh` first (it auto-detects both deployment styles) rather than guessing |
| `monitor.checkIntervalMinutes` | Check interval, default 5 minutes |
| `monitor.notifyCooldownMinutes` | Notification cooldown, to avoid a flood of emails if the node flaps |
| `panel.password` | The panel's login password. Leave empty only if you're accessing exclusively via SSH tunnel and never exposing it to the open internet |
| `node.subscriptionUrl` | The real subscription link your one-click node-install script generated (optional). Needed for the backup-pool auto-switch feature below |
| `pool.enabled` | Whether the backup node pool is on, default `false` |
| `smtp.*` | SMTP credentials for notification emails — see "Configuring Email" below |
| `ai.*` | AI diagnosis settings (optional) — see "AI Failure Diagnosis" below |

**Prefer not to `nano` a JSON file by hand, or setting this up on a headless/scripted server?** `install.sh` also supports a fully non-interactive mode driven by environment variables (`NN_NONINTERACTIVE=true` plus one `NN_*` variable per prompt — e.g. `NN_NODE_NAME`, `NN_CHECK_PORT`, `NN_RESTART_CMD`, `NN_PANEL_PASSWORD`, `NN_SMTP_*`, `NN_AI_*`). `NN_PANEL_PASSWORD` is the one mandatory variable in this mode — the script refuses to run without it, since an empty panel password would mean no protection at all. See the comments at the top of `install.sh` for the full variable list if you want to script a deployment.

## Accessing the Panel

The panel process only listens on `127.0.0.1:8787` by default (unreachable from the outside world unless you change this — that's intentional, for safety).

**`install.sh` now asks you which access method you want at the very end — you don't need to configure a reverse proxy yourself:**
- **You have a domain** → it installs Nginx, requests a Let's Encrypt certificate, and configures the reverse proxy automatically, giving you a `https://your-domain` link.
- **No domain** → it installs Nginx, generates a self-signed certificate, picks a random port, and adds an extra password layer at the Nginx level (same password as the panel). You'll get a `https://your-server-ip:random-port` link. Your browser will warn the certificate isn't trusted — that's expected for a self-signed cert (it's still encrypted); click "Proceed/Advanced" to continue. You'll then be asked for a password a second time — that's the extra Nginx-level protection, not an error.
- **Skip it, use an SSH tunnel yourself** → the script prints a command like:
  ```bash
  ssh -L 8787:127.0.0.1:8787 root@your-server-ip
  ```
  then open `http://localhost:8787` in your browser. You'll need to open this tunnel every time you want to check in — fine for occasional use, not for daily use.

The generated access URL is printed in the terminal and also saved to `PANEL_ACCESS_URL.txt` — open that file any time you forget it.

**If the automatic setup fails, or you'd rather manage Nginx yourself**: see `deploy/nginx-nodenanny.conf.example` for complete examples covering both the domain+HTTPS case and the bare-IP case — just change the domain/certificate paths and it's ready to use. You can also add the reverse proxy manually through a control panel like aaPanel (Website → Add Site → Reverse Proxy, target `http://127.0.0.1:8787`).

You can log out (there's a logout button in the bottom-right corner of the panel); next visit will ask for the password again.

## Backup Node Pool (Optional Emergency Fallback)

**This is not a core feature — think of it as an airbag.** It's off by default. If your node goes down, NodeNanny temporarily borrows a node scraped from open, public sources so your client isn't left completely disconnected; once your own node recovers, it switches back automatically and the pool goes idle again.

**Important safety note you must understand: the nodes in this pool belong to strangers' servers with unknown security properties. They're meant for a few minutes to a few hours of emergency use — never rely on them long-term.**

**A note on content that changes over time**: while your main node is down and the panel is serving pool nodes, the actual node list in that subscription can change whenever the pool refreshes in the background (every `pool.refreshIntervalHours`, 6 hours by default) — this is expected behavior, not a bug. It only happens while you're actively on the fallback pool; your own node's subscription content never changes on its own.

**A note on refresh failures**: it's normal, and expected, for a background refresh to occasionally come back with zero usable nodes — free public sources have inconsistent quality, and most candidate nodes fail the three-layer check (alive → speed → authenticity) on any given attempt (`pm2 logs nodenanny-pool` may show a "refresh failed" line for this reason). This does **not** mean the pool is broken: NodeNanny simply keeps serving whatever nodes it last successfully verified, and tries again on the next cycle. Only worry if the panel shows zero pool nodes for many consecutive cycles in a row.

### How to enable it

- `install.sh` asks whether to install it during setup (needs the server to reach GitHub and PyPI — a network-restricted server may fail to install; a failed install doesn't affect any other feature, just skip it).
- Or install it manually later:
  ```bash
  git clone --depth 1 https://github.com/wzdnzd/aggregator.git /root/aggregator
  cd /root/aggregator && pip3 install -r requirements.txt
  ```
  Then set `pool.enabled` to `true` in `config.json` and restart: `pm2 restart nodenanny-pool`.
- Either path also needs the **sing-box** binary as the detection backend for the pool's three-layer quality check (alive → speed → authenticity). `install.sh` installs this automatically via the official SagerNet apt repository whenever the pool is enabled; if that automatic step ever fails, follow [the official install docs](https://sing-box.sagernet.org/installation/package-manager/) and then run `pm2 restart nodenanny-pool` — no need to rerun the whole installer.

### How to use it (with subscription auto-switch)

1. Put the **real subscription link** your one-click node-install script gave you into `node.subscriptionUrl` in `config.json`.
2. The panel logs (`pm2 logs nodenanny-panel`) will print NodeNanny's own subscription address, shaped like:
   ```
   http(s)://your-panel-access-address/sub/a-random-string
   ```
3. Put **this** address (not the original real one) into your client app's subscription field (Shadowrocket / Clash / sing-box, etc.).
4. Day to day, your client keeps refreshing and always gets your real node — you won't notice any difference. The moment your own node goes down, NodeNanny swaps in pool nodes (clearly labeled "backup/unverified" in the node name), and swaps back automatically once your node recovers.

**A note on client compatibility (not a bug — it's a client-side policy):** if you don't have a domain (i.e. you're on the "no domain" path under "Accessing the Panel" above), this smart subscription URL is plain `http://`, not `https://` — that's a deliberate choice to stay compatible with Shadowrocket-style clients, which flatly reject a self-signed HTTPS certificate with no trust-exception option. The flip side: **v2rayN (desktop) and v2rayNG (Android), starting with their 2025 releases, refuse to even save a subscription URL that starts with `http://`**, with the error "Please do not use an insecure HTTP subscription URL." This is a security policy those two clients added on their own — it has nothing to do with the actual subscription content NodeNanny generates (which is standard, well-formed data).
If you use v2rayN / v2rayNG, the smart subscription feature won't work under a no-domain deployment. Two ways around it:
- Use NekoBox or Shadowrocket instead — neither has this restriction on `http://` subscription URLs; or
- Get a domain for your server and re-run the installer choosing the "I have a domain" path (real Let's Encrypt certificate, `https://` — works with every client).

### Candidate source discovery (experimental "self-healing" layer)

On top of the fixed aggregator source above, NodeNanny can also periodically scan GitHub for other public repositories that publish similar node lists, and gradually build trust in the ones that turn out reliable — starting each new source at a tightly capped weight until it earns more, and auto-blacklisting sources that produce clearly bad data (e.g. many "different" nodes that turn out to share the exact same credentials — a strong signal of a low-quality or dishonest source).

- `install.sh` asks about this separately (right after the question above). Say yes, and it'll ask for a GitHub token (optional). **Important — the token isn't optional for everything**: source discovery actually runs two independent searches. Searching by topic label works fine with no token (subject to GitHub's lower unauthenticated rate limit). Searching by filename pattern **requires** a token — GitHub's code-search API rejects unauthenticated requests outright, so without a token that half of discovery simply never runs (you won't see an error, it's just silently skipped). A token with **zero scopes/permissions checked** is enough for both — it only raises your rate limit and unlocks filename search, it doesn't grant access to anything private.
- This is genuinely experimental. It's been validated end-to-end against real GitHub data and real candidate nodes, but it's still a young feature — treat it the same way as the rest of the backup pool: fine for a short emergency, not something to depend on.

### Manual seed sources (subscriptions you've vetted yourself, added 2026-07-14)

If you've found a free-node subscription you trust (say, one shared and actively maintained by someone on Telegram), you can add it by hand to the `pool.manualSources` array in `config.json` so it joins the multi-source pool too:

```json
"manualSources": [
  { "id": "wangcai", "name": "WangCai", "url": "https://shz.al/~WangCai" }
]
```

- `id` can be any unique string; restart the pool process (`pm2 restart nodenanny-pool`) after editing config for it to take effect.
- **Important**: sources added this way go through the exact same trial/trust state machine as GitHub-discovered sources — adding one here does not grant permanent trust. Even though you've personally vetted it, we still have no way to verify who actually runs it or whether it might turn bad later, so its first-round weight is capped low just like any newly discovered source, and it earns more weight only through a sustained real pass rate. If it ever starts producing anomalous data (e.g. a batch of "different" nodes sharing identical credentials — a honeypot signature), it gets auto-demoted/blacklisted the same as any other source, with no special treatment just because you added it manually.
- These tend to be fresher and higher quality than randomly discovered GitHub repos (someone is actively curating them), but the risk is the same as with any stranger's node: technical checks can confirm "it connects and the content isn't tampered with," not "the operator isn't logging your traffic metadata" — the panel will still honestly label it as an unknown server.

## AI Failure Diagnosis (Optional)

**This is advisory only, never automatic action.** Once the node has been down for a configured number of consecutive checks, NodeNanny sends the recent event timeline to an AI and asks "what might be wrong, what should I check next" — the answer shows up as a card on the panel, and (if SMTP is configured) in its own email. NodeNanny never executes any fix on your behalf.

It uses **your own** Anthropic or OpenAI API key, calling the official API directly — NodeNanny never sees, stores, or bills for your key.

### How to enable it

- `install.sh` asks directly during setup (skippable, can be turned on any time later).
- Or edit the `ai` section of `config.json` by hand:

| Field | What it means |
|---|---|
| `ai.enabled` | Whether it's on, default `false` |
| `ai.provider` | `anthropic`, `openai`, or `openai-compatible` |
| `ai.apiKey` | Your own API key. Leave blank if unconfigured (**don't** paste in placeholder/explanatory text — that would get sent to the real API as if it were a key, producing a confusing error) |
| `ai.model` | Specific model name; leave `""` to use the default (`claude-sonnet-4-6` for Anthropic, `gpt-4o-mini` for OpenAI). **Required** (no default) when `ai.provider` is `openai-compatible` |
| `ai.baseUrl` | Only used when `ai.provider` is `openai-compatible`. A bare hostname, no `http(s)://` prefix (e.g. `open.bigmodel.cn`) |
| `ai.apiPath` | Only used when `ai.provider` is `openai-compatible`. Defaults to `/v1/chat/completions` if left blank |
| `ai.triggerAfterFailures` | How many consecutive failures before it auto-triggers a diagnosis, default `3` |
| `ai.language` | Language for the diagnosis text and error messages: `zh`/`en`/`ja`/`de`/`ru`. Defaults to whatever you picked during install — this is separate from the panel's own display-language switch (that one lives in your browser; the server doesn't know about it), change this field directly if you want a different one |

**What's `openai-compatible` for?** Plenty of third-party or free-tier providers (e.g. Zhipu/GLM, DeepSeek, Qwen/通义, Moonshot/Kimi, and others) speak an OpenAI-compatible chat-completions API without being OpenAI itself. Pick this provider and fill in `baseUrl`/`apiPath` to use one of them — verified working end-to-end against Zhipu's free-tier GLM. One difference from the two official providers: content sent to an `openai-compatible` endpoint is sanitized first (see the redaction step in `core/ai-provider.js`), since these are typically third-party or free services; the official Anthropic/OpenAI paths are not sanitized. If you're on a thinking/reasoning model through this path and diagnoses keep coming back empty, make sure `ai.model` is set to a real model name your provider hosts — reasoning models can burn their whole token budget on internal thinking before writing a final answer if the request's token budget (not user-configurable) is set too low for that model.

After editing, restart the monitor process: `pm2 restart nodenanny-monitor`.

### How to use it

- Normally you don't need to do anything — it triggers automatically once the failure threshold is hit.
- You can also click "Diagnose Now" on the panel's AI card to trigger one manually any time (handy for testing without waiting for a real outage; manual triggers don't send an email).

## Configuring Email

Any SMTP-capable mailbox works. Here are the common ones — copy the matching row straight into the `smtp` section of `config.json`:

| Provider | host | port | secure | What to put as the password |
|---|---|---|---|---|
| QQ Mail | smtp.qq.com | 465 | true | The **authorization code** generated in QQ Mail's settings — **not** your QQ login password |
| 163 Mail | smtp.163.com | 465 | true | The **authorization code** generated in 163 Mail's settings — **not** your login password |
| Gmail | smtp.gmail.com | 465 | true | A Google **App Password** — **not** your Google account password. You must turn on 2-Step Verification first, then generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) |
| A company/self-hosted mailbox | ask your email provider | usually 465 or 587 | `true` for 465, `false` for 587 | Your normal login password |

**Being honest about this one**: this is the single part of setup we think is genuinely not friendly enough for non-technical users yet. "App passwords" and "authorization codes" are a real, necessary security feature of modern email providers, but the process of finding the right settings page and generating one is confusing if you've never done it — we've looked at several providers' flows ourselves and found some of them genuinely unclear even for us. `install.sh` gives you a menu (QQ / 163 / Gmail / other / skip) and prefills the host/port/security settings for the first three so you only have to go generate the code/password itself, but we haven't yet built a truly beginner-proof walkthrough for that last step. If you get stuck, skip email during install (choose "skip", option 5) — every other NodeNanny feature works exactly the same without it, you'll just rely on the panel instead of email alerts, and you can always come back and configure it later.

Once configured, you can test it by running the monitor once by hand:

```bash
node core/monitor.js
```

Watch the terminal for any SMTP-related error. If there's none, `Ctrl+C` to stop it and let PM2 manage it as usual (`pm2 restart nodenanny-monitor`).

## Common Commands

```bash
pm2 status                      # Check process status
pm2 logs nodenanny-monitor      # View monitor logs
pm2 restart nodenanny-monitor   # Manually restart the monitor process
sudo bash uninstall.sh          # Uninstall
```

## Tech Stack

Node.js + PM2 + plain JSON file storage + a plain HTML/JS panel + SMTP email. No database dependency, no Docker, no paid third-party service — $0 cost.

Backup-pool nodes are tagged with a country code using the [`@ip-location-db/geo-whois-asn-country-mmdb`](https://github.com/sapics/ip-location-db) dataset (public-domain / CC0 licensed, bundled via `npm install`, no signup or attribution required). Lookups are best-effort — if a node's address can't be resolved, its country is simply left blank rather than blocking anything.

## FAQ

**Why no Telegram notifications?**
Telegram has real barriers to sign-up and daily use in some regions, which conflicts with the "zero sysadmin skill required, friendly to non-technical people" goal. Email is unglamorous, but everyone already has one and there's no extra barrier.

**v2rayN / v2rayNG says "Please do not use an insecure HTTP subscription URL" and won't import NodeNanny's smart subscription — what's going on?**
This is a security policy those two clients added on their own starting in 2025 — not a NodeNanny bug. Any subscription URL starting with `http://` (the default under a no-domain deployment) gets rejected outright at save time, regardless of whether the content itself is valid. See "A note on client compatibility" under "Backup Node Pool" above — switching to NekoBox / Shadowrocket, or getting a domain for a real HTTPS certificate, both fix it.

**Can it manage multiple nodes?**
Single node only, for now. This is a minimalist tool for one person, not a multi-node management platform.

**Is it safe to expose the panel to the internet?**
By default the panel only listens locally — it's only reachable externally if you deliberately set up the Nginx reverse proxy, and that setup always requires a password. Login cookies are HttpOnly and signature-verified, and repeated wrong-password attempts get rate-limited. Beyond that, your overall security also depends on your server, your SSH password strength, and whether you've set up HTTPS — NodeNanny can only guarantee this one layer is done right, not your server's overall security.

## Troubleshooting FAQ

Don't panic — check the matching scenario below first; most issues don't need a reinstall.

**Panel won't load / spinning forever / "can't reach this site"**
1. Confirm the server itself isn't stopped or expired: log into your VPS provider's dashboard and check the instance is "running."
2. SSH in (see "Before You Start, Part 3" above) and run `pm2 status` to check both processes show `online`; if not, try `pm2 restart all`.
3. If you're using the domain-based access method, confirm the domain's DNS record hasn't been changed or broken (e.g. you switched providers and forgot to update it).
4. If you're using the no-domain random-port method, double check the port number in `PANEL_ACCESS_URL.txt` matches what you're typing into the browser (it's randomly generated, easy to misremember).
5. Still stuck? Share the output of `pm2 logs nodenanny-panel --lines 50` with whoever's helping you.

**Forgot the panel password**
You set this yourself at install time; NodeNanny can't recover it, only reset it:
```bash
cd nodenanny
nano config/config.json   # find the panel.password line, change it to your new password, save (Ctrl+O, Enter, Ctrl+X to exit)
pm2 restart nodenanny-panel
```
If you're using the no-domain access method, there's also a separate Nginx-level Basic Auth password (same as the panel password by default at install time) — changing the panel password doesn't automatically update this one, so update it too:
```bash
sudo openssl passwd -apr1 your-new-password   # prints a hash
sudo nano /etc/nodenanny/ssl/htpasswd  # replace the part after the colon with the hash above, save
sudo systemctl reload nginx
```

**The server restarted (provider maintenance, or you rebooted it yourself) and the panel/monitor disappeared**
Normally you don't need to do anything — NodeNanny runs under PM2 with startup-on-boot configured by `install.sh`, so it should recover on its own within a minute or two of the server coming back up. If it's been a few minutes and it's still down, SSH in and run:
```bash
pm2 resurrect
```
If this says there's no saved process list, startup-on-boot wasn't configured successfully at install time — run `pm2 startup`, follow the command it prints out, run that, then `pm2 save` once — future reboots will recover automatically after that.

**Forgot how you access the panel**
Open `PANEL_ACCESS_URL.txt` in the project directory — the access URL generated at install time is saved there, no need to redo the whole install.

## License

AGPL-3.0

---

*A Chinese-language version of this README is kept at [README.zh-CN.md](README.zh-CN.md).*
