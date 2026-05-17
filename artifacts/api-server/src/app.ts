import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import fs from "fs";

const app: Express = express();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(
  (pinoHttp as any)({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = [
      "https://fabricpro-frontend.vercel.app",
      "https://fab.naewtgroup.com",
    ];
    if (allowed.includes(origin) || origin.endsWith(".vercel.app") || origin.includes("localhost")) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Health check (no auth, no DB)
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), env: process.env.NODE_ENV });
});

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
  res.send(`<!DOCTYPE html><html><body><h1>FabricPro Backup ${sizeKB} KB</h1></body></html>`);
});

app.use("/api", router);

// Global error handler — returns error details in non-production (for debugging)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  logger.error({ err, status }, "Unhandled error");
  res.status(status).json({
    error: message,
    stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    code: err.code,
  });
});

export default app;
