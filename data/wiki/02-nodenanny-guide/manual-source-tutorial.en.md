---
title: How to Manually Add a Node Source
summary: Following the existing WangCai example, step by step, to add a GitHub subscription or Telegram channel to your emergency traffic pool
order: 9
updated: 2026-07-31
tags: [tutorial, traffic pool, configuration]
---

## What this tutorial covers

NodeNanny's emergency traffic pool automatically discovers some backup node sources from public channels by default, but you can also manually specify a node source you trust yourself — for example, a GitHub subscription repo you've relied on for a long time, or a subscription link shared in a Telegram channel. A manually added node source is marked "fixed trusted" by default — it doesn't need to work its way up from trial (observation period) to trusted (fully trusted) before it can be used at full weight, the way an automatically discovered source does.

## Where the configuration lives

Open `config/config.json` (not `config.example.json` — that's just the template) and find the `manualSources` array. There's already one example entry in it:

```json
{
  "id": "wangcai",
  "name": "WangCai",
  "url": "https://shz.al/~WangCai",
  "fixed": true
}
```

What the four fields mean:
- `id`: a unique identifier for this node source — just pick a short English/pinyin name of your own, as long as it doesn't collide with an existing one
- `name`: the display name shown in the panel — Chinese is fine
- `url`: the subscription link's URL
- `fixed`: set to `true` to give this source "fixed trusted" treatment right away, skipping the trust-evaluation process entirely. You can also leave this field out (the default is to go through the normal trust-evaluation flow, the same as an automatically discovered source) — which one you pick depends on how much you personally trust this source.

## Steps to add a new source

1. Find the subscription link you want to add (the raw link to a GitHub repo, or a subscription address someone shared with you)
2. In the `manualSources` array, add a new entry following the format of the `wangcai` one, for example:

```json
{
  "id": "my-source-1",
  "name": "My Own Backup Subscription",
  "url": "paste the subscription link here",
  "fixed": true
}
```

Remember to add a comma after the previous entry — JSON format is picky about commas and brackets, so after editing it's worth pasting the whole thing into an online JSON validator to sanity-check the format, so a missing comma doesn't break the whole config file from loading.

3. Save the file
4. Restart the `nodenanny-pool` PM2 process so the new configuration takes effect:

```
pm2 restart nodenanny-pool
```

5. Check the traffic pool status in the panel to confirm the newly added source has appeared and is successfully pulling in nodes

## About Telegram channel sources

If you want to add a Telegram channel, only the form where "the subscription link is posted directly as text in the channel message" (`message_text_link`) currently works. The form where "the link is posted as a file attachment" isn't usable right now (Telegram's public preview page doesn't expose a real download URL for a file attachment — only a redirect link, which isn't technically usable for this purpose). So when adding a Telegram channel source, first confirm the channel shares its subscription as plain link text rather than as a file.

## On whether to set `fixed: true`

`fixed: true` means this source skips trust evaluation and gets full weight right away — appropriate for a source you've already verified over a long period and genuinely trust (like a repo you maintain yourself). For a source you've just discovered and aren't yet sure about the quality of, it's better to leave out the `fixed` field, letting it go through the same observation-period evaluation as an automatically discovered source — that way, even if the source turns out to be unstable, it won't claim a high weight right out of the gate. For details on how the trust mechanism actually works, see [How the Node Pool Trust Mechanism Works](./pool-trust-mechanism).
