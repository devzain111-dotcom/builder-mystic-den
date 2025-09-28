import { DemoResponse } from "@shared/api";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export default function Index() {
  const [serverMsg, setServerMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDemo();
  }, []);

  async function fetchDemo() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/demo");
      const data = (await res.json()) as DemoResponse;
      setServerMsg(data.message);
    } catch (e) {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white">
      <section className="container mx-auto flex min-h-screen flex-col items-center justify-center gap-6 text-center" dir="rtl">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">تحقق السكن</h1>
        <p className="max-w-prose text-muted-foreground">
          التطبيق يعمل الآن ويمكنك البدء بالتعديل مباشرة. هذه صفحة ترحيبية بسيطة لعرض رسالة الخادم والتأكد من أن الربط بين الواجهة وExpress يعمل.
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={fetchDemo} disabled={loading} className="min-w-36">
            {loading ? "...جاري الجلب" : "جلب رسالة الخادم"}
          </Button>
        </div>
        <div className="min-h-6 text-sm">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : serverMsg ? (
            <span className="rounded-md bg-card px-3 py-1 font-medium">{serverMsg}</span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          عدّل هذه الصفحة في المسار: <code className="font-mono">client/pages/Index.tsx</code>
        </p>
      </section>
    </main>
  );
}
