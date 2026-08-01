---
title: Current State of the Domestic "Airport" Market
summary: The industry's overall structure, the cost/acquisition logic behind extremely-low-cost plans, and why shutdowns are a structural norm — no reviews of specific providers, only industry-wide patterns
order: 5
updated: 2026-07-28
tags: [airports, industry, shutdowns, market, low-cost-services]
---


> This article discusses the overall state and structural characteristics of the "airport" industry (proxy-reseller services aimed at domestic users) — it is not a review or recommendation of any specific providers. Review content about specific providers is itself full of manipulated rankings, sponsored posts, and self-promotion, and is generally low in reliability; this article deliberately avoids citing specific ranking numbers from "monthly leaderboard" or "shutdown list" sites, and does not name any specific brand.

## Basic structure of this industry

An "airport" is essentially a middleman model: bulk-purchasing bandwidth and lines upstream (IEPL/IPLC leased lines, cloud servers, residential broadband, etc.) and splitting them into small subscription packages resold to individual users. Several structural characteristics stand out:

- **Low barrier to entry, low cost to exit**: setting up a panel plus a few VPS/leased lines is enough to start selling. Likewise, shutting down and disappearing is operationally cheap (stop the domain, disband the group — users have little recourse).
- **Leased-line cost is the main fixed expense**: providers advertising IEPL/IPLC typically pay monthly line fees far higher than ordinary VPS bandwidth costs — this is the cost basis behind the common industry saying that "expensive isn't necessarily reliable, cheap isn't necessarily bad, but long-term stable operation is more likely to lose money."
- **Scale isn't much of an advantage — if anything, it's a burden**: the more users, the more likely the exit IP is to be specifically targeted for identification and throttling/blocking, so providers must continually rotate IPs and add nodes; marginal cost doesn't meaningfully decrease with scale.
- **Panel software is highly homogeneous**: the vast majority of providers use the same handful of open-source/paid panels (subscription-link import, package management, usage-display interactions are nearly identical), which is also why ordinary users can't judge a provider's actual operational quality just from "how professional the interface looks" — the panel itself says nothing about the lines, team, or financial standing behind it.

## The extremely-low-cost ("one-yuan") tier: why this recurs in the domestic market

The industry has a long-standing category of extremely cheap packages (commonly advertised as "¥1/month" or "¥1 trial," with some annual plans priced in the low tens of yuan). This is not an isolated phenomenon but a recurring sub-category with a fairly consistent playbook, worth breaking down in terms of cost structure and business logic rather than simply labeling it "scam" or "genuinely cheap."

**Cost side: how near-zero cost is achieved**

- **Riding free/trial-tier cloud resources**: many extremely-low-cost providers' backend nodes run on new-user trial-period resources from major cloud vendors (AWS, Azure, etc.), obtained on a rolling basis through batches of "disposable" accounts registered and discarded daily or monthly. Once a cloud vendor's risk controls flag abnormal traffic patterns, these accounts get suspended and the nodes stop working — this is also why this tier of provider often sees large numbers of nodes fail simultaneously ("all red at once"): it's typically upstream accounts being recycled in bulk, not isolated node failures.
- **"Leased-line" naming disconnected from the actual line**: some extremely-low-cost nodes are labeled with terms like "IPLC leased line" in their names, but the actual line is ordinary public-internet connectivity — the naming is more marketing packaging following industry convention than an indication that a real leased line was actually purchased. Even user communities around this tier of provider don't shy away from acknowledging that "the name is just a name."
- **Overselling**: a single server's real capacity is limited, but the number of accounts sold far exceeds reasonable capacity, driving marginal cost down at the expense of user experience (can't connect during peak hours, throttling, frequent disconnections).

**Acquisition side: this tier usually doesn't profit from the subscription itself**

- **Low price as an acquisition hook**: one-yuan-tier pricing usually isn't an independently sustainable pricing strategy — it functions more as a low-friction hook to acquire user volume and search visibility, with the actual margin recouped elsewhere (later price increases, an affiliated higher-priced brand, ad placements, paid membership add-ons, etc.).
- **The existence of referral/affiliate mechanics indicates the acquisition channel itself isn't purely paid advertising**: in some non-review, non-promotional user community discussions (e.g. everyday Q&A threads on technical forums), users can be seen discussing "airport referral commissions" and "withdrawing USDT" — indicating that a meaningful share of providers (not limited to this tier, but especially common among low-price-acquisition providers) rely on existing users bringing in new ones for a commission cut, rather than funding advertising entirely out of pocket. This also helps explain why this tier keeps attracting new users even when the pricing shows no visible profit margin.

**Structural relationship to shutdowns**

- With both entry barrier and exit cost compressed close to the minimum, this tier concentrates more risk within the broader pattern of "shutdowns being a structural norm across the industry": the same kind of non-promotional, everyday technical-community discussion (as opposed to leaderboard-site "shutdown warnings") repeatedly corroborates an empirical observation — that extremely-low-cost providers shut down noticeably more often than the mid-to-high-priced providers users rely on as their primary service, and that treating a low-cost provider as a "backup" doesn't necessarily reduce risk either (it isn't rare for the backup to fail before the primary one does).
- A realistic framing for individual users: treat this tier of service as something for short-term trial, temporary protocol-compatibility testing, or an emergency-only fallback — not something to depend on long-term or stock up on via a large annual prepayment. This aligns with the general guidance in this article's later "practical implications for individual users" section, just with the risk more pronounced and worth calling out specifically for this sub-category.

## "Shutting down" is a recurring structural pattern in this industry, not an isolated case

Multiple independent sources (review blogs, shutdown-tracking sites, user forum feedback) all describe the same phenomenon: providers closing down, disappearing, and reopening under a new name is an ongoing occurrence in this industry, not a sporadic one. Commonly cited reasons include:

- Pressure from leased-line/bandwidth costs, with cash flow tightening as soon as user growth slows
- Tightening regulation raising the difficulty and cost of acquiring upstream resources (leased lines, IP ranges)
- Some operators running a short-term arbitrage model from the start — "collect prepayments and disappear" — especially common among those marketing "lifetime plans" or "extreme annual discounts"
- As noted above, the extremely-low-cost tier specifically shows a structurally higher relative shutdown frequency, a pattern repeatedly mentioned across multiple non-promotional user discussions

Most of this information comes from non-independent review/ranking sites with their own promotional incentives, and time-sensitive judgments about whether a specific provider is "about to shut down" aren't suitable for a wiki (they go stale quickly) — but the conclusion that "shutdowns are a structural norm rather than the exception" is corroborated fairly consistently across sources and can serve as durable background knowledge.

## The effect of tightening regulation on this industry

Publicly visible trends in recent years include: more frequent blocking of abnormal traffic at the carrier level, rising signals of enforcement at the individual-user level (see "Overview of Domestic Internet Regulation"), and rising compliance costs around leased-line resources and real-name requirements. Combined, these are broadly reflected in the market as:

- Rising survival pressure on small and informally-operated providers, with shutdown frequency showing no clear decline
- Some providers shifting toward marketing emphasizing "lines that don't pass through the GFW" or "compliance"-flavored language — users still need to independently judge the actual line and stability rather than taking the marketing copy at face value
- Price competition persists, but the combination of "low price + annual/lifetime plan" recurs repeatedly in shutdown statistics — this is the one relatively firm empirical pattern this article is willing to state
- The extremely-low-cost tier tends to respond to upstream-resource squeezes more directly: either doubling down on free/trial-tier resources to sustain the low price, or shutting down outright, with less of a middle ground

## Practical implications for individual users

This section echoes the concrete avoidance guidance already covered in [Red flags](./red-flags), and focuses here only on the structural framing:

- Treat an airport service as something that could disappear at any time, not as long-term infrastructure to depend on — this is also part of the real-world basis for NodeNanny's own positioning ("self-hosted node as primary, airport/traffic-pool as an emergency fallback only")
- The savings from an annual or lifetime plan need to be weighed against the probability that "this provider won't last until the plan is used up" — especially for extremely-low-cost plans
- Maintaining several independent sources does more for practical availability than debating "which provider scores highest in reviews" — but as noted above, using another extremely-low-cost provider as a "backup" doesn't necessarily reduce risk
- If you're recruited into a provider's referral/affiliate program (sharing a referral link for a commission), it's worth weighing this against the risk-tier distinction laid out in "Overview of Domestic Internet Regulation" between personal use and commercial operation/external distribution — referral promotion already carries some operational/distribution character, and its risk tier differs from purely personal use

## Reliability note for this content (self-check record)

Most of the information available when writing this article came from airport review/ranking sites, which typically carry their own promotional or affiliate incentives; specific rankings, scores, and "shutdown list" updates go stale quickly and are also hard to independently verify. This article therefore retains only the structural conclusions that recur consistently and without contradiction across multiple sources (cost structure, the prevalence of shutdowns, the general direction of tightening regulation, the free-tier-resource cost model and acquisition logic of extremely-low-cost providers), and deliberately avoids any specific provider names, specific prices, or time-sensitive, single-source "currently recommended" content.

This round's addition on "extremely-low-cost providers" cross-referenced two types of sources: review/blog-type sites (for descriptions of specific mechanisms — riding free cloud trials, overselling, the "leased-line" naming/actual-line mismatch), and non-promotional, everyday technical-community discussion threads (spontaneous user discussion about referral-commission payouts, backup-provider choices, and shutdown likelihood, rather than a "leaderboard" or "review" page). The latter, without an obvious self-promotional motive, provides somewhat more neutral corroboration for structural judgments like "low-cost providers shut down more often" and "referral commissions are one acquisition channel" — though it still doesn't amount to rigorous independent statistics, only a reasonably consistent empirical judgment corroborated across multiple sources. If more specific data is needed later, it's worth prioritizing non-promotional sources (such as long-running independent technical-community discussions) over continuing to rely on ranking sites.

## FAQ: Free/cheap airports are already fast enough — why bother self-hosting?

This is a fair question — if the free or cheap airport you're already using genuinely works well and hasn't given you trouble, what's the point of self-hosting a node? A few angles worth considering:

- **"Fast right now" doesn't mean "fast forever."** As covered in earlier sections, the business model behind extremely-low-cost providers is inherently unstable: upstream resources can get squeezed at any time, and shutdowns are a structural norm rather than an exception. A free or cheap airport working well today doesn't mean it'll still be working next week or next month — whereas a self-hosted node's reliability depends only on your own server and line, and won't suddenly vanish because of someone else's business decision.
- **Something that's fully free usually has costs hidden somewhere you can't see.** For a service that's completely free with no speed or bandwidth limits, where the money to run it comes from is often opaque — common ways it gets monetized include bundled ad injection or collecting usage data for other purposes, both already covered in the glossary's "one-tap-connect apps" entry. Self-hosting doesn't have this opacity — the server is yours, and there's no third party sitting in the middle watching your traffic.
- **Self-hosting isn't meant to fully replace airports — it's an additional option that doesn't depend on someone else.** These two aren't mutually exclusive: airports win on being ready to use out of the box, having many nodes, and offering a wide choice of regions; a self-hosted node wins on being fully under your own control and not being affected by someone else's business situation. The whole point of a tool like NodeNanny is to automate away the most tedious part of self-hosting (monitoring, auto-restart on disconnect, failure notifications), lowering the barrier to doing it yourself — not to claim self-hosting can replace every airport use case (if you want dozens of nodes across different regions to freely switch between, one self-hosted node obviously can't do that).

A reasonably practical setup: put your day-to-day primary use on a node you built and maintain yourself, and keep an airport or a free subscription around as an emergency backup — which is also the original idea behind NodeNanny's emergency traffic pool design.
