---
title: "Glossary: the jargon that trips up newcomers"
summary: Airport, node, rate multiplier, relay, landing, leased line, residential IP... after this page you should be able to follow along in the community chats
order: 1
updated: 2026-07-31
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

**What proxy client software actually is**
"Proxy software" (Clash, V2rayN, Shadowrocket, sing-box, etc.) is a program dedicated
to "talking to servers according to a protocol's rules." Think of it as a dedicated
interpreter-and-dispatcher: it knows how to speak Shadowsocks/VMess/VLESS/Trojan to a
server and establish an encrypted tunnel, and it also intercepts the network requests
coming from every other app on your phone or computer — sending the ones that should go
through the proxy into the tunnel, and letting everything else pass through directly.
You don't need to understand any protocol details yourself; the client handles all of
that behind the scenes.

**Why pasting a subscription link just works**
Node information (server address, port, encryption method, key, etc.) has a
standardized, industry-agreed-upon shorthand — things like `vmess://a-long-encoded-
string`, `ss://a-long-encoded-string`, `trojan://a-long-encoded-string`. These are
essentially all those parameters packed into a single line of text. When you open the
"subscription link" from a provider (or from your own node), what you get back is
usually a batch of links like these (base64-encoded, so they look like gibberish).
Client apps recognize this standard format, and once they read the subscription link
they automatically parse out the parameters, lay them out correctly, and generate a
complete working configuration — which is why all you have to do is "copy the link →
paste it into the app → tap connect," without ever manually typing in a server address
or port number.

It's also precisely because this format is standardized and interoperable across
vendors that so many different clients — Clash, V2rayN, Shadowrocket — can coexist: the
same `vmess://` link can, in principle, be recognized and imported by most of them; only
the interface and the extra features (routing rules, how many protocols are supported)
differ. This is also why a client sometimes "can't recognize" a given subscription —
usually because what you were given is a client-specific extended format (like Clash's
YAML config), not the universal single-node link format. It's not that the subscription
itself is broken.

**And then there's an even more "foolproof" case: open the app, tap once, and you're
connected**
This kind of app is common on Android in particular (especially APKs shared through
forums or cloud-drive links, not necessarily from an app store). Its defining trait is
that you never paste any subscription link and never see any server parameters at all —
you just open it, there's a "one-tap connect" button, and tapping it gets you online.
Compilations of domestic administrative-penalty cases around circumvention tools
repeatedly mention exactly this kind of "works out of the box" app (Lantern, Kuailian,
Kuaimiao, and similar names) as one of the common categories, which suggests this is far
from a niche phenomenon.

The mechanism here has nothing to do with pasting a subscription link. Behind this kind
of app is usually a batch of servers the developer runs and operates long-term; the
server address and account information are already baked into the app at install time
(sometimes packaged directly into the install file, sometimes the app quietly reaches
out to the developer's own dispatch server on launch to request an available node,
entirely behind the scenes, invisible to you) — which skips the step of "the user finds
their own node and imports a subscription" altogether.

This kind of app shows up more on Android mainly because Android allows installing an
APK directly, bypassing the app store ("sideloading"), with a much lower barrier than
iOS. Apple's App Store review is far stricter about tools like this, so most equivalent
apps never make it onto the store — which is why iOS users more commonly end up with the
"download a client + find your own subscription" pattern instead.

A few things worth paying attention to with this kind of app, backed by some solid data:

- A 2026 study presented at the NDSS Symposium (Network and Distributed System Security
  Symposium) used an automated framework to audit 281 free Android VPN/accelerator
  apps, covering a combined total of more than 2.4 billion installs. Findings included:
  5 apps had a "tunnel hijacking" vulnerability (node configuration files were
  downloaded without encryption, meaning an attacker on the same Wi-Fi could intercept
  and tamper with the file, silently redirecting your connection to a server the
  attacker controls while the app's interface still shows a normal "connected" status);
  24 apps leaked DNS requests (meaning even with traffic encrypted, your carrier can
  still see which sites you visited), affecting roughly 360 million installs; and
  246 of the 281 apps (over 87%) contacted advertising or tracking services, with some
  even transmitting the device's precise GPS location. The researchers specifically
  noted that a "Verified" badge on an app store is not evidence that an app has
  undergone a comprehensive security review.
- A service that's completely free with no data caps or speed limits has an operating
  cost that isn't obvious — common ways it gets monetized include inserting ads,
  collecting device information for targeted marketing, and, less commonly, bundling
  in other software during install.
- The November 2025 warning from China's Ministry of State Security (see [Overview of
  Domestic Internet Regulation in China](../04-compliance-and-risk/overview)) also
  noted that some circumvention software is controlled by overseas actors — or even
  directly developed and operated by overseas intelligence agencies — with malware
  covertly embedded. There have been cases of employees at classified-work units
  installing such software by mistake, leading to their devices being remotely
  controlled and materials being stolen. That's not scaremongering — it's a real case
  type from an official notice.
- Compared to a model where "you know who's running the server" — self-hosting your own
  node, or using a provider with a clear reputation and transparent origins — this kind
  of "black-box" app's trustworthiness rests entirely on the developer. The less
  transparent the information, the more caution is warranted in evaluating the source;
  a high download count or a polished interface alone shouldn't be taken as a sign of
  safety.

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
