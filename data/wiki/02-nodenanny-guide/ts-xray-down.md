---
title: 常见故障：代理服务进程退出
summary: 面板显示"离线"，日志里能看到 Failed to start / xray.service failed 之类字样
order: 3
updated: 2026-07-22
tags: [故障排查, 服务进程]
kbRef: xray-service-down
---

## 现象

面板首页的"自建节点状态"变成离线，或者收到了重启通知邮件。

## 原因

代理服务进程（xray/sing-box）本身退出了。常见原因三选一：配置文件写错了、
端口被其它程序占用、或者服务反复崩溃次数太多，systemd 判定失败已经不再自动拉起。

## 怎么处理

先重启一次服务：

```bash
systemctl restart xray
```

这是"低风险"操作，NodeNanny 面板在线终端里可以一键执行。如果重启之后过一会儿又
挂了，说明不是偶发问题，需要看具体报错（`journalctl -u xray -n 50` 看最近50行日志），
再判断是配置错误还是端口冲突。
