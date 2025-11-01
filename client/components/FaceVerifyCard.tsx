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
  const { selectedBranchId, workers } = useWorkers();
  const [statusMsg, setStatusMsg] = useState<string>(
    tr(
      "انظر إلى الكاميرا وثبّت وجهك داخل الإطار.",
      "Look at the camera and keep your face centered.",
    ),
  );
  const [robot, setRobot] = useState<"neutral" | "happy" | "sad">("neutral");
  const envAws =
    (import.meta as any).env?.VITE_USE_AWS_LIVENESS === "1" ||
    (import.meta as any).env?.VITE_USE_AWS_LIVENESS === "true";
  const useAws = envAws && isIOS();
  const [showLiveness, setShowLiveness] = useState(false);

  useEffect(() => {
    return () => {
      if (!useAws) {
        stop();
      }
    };
  }, [useAws, stop]);
  useEffect(() => {
    if (camError) import("sonner").then(({ toast }) => toast.error(camError));
  }, [camError]);
  useEffect(() => {
    setStatusMsg(
      tr(
        "انظر إلى الكاميرا وثبّت وجهك داخل الإطار.",
        "Look at the camera and keep your face centered.",
      ),
    );
  }, [tr]);

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
      setStatusMsg(tr("ثبّت وجهك… جاري التحقق", "Hold still… verifying"));
      setRobot("neutral");
      if (!isActive) await start();
      const live = await checkLivenessFlexible(videoRef.current!, {
        tries: 12,
        intervalMs: 150,
        strict: false,
      });
      if (!live) {
        toast.info(
          tr(
            "تخطّي فحص الحيوية بسبب ضعف الحركة/الإضاءة.",
            "Liveness relaxed due to low motion/light.",
          ),
        );
      }
      const det = await detectSingleDescriptor(videoRef.current!);
      if (!det) {
        const m = tr(
          "لم يتم اكتشاف وجه واضح. قرّب وجهك وأزل النظارة إن وجدت.",
          "No clear face detected. Move closer and remove glasses if any.",
        );
        setStatusMsg(m);
        setRobot("sad");
        toast.error(m);
        return;
      }
      const snapshot = await captureSnapshot(videoRef.current);
      // Step 1: identify candidate worker without creating verification (dry mode)
      const res = await fetch("/api/face/identify?dry=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-branch-id": selectedBranchId || "",
          "x-dry": "1",
        },
        body: JSON.stringify({
          embedding: det.descriptor,
          snapshot,
          branchId: selectedBranchId || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}) as any);
      if (!res.ok || !j?.ok || !j.workerId) {
        const msg =
          j?.message === "no_match_in_branch"
            ? tr("لا يوجد تطابق في هذا الفرع", "No match in this branch")
            : j?.message;
        toast.error(msg || tr("فشل التحقق", "Verification failed"));
        return;
      }

      // Check if the identified worker has a complete file (has or or passport documents)
      // First check from API response, then from context if available
      let workerDocs = j.workerDocs;
      if (!workerDocs && j.workerId) {
        const contextWorker = workers[j.workerId];
        workerDocs = contextWorker?.docs;
      }
      const workerComplete = workerDocs?.or || workerDocs?.passport;
      if (!workerComplete) {
        const msg = tr(
          "ملفك غير مكتمل ولا يمكن إعطاؤك أي مبلغ. يرجى إضافة المستندات أولاً.",
          "Your file is incomplete and cannot receive any amount. Please add documents first.",
        );
        setStatusMsg(msg);
        setRobot("sad");
        toast.error(msg);
        return;
      }

      // Step 2: confirm using AWS Rekognition CompareFaces (server-side) which will also insert verification
      async function tryCompare(url: string) {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceImageB64: snapshot,
            workerId: j.workerId,
            similarityThreshold: 80,
          }),
        });
        const jj = await r.json().catch(() => ({}) as any);
        return { r, jj };
      }
      let resp = await tryCompare("/.netlify/functions/compare-face");
      if (!resp.r.ok || !resp.jj?.ok || !resp.jj?.success) {
        // Fallback to Node server route when Netlify Functions are unavailable
        resp = await tryCompare("/api/face/compare");
      }
      const r2 = resp.r;
      const j2 = resp.jj;
      if (!r2.ok || !j2?.ok || !j2?.success) {
        let em = j2?.message as string | undefined;
        if (!em)
          try {
            em = await r2.text();
          } catch {}
        setStatusMsg(
          em ||
            tr(
              "فشل التحقق. رجاءً قرّب وجهك، أزل النظارة، وانظر للكاميرا.",
              "Verification failed. Move closer, remove glasses, and look at the camera.",
            ),
        );
        setRobot("sad");
        toast.error(em || tr("فشل التحقق عبر AWS", "AWS comparison failed"));
        return;
      }
      onVerified({ workerId: j.workerId, workerName: j.workerName });
      setStatusMsg(
        tr(
          "نجاح! تم التطابق. اضغط موافق لإضافة 40 بيسو.",
          "Success! Match found. Press OK to add ₱40.",
        ),
      );
      setRobot("happy");
      toast.success(
        tr("تم التطابق بنسبة:", "Matched with similarity:") +
          ` ${Math.round((j2.similarity || 0) * 10) / 10}%`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="p-4 flex items-center justify-between border-b">
        <div className="font-bold">
          {tr("التحقق بالوجه", "Face verification")}
        </div>
        <div className="text-sm text-muted-foreground">
          {tr("جاهز", "Ready")}
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="relative aspect-video w-full rounded-md overflow-hidden bg-black/50 min-h-[320px] md:min-h-[380px]">
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
        <div className="rounded-md border bg-muted/40 p-3 flex items-center gap-3">
          <div className="text-2xl" aria-hidden>
            {robot === "happy" ? "🤖😊" : robot === "sad" ? "🤖😕" : "🤖"}
          </div>
          <div className="text-sm font-medium">{statusMsg}</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {tr("الإجراء:", "Action:")}
          </span>
          <Button size="sm" onClick={handleStartIdentify} disabled={busy}>
            {busy
              ? tr("جاري التحقق من البيانات الحيوية…", "Verifying biometrics…")
              : tr("ابدأ التحقق بالوجه", "Start face verification")}
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
