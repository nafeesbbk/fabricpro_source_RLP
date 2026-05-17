#!/bin/bash
set -e
rm -rf .vercel
cd ../..
pnpm --filter @workspace/api-server run build
mkdir -p artifacts/api-server/api artifacts/api-server/public
cp artifacts/api-server/dist/api/index.js artifacts/api-server/api/index.js
echo '{"ok":true}' > artifacts/api-server/public/ping.json
