#!/bin/bash
set -e
cd ../..
pnpm --filter @workspace/api-server run build
node -e "const f=require('fs'),d='artifacts/api-server/.vercel/output',fn=d+'/functions/index.func';f.mkdirSync(fn,{recursive:true});f.copyFileSync('artifacts/api-server/dist/api/index.js',fn+'/index.js');f.writeFileSync(fn+'/.vc-config.json','{\"runtime\":\"nodejs20.x\",\"handler\":\"index.js\",\"launcherType\":\"Nodejs\",\"shouldAddHelpers\":true}');f.writeFileSync(d+'/config.json','{\"version\":3,\"routes\":[{\"src\":\"/(.+)\",\"dest\":\"/index\"},{\"src\":\"/\",\"dest\":\"/index\"}]}')"
echo Done