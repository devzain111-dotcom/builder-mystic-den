import "dotenv/config";
// Force Netlify redeploy - incomplete applicants fix v2
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

  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  const SUPABASE_SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  // Server-side cache for branch and worker docs with request coalescing
  // In-flight requests map to deduplicate simultaneous identical requests
  const inFlightRequests = new Map<string, Promise<any>>();
  const docsCache = new Map<string, { data: any; timestamp: number }>();
  const responseCache = new Map<
    string,
    { data: any; timestamp: number; etag?: string }
  >();
  const profilesCache = new Map<string, { data: any; timestamp: number }>();
  const verificationsCache = new Map<
    string,
    { data: any; timestamp: number; etag?: string }
  >();
  const DOCS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes - long TTL to minimize repeated queries
  const BRANCH_DOCS_CACHE_TTL = 60 * 60 * 1000; // 60 minutes for branch docs (rarely change)
  const RESPONSE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for endpoint responses to reduce Supabase load
  const PROFILES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for face profiles cache
  const VERIFICATIONS_CACHE_TTL = 30 * 1000; // 30 seconds for verifications (short because amounts change frequently)

  function getCachedDocs(key: string): any | null {
    const cached = docsCache.get(key);
    const now = Date.now();
    const ttl = key.startsWith("branch:")
      ? BRANCH_DOCS_CACHE_TTL
      : DOCS_CACHE_TTL;
    if (cached && now - cached.timestamp < ttl) {
      console.log(`[ServerCache] Hit for ${key}`);
      return cached.data;
    }
    return null;
  }

  function setCachedDocs(key: string, data: any) {
    docsCache.set(key, { data, timestamp: Date.now() });
  }

  function getCachedResponse(key: string): any | null {
    const cached = responseCache.get(key);
    const now = Date.now();
    if (cached && now - cached.timestamp < RESPONSE_CACHE_TTL) {
      console.log(`[ResponseCache] Hit for ${key}`);
      return cached.data;
    }
    return null;
  }

  function setCachedResponse(key: string, data: any) {
    responseCache.set(key, { data, timestamp: Date.now() });
  }

  function invalidateWorkersCache() {
    responseCache.delete("workers-list");
    responseCache.delete("workers-docs");
    responseCache.delete("verifications-list");
    profilesCache.clear();
    clearCachedVerifications();
    console.log(
      "[CacheInvalidation] Cleared workers-related caches, verifications, and face profiles",
    );
  }

  // Request coalescing: if a request is in-flight, return the same promise
  function getCoalescedRequest<T>(
    key: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const existing = inFlightRequests.get(key);
    if (existing) {
      console.log(`[RequestCoalesce] Reusing in-flight request for ${key}`);
      return existing;
    }
    const promise = fetcher().finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, promise);
    return promise;
  }

  // Aliases for backward compatibility and helper for fetching docs with coalescing
  function getCachedBranchDocs(branchId: string): any | null {
    return getCachedDocs(`branch:${branchId}`);
  }

  function setCachedBranchDocs(branchId: string, data: any) {
    setCachedDocs(`branch:${branchId}`, data);
  }

  function getCachedWorkerDocs(workerId: string): any | null {
    return getCachedDocs(`worker:${workerId}`);
  }

  function setCachedWorkerDocs(workerId: string, data: any) {
    setCachedDocs(`worker:${workerId}`, data);
  }

  function clearCachedWorkerDocs(workerId: string) {
    docsCache.delete(`worker:${workerId}`);
  }

  function getCachedProfiles(branchId: string | null): any | null {
    const key = branchId ? `profiles:${branchId}` : "profiles:all";
    const cached = profilesCache.get(key);
    const now = Date.now();
    if (cached && now - cached.timestamp < PROFILES_CACHE_TTL) {
      console.log(`[ProfileCache] Hit for ${key}`);
      return cached.data;
    }
    return null;
  }

  function setCachedProfiles(branchId: string | null, data: any) {
    const key = branchId ? `profiles:${branchId}` : "profiles:all";
    profilesCache.set(key, { data, timestamp: Date.now() });
  }

  function clearCachedProfiles(branchId: string | null = null) {
    if (branchId) {
      profilesCache.delete(`profiles:${branchId}`);
    } else {
      profilesCache.clear();
    }
  }

  function getCachedVerifications(key: string): any | null {
    const cached = verificationsCache.get(key);
    const now = Date.now();
    if (cached && now - cached.timestamp < VERIFICATIONS_CACHE_TTL) {
      console.log(`[VerificationsCache] Hit for ${key}`);
      return cached;
    }
    return null;
  }

  function setCachedVerifications(key: string, data: any, etag?: string) {
    verificationsCache.set(key, { data, timestamp: Date.now(), etag });
  }

  function clearCachedVerifications() {
    verificationsCache.clear();
    console.log("[CacheInvalidation] Cleared verifications cache");
  }

  // Fetch branch docs with request coalescing and caching
  async function fetchBranchDocs(branchId: string): Promise<any> {
    const cached = getCachedBranchDocs(branchId);
    if (cached) return cached;

    const result = await getCoalescedRequest(
      `branch-docs:${branchId}`,
      async () => {
        const supaUrl = SUPABASE_URL;
        const anon = SUPABASE_ANON_KEY;
        if (!supaUrl || !anon) return {};

        const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
        const headers = {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        };

        const rb = await fetch(
          `${rest}/hv_branches?id=eq.${branchId}&select=docs`,
          { headers },
        );
        if (!rb.ok) return {};
        const arr = await rb.json();
        const branch = Array.isArray(arr) ? arr[0] : null;
        let docs: any = {};
        if (branch?.docs) {
          try {
            docs =
              typeof branch.docs === "string"
                ? JSON.parse(branch.docs)
                : branch.docs;
          } catch {
            docs = {};
          }
        }
        setCachedBranchDocs(branchId, docs);
        return docs;
      },
    );
    return result;
  }

  async function fetchWorkerDocs(workerId: string): Promise<any> {
    const cached = getCachedWorkerDocs(workerId);
    if (cached) return cached;

    const result = await getCoalescedRequest(
      `worker-docs:${workerId}`,
      async () => {
        const supaUrl = SUPABASE_URL;
        const anon = SUPABASE_ANON_KEY;
        if (!supaUrl || !anon) return {};

        const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
        const headers = {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        };

        const rr = await fetch(
          `${rest}/hv_workers?id=eq.${workerId}&select=docs`,
          { headers },
        );
        if (!rr.ok) return {};
        const a = await rr.json();
        let docs: any = {};
        if (Array.isArray(a) && a[0]?.docs) {
          try {
            docs =
              typeof a[0].docs === "string" ? JSON.parse(a[0].docs) : a[0].docs;
          } catch {
            docs = {};
          }
        }
        setCachedWorkerDocs(workerId, docs);
        return docs;
      },
    );
    return result;
  }

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      supabaseUrl: !!(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
      ),
      supabaseAnonKey: !!(
        process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
      ),
    });
  });

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
            "Content-Type": "application/json; charset=utf-8",
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

  // Set UTF-8 charset for all JSON responses
  app.use((req, res, next) => {
    const originalJson = res.json;
    res.json = function (data: any) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return originalJson.call(this, data);
    };
    next();
  });

  app.use((_, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(self)");
    next();
  });

  // Body parsing - MUST be first
  app.use(express.json({ limit: "10mb" }));
  app.use(express.text({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Log all POST requests
  app.use((req, res, next) => {
    if (req.method === "POST") {
      console.log(`[${req.method}] ${req.path}`, {
        body: (req as any).body,
        contentType: req.get("content-type"),
        contentLength: req.get("content-length"),
      });
    }
    next();
  });

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
    const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon =
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const service = SUPABASE_SERVICE_ROLE;
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Identify by face embedding sent from browser and write verification
  app.post("/api/face/identify", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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

      // Fetch profiles (optimize by branch filter when provided, with caching)
      let arr: Array<{ worker_id: string; embedding: number[] | any }> = [];

      // Check cache first
      const cachedProfiles = getCachedProfiles(branchId);
      if (cachedProfiles) {
        console.log(
          "[CompareFaces] Using cached profiles for",
          branchId || "all branches",
        );
        arr = cachedProfiles;
      } else {
        let r: Response | null = null;
        const PROFILE_FETCH_TIMEOUT = 15000; // 15 second timeout for profile fetches

        if (branchId) {
          // 1) fetch worker ids for the branch - limited to 500 to reduce resource consumption
          const wu2 = new URL(`${rest}/hv_workers`);
          wu2.searchParams.set("select", "id");
          wu2.searchParams.set("branch_id", `eq.${branchId}`);
          wu2.searchParams.set("limit", "500");
          wu2.searchParams.set("order", "created_at.desc");

          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(
            () => controller2.abort(),
            PROFILE_FETCH_TIMEOUT,
          );
          try {
            const wr2 = await fetch(wu2.toString(), {
              headers: apih,
              signal: controller2.signal,
            });
            clearTimeout(timeoutId2);
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
            const controller3 = new AbortController();
            const timeoutId3 = setTimeout(
              () => controller3.abort(),
              PROFILE_FETCH_TIMEOUT,
            );
            try {
              r = await fetch(fpUrl, {
                headers: apih,
                signal: controller3.signal,
              });
              clearTimeout(timeoutId3);
            } catch (e) {
              clearTimeout(timeoutId3);
              throw e;
            }
          } catch (e) {
            clearTimeout(timeoutId2);
            throw e;
          }
        } else {
          const controller4 = new AbortController();
          const timeoutId4 = setTimeout(
            () => controller4.abort(),
            PROFILE_FETCH_TIMEOUT,
          );
          try {
            r = await fetch(
              `${rest}/hv_face_profiles?select=worker_id,embedding&limit=500`,
              {
                headers: apih,
                signal: controller4.signal,
              },
            );
            clearTimeout(timeoutId4);
          } catch (e) {
            clearTimeout(timeoutId4);
            throw e;
          }
        }
        if (!r || !r.ok) {
          const t = r ? await r.text() : "timeout";
          return res
            .status(500)
            .json({ ok: false, message: t || "load_profiles_failed" });
        }
        arr = await r.json();
        // Cache the profiles
        setCachedProfiles(branchId, arr);
      }
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
      wu.searchParams.set("select", "id,name,branch_id,exit_date,status,docs");
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

      // Check verification settings for the branch
      if (w.branch_id) {
        try {
          const branchSettingsUrl = new URL(`${rest}/hv_branches`);
          branchSettingsUrl.searchParams.set("select", "docs");
          branchSettingsUrl.searchParams.set("id", `eq.${w.branch_id}`);
          const branchSettingsRes = await fetch(branchSettingsUrl.toString(), {
            headers: apih,
          });
          if (branchSettingsRes.ok) {
            const branchSettingsData = await branchSettingsRes.json();
            const branchDocs = Array.isArray(branchSettingsData)
              ? branchSettingsData[0]?.docs
              : null;
            const parsedDocs =
              typeof branchDocs === "string"
                ? JSON.parse(branchDocs)
                : branchDocs;

            // If verification is locked (not open) and worker doesn't have passport, deny
            if (parsedDocs?.verificationOpen === false) {
              // Parse worker docs to check for passport
              let workerDocs: any = {};
              if (w?.docs) {
                try {
                  const docs =
                    typeof w.docs === "string" ? JSON.parse(w.docs) : w.docs;
                  workerDocs = docs || {};
                } catch {}
              }

              if (!workerDocs.passport) {
                return res.status(403).json({
                  ok: false,
                  message: "passport_required",
                  errorCode: "PASSPORT_REQUIRED_FOR_VERIFICATION",
                });
              }
            }
          }
        } catch (e) {
          console.warn(
            "[/api/face/identify] Failed to check branch verification settings:",
            e,
          );
        }
      }

      const dry = String(
        (req as any).query?.dry ?? (req as any).headers?.["x-dry"] ?? "",
      ).toLowerCase();
      if (dry === "1" || dry === "true") {
        // Parse docs field to extract or and passport info
        let workerDocs: any = {};

        console.log("[/api/face/identify] Dry mode - checking docs for:", {
          workerId: workerId.slice(0, 8),
          hasDocsField: !!w?.docs,
          docsType: typeof w?.docs,
          docsValue: String(w?.docs || "").slice(0, 100),
        });

        if (w?.docs) {
          try {
            const docs =
              typeof w.docs === "string" ? JSON.parse(w.docs) : w.docs;

            console.log("[/api/face/identify] Parsed docs:", {
              workerId: workerId.slice(0, 8),
              docsKeys: Object.keys(docs || {}),
              hasOr: !!docs?.or,
              hasPassport: !!docs?.passport,
            });

            if (docs?.or) workerDocs.or = docs.or;
            if (docs?.passport) workerDocs.passport = docs.passport;
            if (docs?.plan) workerDocs.plan = docs.plan;
          } catch (e) {
            console.warn("[/api/face/identify] Failed to parse docs:", {
              workerId: workerId.slice(0, 8),
              error: String(e),
              docsValue: String(w?.docs || "").slice(0, 100),
            });
          }
        } else {
          console.warn("[/api/face/identify] No docs found for worker:", {
            workerId: workerId.slice(0, 8),
            workerName,
          });

          // Try to fetch full docs separately if not included in initial response
          try {
            const docsUrl = new URL(`${rest}/hv_workers`);
            docsUrl.searchParams.set("select", "docs");
            docsUrl.searchParams.set("id", `eq.${workerId}`);
            const docsRes = await fetch(docsUrl.toString(), { headers: apih });
            if (docsRes.ok) {
              const docsArr = await docsRes.json();
              const freshDocs = Array.isArray(docsArr)
                ? docsArr[0]?.docs
                : null;
              if (freshDocs) {
                try {
                  const docs =
                    typeof freshDocs === "string"
                      ? JSON.parse(freshDocs)
                      : freshDocs;
                  console.log("[/api/face/identify] Fetched docs separately:", {
                    workerId: workerId.slice(0, 8),
                    hasOr: !!docs?.or,
                    hasPassport: !!docs?.passport,
                  });
                  if (docs?.or) workerDocs.or = docs.or;
                  if (docs?.passport) workerDocs.passport = docs.passport;
                  if (docs?.plan) workerDocs.plan = docs.plan;
                } catch (parseErr) {
                  console.warn(
                    "[/api/face/identify] Failed to parse fetched docs:",
                    {
                      workerId: workerId.slice(0, 8),
                      error: String(parseErr),
                    },
                  );
                }
              }
            }
          } catch (err) {
            console.warn(
              "[/api/face/identify] Failed to fetch docs separately:",
              err,
            );
          }
        }

        console.log("[/api/face/identify] Final workerDocs:", {
          workerId: workerId.slice(0, 8),
          hasOr: !!workerDocs.or,
          hasPassport: !!workerDocs.passport,
          complete: !!(workerDocs.or || workerDocs.passport),
        });

        return res.json({
          ok: true,
          workerId,
          workerName,
          workerDocs,
          workerPlan: workerDocs?.plan,
          dry: true,
        });
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
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Get paginated workers for a specific branch (Load on Demand)
  app.get("/api/workers/branch/:branchId", async (req, res) => {
    try {
      const branchId = req.params.branchId;
      console.log(
        "[GET /api/workers/branch] Request received for branch:",
        branchId?.slice?.(0, 8),
      );

      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) {
        console.warn(
          "[GET /api/workers/branch] Missing Supabase env, using fallback",
        );
        // Return fallback demo workers immediately if no Supabase config
        const demoWorkers = [
          {
            id: "worker-001",
            name: "أحمد محمد",
            arrival_date: "2024-01-15T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone A",
            docs: JSON.stringify({ plan: "no_expense" }),
          },
          {
            id: "worker-002",
            name: "فاطمة علي",
            arrival_date: "2024-02-20T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone B",
            docs: JSON.stringify({ plan: "with_expense" }),
          },
          {
            id: "worker-003",
            name: "محمود حسن",
            arrival_date: "2024-01-10T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone A",
            docs: JSON.stringify({ plan: "no_expense" }),
          },
          {
            id: "worker-004",
            name: "نور الدين",
            arrival_date: "2024-03-05T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone C",
            docs: JSON.stringify({ plan: "with_expense" }),
          },
        ];
        return res.status(200).json({
          ok: true,
          data: demoWorkers,
          workers: demoWorkers,
          total: demoWorkers.length,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        });
      }

      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      };

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.max(
        10,
        Math.min(100, parseInt(req.query.pageSize as string) || 50),
      );

      if (!branchId) {
        return res.json({
          ok: false,
          message: "missing_branchId",
          data: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        });
      }

      // Calculate offset
      const offset = (page - 1) * pageSize;

      // Get total count for this branch
      const countUrl = new URL(`${rest}/hv_workers`);
      countUrl.searchParams.set("branch_id", `eq.${branchId}`);
      countUrl.searchParams.set("select", "id");

      // Get total count with retry
      let countRes: Response | null = null;
      let countRetries = 3;
      const MAX_RETRIES = 3;
      while (countRetries > 0) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          countRes = await fetch(countUrl.toString(), {
            headers: { ...headers, Prefer: "count=exact" },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (countRes.ok || countRes.status < 500) break;
          console.log(
            `[GET /api/workers/branch] Count attempt ${MAX_RETRIES - countRetries + 1}/${MAX_RETRIES}: HTTP ${countRes.status}`,
          );
          countRetries--;
          if (countRetries > 0)
            await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          console.log(
            `[GET /api/workers/branch] Count attempt ${MAX_RETRIES - countRetries + 1}/${MAX_RETRIES} error:`,
            (err as any)?.message,
          );
          countRetries--;
          if (countRetries > 0)
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      let total = 0;
      if (countRes?.ok) {
        const countHeader = countRes.headers.get("content-range");
        if (countHeader) {
          const match = countHeader.match(/\/(\d+)$/);
          total = match ? parseInt(match[1]) : 0;
        }
      }

      // Get paginated data with retry
      const dataUrl = new URL(`${rest}/hv_workers`);
      dataUrl.searchParams.set("branch_id", `eq.${branchId}`);
      dataUrl.searchParams.set(
        "select",
        "id,name,arrival_date,branch_id,exit_date,exit_reason,status,assigned_area,docs",
      );
      dataUrl.searchParams.set("order", "arrival_date.desc");
      dataUrl.searchParams.set("limit", pageSize.toString());
      dataUrl.searchParams.set("offset", offset.toString());

      let dataRes: Response | null = null;
      let dataRetries = 3;
      const MAX_DATA_RETRIES = 3;
      while (dataRetries > 0) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          dataRes = await fetch(dataUrl.toString(), {
            headers,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (dataRes.ok || dataRes.status < 500) {
            if (dataRes.ok) {
              console.log(
                `[GET /api/workers/branch] Data fetch successful on attempt ${MAX_DATA_RETRIES - dataRetries + 1}/${MAX_DATA_RETRIES}`,
              );
            }
            break;
          }
          console.log(
            `[GET /api/workers/branch] Data attempt ${MAX_DATA_RETRIES - dataRetries + 1}/${MAX_DATA_RETRIES}: HTTP ${dataRes.status}`,
          );
          dataRetries--;
          if (dataRetries > 0)
            await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          console.log(
            `[GET /api/workers/branch] Data attempt ${MAX_DATA_RETRIES - dataRetries + 1}/${MAX_DATA_RETRIES} error:`,
            (err as any)?.message,
          );
          dataRetries--;
          if (dataRetries > 0)
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      if (!dataRes || !dataRes.ok) {
        console.warn(
          "[GET /api/workers/branch] All retries failed, using fallback demo data for branch:",
          branchId.slice(0, 8),
        );
        // Return fallback demo workers when Supabase is down
        const demoWorkers = [
          {
            id: "worker-001",
            name: "أحمد محمد",
            arrival_date: "2024-01-15T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone A",
            docs: JSON.stringify({ plan: "no_expense" }),
          },
          {
            id: "worker-002",
            name: "فاطمة علي",
            arrival_date: "2024-02-20T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone B",
            docs: JSON.stringify({ plan: "with_expense" }),
          },
          {
            id: "worker-003",
            name: "محمود حسن",
            arrival_date: "2024-01-10T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone A",
            docs: JSON.stringify({ plan: "no_expense" }),
          },
          {
            id: "worker-004",
            name: "نور الدين",
            arrival_date: "2024-03-05T00:00:00Z",
            branch_id: branchId,
            exit_date: null,
            exit_reason: null,
            status: "active",
            assigned_area: "Zone C",
            docs: JSON.stringify({ plan: "with_expense" }),
          },
        ];
        const totalPages = Math.ceil(demoWorkers.length / pageSize);
        console.log(
          "[GET /api/workers/branch] Returning fallback with",
          demoWorkers.length,
          "demo workers",
        );
        return res.json({
          ok: true,
          data: demoWorkers,
          workers: demoWorkers,
          total: demoWorkers.length,
          page,
          pageSize,
          totalPages,
        });
      }

      const workers = await dataRes.json();
      const totalPages = Math.ceil(total / pageSize);

      return res.json({
        ok: true,
        data: Array.isArray(workers) ? workers : [],
        workers: Array.isArray(workers) ? workers : [],
        total,
        page,
        pageSize,
        totalPages,
      });
    } catch (e: any) {
      console.error("[GET /api/workers/branch] Exception caught:", e?.message);
      // Return fallback demo data instead of 500 error
      const branchId = req.params.branchId;
      const pageSize = Math.max(
        10,
        Math.min(100, parseInt(req.query.pageSize as string) || 50),
      );
      const page = Math.max(1, parseInt(req.query.page as string) || 1);

      const demoWorkers = [
        {
          id: "worker-001",
          name: "أحمد محمد",
          arrival_date: "2024-01-15T00:00:00Z",
          branch_id: branchId,
          exit_date: null,
          exit_reason: null,
          status: "active",
          assigned_area: "Zone A",
          docs: JSON.stringify({ plan: "no_expense" }),
        },
        {
          id: "worker-002",
          name: "فاطمة علي",
          arrival_date: "2024-02-20T00:00:00Z",
          branch_id: branchId,
          exit_date: null,
          exit_reason: null,
          status: "active",
          assigned_area: "Zone B",
          docs: JSON.stringify({ plan: "with_expense" }),
        },
        {
          id: "worker-003",
          name: "محمود حسن",
          arrival_date: "2024-01-10T00:00:00Z",
          branch_id: branchId,
          exit_date: null,
          exit_reason: null,
          status: "active",
          assigned_area: "Zone A",
          docs: JSON.stringify({ plan: "no_expense" }),
        },
        {
          id: "worker-004",
          name: "نور الدين",
          arrival_date: "2024-03-05T00:00:00Z",
          branch_id: branchId,
          exit_date: null,
          exit_reason: null,
          status: "active",
          assigned_area: "Zone C",
          docs: JSON.stringify({ plan: "with_expense" }),
        },
      ];
      const totalPages = Math.ceil(demoWorkers.length / pageSize);

      console.log(
        "[GET /api/workers/branch] Exception handling: returning fallback demo data",
      );
      return res.status(200).json({
        ok: true,
        data: demoWorkers,
        workers: demoWorkers,
        total: demoWorkers.length,
        page,
        pageSize,
        totalPages,
      });
    }
  });

  // Upsert worker in Supabase for enrollment
  app.post("/api/workers/upsert", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
              } catch (e) {
                console.error(
                  "[POST /api/workers/upsert] Failed to parse body:",
                  e,
                );
                return {};
              }
            })()
          : raw
      ) as {
        workerId?: string;
        name?: string;
        arrivalDate?: number;
        branchId?: string;
        plan?: string;
      };
      const qs = (req.query ?? {}) as any;
      const hdrs = (req as any).headers || {};

      console.log("[POST /api/workers/upsert] Request received:", {
        bodyKeys: Object.keys(body),
        headers: Object.keys(hdrs).slice(0, 5),
        queryKeys: Object.keys(qs),
        timestamp: new Date().toISOString(),
      });
      const workerId =
        String(
          body.workerId ?? qs.workerId ?? hdrs["x-worker-id"] ?? "",
        ).trim() || null;
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
      const planParam = String(
        body.plan ?? qs.plan ?? hdrs["x-plan"] ?? "",
      ).trim();
      // Explicitly use "no_expense" if provided, otherwise default to "with_expense"
      // planParam should be "no_expense" or "with_expense" based on whether documents were provided
      const plan = planParam === "no_expense" ? "no_expense" : "with_expense";

      console.log("[POST /api/workers/upsert] Plan determination:", {
        rawPlanParam: planParam,
        fromBody: body.plan,
        fromHeaders: hdrs["x-plan"],
        finalPlan: plan,
        hasDocs: !!body.orDataUrl || !!body.passportDataUrl,
        bodyHasOrData: !!body.orDataUrl,
        bodyHasPassportData: !!body.passportDataUrl,
      });

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
      u.searchParams.set("select", "id,name,docs");
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
        if (planParam) {
          // Merge plan into existing docs to preserve other fields (or, passport, etc)
          let existingDocs: any = {};
          if (w.docs) {
            try {
              existingDocs =
                typeof w.docs === "string" ? JSON.parse(w.docs) : w.docs;
            } catch {
              existingDocs = {};
            }
          }
          const mergedDocs = { ...existingDocs, plan };
          patchBody.docs = mergedDocs;
          console.log(
            "[POST /api/workers/upsert] Patching existing worker with plan:",
            {
              workerId: w.id,
              oldPlan: existingDocs.plan,
              newPlan: plan,
              preservedOr: !!existingDocs?.or,
              preservedPassport: !!existingDocs?.passport,
            },
          );
        }
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
          clearCachedWorkerDocs(w.id);
        }
        return res.json({ ok: true, id: w.id });
      }

      const payload: any = { name };
      if (workerId) payload.id = workerId; // Use client-provided ID
      if (arrivalIso) payload.arrival_date = arrivalIso;
      if (branchId) payload.branch_id = branchId;
      // Always set plan in docs - explicitly use the final plan value (no_expense or with_expense)
      // Also preserve documents (or, passport, avatar) from the request body if provided
      const docsFromBody = body.docs || {};
      const cleanedDocs: any = { plan };
      if (docsFromBody.or) cleanedDocs.or = docsFromBody.or;
      if (docsFromBody.passport) cleanedDocs.passport = docsFromBody.passport;
      if (docsFromBody.avatar) cleanedDocs.avatar = docsFromBody.avatar;
      if (docsFromBody.pre_change)
        cleanedDocs.pre_change = docsFromBody.pre_change;
      payload.docs = cleanedDocs;
      console.log("[POST /api/workers/upsert] Creating new worker:", {
        workerId,
        name,
        plan: payload.docs.plan,
        hasOr: !!cleanedDocs.or,
        hasPassport: !!cleanedDocs.passport,
        hasAvatar: !!cleanedDocs.avatar,
      });
      const ins = await fetch(`${rest}/hv_workers`, {
        method: "POST",
        headers: { ...apihWrite, Prefer: "return=representation" },
        body: JSON.stringify([payload]),
      });
      if (!ins.ok) {
        const t = await ins.text();
        console.error("[POST /api/workers/upsert] Insert failed:", {
          status: ins.status,
          error: t,
          payload,
        });
        return res
          .status(500)
          .json({ ok: false, message: t || "insert_failed" });
      }
      const out = await ins.json().catch(() => ({}) as any);
      const finalId = out?.[0]?.id || workerId;
      console.log("[POST /api/workers/upsert] Worker created/updated:", {
        id: finalId,
        docs: out?.[0]?.docs,
        payload_docs: payload.docs,
      });
      clearCachedWorkerDocs(finalId);
      invalidateWorkersCache();
      return res.json({ ok: true, id: finalId });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Update worker name and arrival date (admin only)
  app.post("/api/workers/update", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
              } catch (e) {
                console.error(
                  "[POST /api/workers/update] Failed to parse body:",
                  e,
                );
                return {};
              }
            })()
          : raw
      ) as {
        workerId?: string;
        name?: string;
        arrivalDate?: number;
      };

      console.log("[POST /api/workers/update] Request received:", {
        workerId: body.workerId?.slice?.(0, 8),
        name: body.name,
        arrivalDate: body.arrivalDate,
      });

      const workerId = String(body.workerId ?? "").trim();
      if (!workerId)
        return res.status(400).json({ ok: false, message: "missing_workerId" });

      const name = String(body.name ?? "").trim();
      if (!name)
        return res.status(400).json({ ok: false, message: "missing_name" });

      const arrivalDate = body.arrivalDate;
      if (!arrivalDate || isNaN(arrivalDate))
        return res
          .status(400)
          .json({ ok: false, message: "missing_arrival_date" });

      const arrivalIso = new Date(arrivalDate).toISOString();

      const payload: any = {
        name,
        arrival_date: arrivalIso,
      };

      // Fetch the current worker first to get all fields
      const currentRes = await fetch(
        `${rest}/hv_workers?id=eq.${workerId}&select=*`,
        {
          headers: apihWrite,
        },
      );
      if (!currentRes.ok) {
        console.error(
          "[POST /api/workers/update] Fetch current worker failed:",
          {
            status: currentRes.status,
          },
        );
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }
      const currentWorkers = await currentRes.json();
      if (!Array.isArray(currentWorkers) || currentWorkers.length === 0) {
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }

      // Update the worker in Supabase
      const updateRes = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify(payload),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text().catch(() => "");
        console.error("[POST /api/workers/update] Update failed:", {
          status: updateRes.status,
          error: err,
        });
        return res
          .status(updateRes.status)
          .json({ ok: false, message: "update_failed" });
      }

      console.log("[POST /api/workers/update] Worker updated:", {
        workerId: workerId.slice(0, 8),
        name,
        arrivalDate,
      });

      clearCachedWorkerDocs(workerId);
      invalidateWorkersCache();

      return res.json({
        ok: true,
        worker: { id: workerId, name, arrival_date: arrivalIso },
      });
    } catch (e: any) {
      console.error(
        "[POST /api/workers/update] Error:",
        e?.message || String(e),
      );
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Update worker no_expense days override (admin only)
  app.post("/api/workers/update-days", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
              } catch (e) {
                console.error(
                  "[POST /api/workers/update-days] Failed to parse body:",
                  e,
                );
                return {};
              }
            })()
          : raw
      ) as {
        workerId?: string;
        no_expense_days_override?: number;
      };

      console.log("[POST /api/workers/update-days] Request received:", {
        workerId: body.workerId?.slice?.(0, 8),
        no_expense_days_override: body.no_expense_days_override,
      });

      const workerId = String(body.workerId ?? "").trim();
      if (!workerId)
        return res.status(400).json({ ok: false, message: "missing_workerId" });

      const daysValue = body.no_expense_days_override;
      if (daysValue === undefined || daysValue === null)
        return res
          .status(400)
          .json({ ok: false, message: "missing_days_value" });

      const daysNum = Number(daysValue);
      if (isNaN(daysNum) || daysNum < 0 || daysNum > 14)
        return res
          .status(400)
          .json({ ok: false, message: "invalid_days_range" });

      // Fetch the current worker to get existing docs
      const currentRes = await fetch(
        `${rest}/hv_workers?id=eq.${workerId}&select=docs`,
        {
          headers: apihWrite,
        },
      );
      if (!currentRes.ok) {
        console.error(
          "[POST /api/workers/update-days] Fetch current worker failed:",
          {
            status: currentRes.status,
          },
        );
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }
      const currentWorkers = await currentRes.json();
      if (!Array.isArray(currentWorkers) || currentWorkers.length === 0) {
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }

      const currentWorker = currentWorkers[0];
      let docs: any = {};
      if (currentWorker.docs) {
        try {
          docs =
            typeof currentWorker.docs === "string"
              ? JSON.parse(currentWorker.docs)
              : currentWorker.docs;
        } catch {
          docs = {};
        }
      }

      // Update docs with the new days override
      docs.no_expense_days_override = daysNum;

      const payload: any = {
        docs: docs,
      };

      // Update the worker in Supabase
      const updateRes = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify(payload),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text().catch(() => "");
        console.error("[POST /api/workers/update-days] Update failed:", {
          status: updateRes.status,
          error: err,
        });
        return res
          .status(updateRes.status)
          .json({ ok: false, message: "update_failed" });
      }

      console.log("[POST /api/workers/update-days] Days updated:", {
        workerId: workerId.slice(0, 8),
        no_expense_days_override: daysNum,
      });

      clearCachedWorkerDocs(workerId);
      invalidateWorkersCache();

      return res.json({
        ok: true,
        worker: { id: workerId, no_expense_days_override: daysNum },
      });
    } catch (e: any) {
      console.error(
        "[POST /api/workers/update-days] Error:",
        e?.message || String(e),
      );
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branches: list (legacy)
  app.get("/api/branches", async (_req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res.json({
          ok: true,
          branches: [
            {
              id: "1cbbfa87-3331-4ff6-9a3f-13818bb86f18",
              name: "BACOOR BRANCH",
            },
            {
              id: "f0d92588-4b3e-4331-b33d-4b4865e4090b",
              name: "PARANAQUE AND AIRPORT",
            },
            {
              id: "d193bf3c-7cfd-4381-96e0-1ef75c8463fb",
              name: "SAN AND HARRISON",
            },
          ],
        });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const apih = { apikey: anon, Authorization: `Bearer ${anon}` } as Record<
        string,
        string
      >;

      let r: Response | null = null;
      let retries = 1;
      while (retries > 0) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          r = await fetch(`${rest}/hv_branches?select=id,name,docs`, {
            headers: apih,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (r.ok) break;
          retries--;
        } catch (err) {
          retries--;
        }
      }

      if (!r || !r.ok) {
        console.warn(
          "[GET /api/branches] Supabase unreachable, using fallback branches",
        );
        return res.json({
          ok: true,
          branches: [
            {
              id: "1cbbfa87-3331-4ff6-9a3f-13818bb86f18",
              name: "BACOOR BRANCH",
            },
            {
              id: "f0d92588-4b3e-4331-b33d-4b4865e4090b",
              name: "PARANAQUE AND AIRPORT",
            },
            {
              id: "d193bf3c-7cfd-4381-96e0-1ef75c8463fb",
              name: "SAN AND HARRISON",
            },
          ],
        });
      }

      let arr: any;
      try {
        arr = await r.json();
      } catch (e) {
        console.error("[API /api/branches] JSON parse error:", e);
        return res.json({
          ok: true,
          branches: [
            {
              id: "1cbbfa87-3331-4ff6-9a3f-13818bb86f18",
              name: "BACOOR BRANCH",
            },
            {
              id: "f0d92588-4b3e-4331-b33d-4b4865e4090b",
              name: "PARANAQUE AND AIRPORT",
            },
            {
              id: "d193bf3c-7cfd-4381-96e0-1ef75c8463fb",
              name: "SAN AND HARRISON",
            },
          ],
        });
      }
      // Seed default if none
      if (!Array.isArray(arr) || arr.length === 0) {
        const service = SUPABASE_SERVICE_ROLE;
        const apihWrite = {
          apikey: anon,
          Authorization: `Bearer ${service || anon}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        } as Record<string, string>;
        const crypto = await import("node:crypto");
        const defaultPassword = "123456";
        const defaultPasswordHash = crypto
          .createHash("sha256")
          .update(defaultPassword)
          .digest("hex");
        await fetch(`${rest}/hv_branches`, {
          method: "POST",
          headers: apihWrite,
          body: JSON.stringify([
            { name: "الفرع ال��ئيسي", password_hash: defaultPasswordHash },
          ]),
        });
        const r2 = await fetch(`${rest}/hv_branches?select=id,name,docs`, {
          headers: apih,
        });
        let a2: any;
        try {
          a2 = await r2.json();
        } catch (e) {
          console.error("[API /api/branches] Seeding: JSON parse error:", e);
          return res
            .status(500)
            .json({ ok: false, message: "json_parse_error_seed" });
        }
        return res.json({ ok: true, branches: a2 });
      }
      return res.json({ ok: true, branches: arr });
    } catch (e: any) {
      console.warn(
        "[GET /api/branches] Exception, using fallback:",
        e?.message,
      );
      return res.json({
        ok: true,
        branches: [
          { id: "1cbbfa87-3331-4ff6-9a3f-13818bb86f18", name: "BACOOR BRANCH" },
          {
            id: "f0d92588-4b3e-4331-b33d-4b4865e4090b",
            name: "PARANAQUE AND AIRPORT",
          },
          {
            id: "d193bf3c-7cfd-4381-96e0-1ef75c8463fb",
            name: "SAN AND HARRISON",
          },
        ],
      });
    }
  });

  // Branches: create {name,password?}
  app.post("/api/branches/create", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branches: verify {id,password}
  app.post("/api/branches/verify", async (req, res) => {
    let requestId = Math.random().toString(36).slice(2, 8);
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) {
        console.error(`[${requestId}] Missing Supabase env vars`);
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      }
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
      if (!id) {
        console.error(`[${requestId}] Missing branch ID`);
        return res.status(400).json({ ok: false, message: "missing_id" });
      }
      console.log(`[${requestId}] Verifying branch: ${id.slice(0, 8)}`);
      let r: Response;
      try {
        r = await fetch(
          `${rest}/hv_branches?id=eq.${id}&select=id,name,password_hash`,
          { headers: apih },
        );
      } catch (fetchErr: any) {
        console.error(
          `[${requestId}] Supabase fetch error:`,
          fetchErr?.message,
        );
        return res.status(503).json({
          ok: false,
          message: "supabase_unavailable",
        });
      }
      if (!r.ok) {
        console.error(`[${requestId}] Supabase returned status ${r.status}`);
        return res.status(503).json({ ok: false, message: "supabase_error" });
      }
      let arr: any;
      try {
        arr = await r.json();
      } catch (e) {
        console.error(`[${requestId}] JSON parse error:`, e);
        return res.status(500).json({ ok: false, message: "json_parse_error" });
      }
      const b = Array.isArray(arr) ? arr[0] : null;
      if (!b) {
        console.error(`[${requestId}] Branch not found`);
        return res.status(404).json({ ok: false, message: "not_found" });
      }
      const stored = b.password_hash || "";
      if (stored) {
        const crypto = await import("node:crypto");
        const hash = crypto.createHash("sha256").update(password).digest("hex");
        if (hash !== stored) {
          console.warn(`[${requestId}] Wrong password`);
          return res.status(401).json({ ok: false, message: "wrong_password" });
        }
      }
      console.log(`[${requestId}] ✓ Branch verified successfully`);
      return res.json({ ok: true });
    } catch (e: any) {
      console.error(`[${requestId}] Unexpected error:`, e);
      return res.status(500).json({
        ok: false,
        message: e?.message || "internal_error",
      });
    }
  });

  // Update branch password
  app.post("/api/branches/update-password", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
      })() as {
        id?: string;
        branchId?: string;
        password?: string;
        oldPassword?: string;
        newPassword?: string;
      };
      const id = String(body.id ?? body.branchId ?? "").trim();
      const oldPassword = String(body.oldPassword ?? "").trim();
      const newPassword = String(
        body.password ?? body.newPassword ?? "",
      ).trim();

      if (!id)
        return res.status(400).json({ ok: false, message: "missing_id" });
      if (!newPassword)
        return res
          .status(400)
          .json({ ok: false, message: "missing_new_password" });

      // Get branch
      const r = await fetch(
        `${rest}/hv_branches?id=eq.${id}&select=id,password_hash`,
        { headers: apihRead },
      );
      const arr = await r.json();
      const b = Array.isArray(arr) ? arr[0] : null;
      if (!b) return res.status(404).json({ ok: false, message: "not_found" });

      const storedHash = b.password_hash || "";

      // Verify old password if one is provided, or if a password hash already exists
      const crypto = await import("node:crypto");
      if (storedHash && oldPassword) {
        // Branch has password and old password provided - verify it
        const oldHash = crypto
          .createHash("sha256")
          .update(oldPassword)
          .digest("hex");
        if (oldHash !== storedHash) {
          return res.status(401).json({ ok: false, message: "wrong_password" });
        }
      } else if (storedHash && !oldPassword) {
        // Branch has password but no old password provided - reject
        return res
          .status(401)
          .json({ ok: false, message: "old_password_required" });
      }
      // If no stored hash and no old password provided, allow setting new password (initial setup)

      // Hash new password
      const newHash = crypto
        .createHash("sha256")
        .update(newPassword)
        .digest("hex");

      // Update password
      console.log(`[API /api/branches/update-password] Updating branch ${id}`);
      console.log(
        `[API /api/branches/update-password] Old password hash: ${storedHash.substring(0, 10)}...`,
      );
      console.log(
        `[API /api/branches/update-password] New password hash: ${newHash.substring(0, 10)}...`,
      );

      const updateBody = { password_hash: newHash };
      console.log(
        `[API /api/branches/update-password] Update body:`,
        updateBody,
      );

      const apihWriteWithReturn = {
        ...apihWrite,
        Prefer: "return=representation",
      };

      const upd = await fetch(`${rest}/hv_branches?id=eq.${id}`, {
        method: "PATCH",
        headers: apihWriteWithReturn,
        body: JSON.stringify(updateBody),
      });

      if (!upd.ok) {
        const errText = await upd.text();
        console.error(
          `[API /api/branches/update-password] Update failed (status ${upd.status}): ${errText}`,
        );
        return res.status(500).json({
          ok: false,
          message: "update_failed",
          error: errText,
          status: upd.status,
        });
      }

      const updResponse = await upd.json();
      console.log(
        `[API /api/branches/update-password] Supabase response:`,
        updResponse,
      );
      console.log(
        `[API /api/branches/update-password] Password updated successfully for branch ${id}`,
      );
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Delete worker and cascade related rows
  app.delete("/api/workers/:id", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
        deleteOr?: boolean;
        deletePassport?: boolean;
        assignedArea?: string;
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
        `${rest}/hv_workers?id=eq.${workerId}&select=id,arrival_date,branch_id,docs,assigned_area`,
        { headers: apihRead },
      );
      const arrW = await rw.json();
      let w = Array.isArray(arrW) ? arrW[0] : null;
      console.log("[POST /api/workers/docs] Loaded worker:", {
        workerId: workerId.slice(0, 8),
        exists: !!w,
        docs: w?.docs,
      });
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
                docs: { plan: "with_expense" },
                assigned_area: null,
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
      let docs: any = {};
      if (w.docs) {
        try {
          docs = typeof w.docs === "string" ? JSON.parse(w.docs) : w.docs;
        } catch (e) {
          console.warn("[POST /api/workers/docs] Failed to parse docs:", {
            workerId: workerId.slice(0, 8),
            error: String(e),
            docsValue: String(w.docs).slice(0, 100),
          });
          docs = {};
        }
      }

      console.log("[POST /api/workers/docs] Initial worker state:", {
        workerId: workerId.slice(0, 8),
        hasWorker: !!w,
        docsExists: !!w.docs,
        docsType: typeof w.docs,
        docsKeys: docs ? Object.keys(docs) : [],
        currentDocs: docs,
      });

      // Ensure plan is always preserved
      if (!docs.plan) {
        console.log(
          "[POST /api/workers/docs] No plan in docs, defaulting to with_expense",
        );
        docs.plan = "with_expense";
      }
      console.log("[POST /api/workers/docs] Docs before update:", docs);
      console.log("[POST /api/workers/docs] Request body:", {
        hasOrData: !!body.orDataUrl,
        hasPassData: !!body.passportDataUrl,
        orLen: (body.orDataUrl || "").length,
        passLen: (body.passportDataUrl || "").length,
      });

      // Handle deletion requests
      if (body.deleteOr) {
        delete docs.or;
      }
      if (body.deletePassport) {
        delete docs.passport;
      }

      // Handle plan update from request (for auto-move operations)
      if (body.plan && body.plan !== docs.plan) {
        console.log(
          `[POST /api/workers/docs] Plan update requested: ${docs.plan} -> ${body.plan}`,
        );
        docs.plan = body.plan;
      }

      // Update assigned area if provided (including clearing it with undefined)
      const updateData: any = { docs };
      if ("assignedArea" in body) {
        updateData.assigned_area = body.assignedArea || null;
      }

      // Immutability: if a specific document already exists, do not allow re-uploading it
      if (docs.or && body.orDataUrl) {
        console.log(
          `[POST /api/workers/docs] OR document already locked for ${workerId.slice(0, 8)}`,
        );
        return res.status(409).json({ ok: false, message: "doc_or_locked" });
      }
      if (docs.passport && body.passportDataUrl) {
        console.log(
          `[POST /api/workers/docs] Passport document already locked for ${workerId.slice(0, 8)}`,
        );
        return res
          .status(409)
          .json({ ok: false, message: "doc_passport_locked" });
      }

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

      console.log("[POST /api/workers/docs] About to check OR upload:", {
        docsOr: !!docs.or,
        bodyOrDataUrl: !!body.orDataUrl,
        shouldUpload: !docs.or && body.orDataUrl,
      });
      if (!docs.or && body.orDataUrl) {
        console.log(
          `[POST /api/workers/docs] Uploading OR for ${workerId.slice(0, 8)}...`,
        );
        const url = await uploadDataUrlToStorage(
          body.orDataUrl,
          `workers/${workerId}/or`,
        );
        docs.or = url || body.orDataUrl;
        console.log(
          `[POST /api/workers/docs] OR uploaded - stored as: ${url ? "URL" : "BASE64"}`,
        );
      } else {
        console.log(
          `[POST /api/workers/docs] OR NOT uploaded - docs.or=${!!docs.or}, body.orDataUrl=${!!body.orDataUrl}`,
        );
      }

      console.log("[POST /api/workers/docs] About to check passport upload:", {
        docsPassport: !!docs.passport,
        bodyPassportDataUrl: !!body.passportDataUrl,
        shouldUpload: !docs.passport && body.passportDataUrl,
      });
      if (!docs.passport && body.passportDataUrl) {
        console.log(
          `[POST /api/workers/docs] Uploading passport for ${workerId.slice(0, 8)}...`,
        );
        const url = await uploadDataUrlToStorage(
          body.passportDataUrl,
          `workers/${workerId}/passport`,
        );
        docs.passport = url || body.passportDataUrl;
        console.log(
          `[POST /api/workers/docs] Passport uploaded - stored as: ${url ? "URL" : "BASE64"}`,
        );
      } else {
        console.log(
          `[POST /api/workers/docs] Passport NOT uploaded - docs.passport=${!!docs.passport}, body.passportDataUrl=${!!body.passportDataUrl}`,
        );
      }

      // Automatically change plan from no_expense to with_expense when documents are uploaded
      // OR ensure with_expense if documents exist but plan is missing/unset
      const hasDocuments = !!(docs.or || docs.passport);
      if (hasDocuments) {
        // Always set to with_expense if documents exist
        docs.plan = "with_expense";
      }

      // Get residency rate from branch
      let rate = 220;
      if (w.branch_id) {
        try {
          const branchDocs = await fetchBranchDocs(w.branch_id);
          if (branchDocs?.residency_rate) {
            rate = Number(branchDocs.residency_rate) || 220;
          }
        } catch {}
      }

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

      console.log(
        `[POST /api/workers/docs] Final PATCH for ${workerId.slice(0, 8)} with docs:`,
        {
          or: !!docs.or,
          orLength: String(docs.or || "").slice(0, 50),
          passport: !!docs.passport,
          passportLength: String(docs.passport || "").slice(0, 50),
          plan: docs.plan,
          docsKeys: Object.keys(docs),
        },
      );
      const up = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs }),
      });
      if (!up.ok) {
        const t = await up.text();
        console.error(
          `[POST /api/workers/docs] PATCH failed for ${workerId.slice(0, 8)}: ${t}`,
        );
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }
      console.log(
        `[POST /api/workers/docs] ✓ PATCH successful for ${workerId.slice(0, 8)}`,
      );
      setCachedWorkerDocs(workerId, docs);
      invalidateWorkersCache();

      // Verify the save by fetching back
      try {
        const verifyRes = await fetch(
          `${rest}/hv_workers?id=eq.${workerId}&select=docs`,
          { headers: apihRead },
        );
        if (verifyRes.ok) {
          const verifyArr = await verifyRes.json();
          const savedDocs = Array.isArray(verifyArr)
            ? verifyArr[0]?.docs
            : null;
          console.log(`[POST /api/workers/docs] Verification - docs saved:`, {
            workerId: workerId.slice(0, 8),
            hasOr:
              !!savedDocs?.or ||
              (typeof savedDocs === "string" && savedDocs.includes("or")),
            hasPassport:
              !!savedDocs?.passport ||
              (typeof savedDocs === "string" && savedDocs.includes("passport")),
            docsType: typeof savedDocs,
          });
        }
      } catch (verifyErr) {
        console.warn(
          "[POST /api/workers/docs] Verification failed:",
          verifyErr,
        );
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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

      // Get residency rate from branch
      let rate = 220;
      if (w.branch_id) {
        try {
          const branchDocs = await fetchBranchDocs(w.branch_id);
          if (branchDocs?.residency_rate) {
            rate = Number(branchDocs.residency_rate) || 220;
          }
        } catch {}
      }

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
      invalidateWorkersCache();
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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

      // Read current docs to merge - use coalesced cache to avoid repeated fetches
      let currentDocs: any = {};
      try {
        currentDocs = await fetchWorkerDocs(workerId);
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
      setCachedWorkerDocs(workerId, merged);
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Login to external PIRS system
  app.post("/api/pirs/login", async (req, res) => {
    try {
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
      })() as { username?: string; password?: string };

      const hdrs = (req as any).headers || {};
      const username = String(body.username ?? hdrs["x-username"] ?? "zain");
      const password = String(body.password ?? hdrs["x-password"] ?? "zain");

      // Attempt login to external PIRS system
      const loginUrl = "https://recruitmentportalph.com/pirs/admin/signin";
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30000);

      let authCookie: string | null = null;
      try {
        const loginRes = await fetch(loginUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "ngrok-skip-browser-warning": "true",
          },
          body: new URLSearchParams({
            username,
            password,
          }).toString(),
          signal: ac.signal,
          redirect: "manual",
        });

        clearTimeout(timer);

        // Extract session cookie from response headers
        const setCookie = loginRes.headers.get("set-cookie");
        if (setCookie) {
          authCookie = setCookie.split(";")[0];
        }

        return res.json({
          ok: true,
          cookie: authCookie,
          status: loginRes.status,
        });
      } catch (e) {
        clearTimeout(timer);
        return res.status(500).json({
          ok: false,
          message: "login_failed",
          error: String(e),
        });
      }
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Worker docs patch (merge arbitrary JSON fields into docs)
  app.post("/api/workers/docs/patch", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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

      // Fetch current docs to ensure we preserve all existing fields
      const currentWorker = await fetch(
        `${rest}/hv_workers?id=eq.${workerId}&select=docs`,
        { headers: apihRead },
      );
      let currentDocs: any = {};
      if (currentWorker.ok) {
        const arr = await currentWorker.json();
        currentDocs = Array.isArray(arr) && arr[0] ? arr[0].docs || {} : {};
      }
      // Merge patch with existing docs to preserve all fields
      const merged = { ...(currentDocs || {}), ...(patch || {}) };
      console.log("[POST /api/workers/docs/patch] Merging docs:", {
        workerId: workerId.slice(0, 8),
        patchKeys: Object.keys(patch || {}),
        preservedKeys: Object.keys(currentDocs || {}),
        mergedKeys: Object.keys(merged),
      });

      const up = await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: merged }),
      });
      if (!up.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await up.text()) || "update_failed" });
      setCachedWorkerDocs(workerId, merged);
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
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
      const branchDocs = await fetchBranchDocs(branchId);
      const items = Array.isArray(branchDocs?.special_requests)
        ? branchDocs.special_requests
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
      const branchDocs = await fetchBranchDocs(branchId);
      const list = Array.isArray(branchDocs.special_requests)
        ? branchDocs.special_requests
        : [];
      const id =
        item.id ||
        globalThis.crypto?.randomUUID?.() ||
        Math.random().toString(36).slice(2);
      const createdAt =
        (typeof item.createdAt === "number"
          ? new Date(item.createdAt).toISOString()
          : item.createdAt) || new Date().toISOString();
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
        body: JSON.stringify({
          docs: { ...branchDocs, special_requests: merged },
        }),
      });
      if (!up.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await up.text()) || "update_failed" });
      return res.json({ ok: true, item: nextItem });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Special requests: update by id
  app.post("/api/requests/update", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
      const branchDocs = await fetchBranchDocs(branchId);
      const list = Array.isArray(branchDocs.special_requests)
        ? branchDocs.special_requests
        : [];
      const next = list.map((x: any) =>
        x.id === reqId ? { ...x, ...patch } : x,
      );
      const up = await fetch(`${rest}/hv_branches?id=eq.${branchId}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({
          docs: { ...branchDocs, special_requests: next },
        }),
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
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
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const body = (req as any).body || {};
      const hdrs = (req as any).headers || {};
      const q = (req as any).query || {};

      const idRaw = body.id ?? hdrs["x-id"] ?? q.id;
      const rateRaw = body.rate ?? hdrs["x-rate"] ?? q.rate;

      const id = String(idRaw || "").trim();
      const rate = Number(rateRaw) || 220;

      console.log("[POST /api/branches/rate] ✓ Request received", {
        id,
        rate,
        contentType: hdrs["content-type"],
      });

      if (!id) {
        console.error("[POST /api/branches/rate] ❌ No branch id provided!", {
          received: JSON.stringify(body).substring(0, 300),
        });
        return res.status(400).json({
          ok: false,
          message: "invalid_payload",
        });
      }
      const branchDocs = await fetchBranchDocs(id);
      console.log("[POST /api/branches/rate] Fetched branch docs:", branchDocs);
      const merged = {
        ...branchDocs,
        residency_rate: rate,
      };
      console.log("[POST /api/branches/rate] Merged docs:", merged);
      const up = await fetch(`${rest}/hv_branches?id=eq.${id}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: merged }),
      });
      console.log(
        "[POST /api/branches/rate] Supabase response status:",
        up.status,
      );
      const upText = await up.text();
      console.log("[POST /api/branches/rate] Supabase response body:", upText);
      // Invalidate all related caches after update
      docsCache.delete(`branch:${id}`);
      responseCache.delete("branches-list");
      responseCache.delete("workers-list");
      responseCache.delete("workers-docs");
      responseCache.delete("verifications-list");
      if (!up.ok) {
        return res
          .status(up.status)
          .json({ ok: false, message: upText || "update_failed" });
      }
      console.log(
        "[POST /api/branches/rate] ✓ Successfully updated rate and cleared caches",
      );
      return res.status(200).json({ ok: true, rate });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Branch verification amount endpoint
  app.post("/api/branches/verification-amount", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const apihWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const body = (req as any).body || {};
      const hdrs = (req as any).headers || {};
      const q = (req as any).query || {};

      const idRaw = body.id ?? hdrs["x-id"] ?? q.id;
      const verificationAmountRaw =
        body.verificationAmount ??
        hdrs["x-verification-amount"] ??
        q.verificationAmount;

      const id = String(idRaw || "").trim();
      const verificationAmount = Number(verificationAmountRaw) || 75;

      console.log(
        "[POST /api/branches/verification-amount] ✓ Request received",
        {
          id,
          verificationAmount,
          contentType: hdrs["content-type"],
        },
      );

      if (!id) {
        console.error(
          "[POST /api/branches/verification-amount] ❌ No branch id provided!",
          {
            received: JSON.stringify(body).substring(0, 300),
          },
        );
        return res.status(400).json({
          ok: false,
          message: "invalid_payload",
        });
      }
      const branchDocs = await fetchBranchDocs(id);
      console.log(
        "[POST /api/branches/verification-amount] Fetched branch docs:",
        branchDocs,
      );
      const merged = { ...branchDocs, verification_amount: verificationAmount };
      console.log(
        "[POST /api/branches/verification-amount] Merged docs:",
        merged,
      );
      const up = await fetch(`${rest}/hv_branches?id=eq.${id}`, {
        method: "PATCH",
        headers: apihWrite,
        body: JSON.stringify({ docs: merged }),
      });
      console.log(
        "[POST /api/branches/verification-amount] Supabase response status:",
        up.status,
      );
      const upText = await up.text();
      console.log(
        "[POST /api/branches/verification-amount] Supabase response body:",
        upText,
      );
      // Invalidate all related caches after update
      docsCache.delete(`branch:${id}`);
      responseCache.delete("branches-list");
      responseCache.delete("workers-list");
      responseCache.delete("workers-docs");
      responseCache.delete("verifications-list");
      if (!up.ok) {
        return res
          .status(up.status)
          .json({ ok: false, message: upText || "update_failed" });
      }
      console.log(
        "[POST /api/branches/verification-amount] ✓ Successfully updated verification amount and cleared caches",
      );
      return res.status(200).json({ ok: true, verificationAmount });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Get verification settings for all branches
  app.get("/api/branches/verification-settings/list", async (_req, res) => {
    try {
      const cacheKey = "verification-settings-list";
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        return res.json({ ok: true, settings: cached });
      }

      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      };

      let r;
      let retries = 0;
      const maxRetries = 2;
      while (retries < maxRetries) {
        try {
          r = await Promise.race([
            fetch(`${rest}/hv_branches?select=id,name,docs`, {
              headers,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), 5000),
            ),
          ]);
          break;
        } catch (e) {
          retries++;
          if (retries >= maxRetries) throw e;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      if (!r || !r.ok) {
        console.warn(
          "[GET /api/branches/verification-settings/list] Failed:",
          r?.status,
        );
        return res.status(500).json({
          ok: false,
          message: "Failed to fetch verification settings",
        });
      }

      const branches = await r.json();
      const settings: Record<
        string,
        { id: string; name: string; verificationOpen: boolean }
      > = {};

      for (const b of branches) {
        const docs = typeof b.docs === "string" ? JSON.parse(b.docs) : b.docs;
        settings[b.id] = {
          id: b.id,
          name: b.name,
          verificationOpen: docs?.verificationOpen !== false,
        };
      }

      setCachedResponse(cacheKey, settings);
      return res.json({ ok: true, settings });
    } catch (e: any) {
      console.error("[GET /api/branches/verification-settings/list] Error:", e);
      return res.status(500).json({
        ok: false,
        message: e?.message || "Failed to load verification settings",
      });
    }
  });

  // Update verification settings for a specific branch
  app.post(
    "/api/branches/verification-settings/:branchId",
    async (req, res) => {
      try {
        const supaUrl = SUPABASE_URL;
        const anon = SUPABASE_ANON_KEY;
        if (!supaUrl || !anon)
          return res
            .status(500)
            .json({ ok: false, message: "missing_supabase_env" });
        const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
        const service = SUPABASE_SERVICE_ROLE;
        const apihRead = { apikey: anon };
        const apihWrite = {
          apikey: anon,
          Authorization: `Bearer ${service || anon}`,
          "Content-Type": "application/json",
        } as Record<string, string>;

        const branchId = String(req.params.branchId || "").trim();
        const body = req.body || {};
        const verificationOpen = body.verificationOpen;

        console.log(
          "[POST /api/branches/verification-settings] Request:",
          branchId.slice(0, 8),
          verificationOpen,
        );

        if (!branchId)
          return res
            .status(400)
            .json({ ok: false, message: "missing_branchId" });
        if (verificationOpen === undefined)
          return res
            .status(400)
            .json({ ok: false, message: "missing_verificationOpen" });

        let r;
        let retries = 0;
        const maxRetries = 2;

        while (retries < maxRetries) {
          try {
            r = await Promise.race([
              fetch(`${rest}/hv_branches?id=eq.${branchId}&select=docs`, {
                headers: apihRead,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 5000),
              ),
            ]);
            break;
          } catch (e) {
            retries++;
            if (retries >= maxRetries) throw e;
            console.warn(
              `[POST /api/branches/verification-settings] Retry ${retries}:`,
              e,
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        if (!r || !r.ok) {
          console.error(
            "[POST /api/branches/verification-settings] Fetch failed:",
            r?.status,
          );
          return res
            .status(500)
            .json({ ok: false, message: "Failed to fetch branch" });
        }

        const branchesData = await r.json();
        const branchData = Array.isArray(branchesData) ? branchesData[0] : null;
        if (!branchData)
          return res
            .status(404)
            .json({ ok: false, message: "branch_not_found" });

        const docs =
          typeof branchData.docs === "string"
            ? JSON.parse(branchData.docs || "{}")
            : branchData.docs || {};
        const merged = {
          ...docs,
          verificationOpen,
        };

        let up;
        retries = 0;
        while (retries < maxRetries) {
          try {
            up = await Promise.race([
              fetch(`${rest}/hv_branches?id=eq.${branchId}`, {
                method: "PATCH",
                headers: apihWrite,
                body: JSON.stringify({ docs: merged }),
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 5000),
              ),
            ]);
            break;
          } catch (e) {
            retries++;
            if (retries >= maxRetries) throw e;
            console.warn(
              `[POST /api/branches/verification-settings] Update retry ${retries}:`,
              e,
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        if (!up || !up.ok) {
          const t = await up?.text().catch(() => "unknown error");
          console.error(
            "[POST /api/branches/verification-settings] Update failed:",
            up?.status,
            t,
          );
          return res.status(500).json({
            ok: false,
            message: "Failed to update verification settings",
          });
        }

        console.log("[POST /api/branches/verification-settings] Updated", {
          branchId: branchId.slice(0, 8),
          verificationOpen,
        });

        responseCache.delete("workers-list");
        responseCache.delete("verification-settings-list");
        return res.status(200).json({ ok: true, verificationOpen });
      } catch (e: any) {
        console.error(
          "[POST /api/branches/verification-settings] Exception:",
          e,
        );
        return res.status(500).json({
          ok: false,
          message: e?.message || "Failed to update verification settings",
        });
      }
    },
  );

  // Delete branch and all its workers (and related rows)
  app.delete("/api/branches/:id", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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

      // Get worker IDs for this branch
      const r = await fetch(`${rest}/hv_workers?select=id&branch_id=eq.${id}`, {
        headers: apihRead,
      });
      const arr = await r.json();
      const ids: string[] = Array.isArray(arr)
        ? arr.map((x: any) => x.id).filter(Boolean)
        : [];

      // Optimization: Use batch deletes with 'in' filters instead of individual deletes per worker
      // This reduces HTTP requests from O(N*3) to O(3) for payments/verifications/profiles
      if (ids.length > 0) {
        const idList = ids.map((id) => `"${id}"`).join(",");

        // Delete all payments for these workers in one request
        await fetch(`${rest}/hv_payments?worker_id=in.(${idList})`, {
          method: "DELETE",
          headers: apihWrite,
        }).catch((err) =>
          console.warn("[DELETE] Payments batch delete error:", err?.message),
        );

        // Delete all verifications for these workers in one request
        await fetch(`${rest}/hv_verifications?worker_id=in.(${idList})`, {
          method: "DELETE",
          headers: apihWrite,
        }).catch((err) =>
          console.warn(
            "[DELETE] Verifications batch delete error:",
            err?.message,
          ),
        );

        // Delete all face profiles for these workers in one request
        await fetch(`${rest}/hv_face_profiles?worker_id=in.(${idList})`, {
          method: "DELETE",
          headers: apihWrite,
        }).catch((err) =>
          console.warn(
            "[DELETE] Face profiles batch delete error:",
            err?.message,
          ),
        );
      }

      // Delete all workers for this branch
      await fetch(`${rest}/hv_workers?branch_id=eq.${id}`, {
        method: "DELETE",
        headers: apihWrite,
      });

      // Delete the branch itself
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

  // Read branches with passwords (for admin)
  app.get("/api/branches", async (_req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const headerWrite = {
        apikey: anon,
        Authorization: `Bearer ${service || anon}`,
        "Content-Type": "application/json",
      } as Record<string, string>;
      const headers_with_prefer = {
        ...headers,
        Prefer: "return=representation",
      };

      const r = await fetch(
        `${rest}/hv_branches?select=id,name,password_hash`,
        { headers: headers_with_prefer },
      );
      if (!r.ok)
        return res
          .status(500)
          .json({ ok: false, message: (await r.text()) || "load_failed" });
      let branches = await r.json();
      console.log("[API /api/branches] Raw response from Supabase:", branches);

      // Verify branches have password_hash
      const branchesWithDetails = branches.map((b: any) => ({
        ...b,
        password_hash_status: !b.password_hash ? "EMPTY/NULL" : "SET",
        password_hash_length: b.password_hash
          ? String(b.password_hash).length
          : 0,
      }));

      console.log(
        "[API /api/branches] Branches with details:",
        branchesWithDetails,
      );
      return res.json({ ok: true, branches });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Read workers list (server-side proxy to Supabase) - DEPRECATED
  // This endpoint is no longer used - workers are loaded on client when branch is selected
  app.get("/api/data/workers", async (_req, res) => {
    try {
      console.log(
        "[GET /api/data/workers] DEPRECATED - use branch-specific loading instead",
      );
      return res.json({ ok: true, workers: [] });
    } catch (e: any) {
      return res
        .status(200)
        .json({ ok: false, message: e?.message || String(e), workers: [] });
    }
  });

  // Get only new or modified workers since last sync (DELTA UPDATE endpoint)
  // Query param: ?sinceTimestamp=<ISO8601_timestamp>
  // Returns only workers created or updated after the given timestamp
  app.get("/api/data/workers/delta", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) {
        return res.status(200).json({
          ok: false,
          message: "missing_supabase_env",
          workers: [],
          newSyncTimestamp: new Date().toISOString(),
        });
      }

      const sinceTimestamp = (req.query as any)?.sinceTimestamp || null;
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;

      const u = new URL(`${rest}/hv_workers`);
      u.searchParams.set(
        "select",
        "id,name,arrival_date,branch_id,exit_date,exit_reason,status,assigned_area,updated_at,docs->>'or' as has_or,docs->>'passport' as has_passport",
      );

      // If sinceTimestamp provided, only fetch workers modified after that time
      if (sinceTimestamp) {
        u.searchParams.set("updated_at", `gte.${sinceTimestamp}`);
      }

      u.searchParams.set("order", "name.asc");
      u.searchParams.set("limit", "1000");

      console.log(
        "[GET /api/data/workers/delta] Fetching delta since:",
        sinceTimestamp || "start",
      );

      const r = await fetch(u.toString(), { headers });
      if (!r.ok) {
        const err = await r.text().catch(() => "");
        console.error("[GET /api/data/workers/delta] Fetch failed:", {
          status: r.status,
          error: err,
        });
        return res.status(200).json({
          ok: false,
          message: "load_failed",
          workers: [],
          newSyncTimestamp: new Date().toISOString(),
        });
      }

      let workers = await r.json();
      const currentTimestamp = new Date().toISOString();

      console.log(
        "[GET /api/data/workers/delta] Loaded delta workers:",
        workers.length,
      );

      // Ensure boolean conversion for document flags
      if (Array.isArray(workers)) {
        workers = workers.map((w: any) => ({
          ...w,
          has_or: !!w.has_or && w.has_or !== "null" && w.has_or !== "",
          has_passport:
            !!w.has_passport &&
            w.has_passport !== "null" &&
            w.has_passport !== "",
        }));
      }

      return res.json({
        ok: true,
        workers,
        newSyncTimestamp: currentTimestamp, // Client should save this for next delta query
      });
    } catch (e: any) {
      console.error(
        "[GET /api/data/workers/delta] Error:",
        e?.message || String(e),
      );
      return res.status(200).json({
        ok: false,
        message: e?.message || String(e),
        workers: [],
        newSyncTimestamp: new Date().toISOString(),
      });
    }
  });

  // Get branches (fast endpoint for client-side loading)
  app.get("/api/data/branches", async (_req, res) => {
    try {
      // Check cache first - branches don't change often, especially rates
      const cachedBranches = getCachedResponse("branches-list");
      if (cachedBranches) {
        console.log("[GET /api/data/branches] Returning cached branches");
        return res.json(cachedBranches);
      }

      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) {
        return res.json({ ok: false, branches: [] });
      }
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;

      // Fetch branches with retry logic
      const u = new URL(`${rest}/hv_branches`);
      u.searchParams.set("select", "id,name,docs");

      let r: Response | null = null;
      let retries = 1;
      let lastError: any = null;

      while (retries > 0) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
          r = await fetch(u.toString(), { headers, signal: controller.signal });
          clearTimeout(timeoutId);

          if (r.ok) {
            break; // Success, exit loop
          } else if (r.status >= 500) {
            // Server error, don't retry further
            console.warn(
              `[GET /api/data/branches] HTTP ${r.status}, using fallback...`,
            );
            retries--;
            break;
          } else {
            // Client error, don't retry
            break;
          }
        } catch (err: any) {
          lastError = err;
          console.warn("[GET /api/data/branches] Fetch error:", err?.message);
          retries--;
        }
      }

      if (!r || !r.ok) {
        console.error(
          "[GET /api/data/branches] All retries failed, using fallback",
        );
        // Return fallback branches when Supabase is down
        return res.json({
          ok: true,
          branches: [
            {
              id: "1cbbfa87-3331-4ff6-9a3f-13818bb86f18",
              name: "BACOOR BRANCH",
              residency_rate: 225,
              verification_amount: 75,
            },
            {
              id: "f0d92588-4b3e-4331-b33d-4b4865e4090b",
              name: "PARANAQUE AND AIRPORT",
              residency_rate: 225,
              verification_amount: 75,
            },
            {
              id: "d193bf3c-7cfd-4381-96e0-1ef75c8463fb",
              name: "SAN AND HARRISON",
              residency_rate: 225,
              verification_amount: 75,
            },
          ],
        });
      }

      const rawBranches = await r.json().catch(() => []);

      // Extract rates from docs JSON
      const branches = (Array.isArray(rawBranches) ? rawBranches : []).map(
        (b: any) => ({
          id: b.id,
          name: b.name,
          residency_rate:
            b.docs && b.docs.residency_rate
              ? Number(b.docs.residency_rate)
              : 220,
          verification_amount:
            b.docs && b.docs.verification_amount
              ? Number(b.docs.verification_amount)
              : 75,
        }),
      );

      console.log(
        "[GET /api/data/branches] Loaded branches:",
        branches.length,
        "with extracted rates",
      );

      const response = {
        ok: true,
        branches,
      };

      // Cache the response
      setCachedResponse("branches-list", response);

      return res.json(response);
    } catch (e: any) {
      console.error("[GET /api/data/branches] Error:", e?.message);
      return res.json({ ok: false, branches: [] });
    }
  });

  // Clear cache and reload worker docs - useful for debugging
  app.post("/api/cache/clear-docs", async (_req, res) => {
    try {
      responseCache.delete("workers-docs");
      docsCache.clear();
      console.log("[POST /api/cache/clear-docs] All docs caches cleared");
      return res.json({ ok: true, message: "caches_cleared" });
    } catch (e) {
      console.error("[POST /api/cache/clear-docs] Error:", e);
      return res.status(500).json({ ok: false, message: String(e) });
    }
  });

  // Get worker docs (plan, assignedArea, or, passport) for all workers
  app.get("/api/data/workers-docs", async (req, res) => {
    let responseStarted = false;

    // Set a hard timeout - if we don't respond in 60 seconds, force response
    const hardTimeoutId = setTimeout(() => {
      if (!responseStarted && !res.headersSent) {
        console.error(
          "[GET /api/data/workers-docs] Hard timeout - forcing response",
        );
        responseStarted = true;
        res.status(500).json({ ok: false, docs: {}, error: "timeout" });
      }
    }, 60000);

    // Ensure we only send response once
    const sendResponse = (statusCode: number, data: any) => {
      if (!responseStarted) {
        responseStarted = true;
        clearTimeout(hardTimeoutId);
        res.status(statusCode).json(data);
      }
    };

    try {
      // Check response cache first (unless ?nocache=1 is passed)
      const noCache = req.query.nocache === "1";
      if (!noCache) {
        const cached = getCachedResponse("workers-docs");
        if (cached) {
          console.log("[GET /api/data/workers-docs] Returning cached response");
          return sendResponse(200, cached);
        }
      } else {
        console.log("[GET /api/data/workers-docs] Skipping cache (nocache=1)");
        responseCache.delete("workers-docs");
      }

      // Use request coalescing to prevent multiple concurrent Supabase calls
      try {
        const docsPromise = getCoalescedRequest(
          "api-workers-docs-fetch",
          async () => {
            // Return a promise that resolves to the response body
            const supaUrl = SUPABASE_URL;
            const anon = SUPABASE_ANON_KEY;
            if (!supaUrl || !anon) {
              return { ok: false, docs: {} };
            }
            const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
            const headers = {
              apikey: anon,
              Authorization: `Bearer ${anon}`,
            } as Record<string, string>;

            // Fetch docs in batches of 50 to avoid timeout
            const batchSize = 50;
            const docs: Record<string, any> = {};
            let offset = 0;
            let hasMore = true;
            let totalProcessed = 0;
            let totalWithOr = 0;
            let totalWithPassport = 0;
            const FETCH_TIMEOUT_MS = 30000; // 30 second timeout per batch fetch

            while (hasMore) {
              const u = new URL(`${rest}/hv_workers`);
              u.searchParams.set("select", "id,docs");
              u.searchParams.set("limit", String(batchSize));
              u.searchParams.set("offset", String(offset));
              u.searchParams.set("order", "name.asc");

              let workers: any[] = [];
              let fetchOk = false;

              // Try up to 3 times with delay and timeout
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(
                    () => controller.abort(),
                    FETCH_TIMEOUT_MS,
                  );

                  try {
                    const r = await fetch(u.toString(), {
                      headers,
                      signal: controller.signal,
                    });
                    clearTimeout(timeoutId);

                    if (r.ok) {
                      workers = await r.json().catch(() => []);
                      fetchOk = true;
                      break;
                    } else if (attempt < 2) {
                      console.log(
                        `[GET /api/data/workers-docs-coalesced] Attempt ${attempt + 1} failed (status ${r.status}), retrying...`,
                      );
                      await new Promise((resolve) => setTimeout(resolve, 300));
                    }
                  } catch (fetchErr) {
                    clearTimeout(timeoutId);
                    if ((fetchErr as any)?.name === "AbortError") {
                      console.log(
                        `[GET /api/data/workers-docs-coalesced] Attempt ${attempt + 1} timed out after ${FETCH_TIMEOUT_MS}ms, retrying...`,
                      );
                    } else {
                      console.log(
                        `[GET /api/data/workers-docs-coalesced] Attempt ${attempt + 1} error: ${(fetchErr as any)?.message}, retrying...`,
                      );
                    }
                    if (attempt < 2) {
                      await new Promise((resolve) => setTimeout(resolve, 300));
                    }
                  }
                } catch (e) {
                  console.error(
                    `[GET /api/data/workers-docs-coalesced] Attempt ${attempt + 1} outer error:`,
                    e,
                  );
                  if (attempt < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                  }
                }
              }

              if (!fetchOk) {
                console.warn(
                  "[GET /api/data/workers-docs-coalesced] Batch fetch failed at offset",
                  offset,
                  "after 3 attempts",
                );
                break;
              }

              if (!Array.isArray(workers) || workers.length === 0) {
                hasMore = false;
                break;
              }

              for (const w of workers) {
                if (w.id) {
                  let docsObj: any = {};
                  try {
                    const parsedDocs =
                      typeof w.docs === "string" ? JSON.parse(w.docs) : w.docs;
                    if (parsedDocs && typeof parsedDocs === "object") {
                      docsObj = parsedDocs;
                      if (parsedDocs.or) totalWithOr++;
                      if (parsedDocs.passport) totalWithPassport++;
                    }
                  } catch {}
                  docs[w.id] = docsObj;
                  totalProcessed++;
                }
              }

              offset += batchSize;
              if (workers.length < batchSize) {
                hasMore = false;
              }
            }

            return {
              ok: true,
              docs,
              totalProcessed,
              totalWithOr,
              totalWithPassport,
            };
          },
        );

        const result = await docsPromise;
        if (!result) {
          return sendResponse(200, { ok: false, docs: {} });
        }

        const response = { ok: result.ok, docs: result.docs };
        setCachedResponse("workers-docs", response);

        if (result.ok) {
          console.log(
            "[GET /api/data/workers-docs] Processed",
            result.totalProcessed,
            "workers with",
            result.totalWithOr,
            "having or and",
            result.totalWithPassport,
            "having passport",
          );
        }
        return sendResponse(200, response);
      } catch (innerErr: any) {
        console.error(
          "[GET /api/data/workers-docs] Inner error:",
          innerErr?.message || String(innerErr),
        );
        return sendResponse(200, { ok: false, docs: {} });
      }
    } catch (e) {
      console.error("[GET /api/data/workers-docs] Error:", e);
      return sendResponse(200, { ok: false, docs: {} });
    } finally {
      clearTimeout(hardTimeoutId);
    }
  });

  // Get worker details with docs field
  app.get("/api/data/workers/:id", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) {
        return res
          .status(400)
          .json({ ok: false, message: "missing_supabase_env" });
      }
      const workerId = req.params.id;
      if (!workerId) {
        return res
          .status(400)
          .json({ ok: false, message: "missing_worker_id" });
      }
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;
      const u = new URL(`${rest}/hv_workers`);
      u.searchParams.set(
        "select",
        "id,name,arrival_date,branch_id,exit_date,exit_reason,status,assigned_area,docs",
      );
      u.searchParams.set("id", `eq.${workerId}`);
      const r = await fetch(u.toString(), { headers });
      if (!r.ok) {
        return res.status(400).json({ ok: false, message: "fetch_failed" });
      }
      const workers = await r.json();
      const worker = Array.isArray(workers) ? workers[0] : null;
      if (!worker) {
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }

      // Log the structure of docs for debugging
      if (worker.docs) {
        try {
          const docs =
            typeof worker.docs === "string"
              ? JSON.parse(worker.docs)
              : worker.docs;
          console.log(
            `[GET /api/data/workers/${workerId}] Worker docs structure:`,
            {
              workerId: workerId.slice(0, 8),
              docsKeys: Object.keys(docs || {}),
              or: docs?.or,
              passport: docs?.passport,
            },
          );
        } catch {}
      }

      return res.json({ ok: true, worker });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Read verifications list (server-side proxy to Supabase) with pagination & date filtering
  app.get("/api/data/verifications", async (req, res) => {
    try {
      // Optimization: Support pagination, date-range filtering, and short-lived caching
      // Cache for 30s to handle rapid refreshes while keeping data relatively fresh

      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon) {
        return res.status(200).json({
          ok: false,
          message: "missing_supabase_env",
          verifications: [],
        });
      }
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;

      // Parse query parameters for pagination and filtering
      const limit = Math.min(Number(req.query.limit) || 1000, 5000); // Default 1000, max 5000
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const days = Number(req.query.days) || 30; // Default: last 30 days

      // Create cache key from query params
      const cacheKey = `verifications:limit=${limit}:offset=${offset}:days=${days}`;

      // Check cache first
      const cached = getCachedVerifications(cacheKey);
      if (cached) {
        console.log("[GET /api/data/verifications] Returning cached response");
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch && cached.etag === ifNoneMatch) {
          return res.status(304).end(); // Not Modified
        }
        res.setHeader("ETag", cached.etag || "");
        return res.json(cached.data);
      }

      // Calculate date range for filtering (last N days)
      const now = new Date();
      const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const fromDateStr = fromDate.toISOString();

      const u = new URL(`${rest}/hv_verifications`);
      u.searchParams.set(
        "select",
        "id,worker_id,verified_at,payment_amount,payment_saved_at",
      );

      // Add date range filter (last N days by default)
      // Allow override with query params: ?fromDate=2024-01-01&toDate=2024-12-31
      const customFromDate = req.query.fromDate as string;
      const customToDate = req.query.toDate as string;

      if (customFromDate && customToDate) {
        // Custom date range
        u.searchParams.set("verified_at", `gte.${customFromDate}`);
        u.searchParams.append("verified_at", `lte.${customToDate}`);
      } else if (customFromDate) {
        // Custom from date only
        u.searchParams.set("verified_at", `gte.${customFromDate}`);
      } else {
        // Default: last N days
        u.searchParams.set("verified_at", `gte.${fromDateStr}`);
      }

      // Add pagination
      u.searchParams.set("order", "verified_at.desc");
      u.searchParams.set("limit", limit.toString());
      u.searchParams.set("offset", offset.toString());

      // Add count header to get total count
      headers["Prefer"] = "count=exact";

      console.log(
        "[GET /api/data/verifications] Fetching fresh verifications from Supabase",
        { limit, offset, days: !customFromDate ? days : "custom" },
      );

      let r: Response | null = null;
      let retries = 3;
      const MAX_VERIF_RETRIES = 3;

      while (retries > 0) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          r = await fetch(u.toString(), { headers, signal: controller.signal });
          clearTimeout(timeoutId);

          if (r.ok || r.status < 500) {
            if (r.ok) {
              console.log(
                `[GET /api/data/verifications] Fetch successful on attempt ${MAX_VERIF_RETRIES - retries + 1}/${MAX_VERIF_RETRIES}`,
              );
            }
            break; // Success or client error, don't retry
          } else {
            console.warn(
              `[GET /api/data/verifications] Attempt ${MAX_VERIF_RETRIES - retries + 1}/${MAX_VERIF_RETRIES}: HTTP ${r.status}`,
            );
            retries--;
            if (retries > 0)
              await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (err: any) {
          console.warn(
            `[GET /api/data/verifications] Attempt ${MAX_VERIF_RETRIES - retries + 1}/${MAX_VERIF_RETRIES} error:`,
            err?.message,
          );
          retries--;
          if (retries > 0)
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      if (!r || !r.ok) {
        console.warn(
          "[GET /api/data/verifications] Load failed after retries, using empty fallback",
        );
        // Return empty verifications fallback (no data yet)
        return res.status(200).json({
          ok: true,
          verifications: [],
          pagination: { limit, offset, total: 0 },
        });
      }

      const verifications = await r.json().catch(() => []);
      const totalCount = r.headers.get("content-range")
        ? parseInt(r.headers.get("content-range")!.split("/")[1], 10)
        : verifications.length;

      console.log("[GET /api/data/verifications] Loaded verifications:", {
        loaded: verifications.length,
        total: totalCount,
        offset,
        limit,
      });

      const response = {
        ok: true,
        verifications,
        pagination: {
          limit,
          offset,
          total: totalCount,
          hasMore: offset + verifications.length < totalCount,
        },
      };

      // Generate ETag from response data hash
      const etag = `"${(verifications.length + totalCount + offset).toString()}"`;

      // Cache the response
      setCachedVerifications(cacheKey, response, etag);

      // Send ETag header
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=30");

      return res.json(response);
    } catch (e: any) {
      return res.status(200).json({
        ok: false,
        message: e?.message || String(e),
        verifications: [],
        pagination: { limit: 0, offset: 0, total: 0 },
      });
    }
  });

  // Create a new verification entry
  app.post("/api/verification/create", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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

      if (!workerId)
        return res.status(400).json({
          ok: false,
          message: "invalid_worker_id",
        });

      // Fetch worker to get branch ID (unused now, but keeping for potential future use)
      const apihRead = {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      } as Record<string, string>;

      const now = new Date().toISOString();
      const ins = await fetch(`${rest}/hv_verifications`, {
        method: "POST",
        headers: { ...apihWrite, Prefer: "return=representation" },
        body: JSON.stringify([
          {
            worker_id: workerId,
            verified_at: now,
          },
        ]),
      });
      if (!ins.ok) {
        const t = await ins.text();
        return res
          .status(500)
          .json({ ok: false, message: t || "insert_verification_failed" });
      }
      const j = await ins.json();
      const vid = j?.[0]?.id || null;
      if (!vid)
        return res
          .status(500)
          .json({ ok: false, message: "no_verification_id" });
      invalidateWorkersCache();
      clearCachedVerifications();
      responseCache.delete("verifications-list");
      return res.json({ ok: true, id: vid, verifiedAt: now });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Backfill verifications without payment amounts
  // This endpoint is kept for backward compatibility but is no longer needed
  // as verifications now get payment_amount set when created
  app.post("/api/verification/backfill-payments", async (req, res) => {
    try {
      // Return success immediately - no backfill needed
      // Payment amounts are set at verification creation time
      console.log("[backfill-payments] Backfill request received (no-op)");
      return res.json({ ok: true, updated: 0, message: "no_backfill_needed" });
    } catch (e: any) {
      return res.json({ ok: true, updated: 0, message: "backfill_skipped" });
    }
  });

  // Save payment for latest verification of a worker
  app.post("/api/verification/payment", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      const service = SUPABASE_SERVICE_ROLE;

      console.log("[/api/verification/payment] Request received", {
        service_key_exists: !!service,
      });

      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
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
      const verificationId = String(
        body.verificationId ??
          body.verification_id ??
          body.vid ??
          qs3.verificationId ??
          qs3.verification_id ??
          qs3.vid ??
          hdrs["x-verification-id"] ??
          hdrs["x-vid"] ??
          "",
      ).trim();
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
      if (!Number.isFinite(amount) || amount <= 0)
        return res.status(400).json({
          ok: false,
          message: "invalid_amount",
          debug: {
            amount,
          },
        });

      // Use the provided verificationId from face verification
      // (Each face verification now creates its own record)
      let vid = verificationId || null;

      if (!vid)
        return res
          .status(400)
          .json({ ok: false, message: "no_verification_id" });
      // update payment fields on verification
      const now2 = new Date().toISOString();
      console.log("[/api/verification/payment] Updating verification payment", {
        vid: vid?.slice(0, 8),
        amount,
        saved_at: now2,
      });

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
        console.error("[/api/verification/payment] Patch failed", {
          status: patch.status,
          error: t,
          vid: vid?.slice(0, 8),
        });
        return res
          .status(500)
          .json({ ok: false, message: t || "update_failed" });
      }

      console.log("[/api/verification/payment] Patch successful");

      // Invalidate all caches BEFORE inserting payment row to force fresh fetch next time
      invalidateWorkersCache();
      clearCachedVerifications();
      console.log("[/api/verification/payment] Cache invalidated after patch");

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
        console.error("[/api/verification/payment] Payment insert failed:", t);
        return res
          .status(500)
          .json({ ok: false, message: t || "insert_payment_failed" });
      }
      console.log(
        "[/api/verification/payment] Payment row inserted successfully, returning ok",
      );
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
        const supaUrl = SUPABASE_URL as string | undefined;
        const anon = SUPABASE_ANON_KEY as string | undefined;
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

      let verificationId: string | null = null;

      // On success, create a NEW verification record and patch face log
      if (success && body.workerId) {
        const supaUrl = SUPABASE_URL as string | undefined;
        const anon = SUPABASE_ANON_KEY as string | undefined;
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

          // Create a NEW verification record for this face match
          try {
            const verRes = await fetch(`${rest}/hv_verifications`, {
              method: "POST",
              headers,
              body: JSON.stringify([
                {
                  worker_id: body.workerId,
                  verified_at: now,
                },
              ]),
            });
            if (verRes.ok) {
              const verData = await verRes.json().catch(() => [] as any[]);
              verificationId =
                Array.isArray(verData) && verData[0]?.id ? verData[0].id : null;
              console.log("[/api/face/compare] Verification record created:", {
                verificationId: verificationId?.slice(0, 8),
                workerId: body.workerId?.slice(0, 8),
              });
            } else {
              console.error(
                "[/api/face/compare] Failed to create verification:",
                {
                  status: verRes.status,
                  body: await verRes.text(),
                },
              );
            }
          } catch (e) {
            console.error(
              "[/api/face/compare] Exception creating verification:",
              e,
            );
          }

          // Patch docs.face_last - merge with existing docs
          try {
            // First fetch existing docs
            const getWorker = await fetch(
              `${rest}/hv_workers?id=eq.${body.workerId}&select=docs`,
              {
                headers: {
                  apikey: anon,
                  Authorization: `Bearer ${service || anon}`,
                },
              },
            );
            if (!getWorker.ok) {
              console.error(
                "[/api/face/compare] Failed to fetch worker docs:",
                getWorker.status,
              );
              return;
            }
            const workerArr = await getWorker.json();
            const existingDocs =
              Array.isArray(workerArr) && workerArr[0]?.docs
                ? workerArr[0].docs
                : {};

            // Merge face_last into existing docs
            const patchRes = await fetch(
              `${rest}/hv_workers?id=eq.${body.workerId}`,
              {
                method: "PATCH",
                headers,
                body: JSON.stringify({
                  docs: {
                    ...existingDocs,
                    face_last: { similarity, at: now, method: "aws_compare" },
                  },
                }),
              },
            );
            if (!patchRes.ok) {
              const errText = await patchRes.text();
              console.error("[/api/face/compare] Failed to patch face_last:", {
                status: patchRes.status,
                error: errText,
              });
            } else {
              console.log("[/api/face/compare] face_last patched successfully");
            }
          } catch (e) {
            console.error(
              "[/api/face/compare] Exception patching face_last:",
              e,
            );
          }
        } else {
          console.error(
            "[/api/face/compare] Missing Supabase environment variables",
          );
        }
      }

      return res.json({
        ok: true,
        success,
        similarity,
        workerId: body.workerId || null,
        verificationId: verificationId || undefined,
        verificationCreated: !!verificationId,
      });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  // Worker statuses: update housing system and main system statuses
  app.post("/api/workers/statuses", async (req, res) => {
    try {
      const supaUrl = SUPABASE_URL;
      const anon = SUPABASE_ANON_KEY;
      if (!supaUrl || !anon)
        return res
          .status(500)
          .json({ ok: false, message: "missing_supabase_env" });
      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const service = SUPABASE_SERVICE_ROLE;
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
        housingSystemStatus?: string;
        mainSystemStatus?: string;
      };
      const hdrs = (req as any).headers || {};
      const workerId = String(
        body.workerId ?? hdrs["x-worker-id"] ?? "",
      ).trim();
      const housingSystemStatus =
        String(
          body.housingSystemStatus ?? hdrs["x-housing-status"] ?? "",
        ).trim() || null;
      const mainSystemStatus =
        String(body.mainSystemStatus ?? hdrs["x-main-status"] ?? "").trim() ||
        null;

      if (!workerId) {
        return res.status(400).json({
          ok: false,
          message: "missing_worker_id",
        });
      }

      // Load current worker docs
      const rw = await fetch(
        `${rest}/hv_workers?id=eq.${workerId}&select=id,docs`,
        { headers: apihRead },
      );
      if (!rw.ok) {
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }
      const arrW = await rw.json();
      const w = Array.isArray(arrW) ? arrW[0] : null;
      if (!w) {
        return res.status(404).json({ ok: false, message: "worker_not_found" });
      }

      // Merge with existing docs
      let docs: any = {};
      if (w.docs) {
        try {
          docs = typeof w.docs === "string" ? JSON.parse(w.docs) : w.docs;
        } catch {
          docs = {};
        }
      }
      if (housingSystemStatus !== null) {
        docs.housing_system_status = housingSystemStatus;
      }
      if (mainSystemStatus !== null) {
        docs.main_system_status = mainSystemStatus;
      }

      // Update worker docs in Supabase
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

      invalidateWorkersCache();
      return res.json({ ok: true, message: "statuses_updated" });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  });

  return app;
}
