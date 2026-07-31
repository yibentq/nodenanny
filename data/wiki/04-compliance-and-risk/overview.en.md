---
title: Overview of Domestic Internet Regulation in China
summary: An objective overview of how the GFW actually works, the legal status of personal VPN use, and the risk-tier difference between personal use and commercial operation — not legal advice
order: 0
updated: 2026-07-31
tags: [gfw, legal-risk, regulation, compliance]
---

> This article is purely informational. It is not legal advice, and it does not encourage or discourage any specific action. Rules and enforcement practices change — refer to official sources and assess your own risk.

## What the GFW is, and how it actually works

Many people picture the GFW (Great Firewall) as a simple blocklist — a list of banned domains or IPs that gets checked against every connection. The reality is far more complex: the GFW is a multi-layered, continuously evolving traffic-analysis system that combines several detection methods spanning the network layer up to the application layer, with these layers working together and cross-checking each other. Understanding what each layer actually does, and where its limits are, is the foundation for understanding why some circumvention methods work well and others don't.

**Layer 1: DNS poisoning**
When your device looks up the IP address for a domain, and that lookup goes over plain, unencrypted DNS (the kind your ISP assigns by default), the GFW can intercept the exchange mid-flight and return a forged or incorrect IP, leaving you with an address that simply doesn't work. This is the oldest and most widely deployed layer — for an ordinary user with no special DNS setup, DNS poisoning remains the first, and often the most effective, line of blocking. Encrypted DNS (DoH/DoT), or simply offloading DNS resolution to the proxy server instead of resolving locally, gets around this layer.

**Layer 2: IP blocking**
The GFW maintains a continuously updated list of blocked IPs and IP ranges. Once your connection's destination matches an entry on that list, the connection is reset or dropped outright. This layer targets "known" servers — switching to a new IP usually solves the problem temporarily, but a popular node that stays in continuous use will eventually be discovered and added to the list.

**Layer 3: Deep packet inspection (DPI)**
DPI looks beyond IP and port and analyzes the format characteristics of the packet content itself, recognizing protocol "fingerprints." For example, older, unencrypted versions of Shadowsocks had very distinctive handshake signatures, and "bare" VMess, OpenVPN, and WireGuard handshakes are also relatively fixed in format and easy to recognize. What DPI identifies is whether traffic "looks like" a known proxy protocol — not the actual transmitted content, which remains encrypted and unreadable.

**Layer 4: TLS fingerprinting and SNI detection**
When browsing an HTTPS site normally, before encryption actually begins there's a plaintext handshake stage (Client Hello / Server Hello) that includes the SNI (which domain you're connecting to), supported cipher suites, and other information — all transmitted in the clear before the encrypted tunnel is established. The GFW can read this segment and learn which domain you're connecting to, even though the subsequent data is encrypted. This is exactly why some newer protocols (Reality, for instance, which "borrows" a major provider's real certificate during the handshake) are specifically designed to make this stage indistinguishable from an ordinary connection to Google or Cloudflare.

**Layer 5: Active probing**
When passive detection raises suspicion that a given IP and port is running a proxy service, the GFW actively initiates connections to that server from multiple domestic IPs, mimicking a real client "knocking on the door," and then judges after the fact — based on how the server responds (whether it responds at all, what it responds with, connection behavior) — whether this is really a proxy server. This layer is active rather than passive, and far more targeted — historically it has been used against Tor bridges and SoftEther, among others.

**Layer 6: Traffic behavior analysis**
Even if every prior layer is evaded, the macroscopic pattern of the connection itself — packet-length distribution, timing intervals, connection duration, and other statistical characteristics — can still be flagged as anomalous by machine-learning methods, with no need to understand the specific protocol or content. This is the newest layer, and also the one with the least detail available in public sources.

These six layers aren't a sequence that replaces one another — they exist and operate simultaneously, reinforcing each other. The same connection can be checked by DPI and active probing at once. **This is exactly why there's no such thing as a one-and-done technical fix**: any given proxy protocol is only designed to withstand a few specific layers of this system, and the system itself keeps getting updated.

## What a "ladder" (proxy/VPN) actually does

Setting aside the details of any specific protocol, every "ladder" tool works on the same core principle: it establishes an **encrypted tunnel** between your device and a server you trust.

An analogy: ordinary internet browsing is like talking out loud in a public square — anyone nearby can hear what you're saying and to whom. An encrypted tunnel is like opening a private channel with someone far away that only the two of you understand: outsiders (including your ISP and the GFW) can see "there's a channel here, and data is moving through it around this time," but can't make out what's actually being transmitted.

Roughly, the flow works like this: your device encrypts and packages the request you want to send, and passes it through the tunnel to the proxy server; the proxy server decrypts the request and reaches the actual target site on your behalf; the target site's response travels back the same way, gets encrypted by the proxy server, and is sent back to you, where your device decrypts it into readable form. **The visitor IP the target site sees is the proxy server's IP, not your own.** This is the technical basis for both "hiding your real IP" and "getting around regional restrictions" — the former because a layer of proxy sits between you and the target site, the latter because your traffic physically originates from wherever the proxy server is located.

The differences between protocols (Shadowsocks, VMess, VLESS, Trojan, WireGuard, and others) mostly come down to **exactly how the tunnel is established and how encryption and disguise differ** — and that, in turn, determines how resistant each one is to the six detection layers described above. This is why "which protocol to pick" gets discussed so often — at its core, it's choosing a strategy for the ongoing contest with the detection system.

## Clearing up common misconceptions

Building on the mechanisms above, here are a few frequently asked and easily misunderstood questions:

- **"If I use a ladder, will I definitely get tracked down to the last detail?"** No. The encrypted tunnel itself doesn't let the GFW directly read what you're actually visiting; what typically gets detected is "whether this connection's behavior pattern looks like proxy traffic," not "exactly what this person visited." That said, this doesn't mean zero risk — see the legal-risk section below.
- **"All proxy protocols are insecure — the content can easily be intercepted and read."** Also inaccurate. It's easy to conflate two different questions here: whether the protocol can be recognized as "proxy traffic," and whether the content can be decrypted and read — these are two separate problems. In terms of content encryption, mainstream modern protocols are solid — what usually gets flagged is "the traffic pattern looks like a proxy," not "the content got cracked."
- **"As long as I avoid free/low-quality tools, using this is completely safe."** Any technical method is in an ongoing contest with a continuously evolving detection system; something working today doesn't mean it will keep working indefinitely — which is exactly why this article needs periodic review (see the closing note).

## The legal status of personal VPN use for circumvention

This is a frequently asked question without a simple answer. Here's roughly the current publicly available picture:

- **At the level of written regulations**: only operators licensed by the Ministry of Industry and Information Technology (MIIT) may lawfully provide VPN services; an individual who independently sets up or uses an unlicensed circumvention tool sits in a position the letter of the law does not explicitly permit.
- **At the level of actual enforcement**: "use" by itself is rarely the sole basis for punishment — in publicly reported cases, punishment is typically accompanied by other conduct, such as publicly distributing or selling circumvention tools and accounts, using circumvention to carry out other activity deemed illegal, or accessing and spreading content deemed illegal. That said, there genuinely are cases where individuals were held accountable purely for "long-term personal use of circumvention" itself (for example, media-reported cases of state-enterprise employees disciplined for long-term circumvention use) — showing the risk isn't purely theoretical.
- **The November 2025 signal**: China's Ministry of State Security published an article via its official WeChat account publicly warning that illegally using circumvention software to access overseas sites carries legal and security risks. This is a relatively rare official statement specifically about personal circumvention use, and can be read as a signal of tightening regulatory attention and tone.
- **Trend assessment**: a number of signals (including shifts in regulatory language and improved technical detection capability) point toward "the acceptable space narrowing" rather than expanding — though in practice, actual enforcement remains selective rather than universal.

## Personal self-hosted use vs. commercial operation — different risk tiers

This point is often conflated in existing material, so it's worth addressing separately:

- **Personal use** of a self-hosted node for everyday personal access is — based on current discussion and public reporting — a relatively low-risk category of behavior.
- **Selling access to third parties, publicly sharing accounts/subscription links, or running groups to resell "airport" services** — this already constitutes commercial operation, a noticeably higher risk tier, and one of the most common triggers among publicly known punishment cases.
- **Openly discussing circumvention details or mass-distributing related information during sensitive time windows** (major meetings, anniversaries, and similar) has historically been regarded as a behavior pattern more likely to draw attention.

The NodeNanny project's own positioning — "help one person keep an eye on their one node" — doesn't involve selling or distributing access to third parties, which by itself places the project toward the lower-risk end of this spectrum. That said, the project's documentation and wiki content should still describe the overall picture objectively and honestly, rather than giving the impression of either "zero risk" or "guaranteed trouble" — both extremes would be misleading.

## Behavior that publicly available information considers relatively higher-risk

Summarizing the current picture, the following categories of behavior repeatedly show up in publicly available information as raising the likelihood of drawing attention (this is purely a summary of the current situation, not a recommendation or position from this project):

- Distributing download methods, subscription links, or usage tutorials for circumvention tools through public channels (WeChat groups, Weibo, Douyin, etc.)
- Renting out or selling a self-hosted node, or sharing it with strangers
- Using circumvention to carry out other activity deemed illegal
- Openly engaging in related behavior during politically sensitive time windows

## This section requires ongoing review

Regulatory statements, enforcement cases, and technical detection capabilities all keep changing; treat this article as a snapshot at a point in time, not a text written once and never updated. On the next review, watch for whether new official statements have appeared, whether new and more specific types of punishment cases have emerged, and whether new, publicly documented GFW capabilities have surfaced at the technical level.
