---
title: "Common issue: vmess+ws client keeps disconnecting"
summary: There's currently no ready-made one-click fix for this — manual investigation is needed, and we're being upfront about that
order: 7
updated: 2026-07-22
tags: [troubleshooting, vmess, known-limitation]
kbRef: vmess-ws-mux-mismatch
---

## Symptom

A client using the vmess+websocket protocol connects unstably and keeps dropping,
with logs showing "websocket: bad handshake" or vmess-related unexpected EOF errors.

## Cause

This kind of issue is usually **not the server process crashing** — it's typically a
mismatch between the client's and server's ws path / mux parameters, or a CDN /
reverse-proxy layer in between mishandling fragmented data in an incompatible way.

## Current approach (being upfront: there's no one-click fix yet)

This knowledge-base entry currently **has no directly executable fix command**. It
needs manual, item-by-item comparison of the client and server config files
(especially the ws path and mux-related parameters). This is a deliberately kept
"placeholder" entry in the knowledge base — it records the symptom and the direction
to investigate, but doesn't pretend there's a universal one-click fix. Once a
generally applicable fix is actually found, it'll be added here. If you hit this
issue, please post both configs for comparison rather than expecting a single
command to solve it.
