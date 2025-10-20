import { useEffect, useState, useRef } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";
const USERNAME = "zain";
const PASSWORD = "zain";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const iframeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    let loginIframe: HTMLIFrameElement | null = null;

    const performAutoLogin = async () => {
      try {
        // Create hidden iframe to load login page and auto-fill credentials
        loginIframe = document.createElement("iframe");
        loginIframe.src = LOGIN_URL;
        loginIframe.style.display = "none";
        loginIframe.style.position = "fixed";
        loginIframe.style.pointerEvents = "none";
        loginIframe.sandbox.add(
          "allow-scripts",
          "allow-forms",
          "allow-same-origin",
          "allow-popups",
          "allow-top-navigation"
        );
        loginIframe.setAttribute("referrerPolicy", "no-referrer");
        loginIframe.setAttribute("title", "auto-login");

        document.body.appendChild(loginIframe);

        // Wait for iframe to load and attempt auto-fill
        await new Promise<void>((resolve) => {
          const attemptAutoFill = () => {
            try {
              const iframeDoc =
                loginIframe!.contentDocument ||
                loginIframe!.contentWindow?.document;

              if (!iframeDoc?.body) {
                setTimeout(attemptAutoFill, 300);
                return;
              }

              // Find all input fields
              const inputs = Array.from(iframeDoc.querySelectorAll("input"));
              let usernameInput: HTMLInputElement | null = null;
              let passwordInput: HTMLInputElement | null = null;

              // Identify input fields
              for (const input of inputs) {
                const type = input.type?.toLowerCase() || "";
                const name = (input.name || "").toLowerCase();
                const placeholder = (input.placeholder || "").toLowerCase();

                if (
                  type === "password" ||
                  name.includes("pass") ||
                  placeholder.includes("pass")
                ) {
                  passwordInput = input;
                } else if (
                  type === "text" ||
                  type === "email" ||
                  name.includes("user") ||
                  placeholder.includes("user")
                ) {
                  if (!usernameInput) {
                    usernameInput = input;
                  }
                }
              }

              // If inputs not found by attributes, use first two inputs
              if (!usernameInput && inputs.length > 0) {
                usernameInput = inputs[0] as HTMLInputElement;
              }
              if (!passwordInput && inputs.length > 1) {
                passwordInput = inputs[1] as HTMLInputElement;
              }

              // Fill in the credentials
              if (usernameInput && passwordInput) {
                // Fill username
                usernameInput.value = USERNAME;
                usernameInput.dispatchEvent(
                  new Event("input", { bubbles: true })
                );
                usernameInput.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
                usernameInput.dispatchEvent(
                  new KeyboardEvent("keydown", { bubbles: true })
                );

                // Fill password
                passwordInput.value = PASSWORD;
                passwordInput.dispatchEvent(
                  new Event("input", { bubbles: true })
                );
                passwordInput.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
                passwordInput.dispatchEvent(
                  new KeyboardEvent("keydown", { bubbles: true })
                );

                // Find and submit the form
                setTimeout(() => {
                  const form =
                    usernameInput!.closest("form") ||
                    passwordInput!.closest("form");

                  if (form) {
                    form.submit();
                  } else {
                    // Try to find a submit button
                    const buttons = Array.from(
                      iframeDoc!.querySelectorAll("button, input[type='submit']")
                    );
                    const submitBtn = buttons.find((btn) => {
                      const text = (btn.textContent || "").toLowerCase();
                      return (
                        text.includes("login") ||
                        text.includes("sign") ||
                        (btn as HTMLButtonElement).type === "submit" ||
                        (btn as HTMLInputElement).type === "submit"
                      );
                    });

                    if (submitBtn) {
                      if (submitBtn instanceof HTMLButtonElement) {
                        submitBtn.click();
                      } else if (submitBtn instanceof HTMLInputElement) {
                        submitBtn.click();
                      }
                    }
                  }

                  // Wait for login to complete
                  setTimeout(() => {
                    resolve();
                  }, 2500);
                }, 200);
              } else {
                // If inputs not found, still proceed after delay
                setTimeout(() => {
                  resolve();
                }, 2000);
              }
            } catch (err) {
              // Silently handle cross-origin errors
              setTimeout(() => {
                resolve();
              }, 1500);
            }
          };

          loginIframe!.onload = () => {
            setTimeout(attemptAutoFill, 500);
          };

          loginIframe!.onerror = () => {
            // Even if iframe fails to load, proceed
            setTimeout(() => {
              resolve();
            }, 1000);
          };
        });

        // Wait for session to establish
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Clean up login iframe
        if (loginIframe && document.body.contains(loginIframe)) {
          document.body.removeChild(loginIframe);
        }

        // Mark as ready to display main iframe
        if (isMounted) {
          setIsReady(true);
        }
      } catch (err) {
        console.error("Auto-login error:", err);
        if (isMounted) {
          // Still try to load the page
          setIsReady(true);
        }
      }
    };

    performAutoLogin();

    return () => {
      isMounted = false;
      if (loginIframe && document.body.contains(loginIframe)) {
        try {
          document.body.removeChild(loginIframe);
        } catch (e) {
          // Ignore cleanup errors
        }
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

        <div
          ref={iframeContainerRef}
          className="rounded-lg border overflow-hidden h-[calc(100vh-8rem)] bg-background"
        >
          {!isReady && (
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
