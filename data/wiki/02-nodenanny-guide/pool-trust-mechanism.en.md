---
title: How the Node Pool Trust Mechanism Works
summary: How sources transition between the trial (observation), trusted, and blacklisted states — a guide to reading the traffic pool status labels in the panel
order: 10
updated: 2026-07-31
tags: [tutorial, traffic pool, trust mechanism]
---

## Why this mechanism is needed

Node sources in NodeNanny's emergency traffic pool come from different channels: some are added manually by you and verified over a long period (like WangCai), others are automatically discovered by the system from GitHub or Telegram channels and have never been quality-checked before. If all of them were treated the same regardless of quality, a poor-quality source that frequently fails to connect would end up claiming the same weight as a high-quality one, dragging down the reliability of the entire emergency pool. This trust mechanism exists to let "sources that perform well gradually earn more weight, and sources that perform poorly gradually get demoted or removed" — entirely automatically, with no need for you to manually judge whether each source is any good.

## The three states

A node source in the system is always in exactly one of the following three states (a manual source with `fixed: true` skips this entire process and isn't subject to the rules described here):

**trial (observation period)**
Every newly discovered source starts in this state. During this phase, its weight is capped between 0% and 5%, floating linearly based on its recent pass rate — the higher the pass rate, the closer the weight gets to 5%, but no matter how well it performs, a source in trial never gets more than 5% weight, to prevent an unverified source from claiming too large a share of traffic right out of the gate.

**trusted (fully trusted)**
If a source's pass rate stays at or above 70% for 7 consecutive checking rounds (roughly 42 hours) during trial, it gets promoted to trusted, at which point the 5% weight cap no longer applies.

**blacklisted**
A source gets blacklisted under either of two conditions:
- Its pass rate during trial stays persistently low, and it still hasn't met the bar by the end of the observable period
- Its pass rate is 0% for 4 consecutive checking rounds during trial (with checks actually having run, not simply having failed to check) — in this case it gets blacklisted immediately without waiting out the full 7 rounds

If a trusted source's pass rate drops below 70% for 7 consecutive rounds, it isn't blacklisted outright — it first gets demoted back to trial and goes through the observation process again.

## Can a blacklisted source recover?

Yes. Being blacklisted isn't permanent — if a source's pass rate reaches 70% or above for 2 consecutive checking rounds afterward, it automatically comes back from blacklisted to trial status, with its weight recalculated from there — no need to wait a fixed number of days, and no need to manually edit the config file. This is designed to handle situations where "a source was only temporarily broken and has since recovered" (for example, if the probe target site's address changed, briefly causing checks to fail).

## Manual sources vs. automatically discovered sources

There's one clear principle here: **only manually added sources with `fixed: true` set can skip this entire process** — automatically discovered sources (from GitHub scanning, Telegram channel fetching) must go through the full trial → trusted flow no matter how good they look, and are never automatically trusted. This is intentional: content from machine-discovered sources hasn't been vetted by a human, so it shouldn't be pre-trusted — only a source a person has personally selected and confirmed is eligible to skip the evaluation process.

## How this relates to your day-to-day use

You don't need to manually intervene in this state machine day to day — it runs fully automatically. The main scenario where you need to know about this mechanism is: if you see a node source's status in the panel suddenly change from trusted to trial, or to blacklisted, there's no need to panic — that's the system working as intended (it means this source has been performing unstably lately), not NodeNanny malfunctioning. If a manual source you added yourself is observed to have unstable quality, you can also use this mechanism's criteria as a reference for deciding whether to keep it.
