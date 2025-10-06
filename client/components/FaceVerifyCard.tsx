import { Suspense, useEffect, useState, lazy } from "react";
import { Button } from "@/components/ui/button";
import { useCamera } from "@/hooks/useCamera";
import {
  checkLivenessFlexible,
  detectSingleDescriptor,
  captureSnapshot,
} from "@/lib/face";
import { isIOS } from "@/lib/platform";
import { toast } from "sonner";
import { useI18n } from "@/context/I18nContext";
import { useWorkers } from "@/context/WorkersContext";
const AwsLiveness = lazy(() => import("@/components/AwsLiveness"));

export default function FaceVerifyCard({
  onVerified,
}: {
  onVerified: (out: { workerId: string; workerName?: string }) => void;
}) {
  const {
    videoRef,
    isActive,
    start,
    stop,
    error: camError,
    switchCamera,
  } = useCamera() as any;
  const [busy, setBusy] = useState(false);
  const { tr } = useI18n();
  const { selectedBranchId } = useWorkers();
  const envAws =
    (import.meta as any).env?.VITE_USE_AWS_LIVENESS === "1" ||
    (import.meta as any).env?.VITE_USE_AWS_LIVENESS === "true";
  const useAws = envAws && isIOS();
  const [showLiveness, setShowLiveness] = useState(false);

  useEffect(() => {
    if (!useAws) {
      start();
      return () => stop();
    }
    return;
  }, [useAws, start, stop]);
  useEffect(() => {
    if (camError) import("sonner").then(({ toast }) => toast.error(camError));
  }, [camError]);

  async function handleStartIdentify() {
    if (useAws) {
      setShowLiveness(true);
      return;
    }
    if (!isActive) {
      try {
        await start();
      } catch {}
    }
    if (!videoRef.current) return;
    try {
      setBusy(true);
      if (!isActive) await start();
      const live = await checkLivenessFlexible(videoRef.current!, {
        tries: 12,
        intervalMs: 150,
        strict: false,
      });
      if (!live) {
        toast.info(tr("تخطّي فحص الحيوية بسبب ضعف الحركة/الإضاءة.", "Liveness relaxed due to low motion/light."));
      }
      const det = await detectSingleDescriptor(videoRef.current!);
      if (!det) {
        toast.error(tr("لم يتم اكتشاف وجه واضح", "No clear face detected"));
        return;
      }
      const snapshot = await captureSnapshot(videoRef.current);
      // Step 1: identify candidate worker without creating verification (dry mode)
      const res = await fetch("/api/face/identify?dry=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-branch-id": selectedBranchId || "", "x-dry": "1" },
        body: JSON.stringify({ embedding: det.descriptor, snapshot, branchId: selectedBranchId || undefined }),
      });
      const j = await res.json().catch(() => ({}) as any);
      if (!res.ok || !j?.ok || !j.workerId) {
        const msg = j?.message === "no_match_in_branch" ? tr("لا يوجد تطابق في هذا الفرع", "No match in this branch") : j?.message;
        toast.error(msg || tr("فشل التحقق", "Verification failed"));
        return;
      }
      // Step 2: confirm using AWS Rekognition CompareFaces (server-side) which will also insert verification
      const r2 = await fetch("/.netlify/functions/compare-face", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceImageB64: snapshot, workerId: j.workerId, similarityThreshold: 80 }),
      });
      const j2 = await r2.json().catch(() => ({} as any));
      if (!r2.ok || !j2?.ok || !j2?.success) {
        toast.error(tr("فشل التحقق عبر AWS", "AWS comparison failed"));
        return;
      }
      onVerified({ workerId: j.workerId, workerName: j.workerName });
      toast.success(tr("تم التطابق بنسبة:", "Matched with similarity:") + ` ${Math.round((j2.similarity || 0) * 10) / 10}%`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="p-4 flex items-center justify-between border-b">
        <div className="font-bold">{tr("التحقق بالوجه", "Face verification")}</div>
        <div className="text-sm text-muted-foreground">{tr("جاهز", "Ready")}</div>
      </div>
      <div className="p-4 space-y-3">
        <div className="relative aspect-video w-full rounded-md overflow-hidden bg-black/50">
          {showLiveness && useAws ? (
            <Suspense
              fallback={
                <div className="p-4 text-sm text-muted-foreground">
                  {tr("جاري تحميل فحص الحيوية…", "Loading liveness…")}
                </div>
              }
            >
              <AwsLiveness
                onSucceeded={async () => {
                  setShowLiveness(false);
                  await handleStartIdentify();
                }}
                onCancel={() => setShowLiveness(false)}
              />
            </Suspense>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              {camError ? (
                <div className="absolute inset-x-0 bottom-0 bg-black/60 text-red-200 text-xs p-2">
                  {camError}
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{tr("الإجراء:", "Action:")}</span>
          <Button size="sm" onClick={handleStartIdentify} disabled={busy}>
            {busy ? tr("جارٍ التعرّف…", "Identifying…") : tr("ابدأ التحقق بالوجه", "Start face verification")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBusy(false);
              stop();
            }}
            disabled={busy}
          >
            {tr("إلغاء", "Cancel")}
          </Button>
          {!useAws && !isActive ? (
            <Button size="sm" variant="secondary" onClick={() => start()}>
              {tr("تشغيل الكاميرا", "Start camera")}
            </Button>
          ) : null}
          {!useAws && isActive ? (
            <Button size="sm" variant="outline" onClick={() => switchCamera()}>
              {tr("تبديل الكاميرا", "Switch camera")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
