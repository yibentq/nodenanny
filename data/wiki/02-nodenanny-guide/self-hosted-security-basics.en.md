---
title: Security & Privacy Basics for a Self-Hosted Node
summary: General-knowledge basics for non-technical users buying their own VPS to self-host a node — how to pick a server, and six basic SSH hardening steps
order: 8
updated: 2026-07-28
tags: [vps, ssh, security, self-hosted]
---


> This article is written for non-technical-background users who "bought a VPS to self-host a node." It covers two areas: how to choose a server, and basic SSH hardening. These are relatively mature, stable pieces of general operations knowledge — nothing specific to NodeNanny — but worth organizing separately for anyone managing a server on their own.

## VPS-selection considerations

- **How strict the provider's/data-center's risk-control tolerance is**: different providers vary widely in how much tolerance they have for "what this machine is doing." Some data centers/ASN ranges are more heavily abused than others, making their exit IPs more likely to be specifically throttled or blacklisted — when choosing, it's worth paying attention to the provider's IP-range reputation, not just price and spec sheet.
- **Geographic location and latency**: a data center physically closer to you generally means lower round-trip latency, but the choice of location also needs to be weighed against "whether this route passes through a path more likely to be specifically targeted for detection" — there's no one-size-fits-all "optimal region."
- **Whether it's a "recycled IP"**: cheap VPS instances sometimes use IP ranges that were previously used by someone else and may already be flagged. After spinning up the machine, test the IP's connectivity and reputation history yourself first — it's easier than troubleshooting "why it didn't work from the start" after the fact.
- **Pay-as-you-go or monthly to start, avoid a large upfront annual payment**: this isn't just advice for the "airport" industry (see "Current State of the Domestic Airport Market") — it applies equally to buying a VPS directly from a provider, since the provider itself could also shut down, raise prices, or be affected by policy changes. Verify stability over a short billing cycle first before considering a longer-term plan.
- **Whether independent IPv4 is offered and whether the bandwidth billing method is clear**: these two points directly affect whether you'll be able to pin down the cause when troubleshooting network issues later — confirming them before purchase is more reliable than asking support after something goes wrong.

## Basic SSH hardening items

Self-hosting a node means you're your own sole system administrator, and the server is exposed to the public internet — basic SSH hardening is the bare minimum that should be done:

- **Switch to key-based login, disable password login**: after setting up SSH public-key authentication on the server, change `PasswordAuthentication` to `no` in `/etc/ssh/sshd_config`. This one setting blocks the vast majority of password brute-force attempts.
- **Disable direct root login**: set `PermitRootLogin` to `no`, and log in as a regular user before elevating with `sudo` instead. Even if one account's credentials leak, an attacker still doesn't get a direct path to the highest privilege level.
- **Change the default SSH port (optional, limited effect but reduces noise)**: changing port 22 to something else doesn't actually improve security (it means nothing against a targeted attacker), but it can substantially reduce the log noise from indiscriminate internet-wide scanning — whether to do this is a matter of personal preference.
- **Install a failed-login blocking tool like fail2ban**: automatically bans source IPs after multiple failed login attempts in a short window, adding an extra layer of protection against brute force at low configuration cost.
- **Keep the system and the SSH service itself updated**: regularly run the system's security updates to avoid being caught by mass scanning that exploits known vulnerabilities — the risk here isn't "someone targeting you specifically," it's "mass scanning of the entire internet for machines with this vulnerability." Updating is the lowest-cost protection available.
- **Restrict which accounts/IPs can log in**: if your own access IP is relatively fixed, you can allow only specific source addresses to reach the SSH port at the firewall level — a more practically effective restriction than port obfuscation (but be sure to keep an emergency access method in reserve, so you don't lock yourself out if your own IP changes).

## Where this content fits

Everything above is a baseline for general server security, recommended for any self-hosted server (not just one running a NodeNanny node). This kind of knowledge is comparatively stable and unlikely to go stale over time, though the specific hardening methods and tools (e.g. alternatives to fail2ban, a cloud provider's built-in security-group features) may see newer options emerge. This article deliberately keeps only the most basic, least-perishable items, and doesn't try to cover every possible hardening technique.
