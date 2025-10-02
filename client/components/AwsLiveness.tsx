import { useEffect, useState } from 'react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';

export default function AwsLiveness({ onSucceeded, onCancel }: { onSucceeded: () => void; onCancel: () => void }) {
  const [session, setSession] = useState<{ sessionId: string; region: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startSession() {
    setError(null);
    const r = await fetch('/api/liveness/session', { method: 'POST' });
    const j = await r.json();
    if (!r.ok || !j?.ok) { setError(j?.message || 'failed_to_create_session'); return; }
    setSession({ sessionId: j.sessionId, region: j.region });
  }

  useEffect(()=>{ startSession(); }, []);

  if (error) return <div className="text-destructive text-sm">{error}</div>;
  if (!session) return <div className="text-sm text-muted-foreground">جاري تجهيز فحص الحيوية…</div>;
  return (
    <FaceLivenessDetector
      sessionId={session.sessionId}
      region={session.region}
      onAnalysisComplete={async () => {
        const r = await fetch('/api/liveness/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId }) });
        const j = await r.json();
        if (r.ok && j?.ok) onSucceeded(); else onCancel();
      }}
      onError={() => onCancel()}
    />
  );
}
