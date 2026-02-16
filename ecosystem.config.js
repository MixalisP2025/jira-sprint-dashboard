module.exports = {
  apps: [
    {
      name: 'jira-backend',
      cwd: './server',
      script: 'npm',
      args: 'start',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'jira-frontend',
      script: 'npm',
      args: 'run dev',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development'
      }
    }
  ]
};
