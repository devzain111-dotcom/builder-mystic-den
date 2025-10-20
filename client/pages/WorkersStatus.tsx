import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";
const USERNAME = "zain";
const PASSWORD = "zain";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const performAutoLogin = async () => {
      try {
        // Step 1: Try to login via POST request
        const formData = new FormData();
        formData.append("username", USERNAME);
        formData.append("password", PASSWORD);

        await fetch(LOGIN_URL, {
          method: "POST",
          body: formData,
          credentials: "include",
          mode: "cors",
        }).catch(() => null);

        // Step 2: Wait a moment for session to be established
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Step 3: Create a visible iframe to load the target page
        if (isMounted) {
          setIsReady(true);
        }
      } catch (err) {
        console.error("Auto-login error:", err);
        if (isMounted) {
          // Still try to load the page even if login failed
          setIsReady(true);
        }
      }
    };

    performAutoLogin();

    return () => {
      isMounted = false;
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
          {!isReady && !error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                <p className="text-muted-foreground">
                  {tr(
                    "جاري تحضير البيانات...",
                    "Preparing data..."
                  )}
                </p>
              </div>
            </div>
          )}
          {error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center space-y-4">
                <p className="text-red-600">{error}</p>
              </div>
            </div>
          )}
          {isReady && !error && (
            <iframe
              src={TARGET_URL}
              className="w-full h-full border-none"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation"
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
