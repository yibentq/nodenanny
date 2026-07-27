---
title: 常见故障：本地测试失败但服务进程是活着的
summary: 疑似防火墙规则挡住了端口，报错里能看到 connection refused / iptables DROP
order: 5
updated: 2026-07-22
tags: [故障排查, 防火墙]
kbRef: iptables-blocking-port
---

## 现象

服务进程本身状态正常（`pm2 status` / `systemctl status xray` 都显示在跑），但本地
连接测试失败，报 connection refused。

## 原因

大概率是 iptables 防火墙规则发生了变化，把代理端口挡住了——可能是你自己之前配置
过规则，也可能是其它安装脚本顺手改了防火墙。

## 怎么处理，务必先看这段再执行

```bash
iptables -F
```

**这条命令会清空当前所有 iptables 规则，不只是挡住代理端口的那一条**，属于"高风险"
操作。NodeNanny 终端会强制要求二次确认（输入确认词）才会真正执行，即使知识库把
它标成别的风险级别也一样——这是系统兜底的安全设计，不是可以跳过的提示。执行前
务必确认清楚：你的防火墙上有没有其它必须保留的规则，尤其是 SSH 端口的访问限制，
如果 SSH 也被这条规则一起清空，可能导致你连服务器都连不上去。
