import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";
const USERNAME = "zain";
const PASSWORD = "zain";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let loginIframe: HTMLIFrameElement | null = null;

    const initializeLoginFlow = () => {
      // Create hidden iframe for login
      loginIframe = document.createElement("iframe");
      loginIframe.src = LOGIN_URL;
      loginIframe.style.display = "none";
      loginIframe.style.width = "0";
      loginIframe.style.height = "0";
      loginIframe.sandbox.add(
        "allow-scripts",
        "allow-forms",
        "allow-same-origin",
        "allow-popups"
      );
      loginIframe.setAttribute("referrerPolicy", "no-referrer");
      loginIframe.setAttribute("title", "login-iframe");

      const performAutoLogin = () => {
        try {
          const iframeDoc =
            loginIframe!.contentDocument ||
            loginIframe!.contentWindow?.document;

          if (!iframeDoc || !iframeDoc.body) {
            setTimeout(performAutoLogin, 200);
            return;
          }

          // Wait for DOM to be fully ready
          if (iframeDoc.readyState !== "complete") {
            setTimeout(performAutoLogin, 300);
            return;
          }

          // Find input fields
          const inputs = iframeDoc.querySelectorAll("input[type='text'], input[type='password']");
          let usernameInput: HTMLInputElement | null = null;
          let passwordInput: HTMLInputElement | null = null;

          // Identify username and password fields
          for (const input of inputs) {
            const inputEl = input as HTMLInputElement;
            if (inputEl.placeholder?.toLowerCase().includes("user") || 
                inputEl.name?.toLowerCase().includes("user")) {
              usernameInput = inputEl;
            } else if (inputEl.type === "password") {
              passwordInput = inputEl;
            }
          }

          // If not found by type, try by order
          if (!usernameInput && inputs.length > 0) {
            usernameInput = inputs[0] as HTMLInputElement;
          }
          if (!passwordInput && inputs.length > 1) {
            passwordInput = inputs[1] as HTMLInputElement;
          }

          if (usernameInput && passwordInput) {
            // Fill username
            usernameInput.focus();
            usernameInput.value = USERNAME;
            usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
            usernameInput.dispatchEvent(new Event("change", { bubbles: true }));
            usernameInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

            // Fill password
            setTimeout(() => {
              passwordInput!.focus();
              passwordInput!.value = PASSWORD;
              passwordInput!.dispatchEvent(new Event("input", { bubbles: true }));
              passwordInput!.dispatchEvent(new Event("change", { bubbles: true }));
              passwordInput!.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

              // Find and click the login button
              setTimeout(() => {
                const buttons = Array.from(iframeDoc!.querySelectorAll("button"));
                const loginBtn = buttons.find((btn) => {
                  const text = btn.textContent || "";
                  return text.toLowerCase().includes("login") || btn.type === "submit";
                });

                if (loginBtn) {
                  loginBtn.click();
                } else {
                  // Try to find input submit button
                  const submitInput = iframeDoc!.querySelector('input[type="submit"]') as HTMLInputElement;
                  if (submitInput) {
                    submitInput.click();
                  }
                }

                // Wait for login to complete and then mark as ready
                setTimeout(() => {
                  setIsReady(true);
                }, 2000);
              }, 300);
            }, 200);
          } else {
            // If we can't find fields, still proceed after delay
            setTimeout(() => {
              setIsReady(true);
            }, 2000);
          }
        } catch (error) {
          // If cross-origin error, still proceed
          setTimeout(() => {
            setIsReady(true);
          }, 2000);
        }
      };

      loginIframe.onload = () => {
        setTimeout(performAutoLogin, 500);
      };

      loginIframe.onerror = () => {
        // If iframe fails to load, still proceed
        setTimeout(() => {
          setIsReady(true);
        }, 1000);
      };

      // Add iframe to document
      document.body.appendChild(loginIframe);
    };

    initializeLoginFlow();

    return () => {
      if (loginIframe && document.body.contains(loginIframe)) {
        document.body.removeChild(loginIframe);
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
          {isReady ? (
            <iframe
              title="applicants-status"
              src={TARGET_URL}
              className="w-full h-full"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
            />
          ) : (
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
