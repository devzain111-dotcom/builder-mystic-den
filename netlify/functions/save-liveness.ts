import type { Handler } from "@netlify/functions";
import { neon } from "@netlify/neon";

const sql = neon(); // يستخدم NETLIFY_DATABASE_URL تلقائيًا

export const handler: Handler = async (event) => {
  try {
    if (!event.body) {
      return { statusCode: 400, body: "Missing body" };
    }

    const { sessionId, status, confidence, workerId } = JSON.parse(event.body);

    const result = await sql`
      INSERT INTO liveness_results (session_id, status, confidence, worker_id)
      VALUES (${sessionId}, ${status}, ${confidence ?? null}, ${workerId ?? null})
      RETURNING id, created_at
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, result }),
    };
  } catch (err: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
