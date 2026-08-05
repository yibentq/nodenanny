---
title: 常见故障：面板打不开
summary: 浏览器提示"无法连接""ERR_CONNECTION_REFUSED"或一直转圈，面板地址访问不到
order: 11
updated: 2026-08-05
tags: [故障排查, 面板, nginx]
kbRef: panel-unreachable
---

## 现象

在浏览器里打开面板地址（例如 `https://你的服务器IP:49769`），出现以下情况之一：

- `ERR_CONNECTION_REFUSED`（连接被拒绝）——通常意味着 nginx 根本没在跑，或者端口被防火墙拦了
- `ERR_CONNECTION_TIMED_OUT`（一直转圈，超时）——通常意味着端口被防火墙拦了，请求根本没到达服务器
- `502 Bad Gateway`——nginx 在跑，但它找不到 NodeNanny 面板进程（上游没响应）
- 页面能打开但显示 nginx 默认欢迎页，不是 NodeNanny 面板——nginx 在跑，但反代配置没生效

**端口说明**：NodeNanny 有三个端口，功能各不相同——
- `49769`：nginx 对外暴露的面板访问端口（你在浏览器里输入的那个）
- `3000`：NodeNanny 面板进程实际监听的内部端口（nginx 把请求转发到这里，外部不直接访问）
- `35319`：订阅专用端口，无需登录验证

## 排查顺序

根据上面的现象，可以判断大致从哪一步开始查。`ERR_CONNECTION_REFUSED` 或 `502` 先查第一步；超时先查第三步（防火墙）；nginx 默认页直接跳第四步。

### 第一步：确认 NodeNanny 面板进程是否在跑

在服务器终端（或面板的在线终端，如果还能访问的话）执行：

```bash
pm2 list
```

找 `nodenanny-panel` 这一行，看 `status` 列：

- 显示 `online`：进程本身没问题，跳到第二步检查 nginx。
- 显示 `stopped` 或 `errored`：进程挂了，先重启它：

```bash
pm2 restart nodenanny-panel
```

重启完再刷新浏览器，看问题是否解决。如果重启之后过一会儿又挂，说明进程本身有错误，需要看日志：

```bash
pm2 logs nodenanny-panel --lines 50 --nostream
```

找 `Error` 开头的行，最常见的原因是 `config.json` 配置格式写错了。

### 第二步：确认 nginx 是否在跑

```bash
systemctl status nginx
```

- 显示 `active (running)`：nginx 正常，跳到第三步。
- 显示 `inactive` 或 `failed`：nginx 挂了，重启：

```bash
systemctl restart nginx
```

重启完再试一次浏览器。如果重启后浏览器从 `ERR_CONNECTION_REFUSED` 变成了 `502`，说明 nginx 恢复了但面板进程还有问题，回到第一步查 PM2。

### 第三步：确认端口没被防火墙拦掉

NodeNanny 面板默认通过 nginx 反代在 `49769` 端口对外提供服务。如果服务器开了防火墙（iptables 或云服务商的安全组），这个端口需要放行。

检查 iptables 规则：

```bash
iptables -L INPUT -n | grep 49769
```

如果没有任何输出，说明没有专门放行这个端口的规则。放行命令：

```bash
iptables -I INPUT -p tcp --dport 49769 -j ACCEPT
```

**注意**：还需要去你的云服务商控制台（阿里云/腾讯云/搬瓦工等）的"安全组"或"防火墙"页面，确认 49769 端口也在入站规则里开放了——iptables 和云安全组是两道独立的门，两道都要开。

### 第四步：确认 nginx 的反代配置正确

如果前三步都没问题，浏览器仍然访问不到，可能是 nginx 配置指向了错误的端口，或者缺少 WebSocket 升级头（在线终端需要这几行）。

查看 NodeNanny 的 nginx 配置文件：

```bash
cat /etc/nginx/sites-enabled/nodenanny
```

正确的配置关键部分应该包含：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;   # 3000 是 NodeNanny 面板实际监听的内部端口
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

**注意**：如果你修改过 `config.json` 里的 `port` 字段，把这里的 `3000` 换成你实际设置的值。

如果 `proxy_pass` 后面的端口不对，或者缺少 `proxy_http_version` 和 `Upgrade`/`Connection` 这三行，在线终端会断连（即使面板本身能打开）。修改配置文件之后，需要重载 nginx：

```bash
nginx -t && systemctl reload nginx
```

`nginx -t` 会先做语法检查，通过了再 reload，避免配置写错导致 nginx 整体挂掉。

## 还是不行？

把以下信息告诉你的运维朋友或在 Issue 里反馈，方便快速定位：

1. `pm2 list` 的输出截图
2. `systemctl status nginx` 的输出
3. 浏览器报的具体错误（`ERR_CONNECTION_REFUSED` 还是 `502` 还是别的）
4. 是全新安装后从未能访问，还是之前好用、突然不行了
