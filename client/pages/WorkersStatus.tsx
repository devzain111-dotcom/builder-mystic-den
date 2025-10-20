import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";

const TARGET_URL = "https://recruitmentportalph.com/pirs/others/s-z.php";
const LOGIN_URL = "https://recruitmentportalph.com/pirs/admin/signin";
const USERNAME = "zain";
const PASSWORD = "zain";

export default function WorkersStatus() {
  const { tr } = useI18n();
  const [dependencyLoaded, setDependencyLoaded] = useState(false);

  useEffect(() => {
    let hiddenLoginIframe: HTMLIFrameElement | null = null;
    let hiddenSessionIframe: HTMLIFrameElement | null = null;
    let cleanupTimeout: NodeJS.Timeout | null = null;

    const performLogin = () => {
      return new Promise<void>((resolve) => {
        hiddenLoginIframe = document.createElement("iframe");
        hiddenLoginIframe.src = LOGIN_URL;
        hiddenLoginIframe.style.display = "none";
        hiddenLoginIframe.sandbox.add(
          "allow-scripts",
          "allow-forms",
          "allow-same-origin",
          "allow-popups"
        );
        hiddenLoginIframe.setAttribute("referrerPolicy", "no-referrer");
        hiddenLoginIframe.setAttribute("title", "login-iframe");

        const attemptLogin = () => {
          try {
            const iframeDoc =
              hiddenLoginIframe!.contentDocument ||
              hiddenLoginIframe!.contentWindow?.document;

            if (!iframeDoc) {
              setTimeout(attemptLogin, 300);
              return;
            }

            // Find username input field
            const usernameInput = iframeDoc.querySelector(
              'input[placeholder="Username"], input[name="username"], input[type="text"]'
            ) as HTMLInputElement;

            // Find password input field
            const passwordInput = iframeDoc.querySelector(
              'input[placeholder="Password"], input[name="password"], input[type="password"]'
            ) as HTMLInputElement;

            if (usernameInput && passwordInput) {
              usernameInput.value = USERNAME;
              usernameInput.dispatchEvent(
                new Event("input", { bubbles: true })
              );
              usernameInput.dispatchEvent(
                new Event("change", { bubbles: true })
              );

              passwordInput.value = PASSWORD;
              passwordInput.dispatchEvent(
                new Event("input", { bubbles: true })
              );
              passwordInput.dispatchEvent(
                new Event("change", { bubbles: true })
              );

              // Find the login button
              const buttons = Array.from(iframeDoc.querySelectorAll("button"));
              const submitBtn = buttons.find(
                (btn) =>
                  btn.textContent?.toLowerCase().includes("login") ||
                  btn.type === "submit"
              );

              if (submitBtn) {
                submitBtn.click();
                // Wait for login to complete
                setTimeout(() => {
                  resolve();
                }, 2500);
              } else {
                resolve();
              }
            } else {
              resolve();
            }
          } catch (error) {
            // Cross-origin restrictions, resolve anyway
            resolve();
          }
        };

        hiddenLoginIframe.onload = () => {
          setTimeout(attemptLogin, 500);
        };

        document.body.appendChild(hiddenLoginIframe);
      });
    };

    const loadSessionIframe = () => {
      return new Promise<void>((resolve) => {
        hiddenSessionIframe = document.createElement("iframe");
        hiddenSessionIframe.src = TARGET_URL;
        hiddenSessionIframe.style.display = "none";
        hiddenSessionIframe.sandbox.add(
          "allow-scripts",
          "allow-forms",
          "allow-same-origin",
          "allow-popups"
        );
        hiddenSessionIframe.setAttribute("referrerPolicy", "no-referrer");
        hiddenSessionIframe.setAttribute("title", "session-iframe");

        hiddenSessionIframe.onload = () => {
          resolve();
        };

        hiddenSessionIframe.onerror = () => {
          resolve();
        };

        document.body.appendChild(hiddenSessionIframe);
      });
    };

    const initializeSession = async () => {
      // Step 1: Perform login in hidden iframe
      await performLogin();

      // Step 2: Load the target URL in a hidden iframe to establish session
      await loadSessionIframe();

      // Step 3: Mark as ready to display the main iframe
      setDependencyLoaded(true);

      // Clean up the hidden iframes after a delay
      cleanupTimeout = setTimeout(() => {
        if (hiddenLoginIframe && document.body.contains(hiddenLoginIframe)) {
          document.body.removeChild(hiddenLoginIframe);
        }
        if (hiddenSessionIframe && document.body.contains(hiddenSessionIframe)) {
          document.body.removeChild(hiddenSessionIframe);
        }
      }, 5000);
    };

    initializeSession();

    return () => {
      if (cleanupTimeout) clearTimeout(cleanupTimeout);
      if (hiddenLoginIframe && document.body.contains(hiddenLoginIframe)) {
        document.body.removeChild(hiddenLoginIframe);
      }
      if (hiddenSessionIframe && document.body.contains(hiddenSessionIframe)) {
        document.body.removeChild(hiddenSessionIframe);
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
            "ملاحظة: إذا لم تظهر الصفحة داخل الإطار، فربما يمنع الموقع التضمين (X-Frame-Options/CSP).",
            "Note: If the page does not appear inside the frame, the site may block embedding (X-Frame-Options/CSP).",
          )}
        </p>
      </section>
    </main>
  );
}
