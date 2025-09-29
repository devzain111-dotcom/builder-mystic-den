import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Proxy endpoint for HIKVISION to avoid Authorization header requirement on device
  app.post("/api/hikvision", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, error: "missing_supabase_env" });
      const fn = `${supaUrl.replace(/\/$/, "")}/functions/v1/hikvision-webhook`;
      const r = await fetch(fn, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` }, body: JSON.stringify(req.body ?? {}) });
      const json = await r.json().catch(() => ({}));
      res.status(r.status).json(json);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  return app;
}
