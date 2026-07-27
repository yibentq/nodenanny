---
title: "Glossary: the jargon that trips up newcomers"
summary: Airport, node, rate multiplier, relay, landing, leased line, residential IP... after this page you should be able to follow along in the community chats
order: 1
updated: 2026-07-23
tags: [glossary, primer, beginner]
---

## Basic terms

**Airport**
Community slang for a "proxy service provider" — they sell access to a batch of
server nodes, usually billed monthly or by data usage. Nothing to do with actual
airports; it's just a term that stuck.

**Node**
A server that relays your traffic for you, usually labeled by region (e.g. "HK-01",
"US-02"). A single provider usually offers several — sometimes dozens or hundreds — of
nodes at once.

**Subscription link**
A URL that encodes "which nodes this account can use." Clients (Clash, Shadowrocket,
etc.) import this link and automatically pull the node list, so you don't have to add
nodes one by one. The link usually contains an identifying token that's effectively
equivalent to a password — don't forward it carelessly.

**Rate multiplier**
Not a speed measurement — it's a **data-usage multiplier**. If you have a 100GB plan
and stream 10GB of video through a node with a 3x multiplier, it actually deducts 30GB.
Higher-multiplier nodes usually run on more expensive lines (e.g. leased lines);
providers use the multiplier to balance the real cost differences between lines.

## Line types

**Direct**
Your device connects straight to the provider's overseas server; traffic goes over the
public internet the whole way out. Simplest and usually cheapest setup, but the
experience during peak hours is entirely at the mercy of whatever the carrier's network
conditions happen to be.

**Relay**
Traffic first hits a domestic server run by the provider, which encrypts and forwards
it to an overseas "landing" server, which then reaches the target site. A relay server
can be optimized for routing and generally handles censorship better than a direct
connection — this is the most common mainstream approach today.

**Landing**
The overseas server at the end of a relay chain that's actually responsible for
reaching the outside internet. A single relay entry point may sit in front of multiple
landing nodes in different regions.

**Leased line (IPLC / IEPL)**
IPLC (International Private Leased Circuit) and IEPL (International Ethernet Private
Line) are both "dedicated channels" provided by carriers — traffic doesn't go through
the public internet's international exit, so in theory it isn't affected by exit-point
censorship or throttling. The two differ technically, but the difference is barely
noticeable to an ordinary user; "leased line" is a fine catch-all term. The defining
trait of a leased line is that it's expensive — real leased-line bandwidth costs a lot,
so if a plan is priced well below what mainstream leased-line providers charge, it's
probably not what it claims to be.

**CN2 / CN2 GIA / BGP**
Another set of terms related to domestic carrier route optimization, usually used to
describe "what kind of line the domestic-to-landing segment runs on." No need to
memorize the details — think of it loosely as "different tiers of line products offered
by carriers." The practical difference for everyday use (streaming, browsing) is much
smaller than marketing copy tends to imply.

## IP-related

**Residential IP**
An IP address assigned to an ordinary home broadband subscriber; some lookup tools
label it "Residential." Certain platforms (some streaming services, some
strictly-policed sites) restrict datacenter IPs more aggressively, so residential IPs
are less likely to get blocked — which is why providers often advertise them as a
selling point.

**Datacenter IP (DCH)**
An IP from a data center / server farm — this is the actual identity of the vast
majority of provider nodes.

**Why "residential" claims deserve skepticism**
Genuine overseas residential broadband comes with strict restrictions on who it's
assigned to and what it's used for, so bulk-"wholesaling" it to providers is nearly
impossible. A lot of advertised "US residential" or "Japan residential" IPs turn out,
on closer inspection, not to be real residential addresses at all. You can get a rough
read using the "Usage Type" field on lookup tools like ip2location (ip2location.com),
but no single tool's result is authoritative — cross-checking and actually trying the
node yourself matters more than fixating on one score.

## Client & configuration terms

**Rule mode**
Traffic is automatically routed according to rules in the config: domestic sites go
direct, foreign sites go through the proxy, no manual switching needed. This is the
recommended default for everyday use.

**Global mode**
All traffic — including domestic sites — goes through the proxy. Generally not
recommended to leave on long-term; see [Red flags](./red-flags) for why.

**TUN mode / system proxy**
Two ways to let the proxy "take over" your device's traffic. System proxy only covers
software that respects the system's proxy settings (most browsers, some apps); TUN mode
creates a virtual network adapter with much broader coverage, including games and
command-line tools that don't follow the system proxy setting.

**DNS leak**
Even if your actual traffic goes through an encrypted proxy, if the domain-name
resolution (DNS lookup) step doesn't go through the same tunnel, your carrier can still
tell which sites you visited — the content is encrypted, but the "destination" leaks
through. A well-built subscription config usually already handles this layer, so you
shouldn't need to worry about it separately.

## What this has to do with NodeNanny

Most of the terms above are concepts underneath the "airport" business model.
NodeNanny itself **is not an airport** — it doesn't buy or sell nodes. The protocol
your own self-hosted node uses (see [Protocol primer](../03-network-knowledge/protocols-overview))
and the line types described here are the same underlying technology; understanding
these concepts helps you judge what kind of line your own node is running on and what
behavior to expect, and it also helps you gauge roughly what quality to expect from the
backup nodes in NodeNanny's emergency pool (pulled from public sources and any
subscription you add yourself) when you actually need them.
