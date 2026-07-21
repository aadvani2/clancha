#!/usr/bin/env bash
set -e

npm ci
npm run build
pm2 delete 0 || true
pm2 start npm --name "clancha-admin" -- start
