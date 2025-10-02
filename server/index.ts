import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand } from "@aws-sdk/client-rekognition";

export function createServer() {
  const app = express();

  async function callGatewayJson(gateway: string, paths: string[], body: any, timeoutMs = 60000) {
    const base = gateway.replace(/\/$/, "");
    let last: { status: number; ok: boolean; text: string; payload: any } | null = null;
    for (const p of paths) {
      const url = `${base}${p.startsWith("/") ? p : "/" + p}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let r: Response;
      try {
        r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" }, body: JSON.stringify(body ?? {}), signal: ac.signal });
      } catch (e) {
        clearTimeout(timer);
        last = { status: 599, ok: false, text: String(e), payload: { message: String(e) } };
        continue;
      } finally {
        clearTimeout(timer);
      }
      const text = await r.text();
      let payload: any = null;
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
      // If 404/405, try next candidate
      if (r.status === 404 || r.status === 405) { last = { status: r.status, ok: false, text, payload }; continue; }
      last = { status: r.status, ok: r.ok, text, payload };
      if (r.ok) return last;
      // For non-OK non-404, stop trying and return error
      break;
    }
    return last ?? { status: 599, ok: false, text: "no_response", payload: { message: "no_response" } };
  }

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


  // Face enrollment: save embedding & snapshot for a worker in Supabase
  app.post("/api/face/enroll", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" } as Record<string,string>;

      const body = (req.body ?? {}) as { workerId?: string; name?: string; embedding?: number[]; snapshot?: string };
      if (!body.embedding || !Array.isArray(body.embedding)) return res.status(400).json({ ok: false, message: "missing_embedding" });
      let workerId = body.workerId || null;
      if (!workerId && body.name) {
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status");
        u.searchParams.set("name", `ilike.${body.name}`);
        u.searchParams.set("limit", "1");
        const rr = await fetch(u.toString(), { headers: apih });
        const arr = await rr.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (!w) return res.status(404).json({ ok: false, message: "worker_not_found" });
        if (w.exit_date && w.status !== "active") return res.status(403).json({ ok: false, message: "worker_locked" });
        workerId = w.id;
      }
      if (!workerId) return res.status(400).json({ ok: false, message: "missing_worker_identifier" });

      const save = await fetch(`${rest}/hv_face_profiles`, { method: "POST", headers: apih, body: JSON.stringify([{ worker_id: workerId, embedding: body.embedding, snapshot_b64: body.snapshot ?? null }]) });
      if (!save.ok) { const t = await save.text(); return res.status(500).json({ ok: false, message: t || "save_face_failed" }); }
      return res.json({ ok: true, workerId, message: "face_saved" });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Identify by face embedding sent from browser and write verification
  app.post("/api/face/identify", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" } as Record<string,string>;

      const body = (req.body ?? {}) as { embedding?: number[]; snapshot?: string };
      if (!body.embedding || !Array.isArray(body.embedding)) return res.status(400).json({ ok: false, message: "missing_embedding" });

      // Fetch all profiles and compute best match by Euclidean distance
      const r = await fetch(`${rest}/hv_face_profiles?select=worker_id,embedding`, { headers: apih });
      if (!r.ok) { const t = await r.text(); return res.status(500).json({ ok: false, message: t || 'load_profiles_failed' }); }
      const arr: Array<{ worker_id: string; embedding: number[] | any }> = await r.json();
      function dist(a: number[], b: number[]) { let s=0; for(let i=0;i<a.length && i<b.length;i++){ const d=a[i]-b[i]; s+=d*d; } return Math.sqrt(s); }
      let best: { worker_id: string; d: number } | null = null;
      for (const it of arr) { const emb = Array.isArray(it.embedding) ? it.embedding : (Array.isArray(it.embedding?.data) ? it.embedding.data : Object.values(it.embedding||{})); if (!emb || emb.length === 0) continue; const d = dist(body.embedding!, emb as number[]); if (!best || d < best.d) best = { worker_id: it.worker_id, d }; }
      if (!best || best.d > 0.6) return res.status(404).json({ ok: false, message: 'no_match' });
      let workerId = best.worker_id; let workerName: string | null = null;
      const wu = new URL(`${rest}/hv_workers`); wu.searchParams.set('select','id,name'); wu.searchParams.set('id',`eq.${workerId}`); const wr = await fetch(wu.toString(), { headers: apih }); const wj = await wr.json(); workerName = Array.isArray(wj) && wj[0]?.name ? wj[0].name : null;
      if (!workerId) {
        if (!workerName) return res.status(400).json({ ok: false, message: "missing_match_info" });
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status,name");
        u.searchParams.set("name", `ilike.${workerName}`);
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
      if (!ins.ok) { const t = await ins.text(); return res.status(500).json({ ok: false, message: t || 'insert_failed' }); }
      return res.json({ ok: true, workerId, workerName, verifiedAt });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Upsert worker in Supabase for enrollment
  app.post("/api/workers/upsert", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" } as Record<string,string>;
      const body = (req.body ?? {}) as { name: string; arrivalDate?: number };
      const name = (body.name || "").trim(); if (!name) return res.status(400).json({ ok: false, message: "missing_name" });
      const arrivalIso = body.arrivalDate ? new Date(body.arrivalDate).toISOString() : null;

      // Try get existing by exact name (case-insensitive)
      const u = new URL(`${rest}/hv_workers`);
      u.searchParams.set("select", "id,name");
      u.searchParams.set("name", `ilike.${name}`);
      u.searchParams.set("limit", "1");
      const r0 = await fetch(u.toString(), { headers: apih });
      const arr = await r0.json();
      const w = Array.isArray(arr) ? arr[0] : null;
      if (w?.id) return res.json({ ok: true, id: w.id });

      const payload: any = { name };
      if (arrivalIso) payload.arrival_date = arrivalIso;
      const ins = await fetch(`${rest}/hv_workers`, { method: "POST", headers: { ...apih, Prefer: "return=representation" }, body: JSON.stringify([payload]) });
      if (!ins.ok) { const t = await ins.text(); return res.status(500).json({ ok: false, message: t || "insert_failed" }); }
      const out = await ins.json();
      return res.json({ ok: true, id: out?.[0]?.id });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Save payment for latest verification of a worker
  app.post('/api/verification/payment', async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) return res.status(500).json({ ok: false, message: 'missing_supabase_env' });
      const rest = `${supaUrl.replace(/\/$/, '')}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' } as Record<string, string>;
      const body = (req.body ?? {}) as { workerId?: string; amount?: number };
      const workerId = body.workerId; const amount = Number(body.amount);
      if (!workerId || !isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, message: 'invalid_payload' });
      // get latest verification id for worker
      const u = new URL(`${rest}/hv_verifications`);
      u.searchParams.set('select', 'id');
      u.searchParams.set('worker_id', `eq.${workerId}`);
      u.searchParams.set('order', 'verified_at.desc');
      u.searchParams.set('limit', '1');
      const r0 = await fetch(u.toString(), { headers: apih });
      if (!r0.ok) { const t = await r0.text(); return res.status(500).json({ ok: false, message: t || 'load_latest_failed' }); }
      const arr = await r0.json();
      let vid: string | null = Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
      // If none exists, create one now
      if (!vid) {
        const now = new Date().toISOString();
        const ins = await fetch(`${rest}/hv_verifications`, { method: 'POST', headers: { ...apih, Prefer: 'return=representation' }, body: JSON.stringify([{ worker_id: workerId, verified_at: now }]) });
        if (!ins.ok) { const t = await ins.text(); return res.status(500).json({ ok: false, message: t || 'insert_verification_failed' }); }
        const j = await ins.json(); vid = j?.[0]?.id || null;
      }
      if (!vid) return res.status(500).json({ ok: false, message: 'no_verification_id' });
      // update payment fields on verification
      const now2 = new Date().toISOString();
      const patch = await fetch(`${rest}/hv_verifications?id=eq.${vid}`, { method: 'PATCH', headers: apih, body: JSON.stringify({ payment_amount: amount, payment_saved_at: now2 }) });
      if (!patch.ok) { const t = await patch.text(); return res.status(500).json({ ok: false, message: t || 'update_failed' }); }
      // insert payment row for worker history
      const payIns = await fetch(`${rest}/hv_payments`, { method: 'POST', headers: apih, body: JSON.stringify([{ worker_id: workerId, verification_id: vid, amount, saved_at: now2 }]) });
      if (!payIns.ok) { const t = await payIns.text(); return res.status(500).json({ ok: false, message: t || 'insert_payment_failed' }); }
      return res.json({ ok: true, id: vid, savedAt: now2 });
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Create AWS Rekognition Face Liveness session
  app.post('/api/liveness/session', async (_req, res) => {
    try {
      const region = process.env.AWS_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      if (!region || !accessKeyId || !secretAccessKey) return res.status(500).json({ ok: false, message: 'missing_aws_env' });
      const client = new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
      const out = await client.send(new CreateFaceLivenessSessionCommand({}));
      if (!out.SessionId) return res.status(500).json({ ok: false, message: 'no_session_id' });
      return res.json({ ok: true, sessionId: out.SessionId, region });
    } catch (e: any) { return res.status(500).json({ ok: false, message: e?.message || String(e) }); }
  });

  // Verify liveness session result
  app.post('/api/liveness/result', async (req, res) => {
    try {
      const region = process.env.AWS_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      if (!region || !accessKeyId || !secretAccessKey) return res.status(500).json({ ok: false, message: 'missing_aws_env' });
      const body = (req.body ?? {}) as { sessionId?: string };
      if (!body.sessionId) return res.status(400).json({ ok: false, message: 'missing_session_id' });
      const client = new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
      const out = await client.send(new GetFaceLivenessSessionResultsCommand({ SessionId: body.sessionId }));
      const status = (out?.Status as string) || 'UNKNOWN';
      const confidence = (out?.Confidence as number) ?? 0;
      if (status !== 'SUCCEEDED' || confidence < 0.9) return res.status(403).json({ ok: false, message: 'liveness_failed', status, confidence });
      return res.json({ ok: true, status, confidence });
    } catch (e: any) { return res.status(500).json({ ok: false, message: e?.message || String(e) }); }
  });

  return app;
}
