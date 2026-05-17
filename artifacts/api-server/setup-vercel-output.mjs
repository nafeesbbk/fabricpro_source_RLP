import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";

const base = "artifacts/api-server/.vercel/output";

// Clean any stale output from previous builds
await rm(base, { recursive: true, force: true });

// [[...catchall]].func handles EVERY path — /api/health, /api/auth/login, etc.
const funcDir = `${base}/functions/[[...catchall]].func`;

await mkdir(funcDir, { recursive: true });
await copyFile("artifacts/api-server/dist/api/index.js", `${funcDir}/index.js`);

await writeFile(`${funcDir}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs20.x",
  handler: "index.js",
  launcherType: "Nodejs",
  shouldAddHelpers: true,
}));

await writeFile(`${base}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    {
      src: "/(.*)",
      methods: ["OPTIONS"],
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
      status: 204,
      continue: false,
    },
  ],
}, null, 2));

console.log("✅ Vercel Build Output created: [[...catchall]].func handles all routes!");
