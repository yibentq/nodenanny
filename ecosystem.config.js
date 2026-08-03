// 稳定性审查（2026-08-03）新增 max_memory_restart：三个进程之前完全没有内存上限，
// 一旦某个进程内存缓慢增长（泄漏，或者流量池刷新时候选源特别多），PM2 不会主动
// 干预，只能等系统 OOM killer 出手——那时候往往会连带影响同台机器上的其它进程，
// 而不是干净地只重启这一个。下面这几个数值是针对"小内存服务器"给的保守起点：
// nodenanny-pool 平时负载最重（要抓取/检测大量候选源），给得宽松一些；如果部署后
// 发现某个进程经常触碰到这个阈值被重启，用 `pm2 monit` 看一下它平时的真实内存占用，
// 再把对应的数字调高即可，不是固定不能改的值。
module.exports = {
  apps: [
    {
      name: 'nodenanny-monitor',
      script: './core/monitor.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '200M'
    },
    {
      name: 'nodenanny-panel',
      script: './core/panel-server.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '300M'
    },
    {
      name: 'nodenanny-pool',
      script: './core/pool-refresher.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '500M'
    }
  ]
};
