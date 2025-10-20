import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const performLogin = () => {
      setIsLoggingIn(true);

      // Open login page in a new window
      const loginWindow = window.open(
        LOGIN_URL,
        "login_window",
        "width=800,height=600,left=100,top=100"
      );

      if (loginWindow) {
        // Monitor when user closes the login window
        const checkInterval = setInterval(() => {
          try {
            // Check if the login window was closed
            if (loginWindow.closed) {
              clearInterval(checkInterval);

              if (isMounted) {
                // Wait a moment for session to be established
                setTimeout(() => {
                  setIsLoggingIn(false);
                  setIsReady(true);
                }, 500);
              }
            }
          } catch (e) {
            // Handle any errors checking window status
          }
        }, 500);

        // Fallback: If window is still open after 5 minutes, assume login succeeded
        setTimeout(() => {
          if (!loginWindow.closed && isMounted) {
            setIsLoggingIn(false);
            setIsReady(true);
          }
        }, 300000);
      } else {
        // If popup is blocked, still try to load the page
        if (isMounted) {
          setIsLoggingIn(false);
          setIsReady(true);
        }
      }
    };

    // Start login immediately on mount
    performLogin();

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
          {!isReady && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center space-y-4">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                <p className="text-muted-foreground">
                  {isLoggingIn
                    ? tr(
                        "يرجى تسجيل الدخول في النافذة المفتوحة",
                        "Please login in the opened window"
                      )
                    : tr(
                        "جاري فتح صفحة تسجيل الدخول...",
                        "Opening login page..."
                      )}
                </p>
                {isLoggingIn && (
                  <p className="text-xs text-muted-foreground max-w-sm">
                    {tr(
                      "استخدم البيانات: zain / zain",
                      "Use credentials: zain / zain"
                    )}
                  </p>
                )}
              </div>
            </div>
          )}
          {isReady && (
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
