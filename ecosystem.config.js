module.exports = {
  apps: [
    {
      name: "clancha-admin",
      cwd: "./",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      // Load .env from this directory (PM2 doesn't load .env by default)
      // env_file: ".env",
    },
  ],
};
