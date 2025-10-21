import { useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const PREP_URL =
  "https://recruitmentportalph.com/pirs/admin/applicants/quick_search?keyword=ACOSTA";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [showIframe, setShowIframe] = useState(false);

  const handlePrepareSession = () => {
    // Open first URL in new window/tab to prepare session
    window.open(PREP_URL, "_blank", "noopener,noreferrer");
    toast.info(
      tr(
        "تم فتح صفحة التحضير. قم بإدخال البيانات ثم أغلق النافذة",
        "Preparation page opened. Enter data then close the window"
      )
    );
  };

  const handleOpenTargetPage = () => {
    // Check if browser has session by trying to open target page
    const popup = window.open(TARGET_URL, "_blank");
    if (!popup) {
      toast.error(
        tr("تم منع النافذة المنفثقة. يرجى السماح بالنوافذ المنفثقة", "Popup blocked")
      );
    }
  };

  const handleLoadInFrame = () => {
    // Load target page directly in iframe (assumes session exists from opening in browser)
    setShowIframe(true);
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

        {!showIframe ? (
          <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background flex items-center justify-center">
            <div className="w-full max-w-md mx-auto p-8 text-center space-y-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">
                  {tr(
                    "التحقق من حالات المتقدمات",
                    "Applicants Status Check"
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {tr(
                    "يرجى اتباع الخطوات التالية للوصول إلى البيانات",
                    "Please follow the steps below to access the data"
                  )}
                </p>
              </div>

              <div className="space-y-4 text-left">
                <div className="flex gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex-shrink-0">
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {tr(
                        "افتح صفحة التحضير",
                        "Open preparation page"
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr(
                        "سيتم فتح نافذة جديدة. قم بإدخال بيانات الدخول إذا لزم الأمر",
                        "A new window will open. Enter login credentials if needed"
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex-shrink-0">
                    2
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {tr(
                        "أغلق النافذة",
                        "Close the window"
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr(
                        "بعد إدخال البيانات، أغلق النافذة المفتوحة",
                        "After entering data, close the opened window"
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex-shrink-0">
                    3
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {tr(
                        "افتح البيانات",
                        "Open the data"
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr(
                        "ستظهر البيانات في هذه الصفحة مع الجلسة المحفوظة",
                        "Data will appear in this page with the preserved session"
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-4">
                <Button
                  onClick={handlePrepareSession}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                >
                  {tr("الخطوة 1: افتح صفحة التحضير", "Step 1: Open preparation page")}
                </Button>

                <Button
                  onClick={handleLoadInFrame}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  size="lg"
                >
                  {tr("الخطوة 3: عرض البيانات", "Step 3: Show data")}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleOpenTargetPage}
                  className="w-full"
                  size="lg"
                >
                  {tr("أو افتح في نافذة جديدة", "Or open in new window")}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {tr(
                  "هذا النهج يحافظ على جلسة المتصفح تماماً كما تفعل يدويًا",
                  "This approach preserves browser session exactly as you do manually"
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background">
            <iframe
              src={TARGET_URL}
              className="w-full h-full border-none"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation allow-modals"
              title="applicants-status"
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
