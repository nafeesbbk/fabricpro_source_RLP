#!/bin/bash
set -e
rm -rf .vercel
cd ../..
pnpm --filter @workspace/api-server run build

FUNC_DIR="artifacts/api-server/.vercel/output/functions/[[...catchall]].func"
mkdir -p "$FUNC_DIR"
cp artifacts/api-server/dist/api/index.js "$FUNC_DIR/index.js"

cat > "$FUNC_DIR/.vc-config.json" << 'EOF'
{"runtime":"nodejs20.x","handler":"index.js","launcherType":"Nodejs","shouldAddHelpers":true}
EOF

cat > "artifacts/api-server/.vercel/output/config.json" << 'EOF'
{"version":3,"routes":[{"src":"/(.*)","methods":["OPTIONS"],"headers":{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,PATCH,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type,X-Requested-With","Access-Control-Max-Age":"86400"},"status":204,"continue":false}]}
EOF

echo "Build Output API structure created successfully"
