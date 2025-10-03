import type { Handler } from "@netlify/functions";
import AWS from "aws-sdk";

const rekognition = new AWS.Rekognition({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const handler: Handler = async () => {
  try {
    // أنشئ جلسة Liveness
    const session = await rekognition.createFaceLivenessSession({
      // خصائص مطلوبة من AWS
      ClientRequestToken: Date.now().toString(),
    }).promise();

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        sessionId: session.SessionId,
        region: process.env.AWS_REGION,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, message: err.message }),
    };
  }
};
