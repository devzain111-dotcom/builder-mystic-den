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
  const snap =
    Array.isArray(arr) && arr[0]?.snapshot_b64
      ? String(arr[0].snapshot_b64)
      : null;
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
  if (!supaUrl || !anon) return { ok: false };
  const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${service || anon}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  } as Record<string, string>;
  const now = new Date().toISOString();
  const r = await fetch(`${rest}/hv_verifications`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ worker_id: workerId, verified_at: now }]),
  });
  if (!r.ok) return { ok: false };
  const out = await r.json().catch(() => null as any);
  return { ok: true, id: out?.[0]?.id };
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
  // Fetch current docs
  const r0 = await fetch(`${rest}/hv_workers?id=eq.${workerId}&select=docs`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
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

    const region = (
      (process.env.AWS_REGION ||
        process.env.SERVER_AWS_REGION ||
        process.env.VITE_AWS_REGION) as string | undefined
    )?.trim();
    const accessKeyId = (
      (process.env.AWS_ACCESS_KEY_ID ||
        process.env.SERVER_AWS_ACCESS_KEY_ID ||
        process.env.VITE_AWS_ACCESS_KEY_ID) as string | undefined
    )?.trim();
    const secretAccessKey = (
      (process.env.AWS_SECRET_ACCESS_KEY ||
        process.env.SERVER_AWS_SECRET_ACCESS_KEY ||
        process.env.VITE_AWS_SECRET_ACCESS_KEY) as string | undefined
    )?.trim();
    if (!region || !accessKeyId || !secretAccessKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, message: "missing_aws_env" }),
      };
    }

    const sessionToken = (
      (process.env.AWS_SESSION_TOKEN ||
        process.env.SERVER_AWS_SESSION_TOKEN ||
        process.env.VITE_AWS_SESSION_TOKEN) as string | undefined
    )?.trim();
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

    if (success && workerId) {
      await insertVerification(workerId);
      await patchWorkerFaceLog(workerId, similarity);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        success,
        similarity,
        workerId: workerId || null,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, message: err?.message || String(err) }),
    };
  }
}
