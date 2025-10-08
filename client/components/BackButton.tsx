import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/context/I18nContext";

export default function BackButton() {
  const navigate = useNavigate();
  const { tr } = useI18n();
  const [dir, setDir] = useState<string>("rtl");
  useEffect(() => {
    setDir(document?.documentElement?.dir || "rtl");
  }, []);
  const Icon = dir === "rtl" ? ChevronRight : ChevronLeft;

  function handleBack() {
    const ref = document.referrer || "";
    const sameOrigin = ref.startsWith(window.location.origin);
    // If we have history and referrer is same-origin, go back; otherwise, fallback
    if (sameOrigin && window.history.length > 1) {
      navigate(-1);
      return;
    }
    const p = window.location.pathname.startsWith("/workers/") ? "/workers" : "/";
    navigate(p, { replace: true });
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
      aria-label={tr("رجوع", "Back")}
    >
      <Icon className="h-4 w-4" />
      <span>{tr("رجوع", "Back")}</span>
    </button>
  );
}
