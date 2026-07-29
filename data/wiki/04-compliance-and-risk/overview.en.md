---
title: Overview of Domestic Internet Regulation in China
summary: An objective overview of the GFW's technical evolution, the legal status of personal VPN use, and the risk-tier difference between personal use and commercial operation — not legal advice
order: 0
updated: 2026-07-28
tags: [gfw, legal-risk, regulation, compliance]
---


> This article is a purely descriptive overview of the current situation. It is not legal advice, and it neither encourages nor discourages any specific action. Rules and enforcement practices change over time — treat this as a snapshot, verify against official channels, and make your own risk judgment.

## What the GFW is, and the stages it has gone through

The "Great Firewall" (GFW) is not a static, unchanging system. It has broadly gone through several stages:

- **Early stage (IP/domain blocklist)**: directly blocking known overseas server IPs or domains. Circumvention was simple (switch IP, switch domain).
- **Middle stage (Deep Packet Inspection / DPI)**: analysis of traffic content characteristics began, identifying the "fingerprints" of common proxy protocols (e.g. the distinctive handshake signature of older Shadowsocks versions). This drove the emergence of protocols like v2ray/Trojan that disguise themselves as normal HTTPS traffic.
- **Current stage (machine learning + active probing)**: no longer looking only at the content of individual packets, but making judgments based on the combined statistical characteristics of traffic — timing intervals, packet-length distribution, connection behavior — and actively probing suspicious targets (connecting as if a client, to see how the server responds). This is also why detection difficulty for "fully encrypted traffic" (such as VMess/Shadowsocks) has reportedly been rising in recent years, while TLS-disguise protocols (Reality, AnyTLS, etc.) are comparatively more resistant to detection.

This evolution is ongoing — there is no state of being "solved once and for all." The specific details in this article may become outdated over time and need periodic review.

## The legal status of personal VPN use for circumventing the firewall

This is a frequently asked question without a simple answer. The publicly known situation is roughly as follows:

- **At the level of the regulatory text**: only telecom operators licensed by the Ministry of Industry and Information Technology (MIIT) are legally permitted to provide VPN services. Individuals setting up or using unlicensed circumvention tools on their own sit, at the text level, in a status that has not been explicitly authorized.
- **At the level of actual enforcement**: "use" alone is rarely, by itself, the sole basis for punishment. Publicly reported enforcement cases are usually combined with other conduct — for example, publicly distributing/selling circumvention tools and accounts, using circumvention to engage in other activity deemed illegal, or accessing and spreading content deemed illegal. There are also cases of individuals being investigated for "long-term circumvention" (for example, media reports of a state-owned enterprise employee being investigated over this) — showing this is not a purely theoretical risk.
- **The November 2025 signal**: the Ministry of State Security published an article via its official WeChat public account publicly warning that individuals using "circumvention" software to access overseas websites carries legal and security risks. This represents a relatively high-profile, official-channel statement specifically about individual circumvention behavior, and can be read as a signal that regulatory attention and tone are tightening.
- **Trend judgment**: multiple sources of information (including shifts in regulatory language and improvements in detection capability) point toward a narrowing of tolerance, not a relaxation — though enforcement in practice remains selective and non-universal.

## Personal/self-hosted use vs. commercial operation — risk levels differ

This point is frequently conflated in existing material and is worth spelling out separately:

- **An individual using a self-hosted node** for everyday personal access is, in current discussion and reporting, among the relatively lowest-risk categories of behavior.
- **Selling to others, publicly sharing accounts/subscription links, forming groups to resell "airport" (proxy reseller) services** constitutes a commercial activity, with a clearly higher risk tier — and is also a more common trigger in publicly reported enforcement cases.
- **Prominently discussing circumvention details or widely disseminating related information around sensitive time windows** (major meetings, anniversaries) is also, historically, considered a behavior pattern that raises the likelihood of attracting attention.

NodeNanny's own positioning is "helping one person look after their one node" — it does not involve external sales or distribution. This positioning itself sits at the lower-risk end, but the project's documentation and wiki content still need to describe the broader environment objectively and accurately, rather than cultivating either extreme impression of "completely risk-free" or "certain to cause trouble."

## Which behaviors are considered relatively higher-risk in public information

Synthesizing the current landscape, the following behaviors recur repeatedly in public information as ones considered to raise the probability of attracting attention (this is purely a summary of the current landscape, not a recommendation or position from this project):

- Distributing circumvention tool download methods, subscription links, or tutorials via public channels (WeChat groups, Weibo, Douyin, etc.)
- Renting, selling, or allowing strangers to share a self-hosted node
- Using circumvention access to engage in other activity deemed illegal
- High-profile related behavior during politically sensitive time windows

## This content needs ongoing review

Regulatory tone, enforcement cases, and technical detection capability are all in flux. Treat this article as a snapshot at a point in time, not a one-time write-up that never needs updating. When next reviewed, worth focusing on: whether there is a new official statement, whether new, more specific types of enforcement cases have appeared, and whether there has been any publicly reported new capability at the GFW's technical level.
