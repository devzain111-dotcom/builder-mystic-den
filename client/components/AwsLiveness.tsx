<FaceLivenessDetector
  sessionId={session.sessionId}
  region={session.region}
  onAnalysisComplete={async () => {
    try {
      const r = await fetch('/api/liveness/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      const j = await r.json();

      if (r.ok && j?.ok) {
        // ✅ استدعاء Netlify Function لحفظ النتيجة في قاعدة البيانات
        await fetch("/.netlify/functions/save-liveness", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            status: "verified",
            confidence: j.confidence || 98.7,
            workerId: "worker_42",
          }),
        });

        onSucceeded();
      } else {
        onCancel();
      }
    } catch {
      onCancel();
    }
  }}
  onError={() => onCancel()}
/>
