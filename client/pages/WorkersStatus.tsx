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
        "جاري فتح صفحة البحث والتسجيل...",
        "Opening login and search page..."
      )
    );

    // Open the exact login page with search credentials
    const loginWindow = window.open(
      LOGIN_URL,
      "pirsLogin",
      "width=800,height=800"
    );

    if (!loginWindow) {
      toast.error(
        tr("تم منع النافذة المنفثقة. يرجى السماح بالنوافذ المنفثقة.", "Popup blocked. Please allow popups.")
      );
      setIsLoading(false);
      return;
    }

    setMessage(
      tr(
        "يرجى إدخال بيانات الدخول في النافذة المفتوحة (zain/zain)",
        "Please enter login credentials in the opened window (zain/zain)"
      )
    );

    // Check if window is closed
    const checkInterval = setInterval(() => {
      if (loginWindow.closed) {
        clearInterval(checkInterval);
        setIsLoading(false);

        // After login window closes, wait for session to be established
        setMessage(
          tr(
            "تم تسجيل الدخول. جاري تحميل البيانات...",
            "Logged in. Loading data..."
          )
        );

        // Wait 2 seconds for session to be fully established in cookies
        setTimeout(() => {
          setIsReady(true);
          setCurrentUrl(TARGET_URL);
          toast.success(
            tr(
              "تم تسجيل الدخول والدخول إلى البيانات بنجاح!",
              "Successfully logged in and accessing data!"
            )
          );
        }, 2000);
      }
    }, 500);

    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      if (loginWindow && !loginWindow.closed) {
        loginWindow.close();
      }
    }, 10 * 60 * 1000);
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
                          "التحقق من حالات المتقدمات",
                          "Check Applicants Status"
                        )}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {message}
                      </p>
                    </div>

                    <div className="space-y-3 bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <p className="text-sm font-medium text-blue-900">
                        {tr(
                          "خطوات الدخول:",
                          "Steps to login:"
                        )}
                      </p>
                      <ol className="space-y-2 text-xs text-blue-800">
                        <li className="flex gap-2">
                          <span className="font-semibold">1.</span>
                          <span>
                            {tr(
                              "اضغط الزر أدناه لفتح صفحة التحقق",
                              "Click the button below to open the verification page"
                            )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="font-semibold">2.</span>
                          <span>
                            {tr(
                              "أدخل بيانات الدخول: zain / zain",
                              "Enter credentials: zain / zain"
                            )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="font-semibold">3.</span>
                          <span>
                            {tr(
                              "أغلق النافذة بعد تسجيل الدخول",
                              "Close the window after login"
                            )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="font-semibold">4.</span>
                          <span>
                            {tr(
                              "البيانات ستحمّل تلقائياً في هذه الصفحة",
                              "Data will load automatically on this page"
                            )}
                          </span>
                        </li>
                      </ol>
                    </div>

                    <Button
                      onClick={handleManualLogin}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      size="lg"
                      disabled={isLoading}
                    >
                      {tr(
                        "فتح صفحة التحقق",
                        "Open Verification Page"
                      )}
                    </Button>
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
