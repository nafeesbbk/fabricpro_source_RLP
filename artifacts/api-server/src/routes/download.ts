import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const SECRET = "fp-dl-2026-xk9";
const BACKUP_PATH = path.resolve("/home/runner/workspace/fabricpro-backup.tar.gz");

router.get(`/download/${SECRET}`, (req, res) => {
  if (!fs.existsSync(BACKUP_PATH)) {
    res.status(404).json({ error: "Backup file not found" });
    return;
  }
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", 'attachment; filename="fabricpro-backup.tar.gz"');
  res.setHeader("Content-Length", fs.statSync(BACKUP_PATH).size);
  fs.createReadStream(BACKUP_PATH).pipe(res);
});

export default router;
