#!/bin/bash
set -e
cd ../..
pnpm --filter @workspace/api-server run build
mkdir -p artifacts/api-server/public
echo ok > artifacts/api-server/public/ping.json
echo "Build done"

