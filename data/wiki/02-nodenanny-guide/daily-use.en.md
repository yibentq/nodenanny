---
title: Daily use
summary: What you'll see on the panel, and how to manually add your own subscription source
order: 2
updated: 2026-07-22
tags: [usage, panel]
---

## What's on the panel home page

- **Self-hosted node status**: whether your own proxy service is alive, along with
  uptime stats at the bottom
- **Subscription address**: NodeNanny generates its own "smart subscription" link —
  clients only need to subscribe to this one address. It returns your real node when
  your self-hosted node is healthy, and automatically switches to backup-pool content
  when your self-hosted node is down and the pool has usable nodes — you never need to
  manually swap subscription links
- **Backup node pool / star-map view**: which sources are currently in the backup
  pool, each source's trust status (trial / trusted / blacklisted), and node counts

## Manually adding a subscription source you trust

If you have a stable subscription link of your own (whether it's from another provider
you personally pay for, or one a friend shared), and you want it to participate in the
backup pool too, that goes through the "manual source" path. A newly added manual
source still goes through the same trial-period evaluation — it doesn't skip the trust
tiers just because you added it by hand:

```bash
cat <<'EOF' | node
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('config/config.json', 'utf-8'));
const newSources = [
  { id: 'short-id-for-this-source', name: 'Display name', url: 'subscription-link' }
];
for (const s of newSources) {
  if (!config.pool.manualSources.some(x => x.id === s.id)) {
    config.pool.manualSources.push(s);
  }
}
fs.writeFileSync('config/config.json', JSON.stringify(config, null, 2));
console.log('Written:', config.pool.manualSources.map(s => s.id));
EOF
pm2 restart nodenanny-pool
```

Using a heredoc to run a small JS script — rather than gluing JSON together with
`sed`/`echo` — avoids the easy mistake of missing or adding an extra comma when hand-
editing JSON, which can break parsing of the whole config file. This approach has been
verified repeatedly throughout the project without issues.

Once added, the source will run in "trial" status for a while, and you can watch its
real-time pass rate on the panel's star-map view — no further action needed.

## When to check the "Network & Protocol Knowledge" category

If you notice a particular kind of node (say, a specific protocol) consistently has a
low pass rate, but you've confirmed the subscription source itself is fine, that's
usually a knowledge gap about the protocol itself, not a NodeNanny misconfiguration —
in that case, check the corresponding protocol's entry in the "Network & Protocol
Knowledge" category. That category covers how the protocols themselves work and their
common limitations; it's not about how to use the NodeNanny tool.
