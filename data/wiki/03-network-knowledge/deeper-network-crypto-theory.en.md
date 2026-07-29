---
title: "Deeper Network & Crypto Theory: TLS, AEAD, and Traffic Fingerprinting"
summary: A follow-on to protocols-overview.md explaining the "why" behind TLS handshakes, AEAD encryption, and DPI traffic fingerprinting — theory-heavy and comparatively slow to go stale
order: 2
updated: 2026-07-28
tags: [tls, encryption, dpi, theory]
---


> This article is a follow-on to protocols-overview.md, covering the "why": specifically how DPI actually identifies traffic, and where each protocol's censorship resistance comes from. The content leans theoretical and is comparatively stable background knowledge — its correctness doesn't go stale as quickly as a specific protocol list or detection-rate numbers would.

## Roughly what a TLS handshake is doing

Whether you're visiting an ordinary website or using a "TLS-disguise" proxy protocol like Reality/AnyTLS, the TLS handshake is solving the same problem: **how can a client and server who have never met agree on an encryption key that only the two of them know, over an insecure network, while also verifying each other's identity**. Simplified flow:

1. The client sends a ClientHello, including its list of supported cipher suites, a random number, and the domain it wants to reach (the SNI field — this step is in plaintext, and was also one of the key points the early GFW used to block by domain)
2. The server responds with a ServerHello, selects a cipher suite, presents a certificate to prove its identity, and also includes a random number
3. Based on these two random numbers plus a key-exchange algorithm (ECDHE is the current mainstream choice), both sides independently derive the same session key, without the key itself ever traveling over the network
4. All subsequent application data is encrypted with this session key

The core idea behind the Reality protocol is to "borrow" a real website's TLS certificate and handshake characteristics, so that when the GFW actively probes it, what it sees is indistinguishable from actually visiting that real website. AnyTLS instead wraps arbitrary proxy traffic inside a standard TLS record layer — the same category of "disguise," just with different implementation details.

## What AEAD encryption is actually protecting

Today's mainstream proxy protocols (VMess, Shadowsocks-2022, Trojan's data layer, etc.) all use AEAD (Authenticated Encryption with Associated Data) algorithms, commonly AES-GCM or ChaCha20-Poly1305. AEAD does two things at once:

- **Confidentiality**: once content is encrypted, it can't be read without the key
- **Integrity/authenticity**: every ciphertext segment carries an authentication tag, letting the receiver verify that this data "was genuinely produced by whoever holds the correct key, and hasn't been tampered with in transit" — if the GFW sends forged/tampered data during active probing, the AEAD check fails and the connection is simply dropped. This is also a natural obstacle that "active probing" as an attack technique inherently runs into.

This is also why some early protocols, lacking authentication (or with insufficiently rigorous authentication), were easy to identify via "active probing" — a prober sends malformed packets and observes the server's response pattern, which by itself reveals the protocol's fingerprint.

## Specifically how DPI "sees" that this is proxy traffic

Given that the traffic itself is already encrypted and its content can't be read directly, DPI mainly relies on statistical characteristics rather than content. Common dimensions of analysis include:

- **Packet-length distribution**: different protocols' handshake and control packets tend to have regular sizes; encryption doesn't fully mask this regularity unless the protocol itself does active length padding
- **Timing-interval characteristics**: the cadence of heartbeat/keep-alive packets — proxy software behaves differently from an ordinary browser
- **Entropy analysis**: genuinely random encrypted data has entropy close to the theoretical maximum; if a protocol's ciphertext shows a non-random, fixed pattern at certain byte positions (an early protocol design flaw), it can be picked up statistically
- **First-packet / early-packet fingerprint matching**: many protocols have a fixed structure in the first few packets of connection setup (even if the content is encrypted, the length and ordering pattern may stay constant)
- **Active probing**: when an IP is suspected of running a proxy service, connect to it directly and see how the server responds — if the response differs from a normal HTTPS website (e.g. handshake-failure behavior, reaction to malformed requests), it may get flagged

Understanding this layer explains the mechanism behind protocols-overview.md's conclusion of "why TLS-disguise protocols are more detection-resistant": the goal of protocols like Reality/AnyTLS is to make all of the above dimensions (packet length, handshake structure, response to active probing) look as close as possible to a real website — not just to encrypt the data. **Encryption solves "whether the content is readable"; fingerprint resistance solves "whether the behavior pattern looks suspicious" — these are two different layers of the problem, and a protocol doing encryption well doesn't automatically mean it resists fingerprinting.**

## Why this content is comparatively slow to go stale

The TLS handshake flow, AEAD's design goals, and the fact that DPI relies on statistical characteristics rather than content — these are comparatively stable foundational facts at the level of cryptography and network protocols, unlikely to go stale wholesale because of some single technical upgrade in the near term. What actually changes and needs periodic review are application-layer conclusions like "which specific protocol currently resists detection well or poorly" or "the GFW's specific detection-rate numbers" — for that content, refer to protocols-overview.md rather than this article.
