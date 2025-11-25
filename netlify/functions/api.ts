import serverless from "serverless-http";
import { createServer } from "../../server";

const app = createServer();

export const handler = serverless(app, {
  request(request, event, context) {
    console.log("[Netlify] Received request:", event.httpMethod, event.path);
    return request;
  },
  response(response) {
    console.log("[Netlify] Response status:", response.statusCode);
    return response;
  },
});
