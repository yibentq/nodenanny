---
title: 常见代理协议科普：vmess / vless / trojan / shadowsocks / hysteria2 / anytls
summary: 这几个词到底是什么意思、有什么区别，看完这页大概就能听懂圈子里的讨论
order: 0
updated: 2026-08-05
tags: [协议, 科普, vmess, vless, trojan, shadowsocks, hysteria2, anytls]
---

## 先搞清楚一件事：协议是"传输方式"，不是"哪家机场"

很多新手会把"协议"和"机场服务商"搞混。协议指的是客户端和服务器之间"怎么把数据
包装、加密、传过去"这套规则，跟你用哪家机场没关系——同一家机场往往可以同时提供
好几种协议的节点，你自己搭的 NodeNanny 也是同样的道理。

## 六个常见协议，各自是什么

### Shadowsocks（SS）
最早、最简单的一种，本质是一个加了密的 SOCKS5 代理。优点是实现简单、各平台客户端
成熟、开销小；缺点是流量特征相对容易被识别，纯 SS 现在较少单独使用，常见做法是
搭配混淆插件或者干脆换用更新的协议。

### VMess
V2Ray 项目自带的协议，用 AEAD 加密（比如 AES-128-GCM），每个包都带认证信息，能
防重放攻击。相比 SS 多了一层身份校验和抗分析设计，但因为握手信息里带的东西更多，
开销比 SS 和 VLESS 稍大。需要说明的是，GFW 对 VMess 一类"全加密流量"的识别能力
在近几年确实有实质性提升，这条不只是模糊传闻——专门研究 GFW 技术机制的独立研究
团队 GFW Report 在权威学术会议 USENIX Security 2023 发表的论文中记录了 GFW 自
2021 年11月起部署的一套被动检测系统，能够实时识别并阻断包括 Shadowsocks、VMess、
Obfs4 在内的多种"全加密"流量协议[^1]；该团队更早（2020年）也记录过 VMess 因认证
机制设计缺陷而被主动探测（active probing）针对的具体技术细节[^2]。这两点合起来说明
"VMess 的抗识别能力在持续被削弱"是有扎实技术信源支持的判断，不是没有依据的猜测——
但具体到某个时间点、某个网络环境下的实时识别率，仍然没有统一的公开数字，不建议
只看某个单一来源给出的百分比。

### VLESS
可以理解成"VMess 的轻量版"：本身不做额外加密（依赖外层 TLS 来提供加密），去掉了
一部分 VMess 的校验开销，配合 TLS 1.3 和 "Reality" 这类伪装技术，是目前流行度较高
的组合之一，尤其适合追求更好隐蔽性和更低延迟的场景。

### Trojan
设计思路很直接：把自己伪装成一个普通的 HTTPS 网站。没有额外的自定义握手特征，
外部观察者看到的流量长得就像正常访问某个网站一样，抗封锁能力较强，配置也相对简单。

### Hysteria2
这几个协议里最新的一类，构建在 QUIC（基于 UDP）之上，专门针对"网络质量差、丢包
率高"的场景做了优化（比如移动网络），配合自定义的拥塞控制算法，在高延迟/高丢包
环境下往往比传统 TCP 类协议跑得更快更稳。缺点是走 UDP，部分网络环境会限制或屏蔽
UDP 流量。

### AnyTLS
sing-box 团队在 2024 年设计、目前仍由该团队维护的协议[^3]，思路是把任意代理流量包
一层标准 TLS，并加了可配置的流量填充（padding scheme）来对抗基于包长分布的特征
识别[^4]。类似 VLESS+Reality 的"套 TLS 壳"路线，但截至目前还没有统一的订阅链接
格式，配置基本靠手动写 JSON，客户端支持也主要集中在 sing-box 生态（部分支持
v2rayN、Shadowrocket）[^3]。优点是纯 TCP：在 UDP 被严格限制、Hysteria2 这类基于
QUIC 的协议用不了的网络环境里，是一个可用的备选方向，代价是吞吐量通常不如
Hysteria2。

## 怎么选（一般性原则，不针对具体商家）

- **只看稳定性和易用性**：Shadowsocks / VMess 足够，客户端支持最成熟
- **更看重抗封锁/隐蔽性**：VLESS + Reality 或 Trojan 是目前普遍认可效果较好的方向
- **网络环境差（弱4G、卫星网络等）**：Hysteria2 这类基于 QUIC 的协议往往体验更好，
  前提是你的网络没有严格限制 UDP
- **UDP 被严格限制、Hysteria2 用不了**：AnyTLS 是一个纯 TCP 的备选方向，代价是
  吞吐量通常比 Hysteria2 低

## 跟 NodeNanny 的关系

NodeNanny 的备用节点池会解析这几类协议的订阅链接（包括协议内嵌 base64/JSON 格式
的差异），三层筛选（存活/速度/真实性）对所有协议一视同仁，不会因为协议类型不同
而区别对待——具体某类协议节点如果测试通过率持续偏低，通常是协议本身在你所在网络
环境下水土不服，而不是 NodeNanny 检测逻辑的问题。

---

## 参考来源

[^1]: GFW Report 团队在 USENIX Security 2023 发表的论文《How the Great Firewall of China Detects and Blocks Fully Encrypted Traffic》，记录了自2021年11月起部署的被动检测系统，明确将 VMess 列为受影响协议之一：https://gfw.report/publications/usenixsecurity23/en/
[^2]: GFW Report 关于 VMess 因认证机制设计问题（时间戳窗口可被重放）而被主动探测的技术分析（2020年）：https://gfw.report/blog/v2ray_weaknesses/en/
[^3]: AnyTLS 官方协议文档（sing-box 团队维护的 GitHub 仓库）：https://github.com/anytls/anytls-go/blob/main/docs/protocol.md ；sing-box 官方配置文档：https://sing-box.sagernet.org/configuration/inbound/anytls/
[^4]: 关于 AnyTLS padding scheme 对抗包长分布特征识别的技术说明，参见官方协议文档（同[^3]）。

*本文最后一次事实核查：2026-08-05。核查过程见项目对话记录。VMess 检测能力提升的说法原文缺少具体信源，本次核查找到了两篇非营销性质的独立技术研究（GFW Report 团队的 USENIX Security 2023 论文与其早期技术博客）作为支撑；AnyTLS 相关细节均已对照官方协议文档核实。*
