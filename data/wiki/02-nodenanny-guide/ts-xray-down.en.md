---
title: "Common issue: the proxy service process exited"
summary: The panel shows "offline", and logs mention things like Failed to start / xray.service failed
order: 3
updated: 2026-07-22
tags: [troubleshooting, service-process]
kbRef: xray-service-down
---

## Symptom

The panel's "self-hosted node status" turns offline, or you receive a restart
notification email.

## Cause

The proxy service process itself (xray/sing-box) has exited. It's usually one of
three things: a misconfigured config file, the port already being used by another
program, or the service crashing too many times in a row, causing systemd to give up
auto-restarting it.

## What to do

First, try restarting the service:

```bash
systemctl restart xray
```

This is a "low-risk" action and can be run with one click from NodeNanny's in-panel
terminal. If it goes down again shortly after restarting, that means it's not a
one-off — check the actual error (`journalctl -u xray -n 50` for the last 50 log
lines) to figure out whether it's a config mistake or a port conflict.
