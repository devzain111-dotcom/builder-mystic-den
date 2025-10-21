import { useState, useEffect } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL =
  "https://recruitmentportalph.com/pirs/admin/applicants/quick_search?keyword=ACOSTA";
const USERNAME = "zain";
const PASSWORD = "zain";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  // Initialize - show manual login options
  useEffect(() => {
    setMessage(
      tr(
        "يرجى تسجيل الدخول للوصول إلى البيانات",
        "Please login to access the data"
      )
    );
  }, [tr]);

  // Manual login handler
  const handleManualLogin = () => {
    setIsLoading(true);
    setMessage(
      tr(
        "جاري فتح نافذة تسجيل الدخول...",
        "Opening login window..."
      )
    );

    const loginWindow = window.open(
      LOGIN_URL,
      "pirsLogin",
      "width=600,height=700"
    );

    if (!loginWindow) {
      toast.error(
        tr("تم منع النافذة المنفثقة", "Popup blocked")
      );
      setIsLoading(false);
      return;
    }

    // Check if window is closed
    const checkInterval = setInterval(() => {
      if (loginWindow.closed) {
        clearInterval(checkInterval);
        setIsLoading(false);

        // After login, wait and then load the data
        setTimeout(() => {
          setMessage(
            tr(
              "جاري تحميل البيانات...",
              "Loading data..."
            )
          );
          setIsReady(true);
          setCurrentUrl(TARGET_URL);
          toast.success(
            tr(
              "تم تحميل البيانات بنجاح!",
              "Data loaded successfully!"
            )
          );
        }, 1500);
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      if (!loginWindow.closed) {
        loginWindow.close();
      }
    }, 5 * 60 * 1000);
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/10">
      <section className="container py-4 space-y-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <h1 className="text-xl font-bold">
            {tr(
              "التحقق من حالات المتقدمات",
              "Check applicants status"
            )}
          </h1>
          <div className="hidden sm:block">
            <BackButton />
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background">
          {!isReady ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <div className="w-full max-w-md mx-auto p-8 text-center space-y-6">
                {isLoading && (
                  <>
                    <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                    <div className="space-y-2">
                      <p className="font-medium text-lg">
                        {tr(
                          "جاري التحضير...",
                          "Preparing..."
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {message}
                      </p>
                    </div>
                  </>
                )}

                {!isLoading && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h2 className="text-lg font-semibold">
                        {tr(
                          "محاولة تسجيل الدخول التلقائي فشلت",
                          "Automatic login attempt failed"
                        )}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {message}
                      </p>
                    </div>

                    <Button
                      onClick={handleManualLogin}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      size="lg"
                    >
                      {tr(
                        "تسجيل الدخول يدويًا",
                        "Login manually"
                      )}
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "سيتم فتح نافذة تسجيل الدخول. أدخل بيانات الدخول ثم أغلق النافذة.",
                        "Login window will open. Enter credentials then close the window."
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <iframe
              src={currentUrl || TARGET_URL}
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
