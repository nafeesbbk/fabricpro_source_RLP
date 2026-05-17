import { mkdir, writeFile, copyFile } from "node:fs/promises";

const base = "artifacts/api-server/.vercel/output";
const funcDir = `${base}/functions/index.func`;

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
    { src: "/(.*)", dest: "/$1" },
  ],
}, null, 2));

console.log("✅ Vercel Build Output API structure created (index.func, passthrough routing)!");
