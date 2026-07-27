---
title: "Common issue: TLS certificate expiring soon or already expired"
summary: Clients can't connect, and errors mention things like certificate expired
order: 4
updated: 2026-07-22
tags: [troubleshooting, certificate]
kbRef: tls-cert-expiring-soon
---

## Symptom

Client connections fail, with error messages mentioning certificate validation
failure or an expired certificate.

## Cause

The TLS certificate is about to expire or already has. If you're using acme.sh for
auto-renewal, the actual problem is usually that "the renewal succeeded, but the
service never reloaded the new certificate" — not that the renewal itself failed.

## What to do

```bash
acme.sh --renew -d your-domain.com --force
systemctl restart xray
```

Replace `your-domain.com` with your actual domain. This is a "medium-risk" action —
the terminal will pre-fill the command into the input box, but you need to confirm and
press Enter yourself; it won't run automatically, because forcing a renewal plus
restarting the service causes a brief service interruption, which is worth confirming
the timing of manually.
