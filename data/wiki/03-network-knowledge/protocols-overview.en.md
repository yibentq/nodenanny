---
title: "Common proxy protocols explained: vmess / vless / trojan / shadowsocks / hysteria2"
summary: What these terms actually mean and how they differ — after this page you should be able to follow the community's protocol discussions
order: 0
updated: 2026-07-22
tags: [protocols, primer, vmess, vless, trojan, shadowsocks, hysteria2]
---

## First, get one thing straight: a protocol is a "transport method," not "which provider"

A lot of newcomers mix up "protocol" and "provider." A protocol is the set of rules
for how the client and server package, encrypt, and transmit data between each other —
it has nothing to do with which provider you use. The same provider often offers
several different protocols at once, and the same is true if you self-host with
NodeNanny.

## Five common protocols, explained

### Shadowsocks (SS)
The oldest and simplest of the bunch — essentially an encrypted SOCKS5 proxy.
Advantages: simple implementation, mature clients on every platform, low overhead.
Downside: its traffic pattern is relatively easy to fingerprint, so plain SS is less
often used on its own these days — the common approach is pairing it with an
obfuscation plugin, or switching to a newer protocol entirely.

### VMess
The protocol native to the V2Ray project, using AEAD encryption (e.g. AES-128-GCM),
with every packet carrying authentication info to guard against replay attacks.
Compared to SS it adds a layer of identity verification and anti-analysis design, but
because the handshake carries more information, its overhead is slightly higher than
SS and VLESS.

### VLESS
Think of it as a "lightweight VMess": it doesn't do additional encryption on its own
(it relies on an outer TLS layer for that), cutting some of VMess's verification
overhead. Paired with TLS 1.3 and obfuscation techniques like "Reality," it's currently
one of the more popular combinations, especially for scenarios that prioritize better
stealth and lower latency.

### Trojan
A very direct design: it disguises itself as an ordinary HTTPS website. There's no
extra custom handshake fingerprint — from the outside, the traffic looks just like a
normal visit to some website. This gives it strong censorship resistance and a
relatively simple configuration.

### Hysteria2
The newest of these protocols, built on QUIC (which runs over UDP), specifically
optimized for "poor network quality, high packet loss" scenarios (like mobile
networks), paired with a custom congestion-control algorithm. In high-latency,
high-loss environments it often runs faster and more stably than traditional
TCP-based protocols. The downside is that it runs over UDP, and some network
environments restrict or block UDP traffic.

## How to choose (general guidance, not tied to any specific provider)

- **Just want stability and ease of use**: Shadowsocks / VMess are plenty, with the
  most mature client support
- **Care more about censorship resistance / stealth**: VLESS + Reality or Trojan are
  generally recognized as the stronger options right now
- **Poor network environment (weak 4G, satellite, etc.)**: QUIC-based protocols like
  Hysteria2 tend to perform better, as long as your network doesn't heavily restrict
  UDP

## How this relates to NodeNanny

NodeNanny's backup node pool can parse subscription links for all of these protocol
types (including the differences in how each embeds base64/JSON data). The three-layer
filtering (liveness/speed/authenticity) treats every protocol the same way — it
doesn't favor or penalize any protocol type. If a particular protocol's nodes
consistently have a low pass rate for you, that's usually the protocol itself not
playing well with your network environment, rather than a problem with NodeNanny's
detection logic.
