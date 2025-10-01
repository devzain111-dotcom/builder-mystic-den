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

  // Fingerprint registration: capture template and store it for a worker in Supabase
  app.post("/api/fingerprint/register", async (req, res) => {
    try {
      const gateway = process.env.FP_GATEWAY_URL;
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!gateway) return res.status(500).json({ ok: false, message: "missing_fp_gateway" });
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" } as Record<string,string>;

      const body = (req.body ?? {}) as { workerId?: string; name?: string };
      let workerId = body.workerId || null;
      if (!workerId && body.name) {
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status");
        u.searchParams.set("ilike", `name.${body.name}`);
        u.searchParams.set("limit", "1");
        const rr = await fetch(u.toString(), { headers: apih });
        const arr = await rr.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (!w) return res.status(404).json({ ok: false, message: "worker_not_found" });
        if (w.exit_date && w.status !== "active") return res.status(403).json({ ok: false, message: "worker_locked" });
        workerId = w.id;
      }
      if (!workerId) return res.status(400).json({ ok: false, message: "missing_worker_identifier" });

      const url = `${gateway.replace(/\/$/, "")}/register`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 60000);
      let r: Response;
      try {
        r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" }, body: JSON.stringify({}), signal: ac.signal });
      } finally { clearTimeout(timer); }

      const text = await r.text();
      let payload: any = null;
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
      if (!r.ok || !payload?.template) return res.status(r.status).json({ ok: false, message: payload?.message || "register_failed" });

      // Store captured template
      const save = await fetch(`${rest}/hv_fp_templates`, { method: "POST", headers: apih, body: JSON.stringify([{ worker_id: workerId, template: payload.template }]) });
      if (!save.ok) {
        const t = await save.text();
        return res.status(500).json({ ok: false, message: t || "save_template_failed" });
      }
      return res.json({ ok: true, workerId, message: "template_saved" });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Identify via gateway and write verification into Supabase
  app.post("/api/fingerprint/identify", async (_req, res) => {
    try {
      const gateway = process.env.FP_GATEWAY_URL;
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!gateway) return res.status(500).json({ ok: false, message: "missing_fp_gateway" });
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" } as Record<string,string>;

      const url = `${gateway.replace(/\/$/, "")}/identify`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 60000);
      let r: Response;
      try {
        r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" }, body: JSON.stringify({}), signal: ac.signal });
      } finally { clearTimeout(timer); }

      const text = await r.text();
      let payload: any = null;
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
      if (!r.ok) return res.status(r.status).json({ ok: false, message: payload?.message || "identify_failed" });

      let workerId = payload?.workerId || payload?.worker_id || null;
      let workerName = payload?.workerName || payload?.name || null;
      if (!workerId) {
        if (!workerName) return res.status(400).json({ ok: false, message: "missing_match_info" });
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status,name");
        u.searchParams.set("ilike", `name.${workerName}`);
        u.searchParams.set("limit", "1");
        const rr = await fetch(u.toString(), { headers: apih });
        const arr = await rr.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (!w) return res.status(404).json({ ok: false, message: "worker_not_found" });
        if (w.exit_date && w.status !== "active") return res.status(403).json({ ok: false, message: "worker_locked" });
        workerId = w.id; workerName = w.name;
      }

      const verifiedAt = new Date().toISOString();
      const ins = await fetch(`${rest}/hv_verifications`, { method: "POST", headers: apih, body: JSON.stringify([{ worker_id: workerId, verified_at: verifiedAt }]) });
      if (!ins.ok) {
        const t = await ins.text();
        return res.status(500).json({ ok: false, message: t || "insert_failed" });
      }
      return res.json({ ok: true, workerId, workerName, verifiedAt });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  return app;
}
