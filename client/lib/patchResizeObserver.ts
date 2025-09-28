// Suppress noisy Chromium ResizeObserver warnings that occur when UI libraries adjust layout during observation.
// This does NOT swallow real errors; it only stops the specific ResizeObserver loop warnings from bubbling to console.
if (typeof window !== "undefined") {
  const handler = (e: ErrorEvent) => {
    const msg = String(e.message || "");
    if (msg.includes("ResizeObserver loop completed with undelivered notifications.") || msg.includes("ResizeObserver loop limit exceeded")) {
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener("error", handler);
}
