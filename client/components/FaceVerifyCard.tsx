import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCamera } from "@/hooks/useCamera";
import { checkLivenessFlexible, detectSingleDescriptor, captureSnapshot } from "@/lib/face";
import { toast } from "sonner";

export default function FaceVerifyCard({ onVerified }: { onVerified: (out: { workerId: string; workerName?: string }) => void }) {
  const { videoRef, isActive, start, stop } = useCamera();
  const [busy, setBusy] = useState(false);

  useEffect(() => { start(); return () => stop(); }, [start, stop]);

  async function handleStartIdentify() {
    if (!videoRef.current) return;
    try {
      setBusy(true);
      if (!isActive) await start();
      const live = await checkLivenessFlexible(videoRef.current!, { tries: 12, intervalMs: 150, strict: false });
      if (!live) { toast.info("تخطّي فحص الحيوية بسبب ضعف الحركة/الإضاءة."); }
      const det = await detectSingleDescriptor(videoRef.current!);
      if (!det) { toast.error("لم يتم اكتشاف وجه واضح"); return; }
      const snapshot = await captureSnapshot(videoRef.current);
      const res = await fetch('/api/face/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embedding: det.descriptor, snapshot }) });
      const j = await res.json().catch(()=>({} as any));
      if (!res.ok || !j?.ok) { toast.error(j?.message || 'فشل التحقق'); return; }
      onVerified({ workerId: j.workerId, workerName: j.workerName });
      toast.success(`تعرّف على: ${j.workerName || j.workerId}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="p-4 flex items-center justify-between border-b"><div className="font-bold">التحقق بالوجه</div><div className="text-sm text-muted-foreground">جاهز</div></div>
      <div className="p-4 space-y-3">
        <div className="relative aspect-video w-full rounded-md overflow-hidden bg-black/50">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">الإجراء:</span>
          <Button size="sm" onClick={handleStartIdentify} disabled={busy}>{busy ? 'جارٍ التعرّف…' : 'ابدأ ا��تحقق بالوجه'}</Button>
          <Button size="sm" variant="outline" onClick={()=>{ setBusy(false); stop(); }} disabled={busy}>إلغاء</Button>
        </div>
      </div>
    </div>
  );
}
