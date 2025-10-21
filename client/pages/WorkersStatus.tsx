import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [username, setUsername] = useState("zain");
  const [password, setPassword] = useState("zain");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      toast.error(tr("يرجى إدخال بيانات المستخدم", "Please enter credentials"));
      return;
    }

    setIsLoggingIn(true);

    try {
      // Call server-side login proxy
      const loginRes = await fetch("/api/pirs/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      if (!loginRes.ok) {
        toast.error(tr("فشل تسجيل الدخول", "Login failed"));
        setIsLoggingIn(false);
        return;
      }

      const loginData = await loginRes.json();

      if (!loginData.ok) {
        toast.error(
          tr("بيانات الدخول غير صحيحة", "Invalid credentials")
        );
        setIsLoggingIn(false);
        return;
      }

      // If we got here, login succeeded
      toast.success(
        tr("تم تسجيل الدخول بنجاح", "Logged in successfully")
      );

      // Wait a moment for session to be established
      setTimeout(() => {
        setIsLoggingIn(false);
        setIsReady(true);
      }, 1000);
    } catch (error) {
      toast.error(
        tr("حدث خطأ أثناء تسجيل الدخول", "An error occurred during login")
      );
      setIsLoggingIn(false);
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Login Form Sidebar */}
          {!isReady && (
            <div className="lg:col-span-1 bg-white rounded-lg border p-4 h-fit sticky top-4 shadow-sm">
              <h2 className="text-sm font-semibold mb-4 text-gray-900">
                {tr("تسجيل الدخول", "Login")}
              </h2>
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1 text-gray-700">
                    {tr("اسم المستخدم", "Username")}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoggingIn}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                    placeholder="zain"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium block mb-1 text-gray-700">
                    {tr("كلمة المرور", "Password")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoggingIn}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                    placeholder="••••••"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoggingIn || !username || !password}
                  className="w-full h-9 text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoggingIn
                    ? tr("جاري الدخول...", "Logging in...")
                    : tr("دخول", "Login")}
                </Button>

                {isLoggingIn && (
                  <div className="flex items-center justify-center pt-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <p className="text-xs text-muted-foreground ml-2">
                      {tr("جاري المعالجة...", "Processing...")}
                    </p>
                  </div>
                )}
              </form>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-muted-foreground text-center">
                  {tr(
                    "سيتم فتح الصفحة بعد التوثيق",
                    "Page will open after authentication"
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div
            className={`${
              !isReady && "lg:col-span-3"
            } rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background`}
          >
            {!isReady && (
              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <div className="text-center space-y-4">
                  <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                  <p className="text-muted-foreground">
                    {tr(
                      "يرجى تسجيل الدخول للمتابعة",
                      "Please login to continue"
                    )}
                  </p>
                </div>
              </div>
            )}

            {isReady && (
              <iframe
                src={TARGET_URL}
                className="w-full h-full border-none"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation allow-modals"
                title="applicants-status"
              />
            )}
          </div>
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
