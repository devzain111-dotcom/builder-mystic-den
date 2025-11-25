import serverless from "serverless-http";
import { createServer } from "../../server";

const app = createServer();

console.log(
  "[Netlify API] VITE_SUPABASE_URL:",
  process.env.VITE_SUPABASE_URL ? "✓" : "✗"
);
console.log(
  "[Netlify API] VITE_SUPABASE_ANON_KEY:",
  process.env.VITE_SUPABASE_ANON_KEY ? "✓" : "✗"
);

export const handler = serverless(app, {
  binary: ["image/*", "font/*"],
});
