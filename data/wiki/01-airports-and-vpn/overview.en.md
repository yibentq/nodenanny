---
title: "Overview of Domestic Internet Regulation in China"
summary: An objective look at the GFW's technical evolution, the legal status of personal circumvention, and the different risk tiers between personal use and commercial operation — not legal advice
order: 0
updated: 2026-07-31
tags: [gfw, legal-risk, regulation, compliance]
---


> This article is a purely factual overview. It is not legal advice, and it does not encourage or discourage any specific action. Rules and enforcement practices change over time — treat official channels as authoritative and judge the risk for yourself.

## What the GFW actually is, and how it actually works

A lot of people picture the GFW (Great Firewall) as a simple blocklist — a list of banned domains or IPs that gets matched and blocked. The reality is far more layered: the GFW is a multi-tiered, continuously evolving traffic-analysis system, deploying several kinds of detection from the network layer up to the application layer, and these layers work together and cross-check each other. Understanding what each layer actually does, and where its limits are, is the foundation for understanding why some circumvention methods work well and others don't.

**Layer 1: DNS poisoning**
When your device looks up the IP address behind a domain name, if that lookup goes over plain, unencrypted DNS (the kind your carrier assigns by default), the GFW can intercept the exchange mid-flight and return a forged or wrong IP, so you end up resolving to an address that doesn't work. This is the oldest and most widely deployed layer — for an ordinary user running no special configuration at all, DNS poisoning is still the first line of blocking, and often the most effective one. Encrypted DNS (DoH/DoT), or simply letting DNS resolution happen on the proxy server's side instead of locally, both sidestep this layer.

**Layer 2: IP blocking**
The GFW maintains a continuously updated list of blocked IPs and IP ranges. Once your connection's destination matches an entry on that list, the connection gets dropped or reset outright. This layer targets "known" servers — switching to a fresh IP usually gets around it temporarily, but a popular node that stays in continuous use will eventually get discovered and added to the list.

**Layer 3: Deep packet inspection (DPI)**
DPI doesn't just look at IP and port — it analyzes the format characteristics of the packet contents themselves to recognize "protocol fingerprints." Older, unencrypted versions of Shadowsocks had very obvious handshake patterns, and the handshake formats of plain VMess, OpenVPN, and WireGuard are also relatively fixed and easy to recognize. What DPI identifies is "does this look like some known proxy protocol" — not the actual content being transmitted (the content itself is still encrypted and unreadable).

**Layer 4: TLS fingerprinting and SNI detection**
Normal HTTPS web browsing involves a plaintext handshake phase (Client Hello / Server Hello) before encryption actually kicks in, and that handshake includes the SNI (which domain you're connecting to) along with supported cipher suites and other details — all transmitted in the clear before the encrypted tunnel is established. The GFW can read this segment and know which domain you're connecting to, even though the data that follows is encrypted. This is also why some newer protocols (like Reality, which borrows a real certificate from a major provider during the handshake) are specifically designed so this step looks indistinguishable from a normal connection to Google or Cloudflare.

**Layer 5: Active probing**
When passive detection suspects that a given IP and port might be running a proxy service, the GFW will actively initiate connections to that server from multiple domestic IPs, mimicking a real client "knocking on the door," and use the server's response behavior (whether it responds, what it responds with, connection-level behavioral patterns) to determine whether it's actually a proxy server. This layer is proactive rather than passive, and much more targeted — it's been documented in earlier periods being used against Tor bridges, SoftEther, and similar tools.

**Layer 6: Traffic behavior analysis**
Even if every layer above gets bypassed, the macro-level pattern of a connection itself (packet-length distribution, timing intervals, connection duration, and other statistical characteristics) can still be fed into machine-learning-style anomaly detection, without the system needing to understand the specific protocol or content at all. This is the newest layer, and also the one publicly available material describes with the least detail.

These six layers aren't a "sequential upgrade" relationship where one replaces another — they exist and operate simultaneously, reinforcing each other. A single connection might get checked by DPI and active probing at the same time. **This is also why there's no such thing as a "solve it once and forever" technical fix**: any given proxy protocol is, by design, playing a game against a few specific layers of this system, and the system itself keeps getting updated too.

## What a "ladder" (proxy/VPN) actually does

Setting aside the details of any specific protocol, what every "ladder" tool does is fundamentally the same thing: establish an **encrypted tunnel** between your device and a server you trust.

Here's an analogy: normally, browsing the internet is like talking out loud in an open public square — anyone nearby can hear what you're saying and to whom. An encrypted tunnel is like sealing your conversation with someone far away inside a private channel that only the two of you can understand — outsiders (including your carrier, and the GFW) can see "there's a channel here, and it's transmitting data around this time," but can't make out what's actually being said inside it.

The general flow looks like this: your device encrypts and packages the request you want to make, sends it through the tunnel to the proxy server; the proxy server decrypts it and visits the actual target site on your behalf; the target site's response travels back the same way, gets encrypted by the proxy server, and is sent back to you, where your device decrypts it into content you can read. **The visitor IP the target site sees is the proxy server's IP, not your own.** This is the technical basis for both "hiding your real IP" and "getting around content restrictions" — the former because there's a layer of proxy sitting between you and the target site, the latter because your traffic is, physically, originating from wherever the proxy server happens to be located.

The differences between protocols (Shadowsocks, VMess, VLESS, Trojan, WireGuard, etc.) mainly come down to **how the tunnel gets established, and how encryption and disguise are handled differently** — which is what gives each of them a different level of resistance against the six detection layers above. That's why "which protocol to pick" gets argued over so much: it's fundamentally a choice about which strategy to use in the game against the detection system.

## Common misconceptions, clarified

Building on the mechanics above, here are a few frequently-asked, easily-misunderstood questions:

- **"If I use a ladder, will I definitely get precisely tracked?"** No. The encrypted tunnel itself keeps the GFW from directly reading what you're actually visiting; what typically gets detected is "does this connection's behavior pattern look like proxy traffic," not "what specifically did this person visit." That doesn't mean zero risk, though — see the legal-risk sections below.
- **"All proxy protocols are insecure, anyone can just sniff the traffic and read the content"** — also not accurate. This tends to mix up two separate questions: whether the protocol **can be recognized as "this is proxy traffic"**, and whether the content **can be decrypted and read**. These are two different layers of the problem. Mainstream modern protocols are reliable on the content-encryption front — what typically gets flagged is "the traffic pattern looks like proxy traffic," not "the content got cracked."
- **"As long as I avoid free/low-quality tools, using one is completely safe"** — any technical approach is playing a game against a continuously evolving detection system; something working today doesn't mean it'll keep working indefinitely, which is exactly why this article needs to be periodically revisited (see the note at the end).

## The legal status of personal VPN use for circumvention

This is a frequently asked question with no simple answer. Here's roughly the current publicly-available picture:

- **At the level of the written regulations**: only carriers licensed by the Ministry of Industry and Information Technology are legally allowed to provide VPN services; an individual setting up or using an unlicensed circumvention tool sits in a space the text doesn't explicitly permit.
- **At the level of actual enforcement**: "using" one, by itself, is rarely the sole basis for a penalty in publicly reported cases — the reported penalty cases usually involve this stacked with other conduct, such as publicly distributing or selling circumvention tools and accounts, using circumvention access to carry out other activity that's separately determined to be illegal, or accessing and spreading content that's separately determined to be illegal. That said, there genuinely are cases of individuals being investigated for "long-term circumvention use" on its own (for example, media-reported cases of state-enterprise employees disciplined over long-term circumvention use) — so this isn't a purely theoretical risk.
- **The November 2025 signal**: China's Ministry of State Security published an article through its official WeChat account, publicly warning that individuals illegally using "circumvention" software to access overseas sites carries legal and security risk. This is a relatively high-profile, official-channel statement specifically about personal circumvention use, and can reasonably be read as a signal that regulatory attention and enforcement tone are tightening.
- **Trend assessment**: multiple signals (including shifts in regulatory language and improvements in technical detection capability) point toward "the tolerated space is narrowing" rather than loosening — though actual enforcement in practice remains selective, not universal.

## Personal self-hosting/use vs. commercial operation — different risk tiers

This is a distinction that often gets blurred in existing material and is worth spelling out separately:

- **Using a self-hosted node yourself** for everyday personal access is, in current discussion and reporting, the relatively lowest-risk category of behavior.
- **Selling access externally, publicly sharing accounts/subscription links, or running groups that resell airport services** counts as a commercial operation, carries a noticeably higher risk tier, and is one of the more common triggers behind publicly reported penalty cases.
- **Loudly discussing circumvention details or broadly spreading related information around sensitive time windows** (major meetings, anniversaries, and similar) has historically been considered a behavior pattern that raises the odds of drawing attention.

NodeNanny's own positioning is "help one person look after their own single node" — it doesn't involve selling or distributing access to others, which by itself places it toward the lower-risk end of this spectrum. That said, the project's docs and wiki content still need to describe the broader environment objectively and accurately, rather than creating an impression of either "zero risk whatsoever" or "guaranteed trouble" — both of which would be misleading extremes.

## Behaviors that public information suggests carry relatively higher risk

Pulling the current picture together, the following categories of behavior show up repeatedly in publicly available information as things believed to raise the odds of drawing attention (this is purely a summary of the current landscape, not a recommendation or position from this project):

- Distributing circumvention tool downloads, subscription links, or tutorials through public channels (WeChat groups, Weibo, Douyin, etc.)
- Renting out, selling, or letting strangers share a self-hosted node
- Using circumvention access to carry out other activity that's separately determined to be illegal
- Conspicuous, related behavior during politically sensitive time windows

## This section needs ongoing review

Regulatory language, enforcement cases, and technical detection capabilities all keep changing — treat this article as a snapshot at a particular point in time, not something written once and never revisited. Things worth checking on the next review pass: whether there's been any new official statement, whether new, more specific types of penalty cases have appeared, and whether there's any newly publicly documented capability at the GFW's technical level.
