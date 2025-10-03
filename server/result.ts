import type { Handler } from "@netlify/functions";
import AWS from "aws-sdk";
import { createClient } from "@supabase/supabase-js";

const rekognition = new AWS.Rekognition({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const { sessionId } = JSON.parse(event.body || "{}");

    const result = await rekognition.getFaceLivenessSessionResults({
      SessionId: sessionId,
    }).promise();

    if (result.Confidence && result.Confidence > 80) {
      // احفظ النتيجة في Supabase
      await supabase.from("workers").insert({
        session_id: sessionId,
        confidence: result.Confidence,
        created_at: new Date(),
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true }),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, message: "Liveness check failed" }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, message: err.message }),
    };
  }
};
