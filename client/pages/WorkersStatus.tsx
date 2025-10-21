import { useEffect, useState, useRef } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const PREP_URL =
  "https://recruitmentportalph.com/pirs/admin/applicants/quick_search?keyword=ACOSTA";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(PREP_URL);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;

    const handleIframeLoad = () => {
      if (!isMounted) return;

      // After prep URL loads successfully, wait a moment then switch to target URL
      if (currentUrl === PREP_URL) {
        // Clear any existing timeout
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
        }

        // Wait 2 seconds for session to be fully established, then switch
        transitionTimeoutRef.current = setTimeout(() => {
          if (isMounted) {
            setIsReady(true);
            setCurrentUrl(TARGET_URL);
          }
        }, 2000);
      }
    };

    if (iframeRef.current) {
      iframeRef.current.addEventListener("load", handleIframeLoad);
      return () => {
        iframeRef.current?.removeEventListener("load", handleIframeLoad);
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
        }
      };
    }

    return () => {
      isMounted = false;
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [currentUrl]);

  // Fallback timeout in case iframe doesn't load
  useEffect(() => {
    const fallbackTimeout = setTimeout(() => {
      setIsReady(true);
      setCurrentUrl(TARGET_URL);
    }, 15000);

    return () => clearTimeout(fallbackTimeout);
  }, []);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/10">
      <section className="container py-4 space-y-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <h1 className="text-xl font-bold">
            {tr("التحقق من حالات المت��دمات", "Check applicants status")}
          </h1>
          <div className="hidden sm:block">
            <BackButton />
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background">
          {!isReady ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <div className="text-center space-y-4">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                <p className="text-muted-foreground">
                  {tr("جاري التحضير...", "Preparing...")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "يتم تحميل الجلسة حالياً",
                    "Loading session..."
                  )}
                </p>
              </div>
            </div>
          ) : null}

          <iframe
            ref={iframeRef}
            src={currentUrl}
            className={`w-full h-full border-none transition-opacity ${
              isReady ? "opacity-100" : "opacity-0"
            }`}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation allow-modals"
            title="applicants-status"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {tr(
            "ملاحظة: إذا لم تظهر الصفحة داخل الإطار، فربما يمنع الموقع التضمين (X-Frame-Options/CSP).",
            "Note: If the page does not appear inside the frame, the site may block embedding (X-Frame-Options/CSP)."
          )}
        </p>
      </section>
    </main>
  );
}
