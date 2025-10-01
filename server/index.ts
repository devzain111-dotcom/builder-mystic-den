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

  // Endpoint for HIKVISION: resolve worker and insert verification directly into Supabase REST
  app.post("/api/hikvision", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, error: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" } as Record<string,string>;

      const body = (req.body ?? {}) as { workerId?: string; name?: string; verifiedAt?: string };
      let workerId = body.workerId || null;
      if (!workerId && body.name) {
        const url = new URL(`${rest}/hv_workers`);
        url.searchParams.set("select", "id,exit_date,status");
        url.searchParams.set("ilike", `name.${body.name}`); // simple ilike
        url.searchParams.set("limit", "1");
        const r = await fetch(url.toString(), { headers: apih });
        const arr = await r.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (!w) return res.status(404).json({ ok: false, error: "worker_not_found" });
        if (w.exit_date && w.status !== "active") return res.status(403).json({ ok: false, error: "worker_locked" });
        workerId = w.id;
      }
      if (!workerId) return res.status(400).json({ ok: false, error: "missing_worker_identifier" });

      const verifiedAt = body.verifiedAt || new Date().toISOString();
      const ins = await fetch(`${rest}/hv_verifications`, { method: "POST", headers: apih, body: JSON.stringify([{ worker_id: workerId, verified_at: verifiedAt }]) });
      if (!ins.ok) {
        const err = await ins.text();
        return res.status(500).json({ ok: false, error: err || "insert_failed" });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Fingerprint registration trigger: forwards to local gateway
  app.post("/api/fingerprint/register", async (req, res) => {
    try {
      const gateway = process.env.FP_GATEWAY_URL;
      if (!gateway) return res.status(500).json({ ok: false, error: "missing_fp_gateway" });
      const body = (req.body ?? {}) as { workerId?: string; name?: string };
      if (!body.workerId && !body.name) return res.status(400).json({ ok: false, error: "missing_worker_identifier" });
      const url = `${gateway.replace(/\/$/, "")}/register`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await r.text();
      // Try to parse JSON, else forward text
      try {
        const json = JSON.parse(text);
        return res.status(r.status).json(json);
      } catch {
        return res.status(r.status).send(text);
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  return app;
}
