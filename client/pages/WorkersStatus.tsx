import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const DEPENDENCY_URL =
  "https://recruitmentportalph.com/pirs/admin/applicants/quick_search?keyword=ACOSTA";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [dependencyLoaded, setDependencyLoaded] = useState(false);

  useEffect(() => {
    // Create and load the hidden iframe for the dependency URL
    const hiddenIframe = document.createElement("iframe");
    hiddenIframe.src = DEPENDENCY_URL;
    hiddenIframe.style.display = "none";
    hiddenIframe.sandbox.add(
      "allow-scripts",
      "allow-forms",
      "allow-same-origin",
      "allow-popups"
    );
    hiddenIframe.setAttribute("referrerPolicy", "no-referrer");
    hiddenIframe.setAttribute("title", "dependency-loader");

    hiddenIframe.onload = () => {
      setDependencyLoaded(true);
    };

    hiddenIframe.onerror = () => {
      // Even if there's an error, allow the main URL to load
      setDependencyLoaded(true);
    };

    document.body.appendChild(hiddenIframe);

    return () => {
      document.body.removeChild(hiddenIframe);
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
          {dependencyLoaded && (
            <iframe
              title="applicants-status"
              src={TARGET_URL}
              className="w-full h-full"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
            />
          )}
          {!dependencyLoaded && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                <p className="text-muted-foreground">
                  {tr("جاري التحميل...", "Loading...")}
                </p>
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {tr(
            "ملاح��ة: إذا لم تظهر الصفحة داخل الإطار، فربما يمنع الموقع التضمين (X-Frame-Options/CSP).",
            "Note: If the page does not appear inside the frame, the site may block embedding (X-Frame-Options/CSP).",
          )}
        </p>
      </section>
    </main>
  );
}
