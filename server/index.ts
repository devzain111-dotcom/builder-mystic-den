import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand,
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

  // Normalize paths when deployed behind Netlify function where paths may be prefixed by '/.netlify/functions/api'
  app.use((req, _res, next) => {
    try {
      let url = req.url || "";
      const pathOnly = req.path || url;
      const netlifyPrefix = "/.netlify/functions/api";
      if (url.startsWith(netlifyPrefix)) {
        url = url.slice(netlifyPrefix.length) || "/";
      }
      const needsPrefix =
        !url.startsWith("/api/") &&
        /^(\/)(workers|branches|face|liveness|verification|data|requests)(\/|$)/.test(
          url,
        );
      if (needsPrefix) url = "/api" + url;
      if (url !== req.url) req.url = url;
    } catch {}
    next();
  });

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

      // Upload snapshot to Supabase Storage (store public URL instead of base64)
      let snapshotField: string | null = null;
      const bucket = process.env.SUPABASE_BUCKET || "project";
      async function uploadDataUrlToStorage(dataUrl: string, keyHint: string) {
        try {
          const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || "");
          if (!m) return null;
          const mime = m[1];
          const b64 = m[2];
          const buf = Buffer.from(b64, "base64");
          const ext = mime.includes("jpeg")
            ? "jpg"
            : mime.includes("png")
              ? "png"
              : mime.includes("pdf")
                ? "pdf"
                : "bin";
          const key = `${keyHint}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const url = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`;
          const up = await fetch(url, {
            method: "POST",
            headers: {
              apikey: anon as string,
              Authorization: `Bearer ${service || anon}`,
              "Content-Type": mime,
              "x-upsert": "true",
            } as any,
            body: buf as any,
          });
          if (!up.ok) return null;
          const pub = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${key}`;
          return pub;
        } catch {
          return null;
        }
      }
      if (
        typeof body.snapshot === "string" &&
        body.snapshot.startsWith("data:")
      ) {
        const url = await uploadDataUrlToStorage(
          body.snapshot,
          `face_profiles/${workerId}/snapshot`,
        );
        snapshotField = url ?? null;
      }

      const save = await fetch(`${rest}/hv_face_profiles`, {
        method: "POST",
        headers: apihWrite,
        body: JSON.stringify([
          {
            worker_id: workerId,
            embedding,
            snapshot_b64:
              snapshotField ??
              (typeof body.snapshot === "string" ? body.snapshot : null),
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
      })() as { embedding?: number[]; snapshot?: string; branchId?: string };
      const hdrsIdentify = (req as any).headers || {};
      const branchId = String(
        body.branchId ?? hdrsIdentify["x-branch-id"] ?? "",
      ).trim();
      if (!body.embedding || !Array.isArray(body.embedding))
        return res
          .status(400)
          .json({ ok: false, message: "missing_embedding" });

      // Fetch profiles (optimize by branch filter when provided)
      let r: Response;
      if (branchId) {
        // 1) fetch worker ids for the branch
        const wu2 = new URL(`${rest}/hv_workers`);
        wu2.searchParams.set("select", "id");
        wu2.searchParams.set("branch_id", `eq.${branchId}`);
        wu2.searchParams.set("limit", "2000");
        const wr2 = await fetch(wu2.toString(), { headers: apih });
        const wa: Array<{ id: string }> = (await wr2
          .json()
          .catch(() => [])) as any;
        const ids = (wa || []).map((x) => x.id).filter(Boolean);
        if (ids.length === 0)
          return res
            .status(404)
            .json({ ok: false, message: "no_branch_workers" });
        // 2) fetch face profiles only for these ids using 'in' filter
        const inList = `(${ids.map((x) => x).join(",")})`;
        const fpUrl = `${rest}/hv_face_profiles?select=worker_id,embedding&worker_id=in.${encodeURIComponent(inList)}`;
        r = await fetch(fpUrl, { headers: apih });
      } else {
        r = await fetch(`${rest}/hv_face_profiles?select=worker_id,embedding`, {
          headers: apih,
        });
      }
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
      wu.searchParams.set("select", "id,name,branch_id,exit_date,status");
      wu.searchParams.set("id", `eq.${workerId}`);
      const wr = await fetch(wu.toString(), { headers: apih });
      const wj = await wr.json();
      let w = (Array.isArray(wj) ? wj[0] : null) as any;
      workerName = w?.name || null;
      if (!w) {
        // Fallback by name if id missing (rare)
        if (!workerName)
          return res
            .status(400)
            .json({ ok: false, message: "missing_match_info" });
        const u = new URL(`${rest}/hv_workers`);
        u.searchParams.set("select", "id,exit_date,status,name,branch_id");
        u.searchParams.set("name", `ilike.${workerName}`);
        u.searchParams.set("limit", "1");
        const rr = await fetch(u.toString(), { headers: apih });
        const arr2 = await rr.json();
        w = Array.isArray(arr2) ? arr2[0] : null;
        if (!w)
          return res
            .status(404)
            .json({ ok: false, message: "worker_not_found" });
      }
      if (branchId && w.branch_id !== branchId)
        return res
          .status(404)
          .json({ ok: false, message: "no_match_in_branch" });
      if (w.exit_date && w.status !== "active")
        return res.status(403).json({ ok: false, message: "worker_locked" });
      workerId = w.id;
      workerName = w.name;

      const dry = String(
        (req as any).query?.dry ?? (req as any).headers?.["x-dry"] ?? "",
      ).toLowerCase();
      if (dry === "1" || dry === "true") {
        return res.json({ ok: true, workerId, workerName, dry: true });
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

      // Ensure branch exists to avoid FK errors
      if (branchId) {
        const chk = await fetch(
          `${rest}/hv_branches?id=eq.${branchId}&select=id`,
          { headers: apihRead },
        );
        const chkJson = await chk.json().catch(() => [] as any);
        const exists = Array.isArray(chkJson) && chkJson.length > 0;
        if (!exists)
          return res
            .status(400)
            .json({ ok: false, message: "branch_not_found" });
      }

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

  // Branches: list (legacy)
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

  // Worker docs upload and pre-change cost compute
  app.post("/api/workers/docs", async (req, res) => {
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
      })() as {
        workerId?: string;
        orDataUrl?: string;
        passportDataUrl?: string;
        name?: string;
        branchId?: string;
        arrivalDate?: string | number;
      };
      const hdrs = (req as any).headers || {};
      const workerId = String(
        body.workerId || hdrs["x-worker-id"] || "",
      ).trim();
      if (!workerId)
        return res.status(400).json({
          ok: false,
          message: "missing_worker",
          debug: {
            keys: Object.keys(body || {}),
            hdrWorker: hdrs["x-worker-id"],
            orLen: (body.orDataUrl || "").length,
            passLen: (body.passportDataUrl || "").length,
          },
        });
      // Load worker
      const rw = await fetch(
        `${rest}/hv_workers?id=eq.${workerId}&select=id,arrival_date,branch_id,docs`,
        { headers: apihRead },
      );
      const arrW = await rw.json();
      let w = Array.isArray(arrW) ? arrW[0] : null;
      if (!w) {
        // Try to create the worker if payload includes minimum fields
        if (body.name && body.branchId) {
          const arrivalIso = body.arrivalDate
            ? new Date(
                Number(body.arrivalDate) ||
                  Date.parse(String(body.arrivalDate)),
              ).toISOString()
            : new Date().toISOString();
          const insW = await fetch(`${rest}/hv_workers`, {
            method: "POST",
            headers: { ...apihWrite, Prefer: "return=representation" },
            body: JSON.stringify([
              {
                id: workerId,
                name: body.name,
                branch_id: body.branchId,
                arrival_date: arrivalIso,
                status: "active",
                docs: {},
              },
            ]),
          });
          if (insW.ok) {
            try {
              const jw = await insW.json();
              w = jw?.[0] || null;
            } catch {}
          }
        }
        if (!w)
          return res
            .status(404)
            .json({ ok: false, message: "worker_not_found" });
      }

      const nowIso = new Date().toISOString();
      const docs = (w.docs || {}) as any;

      // Immutability: if a specific document already exists, do not allow re-uploading it
      if (docs.or && body.orDataUrl)
        return res.status(409).json({ ok: false, message: "doc_or_locked" });
      if (docs.passport && body.passportDataUrl)
        return res
          .status(409)
          .json({ ok: false, message: "doc_passport_locked" });

      // Apply only missing pieces (upload to Supabase Storage if possible)
      const bucket = process.env.SUPABASE_BUCKET || "project";
      async function uploadDataUrlToStorage(dataUrl: string, keyHint: string) {
        try {
          const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || "");
          if (!m) return null;
          const mime = m[1];
          const b64 = m[2];
          const buf = Buffer.from(b64, "base64");
          const ext = mime.includes("jpeg")
            ? "jpg"
            : mime.includes("png")
              ? "png"
              : mime.includes("pdf")
                ? "pdf"
                : "bin";
          const key = `${keyHint}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const url = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`;
          const up = await fetch(url, {
            method: "POST",
            headers: {
              apikey: anon as string,
              Authorization: `Bearer ${service || anon}`,
              "Content-Type": mime,
              "x-upsert": "true",
            } as any,
            body: buf as any,
          });
          if (!up.ok) return null;
          const pub = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${key}`;
          return pub;
        } catch {
          return null;
        }
      }
      if (!docs.or && body.orDataUrl) {
        const url = await uploadDataUrlToStorage(
          body.orDataUrl,
          `workers/${workerId}/or`,
        );
        docs.or = url || body.orDataUrl;
      }
      if (!docs.passport && body.passportDataUrl) {
        const url = await uploadDataUrlToStorage(
          body.passportDataUrl,
          `workers/${workerId}/passport`,
        );
        docs.passport = url || body.passportDataUrl;
      }
      // Keep plan unchanged; moving from no_expense to with_expense is manual via /api/workers/plan

      // Fixed residency rate
      const rate = 220;

      // Compute pre-change only once (at first document upload)
      let cost = 0,
        days = 0;
      let verificationId: string | null = null;
      const plan = (docs?.plan as string) || (w.docs?.plan as string) || "";
      const hadPre = !!docs.pre_change;
      if (!hadPre && (docs.or || docs.passport)) {
        const arrivalTs = w.arrival_date
          ? new Date(w.arrival_date).getTime()
          : Date.now();
        const nowTs = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;
        days = Math.max(1, Math.ceil((nowTs - arrivalTs) / msPerDay));
        cost = days * rate;

        // For no_expense plan, create a verification with the computed amount
        if ((plan || "no_expense") === "no_expense" && cost > 0) {
          const insV = await fetch(`${rest}/hv_verifications`, {
            method: "POST",
            headers: { ...apihWrite, Prefer: "return=representation" },
            body: JSON.stringify([
              {
                worker_id: workerId,
                verified_at: nowIso,
                payment_amount: cost,
                payment_saved_at: nowIso,
              },
            ]),
          });
          if (insV.ok) {
            try {
              const jv = await insV.json();
              verificationId = jv?.[0]?.id || null;
            } catch {}
          }
          if (verificationId) {
            await fetch(`${rest}/hv_payments`, {
              method: "POST",
              headers: apihWrite,
              body: JSON.stringify([
                {
                  worker_id: workerId,
                  verification_id: verificationId,
                  amount: cost,
                  saved_at: nowIso,
                },
              ]),
            });
          }
        }
        docs.pre_change = {
          days,
          rate,
          cost,
          at: nowIso,
          verification_id: verificationId,
        };
      }

      const up = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs }),
      });
      if (!up.ok) {
        const t = await up.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }
      return res.json({ ok: true, cost, days, rate });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Worker exit: set exit date/reason and, if plan is no_expense, charge for residency up to exit
  app.post("/api/workers/exit", async (req, res) => {
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
      })() as {
        workerId?: string;
        exitDate?: string | number;
        reason?: string;
      };
      const hdrs = (req as any).headers || {};
      const workerId = String(
        body.workerId ?? hdrs["x-worker-id"] ?? "",
      ).trim();
      const exitRaw = body.exitDate ?? hdrs["x-exit-date"] ?? "";
      const reason = String(body.reason ?? hdrs["x-reason"] ?? "");
      if (!workerId || exitRaw == null)
        return res.status(400).json({ ok: false, message: "invalid_payload" });
      const exitTs = Number(exitRaw) || Date.parse(String(exitRaw));
      if (!Number.isFinite(exitTs) || exitTs <= 0)
        return res.status(400).json({ ok: false, message: "invalid_exit" });
      const exitIso = new Date(exitTs).toISOString();

      // Load worker
      const rw = await fetch(
        `${rest}/hv_workers?id=eq.${workerId}&select=id,arrival_date,branch_id,docs,status`,
        { headers: apihRead },
      );
      const arrW = await rw.json();
      const w = Array.isArray(arrW) ? arrW[0] : null;
      if (!w)
        return res.status(404).json({ ok: false, message: "worker_not_found" });

      // Update worker exit
      const upW = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({
          exit_date: exitIso,
          exit_reason: reason,
          status: "exited",
        }),
      });
      if (!upW.ok) {
        const t = await upW.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }

      const docs = (w.docs || {}) as any;
      const plan = (docs.plan as string) || "with_expense";
      if (plan !== "no_expense") return res.json({ ok: true, charged: false });

      // Fixed residency rate
      const rate = 220;

      // Compute days and cost from arrival to exit
      const arrivalTs = w.arrival_date
        ? new Date(w.arrival_date).getTime()
        : Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;
      const days = Math.max(1, Math.ceil((exitTs - arrivalTs) / msPerDay));
      const cost = days * rate;

      if (cost > 0) {
        // Create verification and payment
        let verificationId: string | null = null;
        const insV = await fetch(`${rest}/hv_verifications`, {
          method: "POST",
          headers: { ...apihWrite, Prefer: "return=representation" },
          body: JSON.stringify([
            {
              worker_id: workerId,
              verified_at: exitIso,
              payment_amount: cost,
              payment_saved_at: exitIso,
            },
          ]),
        });
        if (insV.ok) {
          try {
            const jv = await insV.json();
            verificationId = jv?.[0]?.id || null;
          } catch {}
        }
        if (verificationId) {
          await fetch(`${rest}/hv_payments`, {
            method: "POST",
            headers: apihWrite,
            body: JSON.stringify([
              {
                worker_id: workerId,
                verification_id: verificationId,
                amount: cost,
                saved_at: exitIso,
              },
            ]),
          });
        }
      }
      return res.json({ ok: true, charged: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Worker plan update (merges with existing docs, preserving uploaded files and metadata)
  app.post("/api/workers/plan", async (req, res) => {
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
      })() as { workerId?: string; plan?: string };
      const hdrs = (req as any).headers || {};
      const workerId = String(
        body.workerId ?? hdrs["x-worker-id"] ?? "",
      ).trim();
      const plan = String(body.plan ?? hdrs["x-plan"] ?? "").trim();
      if (!workerId || !plan)
        return res.status(400).json({
          ok: false,
          message: "invalid_payload",
          debug: {
            keys: Object.keys(body || {}),
            hdrWorker: hdrs["x-worker-id"],
            hdrPlan: hdrs["x-plan"],
          },
        });

      // Read current docs to merge
      let currentDocs: any = {};
      try {
        const rr = await fetch(
          `${rest}/hv_workers?id=eq.${workerId}&select=docs`,
          { headers: apihRead },
        );
        if (rr.ok) {
          const a = await rr.json();
          currentDocs = (Array.isArray(a) && a[0]?.docs) || {};
        }
      } catch {}
      const merged = { ...(currentDocs || {}), plan };

      const up = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: merged }),
      });
      if (!up.ok) {
        const t = await up.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Worker docs patch (merge arbitrary JSON fields into docs)
  app.post("/api/workers/docs/patch", async (req, res) => {
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
      })() as { workerId?: string; patch?: Record<string, any> };
      const workerId = String(body.workerId || "").trim();
      const patch = (body.patch || {}) as Record<string, any>;
      if (!workerId || !patch || typeof patch !== "object")
        return res.status(400).json({ ok: false, message: "invalid_payload" });

      // Read current docs
      let currentDocs: any = {};
      try {
        const rr = await fetch(
          `${rest}/hv_workers?id=eq.${workerId}&select=docs`,
          {
            headers: apihRead,
          },
        );
        if (rr.ok) {
          const a = await rr.json();
          currentDocs = (Array.isArray(a) && a[0]?.docs) || {};
        }
      } catch {}
      const merged = { ...(currentDocs || {}), ...(patch || {}) };

      const up = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: merged }),
      });
      if (!up.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await up.text()) || "update_failed" });
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Special requests: list for a branch
  app.get("/api/requests", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const branchId = String(
        (req.query as any)?.branchId || (req.query as any)?.id || "",
      );
      if (!branchId)
        return res
          .status(400)
          .json({ ok: false, message: "missing_branch_id" });
      const r = await fetch(
        `${rest}/hv_branches?id=eq.${branchId}&select=docs`,
        { headers: apihRead },
      );
      const j = await r.json();
      const docs = Array.isArray(j) && j[0]?.docs ? j[0].docs : {};
      const items = Array.isArray(docs?.special_requests)
        ? docs.special_requests
        : [];
      return res.json({ ok: true, items });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Special requests: add
  app.post("/api/requests", async (req, res) => {
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
      ) as any;
      const branchId = String(body.branchId || body.id || "").trim();
      const item = body.item || {};
      if (!branchId || !item)
        return res.status(400).json({ ok: false, message: "invalid_payload" });
      const r = await fetch(
        `${rest}/hv_branches?id=eq.${branchId}&select=docs`,
        { headers: apihRead },
      );
      const j = await r.json();
      const docs = (Array.isArray(j) && j[0]?.docs) || {};
      const list = Array.isArray(docs.special_requests)
        ? docs.special_requests
        : [];
      const id =
        item.id ||
        globalThis.crypto?.randomUUID?.() ||
        Math.random().toString(36).slice(2);
      const createdAt = item.createdAt || new Date().toISOString();
      // Upload any data URLs to Supabase Storage
      const bucket = process.env.SUPABASE_BUCKET || "project";
      async function uploadDataUrlToStorage(dataUrl: string, keyHint: string) {
        try {
          const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || "");
          if (!m) return null;
          const mime = m[1];
          const b64 = m[2];
          const buf = Buffer.from(b64, "base64");
          const ext = mime.includes("jpeg")
            ? "jpg"
            : mime.includes("png")
              ? "png"
              : mime.includes("pdf")
                ? "pdf"
                : "bin";
          const key = `${keyHint}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const url = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`;
          const up = await fetch(url, {
            method: "POST",
            headers: {
              apikey: anon as string,
              Authorization: `Bearer ${service || anon}`,
              "Content-Type": mime,
              "x-upsert": "true",
            } as any,
            body: buf as any,
          });
          if (!up.ok) return null;
          const pub = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${key}`;
          return pub;
        } catch {
          return null;
        }
      }
      const nextItem: any = { ...item, id, createdAt };
      if (
        typeof nextItem.imageDataUrl === "string" &&
        nextItem.imageDataUrl.startsWith("data:")
      ) {
        const url = await uploadDataUrlToStorage(
          nextItem.imageDataUrl,
          `requests/${branchId}/${id}-image`,
        );
        if (url) nextItem.imageDataUrl = url;
      }
      if (
        typeof nextItem.attachmentDataUrl === "string" &&
        nextItem.attachmentDataUrl.startsWith("data:")
      ) {
        const url = await uploadDataUrlToStorage(
          nextItem.attachmentDataUrl,
          `requests/${branchId}/${id}-attachment`,
        );
        if (url) nextItem.attachmentDataUrl = url;
      }
      const merged = [...list, nextItem];
      const up = await fetch(`${rest}/hv_branches?id=eq.${branchId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: { ...docs, special_requests: merged } }),
      });
      if (!up.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await up.text()) || "update_failed" });
      return res.json({ ok: true, item: { ...item, id, createdAt } });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Special requests: update by id
  app.post("/api/requests/update", async (req, res) => {
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
      ) as any;
      const branchId = String(body.branchId || body.id || "").trim();
      const reqId = String(
        body.requestId || body.reqId || body.rid || "",
      ).trim();
      const patch = body.patch || {};
      if (!branchId || !reqId)
        return res.status(400).json({ ok: false, message: "invalid_payload" });
      const r = await fetch(
        `${rest}/hv_branches?id=eq.${branchId}&select=docs`,
        { headers: apihRead },
      );
      const j = await r.json();
      const docs = (Array.isArray(j) && j[0]?.docs) || {};
      const list = Array.isArray(docs.special_requests)
        ? docs.special_requests
        : [];
      const next = list.map((x: any) =>
        x.id === reqId ? { ...x, ...patch } : x,
      );
      const up = await fetch(`${rest}/hv_branches?id=eq.${branchId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: { ...docs, special_requests: next } }),
      });
      if (!up.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await up.text()) || "update_failed" });
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branch rate get/set
  app.get("/api/branches/rate", async (req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const id = String((req.query as any)?.id || "").trim();
      if (!id)
        return res.status(400).json({ ok: false, message: "missing_id" });
      // Always return fixed rate
      return res.json({ ok: true, rate: 220 });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });
  app.post("/api/branches/rate", async (req, res) => {
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
      const raw = (req as any).body ?? {};
      let body: any = raw;
      if (typeof raw === "string") {
        try {
          body = JSON.parse(raw);
        } catch {
          body = {};
        }
      } else if (
        raw &&
        typeof raw === "object" &&
        (raw as any).type === "Buffer" &&
        Array.isArray((raw as any).data)
      ) {
        try {
          body = JSON.parse(Buffer.from((raw as any).data).toString("utf8"));
        } catch {
          body = {};
        }
      }
      const hdrs = (req as any).headers || {};
      const q = (req as any).query || {};
      const idRaw = body.id ?? hdrs["x-id"] ?? q.id;
      const rateRaw = body.rate ?? hdrs["x-rate"] ?? q.rate;
      const id = String(idRaw || "").trim();
      if (!id)
        return res.status(400).json({ ok: false, message: "invalid_payload" });
      // Persist fixed rate = 220 in branch docs for consistency
      const rr = await fetch(`${rest}/hv_branches?id=eq.${id}&select=docs`, {
        headers: apihRead,
      });
      const arr = await rr.json();
      const docs = Array.isArray(arr) && arr[0]?.docs ? arr[0].docs : {};
      const merged = { ...docs, residency_rate: 220 };
      const up = await fetch(`${rest}/hv_branches?id=eq.${id}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: merged }),
      });
      if (!up.ok) {
        const t = await up.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }
      return res.json({ ok: true, rate: 220 });
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

  // Read branches (server-side proxy to Supabase)
  app.get("/api/data/branches", async (_req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const r = await fetch(`${rest}/hv_branches?select=id,name`, { headers });
      if (!r.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await r.text()) || "load_failed" });
      const branches = await r.json();
      return res.json({ ok: true, branches });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Read workers list (server-side proxy to Supabase)
  app.get("/api/data/workers", async (_req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const u = new URL(`${rest}/hv_workers`);
      u.searchParams.set(
        "select",
        "id,name,arrival_date,branch_id,docs,exit_date,exit_reason,status",
      );
      const r = await fetch(u.toString(), { headers });
      if (!r.ok) {
        return res
          .status(500)
          .json({ ok: false, message: (await r.text()) || "load_failed" });
      }
      const workers = await r.json();
      return res.json({ ok: true, workers });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Read verifications list (server-side proxy to Supabase)
  app.get("/api/data/verifications", async (_req, res) => {
    try {
      const supaUrl = process.env.VITE_SUPABASE_URL;
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const u = new URL(`${rest}/hv_verifications`);
      u.searchParams.set(
        "select",
        "id,worker_id,verified_at,payment_amount,payment_saved_at",
      );
      const r = await fetch(u.toString(), { headers });
      if (!r.ok) {
        return res
          .status(500)
          .json({ ok: false, message: (await r.text()) || "load_failed" });
      }
      const verifications = await r.json();
      return res.json({ ok: true, verifications });
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
      const region =
        process.env.SERVER_AWS_REGION ||
        process.env.VITE_AWS_REGION ||
        process.env.AWS_REGION;
      const accessKeyId =
        process.env.SERVER_AWS_ACCESS_KEY_ID ||
        process.env.VITE_AWS_ACCESS_KEY_ID ||
        process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey =
        process.env.SERVER_AWS_SECRET_ACCESS_KEY ||
        process.env.VITE_AWS_SECRET_ACCESS_KEY ||
        process.env.AWS_SECRET_ACCESS_KEY;
      const sessionToken =
        process.env.SERVER_AWS_SESSION_TOKEN ||
        process.env.VITE_AWS_SESSION_TOKEN ||
        process.env.AWS_SESSION_TOKEN;
      if (!region || !accessKeyId || !secretAccessKey)
        return res.status(500).json({ ok: false, message: "missing_aws_env" });
      const client = new RekognitionClient({
        region,
        credentials: { accessKeyId, secretAccessKey, sessionToken },
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
      const region =
        process.env.SERVER_AWS_REGION ||
        process.env.VITE_AWS_REGION ||
        process.env.AWS_REGION;
      const accessKeyId =
        process.env.SERVER_AWS_ACCESS_KEY_ID ||
        process.env.VITE_AWS_ACCESS_KEY_ID ||
        process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey =
        process.env.SERVER_AWS_SECRET_ACCESS_KEY ||
        process.env.VITE_AWS_SECRET_ACCESS_KEY ||
        process.env.AWS_SECRET_ACCESS_KEY;
      const sessionToken =
        process.env.SERVER_AWS_SESSION_TOKEN ||
        process.env.VITE_AWS_SESSION_TOKEN ||
        process.env.AWS_SESSION_TOKEN;
      if (!region || !accessKeyId || !secretAccessKey)
        return res.status(500).json({ ok: false, message: "missing_aws_env" });
      const body = (req.body ?? {}) as { sessionId?: string };
      if (!body.sessionId)
        return res
          .status(400)
          .json({ ok: false, message: "missing_session_id" });
      const client = new RekognitionClient({
        region,
        credentials: { accessKeyId, secretAccessKey, sessionToken },
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

  // Face compare (fallback to support non-Netlify hosting)
  app.post("/api/face/compare", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        sourceImageB64?: string;
        targetImageB64?: string;
        workerId?: string;
        similarityThreshold?: number;
      };
      if (!body?.sourceImageB64)
        return res
          .status(400)
          .json({ ok: false, message: "missing_source_image" });

      // Fetch target snapshot if not provided
      let target = body.targetImageB64;
      if (!target && body.workerId) {
        const supaUrl = process.env.VITE_SUPABASE_URL as string | undefined;
        const anon = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;
        if (!supaUrl || !anon)
          return res
            .status(500)
            .json({ ok: false, message: "supabase_env_missing" });
        const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
        const u = new URL(`${rest}/hv_face_profiles`);
        u.searchParams.set("select", "snapshot_b64,created_at");
        u.searchParams.set("worker_id", `eq.${body.workerId}`);
        u.searchParams.set("order", "created_at.desc");
        u.searchParams.set("limit", "1");
        const r = await fetch(u.toString(), {
          headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        });
        if (!r.ok)
          return res
            .status(404)
            .json({ ok: false, message: "no_registered_face" });
        const arr = (await r.json()) as Array<{ snapshot_b64?: string | null }>;
        let snap =
          Array.isArray(arr) && arr[0]?.snapshot_b64
            ? String(arr[0].snapshot_b64)
            : undefined;
        if (snap && !snap.startsWith("data:")) {
          try {
            const rr2 = await fetch(snap);
            const ct = rr2.headers.get("content-type") || "image/jpeg";
            const ab = await rr2.arrayBuffer();
            const b64 = Buffer.from(new Uint8Array(ab)).toString("base64");
            snap = `data:${ct};base64,${b64}`;
          } catch {}
        }
        target = snap;
        if (!target)
          return res
            .status(404)
            .json({ ok: false, message: "no_registered_face" });
      }

      const sanitize = (v?: string) =>
        (v || "").replace(/^['\"]+|['\"]+$/g, "").trim() || undefined;
      const region = sanitize(
        (process.env.SERVER_AWS_REGION ||
          process.env.VITE_AWS_REGION ||
          process.env.AWS_REGION) as string | undefined,
      );
      const accessKeyId = sanitize(
        (process.env.SERVER_AWS_ACCESS_KEY_ID ||
          process.env.VITE_AWS_ACCESS_KEY_ID ||
          process.env.AWS_ACCESS_KEY_ID) as string | undefined,
      );
      const secretAccessKey = sanitize(
        (process.env.SERVER_AWS_SECRET_ACCESS_KEY ||
          process.env.VITE_AWS_SECRET_ACCESS_KEY ||
          process.env.AWS_SECRET_ACCESS_KEY) as string | undefined,
      );
      const sessionToken = sanitize(
        (process.env.SERVER_AWS_SESSION_TOKEN ||
          process.env.VITE_AWS_SESSION_TOKEN ||
          process.env.AWS_SESSION_TOKEN) as string | undefined,
      );
      if (!region || !accessKeyId || !secretAccessKey)
        return res.status(500).json({ ok: false, message: "missing_aws_env" });

      const client = new RekognitionClient({
        region,
        credentials: { accessKeyId, secretAccessKey, sessionToken },
      });
      const cmd = new CompareFacesCommand({
        SourceImage: {
          Bytes: Buffer.from(
            String(body.sourceImageB64).split(",").pop()!,
            "base64",
          ),
        },
        TargetImage: {
          Bytes: Buffer.from(String(target).split(",").pop()!, "base64"),
        },
        SimilarityThreshold:
          body.similarityThreshold != null
            ? Number(body.similarityThreshold)
            : 80,
      });
      const out = await client.send(cmd);
      const match = out?.FaceMatches?.[0];
      const similarity = (match?.Similarity as number) || 0;
      const success =
        similarity >=
        (body.similarityThreshold != null
          ? Number(body.similarityThreshold)
          : 80);

      // On success, insert verification and patch face log
      if (success && body.workerId) {
        const supaUrl = process.env.VITE_SUPABASE_URL as string | undefined;
        const anon = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;
        const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.SUPABASE_SERVICE_ROLE ||
          process.env.SUPABASE_SERVICE_KEY ||
          "") as string;
        if (supaUrl && anon) {
          const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
          const headers = {
            apikey: anon,
            Authorization: `Bearer ${service || anon}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          } as Record<string, string>;
          const now = new Date().toISOString();
          await fetch(`${rest}/hv_verifications`, {
            method: "POST",
            headers,
            body: JSON.stringify([
              { worker_id: body.workerId, verified_at: now },
            ]),
          });
          // Patch docs.face_last
          try {
            const r0 = await fetch(
              `${rest}/hv_workers?id=eq.${body.workerId}&select=docs`,
              { headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
            );
            const j0 = await r0.json().catch(() => [] as any[]);
            const current = Array.isArray(j0) && j0[0]?.docs ? j0[0].docs : {};
            const next = {
              ...(current || {}),
              face_last: { similarity, at: now, method: "aws_compare" },
            };
            await fetch(`${rest}/hv_workers?id=eq.${body.workerId}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ docs: next }),
            });
          } catch {}
        }
      }

      return res.json({
        ok: true,
        success,
        similarity,
        workerId: body.workerId || null,
      });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  return app;
}
