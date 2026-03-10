module.exports = {
  apps: [
    {
      name: 'jira-backend',
      cwd: './server',
      script: 'server.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      },
      windowsHide: true
    }
  ]
};
