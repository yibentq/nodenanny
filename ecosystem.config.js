module.exports = {
  apps: [
    {
      name: 'nodenanny-monitor',
      script: './core/monitor.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000
    },
    {
      name: 'nodenanny-panel',
      script: './core/panel-server.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000
    },
    {
      name: 'nodenanny-pool',
      script: './core/pool-refresher.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000
    }
  ]
};
