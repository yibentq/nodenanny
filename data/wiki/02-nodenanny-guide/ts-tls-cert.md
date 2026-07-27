---
title: 常见故障：TLS证书即将过期或已过期
summary: 客户端连不上，报错里能看到 certificate expired 之类字样
order: 4
updated: 2026-07-22
tags: [故障排查, 证书]
kbRef: tls-cert-expiring-soon
---

## 现象

客户端连接失败，报错信息提到证书校验失败、证书过期。

## 原因

TLS证书快到期或已经过期了。如果用 acme.sh 做自动续期，问题往往出在"证书续期成功了，
但服务没有重新加载新证书"这一步没做对，而不是续期本身失败。

## 怎么处理

```bash
acme.sh --renew -d your-domain.com --force
systemctl restart xray
```

把 `your-domain.com` 换成你实际的域名。这是"中风险"操作，终端里会预填进输入框，
需要你自己确认后按回车，不会自动执行——因为强制续期加重启服务这个组合会有短暂
的服务中断，值得手动确认一下时机。
