---
title: "How services are categorized: a few common dimensions"
summary: Two providers can both call themselves an "airport" and still be worlds apart. These dimensions help you cut to what matters
order: 2
updated: 2026-07-23
tags: [categorization, primer, beginner]
---

## Dimension one: self-hosted vs. resold

**Self-hosted providers** buy their own servers and build/maintain their own lines
themselves. Information tends to be more transparent, and ones willing to disclose
their line type (leased line / relay / direct) are generally more trustworthy.

**Resold (white-label) providers** wholesale node capacity from an upstream supplier
and repackage it under their own brand. Reselling itself doesn't automatically mean
untrustworthy, but it does mean the actual line quality you get depends on an upstream
party you have no visibility into — if that upstream runs into trouble (price hikes,
disappearing, getting shut down), the downstream reseller often vanishes overnight or
the service collapses suddenly. This amplifies the risk.

## Dimension two: line type

See the "direct / relay / leased line" explanations in the [Glossary](./glossary) —
this is the dimension that most directly affects your day-to-day experience. Rough
ordering (for reference only; actual performance still depends heavily on how well the
specific provider operates things):

Leased line (IPLC/IEPL) > multi-line relay (BGP) > ordinary public-network relay > pure direct

Higher on this list is generally more stable and more expensive; lower is generally
cheaper and more exposed to peak-hour congestion and line fluctuations.

## Dimension three: billing model

- **Fixed monthly/annual plan**: a set data allowance each month, throttled or unusable
  once exceeded; pricing is relatively predictable.
- **Pay-as-you-go**: you're charged for what you use — flexible, but can trigger
  "data anxiety" near the end of the month.
- **Multiplier-based**: different nodes consume data at different rates (see "rate
  multiplier" in the glossary); often layered on top of the two models above to balance
  the real cost differences between lines.

## Dimension four: target use case

Different providers emphasize different things — match this against your own main need:

- **Streaming-unlock focused**: usually markets "Netflix/Disney+ unlock support"; the
  node count may be modest, but it's been specifically optimized for particular
  streaming services.
- **Gaming-focused**: emphasizes low latency and UDP optimization, sometimes with
  dedicated gaming-optimized lines.
- **General everyday use**: lots of nodes, broad regional coverage, no single use case
  emphasized — a good fit for browsing and video-watching type needs.

## How to use these dimensions

No need to memorize any of this — the rough approach is: first figure out which use
case matches your main need, then check whether the provider's disclosed line-type
information is clear and plausible, and finally cross-reference against the concrete
checklist in [How to choose as a beginner](./how-to-choose). No single dimension is
enough on its own to decide whether a provider is good — combining them gives a more
reliable read.
