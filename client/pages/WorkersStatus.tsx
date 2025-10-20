import { useEffect, useRef, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_API = "https://recruitmentportalph.com/pirs/admin/signin";
const USERNAME = "zain";
const PASSWORD = "zain";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginIframeRef = useRef<HTMLIFrameElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const performLogin = async () => {
      try {
        // Create hidden login iframe
        const loginIframe = document.createElement("iframe");
        loginIframeRef.current = loginIframe;
        loginIframe.src = LOGIN_API;
        loginIframe.style.display = "none";
        loginIframe.sandbox.add(
          "allow-scripts",
          "allow-forms",
          "allow-same-origin",
          "allow-popups",
          "allow-top-navigation"
        );
        loginIframe.setAttribute("referrerPolicy", "no-referrer");
        loginIframe.setAttribute("title", "login-session");

        // Add to document
        document.body.appendChild(loginIframe);

        // Wait for login iframe to load and attempt auto-fill
        await new Promise<void>((resolve) => {
          const tryAutoFill = () => {
            try {
              const iframeDoc =
                loginIframe.contentDocument ||
                loginIframe.contentWindow?.document;

              if (!iframeDoc?.body) {
                setTimeout(tryAutoFill, 300);
                return;
              }

              // Try to find and fill the form
              const allInputs = Array.from(iframeDoc.querySelectorAll("input"));
              let usernameInput: HTMLInputElement | null = null;
              let passwordInput: HTMLInputElement | null = null;

              // Find inputs by type or name
              for (const input of allInputs) {
                if (
                  input.type === "password" ||
                  input.name?.toLowerCase().includes("password")
                ) {
                  passwordInput = input;
                } else if (
                  input.type === "text" ||
                  input.type === "email" ||
                  input.name?.toLowerCase().includes("user")
                ) {
                  if (!usernameInput) {
                    usernameInput = input;
                  }
                }
              }

              // If found, fill and submit
              if (usernameInput && passwordInput) {
                usernameInput.value = USERNAME;
                usernameInput.dispatchEvent(new Event("change", { bubbles: true }));
                usernameInput.dispatchEvent(new Event("input", { bubbles: true }));

                passwordInput.value = PASSWORD;
                passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
                passwordInput.dispatchEvent(new Event("input", { bubbles: true }));

                // Find and submit form
                const form =
                  usernameInput.closest("form") ||
                  passwordInput.closest("form");
                if (form) {
                  setTimeout(() => {
                    form.submit();
                  }, 200);
                } else {
                  // Try to find submit button
                  const buttons = Array.from(iframeDoc.querySelectorAll("button"));
                  const submitBtn = buttons.find(
                    (btn) =>
                      btn.type === "submit" ||
                      (btn.textContent?.toLowerCase() || "").includes("login") ||
                      (btn.textContent?.toLowerCase() || "").includes("sign")
                  );
                  if (submitBtn) {
                    setTimeout(() => {
                      (submitBtn as HTMLButtonElement).click();
                    }, 200);
                  }
                }
              }

              // Wait and resolve
              setTimeout(() => {
                resolve();
              }, 2000);
            } catch (err) {
              // If we can't access iframe content, still proceed
              setTimeout(() => {
                resolve();
              }, 1500);
            }
          };

          loginIframe.onload = () => {
            setTimeout(tryAutoFill, 500);
          };

          loginIframe.onerror = () => {
            setTimeout(() => {
              resolve();
            }, 500);
          };
        });

        // Wait for session to be established
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Only update state if component is still mounted
        if (mountedRef.current) {
          setIsReady(true);
        }
      } catch (err) {
        console.error("Login error:", err);
        if (mountedRef.current) {
          setError("حدث خطأ أثناء محاولة الوصول للصفحة");
          setIsReady(true);
        }
      }
    };

    // Start the login process
    performLogin();

    return () => {
      mountedRef.current = false;
      // Clean up: remove login iframe if still exists
      if (loginIframeRef.current) {
        try {
          if (document.body.contains(loginIframeRef.current)) {
            document.body.removeChild(loginIframeRef.current);
          }
        } catch (e) {
          // Already removed, ignore
        }
        loginIframeRef.current = null;
      }
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
          {!isReady && !error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
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
          {error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center space-y-4">
                <p className="text-red-600">{error}</p>
                <p className="text-muted-foreground text-sm">
                  {tr(
                    "يرجى التأكد من بيانات الاتصال",
                    "Please check your connection"
                  )}
                </p>
              </div>
            </div>
          )}
          {isReady && !error && (
            <iframe
              src={TARGET_URL}
              className="w-full h-full border-none"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
              title="applicants-status"
            />
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {tr(
            "ملاحظة: إذا لم تظهر الصفح�� داخل الإطار، فربما يمنع الموقع التضمين (X-Frame-Options/CSP).",
            "Note: If the page does not appear inside the frame, the site may block embedding (X-Frame-Options/CSP)."
          )}
        </p>
      </section>
    </main>
  );
}
