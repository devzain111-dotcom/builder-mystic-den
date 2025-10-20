import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginWindowOpen, setLoginWindowOpen] = useState(false);

  const handleOpenLogin = () => {
    setLoginWindowOpen(true);

    // Open login page in a new window
    const loginWindow = window.open(LOGIN_URL, "login", "width=600,height=700");

    if (loginWindow) {
      // Check if the login window was closed
      const checkWindowClosed = setInterval(() => {
        try {
          if (loginWindow.closed) {
            clearInterval(checkWindowClosed);
            setLoginWindowOpen(false);
            setIsLoggedIn(true);
          }
        } catch (error) {
          clearInterval(checkWindowClosed);
        }
      }, 500);
    }
  };

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

        {!isLoggedIn ? (
          <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background flex items-center justify-center">
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">
                {tr(
                  "يجب تسجيل الدخول أولاً للوصول إلى هذه الصفحة",
                  "You must login first to access this page"
                )}
              </p>
              <Button
                onClick={handleOpenLogin}
                disabled={loginWindowOpen}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {loginWindowOpen
                  ? tr("جاري التسجيل...", "Logging in...")
                  : tr("فتح صفحة تسجيل الدخول", "Open Login Page")}
              </Button>
              <p className="text-xs text-muted-foreground mt-4">
                {tr(
                  "بعد إدخال بيانات المستخدم، أغلق نافذة تسجيل الدخول وسيتم تحميل الصفحة تلقائياً",
                  "After entering your credentials, close the login window and the page will load automatically"
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background">
            <iframe
              title="applicants-status"
              src={TARGET_URL}
              className="w-full h-full"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
            />
          </div>
        )}

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
