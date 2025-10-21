import { useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL =
  "https://recruitmentportalph.com/pirs/admin/applicants/quick_search?keyword=ACOSTA";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [showLoginFrame, setShowLoginFrame] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  // Open login in iframe
  const handleOpenLoginFrame = () => {
    setShowLoginFrame(true);
  };

  // Handle login completion
  const handleLoginComplete = () => {
    setShowLoginFrame(false);

    toast.success(
      tr(
        "تم تسجيل الدخول بنجاح!",
        "Successfully logged in!"
      )
    );

    // Wait for session to be established
    setTimeout(() => {
      setIsReady(true);
      setCurrentUrl(TARGET_URL);

      toast.success(
        tr(
          "جاري تحميل البيانات...",
          "Loading data..."
        )
      );
    }, 1500);
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
          {showLoginFrame ? (
            <div className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                <h3 className="font-semibold">
                  {tr(
                    "صفحة التحقق - الرجاء تسجيل الدخول",
                    "Verification Page - Please login"
                  )}
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowLoginFrame(false);
                    handleLoginComplete();
                  }}
                >
                  {tr("تم التسجيل", "Login Complete")}
                </Button>
              </div>
              <iframe
                src={LOGIN_URL}
                className="flex-1 w-full border-none"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation allow-modals"
                title="login-frame"
              />
              <div className="p-4 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
                {tr(
                  "أدخل بيانات الدخول (zain / zain) ثم اضغط 'تم التسجيل'",
                  "Enter login credentials (zain / zain) then click 'Login Complete'"
                )}
              </div>
            </div>
          ) : !isReady ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <div className="w-full max-w-md mx-auto p-8 text-center space-y-6">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">
                    {tr(
                      "التحقق من حالات المتقدمات",
                      "Check Applicants Status"
                    )}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {tr(
                      "يرجى تسجيل الدخول للوصول إلى البيانات",
                      "Please login to access the data"
                    )}
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
                          "اضغط 'تم التسجيل' عند الانتهاء",
                          "Click 'Login Complete' when done"
                        )}
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-semibold">4.</span>
                      <span>
                        {tr(
                          "البيانات ستحمّل مع الجلسة المحفوظة",
                          "Data will load with the preserved session"
                        )}
                      </span>
                    </li>
                  </ol>
                </div>

                <Button
                  onClick={handleOpenLoginFrame}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                >
                  {tr(
                    "فتح صفحة التحقق",
                    "Open Verification Page"
                  )}
                </Button>
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
