import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import fs from "fs";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.get("/api/backup-fp2024secure", (_req, res) => {
  const filePath = path.resolve("/home/runner/workspace/fabricpro_backup_final.tar.gz");
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Backup file not found" });
    return;
  }
  res.setHeader("Content-Disposition", "attachment; filename=fabricpro_backup_final.tar.gz");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(filePath);
});

app.get("/api/download", (_req, res) => {
  const fileSize = (() => {
    try {
      return fs.statSync("/home/runner/workspace/fabricpro_backup_final.tar.gz").size;
    } catch { return 0; }
  })();
  const sizeKB = Math.round(fileSize / 1024);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FabricPro Backup Download</title>
  <style>
    body { font-family: sans-serif; background: #1a1a2e; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    h1 { color: #e94560; margin-bottom: 8px; }
    p { color: #aaa; margin-bottom: 32px; }
    .btn { background: #e94560; color: white; border: none; padding: 18px 40px; font-size: 18px; border-radius: 12px; cursor: pointer; text-decoration: none; display: inline-block; margin: 8px; }
    .btn:hover { background: #c73652; }
    .btn2 { background: #16213e; border: 2px solid #e94560; color: #e94560; }
    .info { background: #16213e; border-radius: 12px; padding: 20px; margin-top: 24px; max-width: 400px; text-align: left; }
    .info li { margin: 8px 0; color: #ccc; }
    #status { margin-top: 16px; color: #4ade80; font-size: 14px; }
    progress { width: 100%; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <h1>🗂️ FabricPro Backup</h1>
  <p>Source Code + Database — ${sizeKB} KB</p>
  <button class="btn" onclick="startDownload()">📥 Download Karo</button>
  <div id="status"></div>
  <progress id="prog" max="100" value="0"></progress>
  <div class="info">
    <b>Is file mein kya hai:</b>
    <ul>
      <li>✅ Poora source code</li>
      <li>✅ Database (users, slips, payments)</li>
      <li>❌ node_modules (pnpm install se aate hain)</li>
    </ul>
    <b>Extract karne ke liye:</b>
    <ul>
      <li>📱 Android: ZArchiver app</li>
      <li>💻 Windows: WinRAR / 7-Zip</li>
      <li>🍎 Mac: double-click</li>
    </ul>
  </div>
  <script>
    async function startDownload() {
      const status = document.getElementById('status');
      const prog = document.getElementById('prog');
      status.textContent = 'Download shuru ho rahi hai...';
      prog.style.display = 'block';
      try {
        const response = await fetch('/api/backup-fp2024secure');
        const contentLength = response.headers.get('Content-Length');
        const total = parseInt(contentLength, 10);
        const reader = response.body.getReader();
        let received = 0;
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (total) {
            prog.value = Math.round((received / total) * 100);
            status.textContent = 'Download: ' + Math.round(received/1024) + ' KB / ' + Math.round(total/1024) + ' KB';
          }
        }
        const blob = new Blob(chunks, { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fabricpro_backup_final.tar.gz';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        status.textContent = '✅ Download complete! File aapke phone/PC mein save ho gayi.';
        prog.value = 100;
      } catch (err) {
        status.textContent = '❌ Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`);
});

app.use("/api", router);

export default app;
