---
title: 常见故障：磁盘空间已满
summary: 报错里能看到 No space left on device / ENOSPC
order: 6
updated: 2026-07-22
tags: [故障排查, 磁盘]
kbRef: disk-full-log-write-fail
---

## 现象

服务异常，日志或系统报错提到磁盘空间不足。

## 原因

通常是日志文件一直在增长，没有配置轮转清理（logrotate），日积月累把磁盘占满。

## 怎么处理

```bash
journalctl --vacuum-time=3d
```

这条命令只保留最近3天的系统日志，是"低风险"操作，可以一键执行，能立刻腾出空间。
但这只是治标：长期建议给日志配上 logrotate，而不是每次满了再手动清一次。
