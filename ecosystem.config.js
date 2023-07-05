module.exports = {
    apps: [
      {
        name: 'node',
        script: 'src/server.js',
        autorestart: true,
        watch: true,
        ignore_watch: ['node_modules'],
      },
    ],
  };
  