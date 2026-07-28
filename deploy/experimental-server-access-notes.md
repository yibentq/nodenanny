# 实验服务器（186.244.208.32）访问方式说明

这份文档记录的是**当前实验服务器上实际存在、但此前没有写进任何交接文档的一套 Nginx
访问方式**。它是在某次更早的会话里配置好的，具体是哪次已经无法追溯——这份文档的目的
就是让它从"只有服务器自己知道"的部落知识，变成有据可查的东西。

> 和 `deploy/nginx-nodenanny.conf.example` 的关系：那份文件是给**新部署**用的参考模板
> （自定义域名 + Let's Encrypt）。这份文档记录的是**当前这台实验服务器实际在用**的、
> 不带域名、走自签证书 + Basic Auth 的另一套方案。两者不冲突，各自服务不同场景。

## 现状（截至本文档写入时）

服务器上通过 `/etc/nginx/conf.d/nodenanny.conf` 暴露了两个端口，都不经过域名，直接用
服务器 IP 访问：

| 端口 | 协议 | 用途 | 访问控制 |
|------|------|------|----------|
| `49769` | HTTPS（自签证书） | 反代到面板 `127.0.0.1:8787`，日常访问入口 | HTTP Basic Auth（htpasswd） |
| `35319` | 纯 HTTP | 只放行 `/sub/subscription` 路径，其余全部 404 | 无（订阅链接本身带 token，见面板"智能订阅"说明） |

**创始人日常访问面板走的就是 `49769` 这个 URL**，不是 SSH 隧道——早期交接文档一直假设
访问方式是 `ssh -L 8787:127.0.0.1:8787`，这个假设是不准确的，SSH 隧道更多是给 AI/开发者
临时调试用。

## 涉及的文件（都在服务器上，均不受 git 管理）

- `/etc/nginx/conf.d/nodenanny.conf` —— 反代规则本体
- `/etc/nodenanny/ssl/cert.pem`、`/etc/nodenanny/ssl/key.pem` —— 自签证书
- `/etc/nodenanny/ssl/htpasswd` —— Basic Auth 密码文件（bcrypt/crypt 哈希存储，不是明文）

这些文件只存在于这台服务器本身，**不会**出现在 GitHub 仓库或任何交接文档里——密码本身
（包括 Basic Auth 密码）不应该以明文形式写进任何交接材料，这是既有的约定，本文档同样遵守。

## 已知问题记录（2026-07-28 已修复）

`49769` 这个 server block 的 `location /` 原本缺少 WebSocket 升级所需的三行：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

缺少这三行时，终端功能（基于 WebSocket）通过 `49769` 访问会反复断线重连，但通过 SSH
隧道访问却正常（原始 TCP 转发不需要这些头）——这也是为什么这个 bug 拖了很久没被发现：
过去调试终端功能大概率都是用 SSH 隧道验证的。已在服务器上直接修复（改前备份为
`.bak.20260728`，`nginx -t` 验证通过后 `nginx -s reload`），`deploy/nginx-nodenanny.conf.example`
里的参考配置本身从一开始就带这三行，不受影响。

## 遗留事项（尚未处理，供下一次会话参考）

1. **没有记录这套配置最初是何时/哪次会话搭建的**——如果以后要重新生成证书或密码，
   目前没有文档化的操作步骤，只能现查。
2. **三个密码统一为同一个值**（面板登录密码 / 终端解锁密码 / 这里的 Basic Auth 密码）
   ——这是创始人在零预算个人项目上的主动选择，为图方便，不是遗漏，未经创始人同意
   不应该单方面"修正"。
3. 如果以后想让这套配置更规范（比如换成正式域名 + Let's Encrypt，用
   `deploy/nginx-nodenanny.conf.example` 的方案替换掉自签证书），需要创始人决定优先级，
   目前不在任何任务清单里。
