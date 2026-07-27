---
title: 日常使用
summary: 面板上能看到什么、怎么手动加自己的订阅源
order: 2
updated: 2026-07-22
tags: [使用, 面板]
---

## 面板首页看什么

- **自建节点状态**：你自己的代理服务是否存活，配合底部的存活时长统计
- **订阅地址**：NodeNanny 自己会生成一个"智能订阅"链接，客户端订阅这一个地址就够——
  自建节点正常时返回真实节点，自建节点异常且备用池里有可用节点时自动切换成备用
  节点内容，不需要你手动切换订阅链接
- **备用节点池 / 星图视图**：备用池里当前有哪些来源、每个来源的信任状态（试用中/
  已信任/已拉黑）、节点数量

## 手动加一条你自己信任的订阅源

如果你自己有稳定的订阅链接（不管是自己另外买的机场，还是朋友分享的），想让它也
参与备用池，走的是"手动来源"这条路径，新加的来源同样要经过试用期考察，不会因为
是手动加的就跳过信任分级：

```bash
cat <<'EOF' | node
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('config/config.json', 'utf-8'));
const newSources = [
  { id: '给这条源起个短标识', name: '显示名称', url: '订阅链接' }
];
for (const s of newSources) {
  if (!config.pool.manualSources.some(x => x.id === s.id)) {
    config.pool.manualSources.push(s);
  }
}
fs.writeFileSync('config/config.json', JSON.stringify(config, null, 2));
console.log('写入完成:', config.pool.manualSources.map(s => s.id));
EOF
pm2 restart nodenanny-pool
```

用 heredoc 写 JS 脚本而不是直接用 `sed`/`echo` 拼接 JSON，是为了避免手动改 JSON
容易漏逗号/多逗号导致整个配置文件解析失败；这个写法在项目里已经反复验证过没问题。

加进去之后，这条来源会先以"试用"状态运行一段时间，面板星图视图上能看到它的实时
通过率，不需要额外操作。

## 什么时候该去看"节点/代理协议行业通识"这个分类

如果你发现某类节点（比如某个协议）测试通过率一直很低，但你确认订阅源本身没问题，
大概率是协议层面的知识盲区，而不是 NodeNanny 配置错了——这种情况建议去"节点/代理
协议行业通识"分类里查一下对应协议的说明，那边讲的是协议本身的原理和常见限制，
不是 NodeNanny 这个工具的用法。
