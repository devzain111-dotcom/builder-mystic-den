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

  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      {t("no_device_events")}
    </div>
  );
}
