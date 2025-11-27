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

  // Server-side cache for branch and worker docs with request coalescing
  // In-flight requests map to deduplicate simultaneous identical requests
  const inFlightRequests = new Map<string, Promise<any>>();
  const docsCache = new Map<string, { data: any; timestamp: number }>();
  const DOCS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes - long TTL to minimize repeated queries
  const BRANCH_DOCS_CACHE_TTL = 60 * 60 * 1000; // 60 minutes for branch docs (rarely change)

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

  // Fetch branch docs with request coalescing and caching
  async function fetchBranchDocs(branchId: string): Promise<any> {
    const cached = getCachedBranchDocs(branchId);
    if (cached) return cached;

    const result = await getCoalescedRequest(
      `branch-docs:${branchId}`,
      async () => {
        const supaUrl = process.env.VITE_SUPABASE_URL;
        const anon = process.env.VITE_SUPABASE_ANON_KEY;
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
        const docs = branch?.docs || {};
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
        const supaUrl = process.env.VITE_SUPABASE_URL;
        const anon = process.env.VITE_SUPABASE_ANON_KEY;
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
        const docs = (Array.isArray(a) && a[0]?.docs) || {};
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
      supabaseUrl: !!process.env.VITE_SUPABASE_URL,
      supabaseAnonKey: !!process.env.VITE_SUPABASE_ANON_KEY,
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