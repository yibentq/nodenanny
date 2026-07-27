---
title: "Common issue: disk is full"
summary: Errors mention No space left on device / ENOSPC
order: 6
updated: 2026-07-22
tags: [troubleshooting, disk]
kbRef: disk-full-log-write-fail
---

## Symptom

The service misbehaves, and logs or system errors mention insufficient disk space.

## Cause

Usually log files have been growing continuously without log rotation configured
(logrotate), gradually filling up the disk.

## What to do

```bash
journalctl --vacuum-time=3d
```

This command keeps only the last 3 days of system logs. It's a "low-risk" action that
can be run with one click and immediately frees up space. But this only treats the
symptom — the long-term recommendation is to set up logrotate for your logs, rather
than manually cleaning up every time the disk fills.
