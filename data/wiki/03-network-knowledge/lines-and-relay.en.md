---
title: "Line types explained: direct / relay / IPLC / IEPL leased lines"
summary: These terms describe "which road your traffic takes from domestic to overseas" — a completely different dimension from the protocol
order: 1
updated: 2026-07-22
tags: [primer, leased-line, relay, IPLC, IEPL]
---

## This page is about the "road," not the "car"

The previous page's protocols (vmess/vless/trojan...) are like the style of the
vehicle itself; this page's line types are like whether that vehicle takes an ordinary
national highway or a dedicated expressway — the two dimensions are independent of
each other, and the same line can carry nodes running different protocols.

## Direct

Traffic goes straight from your network's exit to the overseas server, without
passing through any purpose-built relay infrastructure. Pro: simple to set up, low
cost. Con: it's fully exposed to whatever the ordinary international exit's network
conditions happen to be, with no buffer against fluctuations or targeted throttling —
relatively lower stability.

## Relay

A domestic relay server is deployed first; traffic is encrypted and sent to that
machine, which then forwards it to an overseas landing server. Compared to a direct
connection, this adds a layer of "buffer" — if one link's quality drops, there's room
to switch it out — so stability is generally better than pure direct. This is the most
common middle-ground approach for individual and small-scale use today.

## IPLC (International Private Leased Circuit)

A point-to-point dedicated link provided by a carrier that doesn't compete with public
traffic for bandwidth — the resources are relatively isolated. High stability, low
latency; the tradeoff is high cost and less flexibility in scaling bandwidth up.

## IEPL (International Ethernet Private Line)

Also a carrier-provided leased-line service, built on Ethernet technology. Compared to
IPLC it's usually more flexible for bandwidth adjustments and can be cheaper, but the
actual value for money in either case depends heavily on the quality of resources the
provider was able to secure — you can't judge it purely from the name.

## How to think about the relationship between these

Roughly speaking, from most exposed / cheapest to least exposed / most expensive:
direct < ordinary relay < IPLC/IEPL leased line. That said, be aware that services
marketed under the "leased line" label vary wildly in actual line quality — the name
itself is no guarantee of the experience. For evaluating a specific provider, refer to
the buying advice in the "Airports & VPN Wiki" category; this page only explains what
the terms themselves mean.

## What this has to do with a self-hosted node (like one you manage with NodeNanny)

If you bought your own VPS and self-host a node (rather than using a commercial
provider's service), your node most likely runs on the most basic "direct" route —
unless you separately purchased a relay or leased-line service to connect into your
self-hosted server. This is also part of why NodeNanny's backup node pool relies on
redundancy across multiple sources with different trust tiers: if your self-hosted
direct-connection node runs into trouble in its network environment, having relay- or
leased-line-based nodes available in the backup pool to step in reduces how much the
experience fluctuates.
