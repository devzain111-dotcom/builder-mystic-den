import {
  RekognitionClient,
  CompareFacesCommand,
} from "@aws-sdk/client-rekognition";

// Helper to normalize base64 (remove data URL prefix)
function normalizeB64(b64: string): string {
  if (!b64) return b64;
  const idx = b64.indexOf(",");
  return b64.startsWith("data:") && idx !== -1 ? b64.slice(idx + 1) : b64;
}

async function fetchWorkerSnapshotFromSupabase(
  workerId: string,
): Promise<string | null> {
  const supaUrl = process.env.VITE_SUPABASE_URL as string | undefined;
  const anon = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl || !anon) return null;
  const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
  const hdr = { apikey: anon, Authorization: `Bearer ${anon}` } as Record<
    string,
    string
  >;
  // Get the latest face profile snapshot for worker
  const u = new URL(`${rest}/hv_face_profiles`);
  u.searchParams.set("select", "snapshot_b64,created_at");
  u.searchParams.set("worker_id", `eq.${workerId}`);
  u.searchParams.set("order", "created_at.desc");
  u.searchParams.set("limit", "1");
  const r = await fetch(u.toString(), { headers: hdr });
  if (!r.ok) return null;
  const arr = (await r.json()) as Array<{ snapshot_b64?: string | null }>;
  let snap =
    Array.isArray(arr) && arr[0]?.snapshot_b64
      ? String(arr[0].snapshot_b64)
      : null;
  if (snap && !snap.startsWith("data:")) {
    try {
      const resp = await fetch(snap);
      const ct = resp.headers.get("content-type") || "image/jpeg";
      const ab = await resp.arrayBuffer();
      const b64 = Buffer.from(new Uint8Array(ab)).toString("base64");
      snap = `data:${ct};base64,${b64}`;
    } catch {
      // ignore; return URL as-is (caller will fail gracefully if needed)
    }
  }
  return snap;
}

async function insertVerification(
  workerId: string,
): Promise<{ ok: boolean; id?: string }> {
  const supaUrl = process.env.VITE_SUPABASE_URL as string | undefined;
  const anon = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "") as string;
  if (!supaUrl || !anon) {
    console.error(
      "[insertVerification] Missing Supabase environment variables",
    );
    return { ok: false };
  }
  const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${service || anon}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  } as Record<string, string>;
  const readHeaders = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
  } as Record<string, string>;
  const now = new Date().toISOString();

  try {
    // Fetch worker to get branch ID
    const workerResp = await fetch(
      `${rest}/hv_workers?id=eq.${workerId}&select=branch_id`,
      { headers: readHeaders },
    );
    if (!workerResp.ok) {
      console.error("[insertVerification] Failed to fetch worker:", {
        status: workerResp.status,
        workerId,
      });
      return { ok: false };
    }
    const workers = await workerResp.json().catch(() => [] as any[]);

    const r = await fetch(`${rest}/hv_verifications`, {
      method: "POST",
      headers,
      body: JSON.stringify([{
        worker_id: workerId,
        verified_at: now,
      }]),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("[insertVerification] Failed to insert verification:", {
        status: r.status,
        error: errText,
        workerId,
        timestamp: now,
      });
      return { ok: false };
    }
    const out = await r.json().catch(() => null as any);
    console.log("[insertVerification] Success:", {
      id: out?.[0]?.id,
      workerId,
      timestamp: now,
    });
    return { ok: true, id: out?.[0]?.id };
  } catch (e) {
    console.error("[insertVerification] Exception:", e, {
      workerId,
      timestamp: now,
    });
    return { ok: false };
  }
}

async function patchWorkerFaceLog(workerId: string, similarity: number) {
  const supaUrl = process.env.VITE_SUPABASE_URL as string | undefined;
  const anon = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "") as string;
  if (!supaUrl || !anon) return;
  const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${service || anon}`,
    "Content-Type": "application/json",
  } as Record<string, string>;
  // Merge into docs JSON: { face_last: { similarity, at, method: 'aws_compare' } }
  const at = new Date().toISOString();
  try {
    // Fetch current docs to preserve other fields
    const r0 = await fetch(
      `${rest}/hv_workers?id=eq.${workerId}&select=id,docs`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      },
    );
    if (!r0.ok) return;
    const j0 = await r0.json().catch(() => [] as any[]);
    const current = Array.isArray(j0) && j0[0]?.docs ? j0[0].docs : {};
    const next = {
      ...(current || {}),
      face_last: { similarity, at, method: "aws_compare" },
    };
    await fetch(`${rest}/hv_workers?id=eq.${workerId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ docs: next }),
    });
  } catch (e) {
    // Silently fail - this is a logging operation
  }
}

export async function handler(event: any) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ ok: false, message: "Method Not Allowed" }),
      };
    }
    const body =
      typeof event.body === "string"
        ? JSON.parse(event.body || "{}")
        : event.body || {};
    let { sourceImageB64, targetImageB64, workerId, similarityThreshold } =
      body as {
        sourceImageB64?: string;
        targetImageB64?: string;
        workerId?: string;
        similarityThreshold?: number;
      };
    if (!sourceImageB64)
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, message: "missing_source_image" }),
      };

    if (!targetImageB64) {
      if (!workerId)
        return {
          statusCode: 400,
          body: JSON.stringify({
            ok: false,
            message: "missing_target_or_worker",
          }),
        };
      targetImageB64 = await fetchWorkerSnapshotFromSupabase(workerId);
      if (!targetImageB64)
        return {
          statusCode: 404,
          body: JSON.stringify({ ok: false, message: "no_registered_face" }),
        };
    }

    const sanitize = (v?: string) =>
      (v || "").replace(/^['\"]+|['\"]+$/g, "").trim() || undefined;
    const region = sanitize(
      process.env.SERVER_AWS_REGION as string | undefined,
    );
    const accessKeyId = sanitize(
      process.env.SERVER_AWS_ACCESS_KEY_ID as string | undefined,
    );
    const secretAccessKey = sanitize(
      process.env.SERVER_AWS_SECRET_ACCESS_KEY as string | undefined,
    );
    if (!region || !accessKeyId || !secretAccessKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, message: "missing_aws_env" }),
      };
    }

    const sessionToken = sanitize(
      process.env.SERVER_AWS_SESSION_TOKEN as string | undefined,
    );
    const source = "server";
    const client = new RekognitionClient({
      region,
      credentials: { accessKeyId, secretAccessKey, sessionToken },
    });
    const command = new CompareFacesCommand({
      SourceImage: {
        Bytes: Buffer.from(normalizeB64(sourceImageB64), "base64"),
      },
      TargetImage: {
        Bytes: Buffer.from(normalizeB64(targetImageB64!), "base64"),
      },
      SimilarityThreshold:
        similarityThreshold != null ? Number(similarityThreshold) : 80,
    });
    const result = await client.send(command);
    const match = result?.FaceMatches?.[0];
    const similarity = (match?.Similarity as number) || 0;
    const success =
      similarity >=
      (similarityThreshold != null ? Number(similarityThreshold) : 80);

    let verificationCreated = false;
    if (success && workerId) {
      const verRes = await insertVerification(workerId);
      verificationCreated = verRes.ok;
      console.log("[netlify/compare-face] Verification insert result:", {
        ok: verRes.ok,
        id: verRes.id,
        workerId,
      });
      await patchWorkerFaceLog(workerId, similarity);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        success,
        similarity,
        workerId: workerId || null,
        verificationCreated,
      }),
    };
  } catch (err: any) {
    const meta = {
      name: err?.name,
      code: err?.code || err?.$metadata?.httpStatusCode,
      message: err?.message || String(err),
    } as any;
    if (typeof region !== "undefined") meta.region = region;
    if (typeof source !== "undefined") meta.source = source;
    if (typeof accessKeyId !== "undefined")
      meta.keyIdSuffix = (accessKeyId || "").slice(-4);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, ...meta }),
    };
  }
}
