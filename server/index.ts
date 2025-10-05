import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from "@aws-sdk/client-rekognition";

export function createServer() {
  const app = express();

  async function callGatewayJson(
    gateway: string,
    paths: string[],
    body: any,
    timeoutMs = 60000,
  ) {
    const base = gateway.replace(/\/$/, "");
    let last: {
      status: number;
      ok: boolean;
      text: string;
      payload: any;
    } | null = null;
    for (const p of paths) {
      const url = `${base}${p.startsWith("/") ? p : "/" + p}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let r: Response;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
          },
          body: JSON.stringify(body ?? {}),
          signal: ac.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        last = {
          status: 599,
          ok: false,
          text: String(e),
          payload: { message: String(e) },
        };
        continue;
      } finally {
        clearTimeout(timer);
      }
      const text = await r.text();
      let payload: any = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
      // If 404/405, try next candidate
      if (r.status === 404 || r.status === 405) {
        last = { status: r.status, ok: false, text, payload };
        continue;
      }
      last = { status: r.status, ok: r.ok, text, payload };
      if (r.ok) return last;
      // For non-OK non-404, stop trying and return error
      break;
    }
    return (
      last ?? {
        status: 599,
        ok: false,
        text: "no_response",
        payload: { message: "no_response" },
      }
    );
  }

  // Middleware
  app.use(cors());
  app.use((_, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(self)");
    next();
  });
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Health diagnostics (no secrets leaked)
  app.get("/api/health", async (_req, res) => {
    const supaUrl = process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    const service =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.SUPABASE_SERVICE_KEY ||
      "";
    const result: any = {
      ok: true,
      has_env: { url: !!supaUrl, anon: !!anon, service: !!service },
      can_read: false,
      can_write: false,
      error_read: null,
      error_write: null,
    };
    try {
      if (supaUrl && anon) {
        const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
        const apih = {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        } as Record<string, string>;
        const r = await fetch(`${rest}/hv_branches?select=id&limit=1`, {
          headers: apih,
        });
        result.can_read = r.ok;
        if (!r.ok) result.error_read = await r.text();
      }
    } catch (e: any) {
      result.error_read = e?.message || String(e);
    }
    try {
      if (supaUrl && (service || anon)) {
        const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
        const apih = {
          apikey: anon || service,
          Authorization: `Bearer ${service || anon}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        } as Record<string, string>;
        const r = await fetch(`${rest}/hv_branches`, {
          method: "POST",
          headers: apih,
          body: JSON.stringify([
            { name: "healthcheck-temp", password_hash: null },
          ]),
        });
        result.can_write = r.ok;
        if (!r.ok) result.error_write = await r.text();
        else {
          try {
            const j = await r.json();
            const id = j?.[0]?.id;
            if (id)
              await fetch(`${rest}/hv_branches?id=eq.${id}`, {
                method: "DELETE",
                headers: {
                  apikey: anon || service,
                  Authorization: `Bearer ${service || anon}`,
                },
              });
          } catch {}
        }
      }
    } catch (e: any) {
      result.error_write = e?.message || String(e);
    }
    res.json(result);
  });

  // Face enrollment: save embedding & snapshot for a worker in Supabase
  app.post("/api/face/enroll", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;

      const raw = (req as any).body ?? {};
      const body = (() => {
        try {
          if (typeof raw === "string") return JSON.parse(raw);
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
            try {
              return JSON.parse(raw.toString("utf8"));
            } catch {
              return {};
            }
          }
          // Some frameworks serialize Buffer as { type:"Buffer", data:[...] }
          if (
            raw &&
            typeof raw === "object" &&
            raw.type === "Buffer" &&
            Array.isArray((raw as any).data)
          ) {
            try {
              return JSON.parse(
                Buffer.from((raw as any).data).toString("utf8"),
              );
            } catch {
              return {};
            }
          }
        } catch {}
        return raw as any;
      })();

      function coerceEmbedding(src: any): number[] | null {
        if (!src) return null;
        if (Array.isArray(src))
          return src.map((x) => Number(x)).filter((n) => Number.isFinite(n));
        if (Array.isArray(src?.data))
          return src.data
            .map((x: any) => Number(x))
            .filter((n: number) => Number.isFinite(n));
        if (typeof src === "string") {
          try {
            const parsed = JSON.parse(src);
            return coerceEmbedding(parsed);
          } catch {
            const parts = src
              .split(/[\s,]+/)
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n));
            return parts.length ? parts : null;
          }
        }
        if (typeof src === "object") {
          const vals = Object.values(src)
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n));
          return vals.length ? vals : null;
        }
        return null;
      }

      let embedding = coerceEmbedding(
        body.embedding ?? body.descriptor ?? body.face ?? null,
      );
      if (!embedding || embedding.length === 0) {
        const hdrs = (req as any).headers || {};
        const rawHdr = hdrs["x-embedding"] || hdrs["x-emb"] || null;
        const parsed = coerceEmbedding(rawHdr);
        if (parsed && parsed.length) embedding = parsed;
      }
      if (!embedding || embedding.length === 0)
        return res.status(400).json({
          ok: false,
          message: "missing_embedding",
          debug: {
            keys: Object.keys(body || {}).filter((k) => k !== "snapshot"),
            hasEmbedding: "embedding" in (body || {}),
            typeofEmbedding: typeof body?.embedding,
            hdrLen: (req as any).headers?.["x-emb-len"],
            snapLen: (req as any).headers?.["x-snap-len"],
          },
        });

      let workerId = body.workerId || null;
      if (!workerId && body.name) {
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status");
        u.searchParams.set("name", `ilike.${body.name}`);
        u.searchParams.set("limit", "1");
        const rr = await fetch(u.toString(), { headers: apihRead });
        const arr = await rr.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (!w)
          return res
            .status(404)
            .json({ ok: false, message: "worker_not_found" });
        if (w.exit_date && w.status !== "active")
          return res.status(403).json({ ok: false, message: "worker_locked" });
        workerId = w.id;
      }
      if (!workerId)
        return res
          .status(400)
          .json({ ok: false, message: "missing_worker_identifier" });

      const save = await fetch(`${rest}/hv_face_profiles`, {
        method: "POST",
        headers: apihWrite,
        body: JSON.stringify([
          {
            worker_id: workerId,
            embedding,
            snapshot_b64: body.snapshot ?? null,
          },
        ]),
      });
      if (!save.ok) {
        const t = await save.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "save_face_failed" });
      }
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
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apih = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;

      const raw = (req as any).body ?? {};
      const body = (() => {
        try {
          if (typeof raw === "string") return JSON.parse(raw);
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
            try {
              return JSON.parse(raw.toString("utf8"));
            } catch {
              return {};
            }
          }
          if (
            raw &&
            typeof raw === "object" &&
            raw.type === "Buffer" &&
            Array.isArray((raw as any).data)
          ) {
            try {
              return JSON.parse(
                Buffer.from((raw as any).data).toString("utf8"),
              );
            } catch {
              return {};
            }
          }
        } catch {}
        return raw as any;
      })() as { embedding?: number[]; snapshot?: string };
      if (!body.embedding || !Array.isArray(body.embedding))
        return res
          .status(400)
          .json({ ok: false, message: "missing_embedding" });

      // Fetch all profiles and compute best match by Euclidean distance
      const r = await fetch(
        `${rest}/hv_face_profiles?select=worker_id,embedding`,
        { headers: apih },
      );
      if (!r.ok) {
        const t = await r.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "load_profiles_failed" });
      }
      const arr: Array<{ worker_id: string; embedding: number[] | any }> =
        await r.json();
      function dist(a: number[], b: number[]) {
        let s = 0;
        for (let i = 0; i < a.length && i < b.length; i++) {
          const d = a[i] - b[i];
          s += d * d;
        }
        return Math.sqrt(s);
      }
      let best: { worker_id: string; d: number } | null = null;
      for (const it of arr) {
        const emb = Array.isArray(it.embedding)
          ? it.embedding
          : Array.isArray(it.embedding?.data)
            ? it.embedding.data
            : Object.values(it.embedding || {});
        if (!emb || emb.length === 0) continue;
        const d = dist(body.embedding!, emb as number[]);
        if (!best || d < best.d) best = { worker_id: it.worker_id, d };
      }
      if (!best || best.d > 0.6)
        return res.status(404).json({ ok: false, message: "no_match" });
      let workerId = best.worker_id;
      let workerName: string | null = null;
      const wu = new URL(`${rest}/hv_workers`);
      wu.searchParams.set("select", "id,name");
      wu.searchParams.set("id", `eq.${workerId}`);
      const wr = await fetch(wu.toString(), { headers: apih });
      const wj = await wr.json();
      workerName = Array.isArray(wj) && wj[0]?.name ? wj[0].name : null;
      if (!workerId) {
        if (!workerName)
          return res
            .status(400)
            .json({ ok: false, message: "missing_match_info" });
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status,name");
        u.searchParams.set("name", `ilike.${workerName}`);
        u.searchParams.set("limit", "1");
        const rr = await fetch(u.toString(), { headers: apih });
        const arr = await rr.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (!w)
          return res
            .status(404)
            .json({ ok: false, message: "worker_not_found" });
        if (w.exit_date && w.status !== "active")
          return res.status(403).json({ ok: false, message: "worker_locked" });
        workerId = w.id;
        workerName = w.name;
      }

      const verifiedAt = new Date().toISOString();
      const ins = await fetch(`${rest}/hv_verifications`, {
        method: "POST",
        headers: apihWrite,
        body: JSON.stringify([
          { worker_id: workerId, verified_at: verifiedAt },
        ]),
      });
      if (!ins.ok) {
        const t = await ins.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "insert_failed" });
      }
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
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const raw = (req as any).body ?? {};
      const body = (
        typeof raw === "string"
          ? (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return {};
              }
            })()
          : raw
      ) as {
        name?: string;
        arrivalDate?: number;
        branchId?: string;
        plan?: string;
      };
      const qs = (req.query ?? {}) as any;
      const hdrs = (req as any).headers || {};
      const name = String(body.name ?? qs.name ?? hdrs["x-name"] ?? "").trim();
      if (!name)
        return res.status(400).json({ ok: false, message: "missing_name" });
      const arrivalDate =
        body.arrivalDate ??
        (qs.arrivalDate ? Number(qs.arrivalDate) : undefined) ??
        (hdrs["x-arrival"] ? Number(hdrs["x-arrival"]) : undefined);
      const arrivalIso = new Date(
        arrivalDate != null && !isNaN(arrivalDate) ? arrivalDate : Date.now(),
      ).toISOString();
      const branchId =
        String(
          body.branchId ?? qs.branchId ?? hdrs["x-branch-id"] ?? "",
        ).trim() || null;
      const plan = String(
        body.plan ?? qs.plan ?? hdrs["x-plan"] ?? "with_expense",
      ).trim();

      // Try get existing by exact name (case-insensitive)
      const u = new URL(`${rest}/hv_workers`);
      u.searchParams.set("select", "id,name");
      u.searchParams.set("name", `ilike.${name}`);
      u.searchParams.set("limit", "1");
      const r0 = await fetch(u.toString(), { headers: apihRead });
      const arr = await r0.json();
      const w = Array.isArray(arr) ? arr[0] : null;
      if (w?.id) {
        // Patch branch/arrival/docs.plan if provided
        const patchBody: any = {};
        if (branchId) patchBody.branch_id = branchId;
        if (arrivalIso) patchBody.arrival_date = arrivalIso;
        if (plan) patchBody.docs = { plan };
        if (Object.keys(patchBody).length) {
          const up = await fetch(`${rest}/hv_workers?id=eq.${w.id}`, {
            method: "PATCH",
            headers: apihWrite,
            body: JSON.stringify(patchBody),
          });
          if (!up.ok) {
            const t = await up.text();
            return res
              .status(500)
              .json({ ok: false, message: t || "update_failed" });
          }
        }
        return res.json({ ok: true, id: w.id });
      }

      const payload: any = { name };
      if (arrivalIso) payload.arrival_date = arrivalIso;
      if (branchId) payload.branch_id = branchId;
      if (plan) payload.docs = { plan };
      const ins = await fetch(`${rest}/hv_workers`, {
        method: "POST",
        headers: { ...apihWrite, Prefer: "return=representation" },
        body: JSON.stringify([payload]),
      });
      if (!ins.ok) {
        const t = await ins.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "insert_failed" });
      }
      const out = await ins.json();
      return res.json({ ok: true, id: out?.[0]?.id });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branches: list
  app.get("/api/branches", async (_req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}` } as Record<
        string,
        string
      >;
      const r = await fetch(`${rest}/hv_branches?select=id,name`, {
        headers: apih,
      });
      if (!r.ok) {
        const t = await r.text();
        return res.status(500).json({ ok: false, message: t || "load_failed" });
      }
      const arr = await r.json();
      // Seed default if none
      if (!Array.isArray(arr) || arr.length === 0) {
        const service =
          process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.SUPABASE_SERVICE_ROLE ||
          process.env.SUPABASE_SERVICE_KEY ||
          "";
        const apihWrite = {
          apikey: anon,
          Authorization: `Bearer ${service || anon}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        } as Record<string, string>;
        await fetch(`${rest}/hv_branches`, {
          method: "POST",
          headers: apihWrite,
          body: JSON.stringify([
            { name: "الفرع الرئيسي", password_hash: null },
          ]),
        });
        const r2 = await fetch(`${rest}/hv_branches?select=id,name`, {
          headers: apih,
        });
        const a2 = await r2.json();
        return res.json({ ok: true, branches: a2 });
      }
      return res.json({ ok: true, branches: arr });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branches: create {name,password?}
  app.post("/api/branches/create", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apih = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      } as Record<string, string>;
      const raw = (req as any).body ?? {};
      const body = (() => {
        try {
          if (typeof raw === "string") return JSON.parse(raw);
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
            try { return JSON.parse(raw.toString("utf8")); } catch { return {}; }
          }
          if (raw && typeof raw === "object" && (raw as any).type === "Buffer" && Array.isArray((raw as any).data)) {
            try { return JSON.parse(Buffer.from((raw as any).data).toString("utf8")); } catch { return {}; }
          }
        } catch {}
        return (raw || {}) as any;
      })() as { name?: string; password?: string };
      const qs1 = (req.query ?? {}) as any;
      const name = String(
        body.name ?? qs1.name ?? (req as any).headers?.["x-name"] ?? "",
      ).trim();
      const password = String(
        body.password ??
          qs1.password ??
          (req as any).headers?.["x-password"] ??
          "",
      );
      if (!name)
        return res.status(400).json({ ok: false, message: "missing_name" });
      const payload: any = { name };
      if (password) {
        const crypto = await import("node:crypto");
        payload.password_hash = crypto
          .createHash("sha256")
          .update(password)
          .digest("hex");
      }
      const ins = await fetch(`${rest}/hv_branches`, {
        method: "POST",
        headers: apih,
        body: JSON.stringify([payload]),
      });
      if (!ins.ok) {
        const t = await ins.text();
        const code = ins.status >= 400 && ins.status < 500 ? 400 : 500;
        return res
          .status(code)
          .json({ ok: false, message: t || "insert_failed" });
      }
      const out = await ins.json();
      return res.json({ ok: true, branch: out?.[0] ?? null });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branches: verify {id,password}
  app.post("/api/branches/verify", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}` } as Record<
        string,
        string
      >;
      const raw = (req as any).body ?? {};
      const body = (() => {
        try {
          if (typeof raw === "string") return JSON.parse(raw);
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
            try { return JSON.parse(raw.toString("utf8")); } catch { return {}; }
          }
          if (raw && typeof raw === "object" && (raw as any).type === "Buffer" && Array.isArray((raw as any).data)) {
            try { return JSON.parse(Buffer.from((raw as any).data).toString("utf8")); } catch { return {}; }
          }
        } catch {}
        return (raw || {}) as any;
      })() as { id?: string; password?: string };
      const qs2 = (req.query ?? {}) as any;
      const id = String(
        body.id ?? qs2.id ?? (req as any).headers?.["x-id"] ?? "",
      );
      const password = String(
        body.password ??
          qs2.password ??
          (req as any).headers?.["x-password"] ??
          "",
      );
      if (!id)
        return res.status(400).json({ ok: false, message: "missing_id" });
      const r = await fetch(
        `${rest}/hv_branches?id=eq.${id}&select=id,name,password_hash`,
        { headers: apih },
      );
      const arr = await r.json();
      const b = Array.isArray(arr) ? arr[0] : null;
      if (!b) return res.status(404).json({ ok: false, message: "not_found" });
      const stored = b.password_hash || "";
      if (!stored) return res.json({ ok: true, ok_no_password: true });
      const crypto = await import("node:crypto");
      const hash = crypto.createHash("sha256").update(password).digest("hex");
      if (hash !== stored)
        return res.status(401).json({ ok: false, message: "wrong_password" });
      return res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Delete worker and cascade related rows
  app.delete("/api/workers/:id", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const id = String(req.params.id || "").trim();
      if (!id)
        return res.status(400).json({ ok: false, message: "missing_id" });
      // delete payments
      await fetch(`${rest}/hv_payments?worker_id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });
      // delete verifications
      await fetch(`${rest}/hv_verifications?worker_id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });
      // delete face profiles
      await fetch(`${rest}/hv_face_profiles?worker_id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });
      // finally delete worker
      const dw = await fetch(`${rest}/hv_workers?id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });
      if (!dw.ok) {
        const t = await dw.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "delete_failed" });
      }
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Delete branch and all its workers (and related rows)
  app.delete("/api/branches/:id", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const id = String(req.params.id || "").trim();
      if (!id)
        return res.status(400).json({ ok: false, message: "missing_id" });
      // get workers of branch
      const r = await fetch(`${rest}/hv_workers?select=id&branch_id=eq.${id}`, {
        headers: apihRead,
      });
      const arr = await r.json();
      const ids: string[] = Array.isArray(arr)
        ? arr.map((x: any) => x.id).filter(Boolean)
        : [];
      for (const wid of ids) {
        await fetch(`${rest}/hv_payments?worker_id=eq.${wid}`, {
          method: "DELETE",
          headers: apihWrite,
        });
        await fetch(`${rest}/hv_verifications?worker_id=eq.${wid}`, {
          method: "DELETE",
          headers: apihWrite,
        });
        await fetch(`${rest}/hv_face_profiles?worker_id=eq.${wid}`, {
          method: "DELETE",
          headers: apihWrite,
        });
      }
      await fetch(`${rest}/hv_workers?branch_id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });
      const db = await fetch(`${rest}/hv_branches?id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });
      if (!db.ok) {
        const t = await db.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "delete_failed" });
      }
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Save payment for latest verification of a worker
  app.post("/api/verification/payment", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_SERVICE_KEY ||
        "";
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;

      // robust JSON body parsing (handles string, Buffer, {type:"Buffer"})
      const raw = (req as any).body ?? {};
      const body = (() => {
        try {
          if (typeof raw === "string") return JSON.parse(raw);
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
            try {
              return JSON.parse(raw.toString("utf8"));
            } catch {
              return {};
            }
          }
          if (
            raw &&
            typeof raw === "object" &&
            (raw as any).type === "Buffer" &&
            Array.isArray((raw as any).data)
          ) {
            try {
              return JSON.parse(
                Buffer.from((raw as any).data).toString("utf8"),
              );
            } catch {
              return {};
            }
          }
        } catch {}
        return (raw || {}) as any;
      })() as any;

      const qs3 = (req.query ?? {}) as any;
      const hdrs = (req as any).headers || {};
      const workerId = String(
        body.workerId ??
          body.worker_id ??
          body.id ??
          qs3.workerId ??
          qs3.worker_id ??
          qs3.id ??
          hdrs["x-worker-id"] ??
          hdrs["x-id"] ??
          "",
      ).trim();
      const amountVal =
        body.amount ??
        body.payment ??
        qs3.amount ??
        qs3.payment ??
        hdrs["x-amount"];
      const amount = Number(amountVal);
      if (!workerId || !Number.isFinite(amount) || amount <= 0)
        return res.status(400).json({
          ok: false,
          message: "invalid_payload",
          debug: {
            keys: Object.keys(body || {}),
            workerId,
            amount,
            hdrs: { xAmount: hdrs["x-amount"], xWorker: hdrs["x-worker-id"] },
          },
        });
      // get latest verification id for worker
      const u = new URL(`${rest}/hv_verifications`);
      u.searchParams.set("select", "id");
      u.searchParams.set("worker_id", `eq.${workerId}`);
      u.searchParams.set("order", "verified_at.desc");
      u.searchParams.set("limit", "1");
      const r0 = await fetch(u.toString(), { headers: apihRead });
      if (!r0.ok) {
        const t = await r0.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "load_latest_failed" });
      }
      const arr = await r0.json();
      let vid: string | null =
        Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
      // If none exists, create one now
      if (!vid) {
        const now = new Date().toISOString();
        const ins = await fetch(`${rest}/hv_verifications`, {
          method: "POST",
          headers: { ...apihWrite, Prefer: "return=representation" },
          body: JSON.stringify([{ worker_id: workerId, verified_at: now }]),
        });
        if (!ins.ok) {
          const t = await ins.text();
          return res
            .status(500)
            .json({ ok: false, message: t || "insert_verification_failed" });
        }
        const j = await ins.json();
        vid = j?.[0]?.id || null;
      }
      if (!vid)
        return res
          .status(500)
          .json({ ok: false, message: "no_verification_id" });
      // update payment fields on verification
      const now2 = new Date().toISOString();
      const patch = await fetch(`${rest}/hv_verifications?id=eq.${vid}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({
          payment_amount: amount,
          payment_saved_at: now2,
        }),
      });
      if (!patch.ok) {
        const t = await patch.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }
      // insert payment row for worker history
      const payIns = await fetch(`${rest}/hv_payments`, {
        method: "POST",
        headers: apihWrite,
        body: JSON.stringify([
          { worker_id: workerId, verification_id: vid, amount, saved_at: now2 },
        ]),
      });
      if (!payIns.ok) {
        const t = await payIns.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "insert_payment_failed" });
      }
      return res.json({ ok: true, id: vid, savedAt: now2 });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Create AWS Rekognition Face Liveness session
  app.post("/api/liveness/session", async (_req, res) => {
    try {
      const region = process.env.AWS_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      if (!region || !accessKeyId || !secretAccessKey)
        return res.status(500).json({ ok: false, message: "missing_aws_env" });
      const client = new RekognitionClient({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
      const out = await client.send(new CreateFaceLivenessSessionCommand({}));
      if (!out.SessionId)
        return res.status(500).json({ ok: false, message: "no_session_id" });
      return res.json({ ok: true, sessionId: out.SessionId, region });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Verify liveness session result
  app.post("/api/liveness/result", async (req, res) => {
    try {
      const region = process.env.AWS_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      if (!region || !accessKeyId || !secretAccessKey)
        return res.status(500).json({ ok: false, message: "missing_aws_env" });
      const body = (req.body ?? {}) as { sessionId?: string };
      if (!body.sessionId)
        return res
          .status(400)
          .json({ ok: false, message: "missing_session_id" });
      const client = new RekognitionClient({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
      const out = await client.send(
        new GetFaceLivenessSessionResultsCommand({ SessionId: body.sessionId }),
      );
      const status = (out?.Status as string) || "UNKNOWN";
      const confidence = (out?.Confidence as number) ?? 0;
      if (status !== "SUCCEEDED" || confidence < 0.9)
        return res
          .status(403)
          .json({ ok: false, message: "liveness_failed", status, confidence });
      return res.json({ ok: true, status, confidence });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  return app;
}
