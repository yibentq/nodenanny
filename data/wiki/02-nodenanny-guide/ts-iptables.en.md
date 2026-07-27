---
title: "Common issue: local test fails but the service process is alive"
summary: Likely a firewall rule blocking the port — errors mention connection refused / iptables DROP
order: 5
updated: 2026-07-22
tags: [troubleshooting, firewall]
kbRef: iptables-blocking-port
---

## Symptom

The service process itself looks fine (`pm2 status` / `systemctl status xray` both
show it running), but a local connection test fails with connection refused.

## Cause

Most likely an iptables firewall rule has changed and is blocking the proxy port —
this could be a rule you configured yourself earlier, or another install script may
have changed the firewall in passing.

## What to do — please read this before running anything

```bash
iptables -F
```

**This command clears every current iptables rule, not just the one blocking the
proxy port** — it's a "high-risk" action. NodeNanny's terminal will force a
double-confirmation (typing a confirmation phrase) before actually running it, even
if the knowledge base happens to label it differently — this is a built-in safety
guardrail, not a prompt you can skip. Before running it, make sure you know whether
your firewall has any other rules you need to keep, especially anything restricting
SSH access — if the SSH rule gets wiped along with everything else, you could lock
yourself out of the server entirely.
