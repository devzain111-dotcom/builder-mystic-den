import { useEffect, useState } from 'react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';

export default function AwsLiveness({
  onSucceeded,
  onCancel,
}: {
  onSucceeded: () => void;
  onCancel: () => void;
}) {
  const [session, setSession] = useState<{ sessionId: string; region: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startSession() {
    try {
      setError(null);
      const r = await fetch('/api/liveness/session', { method: 'POST' });
      const j = await r.json();

      if (!r.ok || !j?.ok) {
        setError(j?.message || 'فشل في إنشاء جلسة الفحص');
        return;
      }

      setSession({ sessionId: j.sessionId, region: j.region });
    } catch (err) {
      setError('حدث خطأ غير متوقع أثناء تجهيز الجلسة');
    }
  }

  useEffect(() => {
    startSession();
  }, []);

  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!session) return <div className="text-sm text-gray-500">جاري تجهيز فحص الحيوية…</div>;

  return (
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
            // ✅ هنا نرسل النتيجة لقواعد البيانات
            await fetch('/.netlify/functions/save-liveness', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: session.sessionId,
                status: 'verified',
                confidence: j.confidence || 95, // تأخذها من رد AWS إذا موجود
                workerId: 'worker_42', // ممكن تستبدلها بمعرف العاملة من عندك
              }),
            });

            onSucceeded();
          } else {
            onCancel();
          }
        } catch (err) {
          console.error('خطأ أثناء معالجة النتيجة أو الحفظ:', err);
          onCancel();
        }
      }}
      onError={() => onCancel()}
    />
  );
}
