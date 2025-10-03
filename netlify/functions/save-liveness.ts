import { neon } from "@neondatabase/serverless";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { sessionId, status, confidence, workerId } = JSON.parse(event.body);

    if (!sessionId || !status || !workerId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // الاتصال بقاعدة البيانات Neon
    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    // إنشاء الجدول إذا لم يكن موجود
    await sql`
      CREATE TABLE IF NOT EXISTS liveness_results (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence NUMERIC,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // إدخال البيانات
    await sql`
      INSERT INTO liveness_results (session_id, worker_id, status, confidence)
      VALUES (${sessionId}, ${workerId}, ${status}, ${confidence});
    `;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "Liveness saved successfully" }),
    };
  } catch (err) {
    console.error("DB Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}
