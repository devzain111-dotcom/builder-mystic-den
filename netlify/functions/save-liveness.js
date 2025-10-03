import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ ok: false, message: "Method Not Allowed" }),
      };
    }

    const body = JSON.parse(event.body);

    // تحقق أن البيانات موجودة
    if (!body.sessionId || !body.status) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, message: "Missing required fields" }),
      };
    }

    // إدخال البيانات في قاعدة Neon
    await sql`
      INSERT INTO liveness_checks (session_id, status, confidence, worker_id)
      VALUES (${body.sessionId}, ${body.status}, ${body.confidence || null}, ${body.workerId || null})
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "Data saved successfully" }),
    };
  } catch (err) {
    console.error("DB error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, message: "Database error", error: err.message }),
    };
  }
}
