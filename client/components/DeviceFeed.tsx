import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/context/I18nContext";

interface Row {
  verified_at: string;
  worker: { name: string } | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

export default function DeviceFeed({
  limit = 20,
  pollMs = 15000,
}: {
  limit?: number;
  pollMs?: number;
}) {
  // DeviceFeed disabled - polling with Supabase relation queries causes excessive API calls
  // causing "GET /rest/v1/hv_workers" to be called repeatedly
  // This component is not critical for the application flow and can be safely disabled
  const [rows] = useState<Row[]>([]);
  const [loading] = useState(false);
  const { t } = useI18n();

  // Prevent any automatic polling or API calls
  useEffect(() => {
    return undefined;
  }, []);

  if (!enabled) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        {t("supabase_not_configured")}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {loading && rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : null}
      {rows.length === 0 && !loading ? (
        <div className="text-sm text-muted-foreground">
          {t("no_device_events")}
        </div>
      ) : null}
      <ul className="divide-y rounded-md border">
        {rows.map((r, i) => (
          <li
            key={i}
            className="px-3 py-2 text-sm flex items-center justify-between"
          >
            <span className="font-medium">{r.worker?.name || "—"}</span>
            <time className="text-xs text-muted-foreground">
              {new Date(r.verified_at).toLocaleString(
                locale === "ar" ? "ar-EG" : "en-US",
              )}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
