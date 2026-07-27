---
title: Deployment & installation
summary: What it takes to get up and running from scratch on a clean VPS
order: 1
updated: 2026-07-22
tags: [deployment, installation, VPS]
---

## Supported environments

The install script currently supports Ubuntu 20.04/22.04/24.04 and Debian 11/12. It's
best to use a brand-new VPS to avoid conflicts with existing services.

## What the installer does

Running the install script walks through several stages in order:

1. **Choose a language** — currently supports Chinese/English/Japanese/German/Russian;
   whichever you pick will apply to both the terminal prompts you see during install
   and the panel UI afterward
2. **Check dependencies** — confirms your server's Node.js version meets the
   requirement, and tells you how to install anything missing
3. **Install the underlying proxy software** — this step calls a widely-used
   community one-click installer to set up the actual proxy service doing the work
   (xray/sing-box); NodeNanny doesn't reinvent this part, it just watches over it
4. **Write the configuration** — generates `config/config.json`, including the panel
   password, bind address, and so on
5. **Start three long-running processes with PM2** — `nodenanny-monitor` (liveness
   monitoring), `nodenanny-panel` (the web panel), and `nodenanny-pool` (backup node
   pool maintenance)

## About connection drops

If you're operating the server remotely over SSH and the connection drops due to
network instability mid-install, the install script itself is designed not to get
killed as a result — but the more reliable approach is still to open a `tmux` or
`screen` session on the server first before running the installer, so that if you get
disconnected you can `tmux attach` back in and pick up where you left off.

## How to open the panel once installation is done

By default, the panel only listens on the local address (`127.0.0.1`), meaning you
can't just open it in a browser using the server's public IP by default — this is a
deliberate security choice, so the panel isn't exposed to the public internet the
moment it's installed. There are two common ways to access it:

- **SSH tunnel**: run `ssh -L local-port:127.0.0.1:panel-port your-server` locally,
  then open `http://127.0.0.1:local-port` in your browser
- **Set up Nginx reverse proxy + password**: if you want to access it directly via a
  domain or public IP, you need to explicitly set a panel password in the config, and
  configure the reverse proxy following the example file
  `deploy/nginx-nodenanny.conf.example`. If the panel detects you've changed the bind
  address away from local-only while the password is still empty, it will refuse to
  start — this is a safeguard against "forgetting to set a password and exposing the
  panel publicly," not a bug.

## The first thing to check after install: confirm all three processes are running

```bash
pm2 status
```

You should see `nodenanny-monitor`, `nodenanny-panel`, and `nodenanny-pool` all in
`online` status. If any of them keeps restarting or shows `errored`, run
`pm2 logs process-name` to see the specific error — this is also a common starting
point for troubleshooting that's gradually being documented both here and in the
"Network & Protocol Knowledge" category.
