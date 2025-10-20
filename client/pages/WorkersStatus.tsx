import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [username, setUsername] = useState("zain");
  const [password, setPassword] = useState("zain");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);

    // Open login page in a new window
    const loginWindow = window.open(
      LOGIN_URL,
      "login_window",
      "width=800,height=600,left=100,top=100"
    );

    if (loginWindow) {
      // Wait a moment for the window to load
      setTimeout(() => {
        try {
          // Try to fill the login form in the new window
          const iframeDoc =
            loginWindow.document ||
            loginWindow.contentDocument;

          if (iframeDoc) {
            // Find input fields
            const inputs = Array.from(iframeDoc.querySelectorAll("input"));
            let usernameInput: HTMLInputElement | null = null;
            let passwordInput: HTMLInputElement | null = null;

            for (const input of inputs) {
              const type = input.type?.toLowerCase() || "";
              const name = (input.name || "").toLowerCase();

              if (
                type === "password" ||
                name.includes("pass")
              ) {
                passwordInput = input;
              } else if (
                type === "text" ||
                type === "email" ||
                name.includes("user")
              ) {
                if (!usernameInput) {
                  usernameInput = input;
                }
              }
            }

            // Fill and submit
            if (usernameInput && passwordInput) {
              usernameInput.value = username;
              usernameInput.dispatchEvent(
                new Event("input", { bubbles: true })
              );
              
              passwordInput.value = password;
              passwordInput.dispatchEvent(
                new Event("input", { bubbles: true })
              );

              // Find and click submit button
              setTimeout(() => {
                const form =
                  usernameInput!.closest("form") ||
                  passwordInput!.closest("form");
                if (form) {
                  form.submit();
                } else {
                  const buttons = Array.from(
                    iframeDoc!.querySelectorAll("button, input[type='submit']")
                  );
                  const submitBtn = buttons.find((btn) => {
                    const text = (btn.textContent || "").toLowerCase();
                    return (
                      text.includes("login") ||
                      text.includes("sign") ||
                      (btn as any).type === "submit"
                    );
                  });
                  if (submitBtn) {
                    (submitBtn as any).click();
                  }
                }
              }, 300);
            }
          }
        } catch (e) {
          // Silently handle cross-origin errors
        }
      }, 1000);

      // Monitor when user closes the login window
      const checkInterval = setInterval(() => {
        try {
          if (loginWindow.closed) {
            clearInterval(checkInterval);
            setIsLoggingIn(false);
            setIsReady(true);
          }
        } catch (e) {
          // Handle any errors
        }
      }, 500);
    } else {
      setIsLoggingIn(false);
      setIsReady(true);
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
            <div className="lg:col-span-1 bg-white rounded-lg border p-4 h-fit sticky top-4">
              <h2 className="text-sm font-semibold mb-4">
                {tr("تسجيل الدخول", "Login")}
              </h2>
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">
                    {tr("اسم المستخدم", "Username")}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-2 py-1 text-sm border rounded bg-white"
                    placeholder="zain"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium block mb-1">
                    {tr("كلمة المرور", "Password")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-2 py-1 text-sm border rounded bg-white"
                    placeholder="••••••"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoggingIn || !username || !password}
                  className="w-full h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoggingIn
                    ? tr("جاري الدخول...", "Logging in...")
                    : tr("دخول", "Login")}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  {tr(
                    "سيتم فتح نافذة تسجيل الدخول",
                    "Login window will open"
                  )}
                </p>
              </form>
            </div>
          )}

          {/* Main Content Area */}
          <div
            className={`${
              !isReady && "lg:col-span-3"
            } rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background`}
          >
            {!isReady && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
                  <p className="text-muted-foreground">
                    {tr(
                      "جاري تحضير البيانات...",
                      "Preparing data..."
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
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation"
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
