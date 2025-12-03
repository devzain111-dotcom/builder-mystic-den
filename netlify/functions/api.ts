import serverless from "serverless-http";
import { createServer } from "../../server";

const app = createServer();

console.log(
  "[Netlify API] SUPABASE_URL:",
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL ? "✓" : "✗",
);
console.log(
  "[Netlify API] SUPABASE_ANON_KEY:",
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    ? "✓"
    : "✗",
);
console.log(
  "[Netlify API] SUPABASE_SERVICE_ROLE_KEY:",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY
    ? "✓"
    : "✗",
);

export const handler = serverless(app, {
  binary: ["image/*", "font/*"],
});
