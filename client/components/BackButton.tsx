import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/context/I18nContext";

const PREVIOUS_PATH_KEY = "hv_previous_path";

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tr } = useI18n();
  const [dir, setDir] = useState<string>("rtl");

  // Track navigation history in localStorage
  useEffect(() => {
    setDir(document?.documentElement?.dir || "rtl");
  }, []);

  useEffect(() => {
    // Save current path before navigating away
    try {
      localStorage.setItem(PREVIOUS_PATH_KEY, location.pathname);
    } catch {}
  }, [location.pathname]);

  const Icon = dir === "rtl" ? ChevronRight : ChevronLeft;

  function handleBack() {
    try {
      const previousPath = localStorage.getItem(PREVIOUS_PATH_KEY);
      const currentPathname = window.location.pathname;

      // Determine where to go back to
      let targetPath = "/";

      // If current page is a details page, go back to the previous page stored in localStorage
      if (currentPathname.startsWith("/workers/")) {
        // Use previousPath if available and valid
        if (previousPath && previousPath !== currentPathname) {
          targetPath = previousPath;
        } else {
          // Fallback to /workers if no previous path
          targetPath = "/workers";
        }
      } else if (currentPathname.startsWith("/no-expense")) {
        targetPath = "/";
      }

      navigate(targetPath, { replace: true });
    } catch {
      // Fallback if localStorage fails
      navigate(-1);
    }
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
