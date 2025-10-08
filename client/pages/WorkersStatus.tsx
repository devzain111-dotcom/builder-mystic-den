import { Link } from "react-router-dom";
import BackButton from "@/components/BackButton";

const TARGET_URL =
  "https://recruitmentportalph.com/philcangco/acct/production/agentbackout.php";

export default function WorkersStatus() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/10">
      <section className="container py-4 space-y-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <h1 className="text-xl font-bold">التحقق من حالات المتقدمات</h1>
          <div className="hidden sm:block"><BackButton /></div>
        </div>
        <div className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background">
          <iframe
            title="applicants-status"
            src={TARGET_URL}
            className="w-full h-full"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          ملاحظة: إذا لم تظهر الصفحة داخل الإطار، فربما يمنع الموقع التض��ين
          (X-Frame-Options/CSP).
        </p>
      </section>
    </main>
  );
}
