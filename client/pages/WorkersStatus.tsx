import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const PREP_URL =
  "https://recruitmentportalph.com/pirs/admin/applicants/quick_search?keyword=ACOSTA";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let hiddenIframe: HTMLIFrameElement | null = null;

    const initializeSession = async () => {
      // Create hidden iframe to load the prep URL first
      hiddenIframe = document.createElement("iframe");
      hiddenIframe.src = PREP_URL;
      hiddenIframe.style.display = "none";
      hiddenIframe.style.position = "fixed";
      hiddenIframe.style.top = "-9999px";
      hiddenIframe.style.left = "-9999px";
      hiddenIframe.sandbox.add(
        "allow-scripts",
        "allow-forms",
        "allow-same-origin",
        "allow-popups"
      );
      hiddenIframe.setAttribute("referrerPolicy", "no-referrer");
      hiddenIframe.setAttribute("title", "prep-iframe");

      const onIframeLoad = () => {
        // After prep iframe loads, wait a moment and mark as ready
        if (isMounted) {
          setTimeout(() => {
            setIsReady(true);
          }, 1500);
        }
      };

      const onIframeError = () => {
        // If prep iframe fails, still mark as ready
        if (isMounted) {
          setTimeout(() => {
            setIsReady(true);
          }, 500);
        }
      };

      hiddenIframe.onload = onIframeLoad;
      hiddenIframe.onerror = onIframeError;

      document.body.appendChild(hiddenIframe);

      // Fallback: if iframe doesn't load within 10 seconds, mark as ready anyway
      const fallbackTimeout = setTimeout(() => {
        if (isMounted && !isReady) {
          setIsReady(true);
        }
      }, 10000);

      return () => {
        clearTimeout(fallbackTimeout);
        if (hiddenIframe && document.body.contains(hiddenIframe)) {
          try {
            document.body.removeChild(hiddenIframe);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };
    };

    initializeSession();

    return () => {
      isMounted = false;
      if (hiddenIframe && document.body.contains(hiddenIframe)) {
        try {
          document.body.removeChild(hiddenIframe);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/10">
      <section className="container py-4 space-y-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <h1 className="text-xl font-bold">
            {tr("التحقق من حالات المتقدمات", "Check applicants status")}
          </h1>
          <div className="hidden sm:block">
            <BackButton />
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background">
          {!isReady && (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <div className="text-center space-y-4">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                <p className="text-muted-foreground">
                  {tr("جاري التحضير...", "Preparing...")}
                </p>
              </div>
            </div>
          )}

          {isReady && (
            <iframe
              src={TARGET_URL}
              className="w-full h-full border-none"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation allow-modals"
              title="applicants-status"
            />
          )}
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
