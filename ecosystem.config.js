module.exports = {
  apps: [
    {
      name: 'crats-indexer',
      script: './src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 5001,
        LOG_LEVEL: 'info'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001,
        LOG_LEVEL: 'warn'
      }
    }
  ]
};
