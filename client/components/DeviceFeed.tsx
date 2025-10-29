import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/context/I18nContext";

interface Row { verified_at: string; worker: { name: string } | null }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export default function DeviceFeed({ limit = 20, pollMs = 5000 }: { limit?: number; pollMs?: number }) {
  const enabled = !!(SUPABASE_URL && SUPABASE_ANON);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const { t, locale } = useI18n();
  const rest = useMemo(() => (enabled ? `${SUPABASE_URL}/rest/v1` : null), [enabled]);

  async function load() {
    if (!rest) return; setLoading(true);
    try {
      const url = new URL(`${rest}/hv_verifications`);
      url.searchParams.set("select", "verified_at,worker:hv_workers(name)");
      url.searchParams.set("order", "verified_at.desc");
      url.searchParams.set("limit", String(limit));
      const res = await fetch(url.toString(), { headers: { apikey: SUPABASE_ANON!, Authorization: `Bearer ${SUPABASE_ANON}` } });
      if (!res.ok) throw new Error(String(res.status));
      const data: Row[] = await res.json();
      setRows(data);
    } catch {
      // ignore
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); const t = setInterval(load, pollMs); return () => clearInterval(t); }, [rest, pollMs]);

  if (!enabled) {
    return <div className="p-6 text-center text-sm text-muted-foreground">لم يتم ضبط اتصال Supabase. يرجى توفير مفاتيح الاتصال.</div>;
  }

  return (
    <div className="p-4 space-y-3">
      {loading && rows.length === 0 ? (<div className="text-sm text-muted-foreground">جاري التحميل…</div>) : null}
      {rows.length === 0 && !loading ? (<div className="text-sm text-muted-foreground">لا توجد أحداث من الجهاز بعد.</div>) : null}
      <ul className="divide-y rounded-md border">
        {rows.map((r, i) => (
          <li key={i} className="px-3 py-2 text-sm flex items-center justify-between">
            <span className="font-medium">{r.worker?.name || "—"}</span>
            <time className="text-xs text-muted-foreground">{new Date(r.verified_at).toLocaleString("ar-EG")}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
