---
title: What is NodeNanny
summary: "In one line: it watches your own proxy node, auto-heals it when it goes down, and backfills with a pool of standby nodes when it can't."
order: 0
updated: 2026-07-22
tags: [introduction, beginner]
---

## In one line

NodeNanny is a "node nanny" that runs on your own VPS: it keeps an eye on the proxy
node you set up yourself (xray/sing-box or similar), auto-restarts it when something
goes wrong, and if your self-hosted node truly can't be brought back, it also
maintains a "backup node pool" — pulling in usable nodes from public sources and any
subscription you point it at yourself — so your client's subscription link always has
something usable in it, instead of going dark all at once.

## The core problems it solves

Running your own proxy node comes with two big worries:

1. **The service process dies and nobody notices** — it crashes at 2am, and you don't
   find out until you wake up hours later.
2. **The node itself hasn't died, but is temporarily unusable** (e.g. it's being
   blocked, or the datacenter had an outage) — restarting the process alone doesn't
   help here; you need a "backup" to step in.

NodeNanny has a dedicated mechanism for each: process-level liveness monitoring +
auto-restart handles the first, and the backup node pool handles the second.

## Overall architecture (this is all you need to know — no code required)

The project consists of three long-running processes (managed by PM2, a Node.js
process supervisor):

- **nodenanny-monitor**: watches your self-hosted node's service process and restarts
  it if it dies
- **nodenanny-panel**: the web control panel — everything you see in the browser comes
  from this
- **nodenanny-pool**: maintains the "backup node pool" — periodically finds candidate
  nodes from various sources, tests each one for real usability, and drops the ones
  that fail

The three processes coordinate by reading and writing the same set of data files — no
separate database required.

## The backup pool's three-layer filtering logic

The backup node pool doesn't just "grab and use" — every candidate node has to pass
three layers of checks in sequence before it makes it into the usable pool:

1. **Liveness check**: can this node even establish a connection?
2. **Speed check**: once connected, does it actually move data? Nodes that are too
   slow get dropped.
3. **Authenticity check**: the first two layers can be fooled by nodes that are "fake
   alive" (connectable but not actually working as a functional proxy) — this layer
   makes an actual request to a real target site to verify it really works.

Only nodes that pass all three layers count as "usable" and show up in the panel.

## Trust tiers for node sources

Node sources — whether pulled from public discovery or a subscription link you added
yourself — aren't treated equally. They go through a "trial → trusted → blacklisted"
state machine:

- New sources start in **trial** status, with a weight cap of just 5%, so a source of
  unknown provenance can't suddenly claim a large share right out of the gate
- If a source's pass rate stays consistently good through the trial period, it gets
  promoted to **trusted**, and the weight cap is lifted
- If a source's pass rate keeps declining, a trusted source gets demoted back to
  trial, and a trial source gets blacklisted
- Blacklisting isn't permanent — if a blacklisted source's real-world pass rate
  recovers over several consecutive checking rounds, it gets unblocked back into trial

This whole mechanism is fully automatic — you don't need to intervene manually, unless
you want to manually add a subscription source you've personally verified as reliable
(the next page covers how to do that).

If you want guidance on picking an actual airport/VPN service, see the "Airports &
VPN Wiki" category; "node sources" here refers to the technical reliability of the
subscription link itself, not a commercial reputation assessment of the provider.
