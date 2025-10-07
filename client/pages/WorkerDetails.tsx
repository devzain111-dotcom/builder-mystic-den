import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export default function WorkerDetails() {
  const { id } = useParams();
  const { workers, setWorkerExit, requestUnlock, updateWorkerDocs } =
    useWorkers();
  const worker = id ? workers[id] : undefined;

  if (!worker) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">
          لا توجد بيانات للعاملة المطلوبة.
        </p>
        <Link to="/workers" className="text-primary hover:underline">
          للعودة إلى قائمة العاملات
        </Link>
      </main>
    );
  }

  const total = worker.verifications.reduce(
    (sum, v) => sum + (v.payment?.amount ?? 0),
    0,
  );
  const complete = !!(worker.docs?.or && worker.docs?.passport);
  const locked = !!worker.exitDate && worker.status !== "active";
  const [exitText, setExitText] = useState("");
  const [exitReason, setExitReason] = useState("");

  const orLocked = !!worker.docs?.or;
  const passLocked = !!worker.docs?.passport;

  // Upload docs state
  const [orFile, setOrFile] = useState<File | null>(null);
  const [passFile, setPassFile] = useState<File | null>(null);
  const [savingDocs, setSavingDocs] = useState(false);
  const [preCost, setPreCost] = useState<{
    days: number;
    rate: number;
    cost: number;
  } | null>(null);

  async function compressImage(
    file: File,
    maxDim = 1200,
    quality = 0.82,
  ): Promise<string> {
    const img = document.createElement("img");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    await new Promise((res, rej) => {
      img.onload = () => res(null);
      img.onerror = rej;
      img.src = dataUrl;
    });
    const w = img.width,
      h = img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no-ctx");
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function saveDocs() {
    try {
      setSavingDocs(true);
      const payload: any = {
        workerId: worker.id,
        name: worker.name,
        branchId: worker.branchId,
        arrivalDate: worker.arrivalDate,
      };
      const [orB64, passB64] = await Promise.all([
        orFile ? compressImage(orFile) : Promise.resolve<string>(""),
        passFile ? compressImage(passFile) : Promise.resolve<string>(""),
      ]);
      if (orB64) payload.orDataUrl = orB64;
      if (passB64) payload.passportDataUrl = passB64;

      // Optimistic local update of docs
      const patch: any = {};
      if (orB64 && !orLocked) patch.or = orB64;
      if (passB64 && !passLocked) patch.passport = passB64;
      if (Object.keys(patch).length) updateWorkerDocs(worker.id, patch);

      const r = await fetch("/api/workers/docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-id": worker.id,
          "x-or-len": String((payload.orDataUrl || "").length),
          "x-pass-len": String((payload.passportDataUrl || "").length),
        },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}) as any);
      if (!r.ok || !j?.ok) {
        toast.error(j?.message || "تعذر حفظ الوثائق");
        return;
      }
      setPreCost({ days: j.days, rate: j.rate, cost: j.cost });
      toast.success("تم حفظ الوثائق");
    } catch {
      toast.error("تعذر حفظ الوثائق");
    } finally {
      setSavingDocs(false);
    }
  }

  async function upgradePlan() {
    try {
      const r = await fetch("/api/workers/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-id": worker.id,
          "x-plan": "with_expense",
        },
        body: JSON.stringify({ workerId: worker.id, plan: "with_expense" }),
      });
      const j = await r.json().catch(() => ({}) as any);
      if (!r.ok || !j?.ok) {
        toast.error(j?.message || "تعذر التحديث");
        return;
      }
      // Update local state to immediately move this worker out of "no_expense"
      updateWorkerDocs(worker.id, { plan: "with_expense" });
      toast.success("تم تحديث حالة الخطة");
    } catch {
      toast.error("تعذر التحديث");
    }
  }
  function parseDateText(t: string): number | null {
    const s = t.trim();
    if (!s) return null;
    const m = s.match(/(\d{1,4})\D(\d{1,2})\D(\d{2,4})/);
    if (m) {
      const a = Number(m[1]),
        b = Number(m[2]),
        c = Number(m[3]);
      const y = a > 31 ? a : c;
      const d = a > 31 ? c : a;
      const mo = b;
      const Y = y < 100 ? y + 2000 : y;
      const ts = new Date(Y, mo - 1, d, 12, 0, 0, 0).getTime();
      if (!isNaN(ts)) return ts;
    }
    const d2 = new Date(s);
    if (!isNaN(d2.getTime()))
      return new Date(
        d2.getFullYear(),
        d2.getMonth(),
        d2.getDate(),
        12,
        0,
        0,
        0,
      ).getTime();
    return null;
  }

  return (
    <main className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">بيانات العاملة: {worker.name}</h1>
          <p className="text-sm text-muted-foreground">
            تاريخ الوصول:{" "}
            {new Date(worker.arrivalDate).toLocaleDateString("ar-EG")}
          </p>
          <p className="mt-1 text-sm">
            الملف:{" "}
            <span
              className={`${complete ? "text-emerald-700" : "text-amber-700"} font-semibold`}
            >
              {complete ? "مكتمل" : "غير مكتمل"}
            </span>
          </p>
        </div>
        <Link to="/workers" className="text-primary hover:underline">
          العودة
        </Link>
        <button
          className="ms-3 inline-flex items-center rounded-md bg-rose-600 px-3 py-2 text-sm text-white hover:bg-rose-700"
          onClick={async () => {
            if (!confirm("تأكيد حذف العاملة وكل سجلاتها؟")) return;
            try {
              const r = await fetch(`/api/workers/${worker.id}`, {
                method: "DELETE",
              });
              if (!r.ok) throw new Error("delete_failed");
              window.location.href = "/workers";
            } catch {
              try {
                const { toast } = await import("sonner");
                toast.error("تعذر الحذف");
              } catch {}
            }
          }}
        >
          حذف العاملة
        </button>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">الحالة وتاريخ الخروج</div>
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              الحالة:{" "}
              {locked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-600/10 px-3 py-1 text-rose-700 text-sm font-semibold">
                  <Lock className="h-3 w-3" /> مقفولة
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-600/10 px-3 py-1 text-emerald-700 text-sm font-semibold">
                  نشطة
                </span>
              )}
            </div>
            {locked ? (
              worker.status === "unlock_requested" ? (
                <span className="text-xs text-muted-foreground">
                  تم إرسال طلب فتح الملف — بانتظار الإدار��
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestUnlock(worker.id)}
                >
                  اطلب من الإد��رة فتح ملف العاملة
                </Button>
              )
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">تاريخ الخروج:</span>
            <Input
              value={exitText}
              onChange={(e) => setExitText(e.target.value)}
              dir="ltr"
              placeholder="yyyy-mm-dd أو dd/mm/yyyy"
              className="w-60"
            />
            <Button
              size="sm"
              onClick={() => {
                const ts = parseDateText(exitText);
                if (ts != null && exitReason.trim())
                  setWorkerExit(worker.id, ts, exitReason.trim());
              }}
            >
              حفظ
            </Button>
            {worker.exitDate ? (
              <span className="text-xs text-muted-foreground">
                الحالي: {new Date(worker.exitDate).toLocaleDateString("ar-EG")}
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="exit-reason">
              أسباب الخروج (إلزامي عند حفظ التاريخ)
            </Label>
            <Textarea
              id="exit-reason"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              placeholder="اكتب أسباب الخروج"
              rows={3}
            />
            {worker.exitReason ? (
              <p className="text-xs text-muted-foreground">
                المسجل حالياً: {worker.exitReason}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">الوثائق</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
          <div>
            <div className="mb-2 text-sm font-semibold">OR</div>
            {worker.docs?.or ? (
              <img
                src={worker.docs.or}
                alt="OR"
                className="max-h-64 rounded-md border"
              />
            ) : (
              <div className="rounded-md border p-6 text-center text-muted-foreground">
                لا يوجد
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="file"
                accept="image/*,application/pdf"
                disabled={orLocked}
                onChange={(e) => setOrFile(e.target.files?.[0] || null)}
              />
              {orLocked ? (
                <span className="text-xs text-muted-foreground">
                  تم قفل وثيقة OR
                </span>
              ) : null}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">Passport</div>
            {worker.docs?.passport ? (
              <img
                src={worker.docs.passport}
                alt="Passport"
                className="max-h-64 rounded-md border"
              />
            ) : (
              <div className="rounded-md border p-6 text-center text-muted-foreground">
                لا يوجد
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="file"
                accept="image/*,application/pdf"
                disabled={passLocked}
                onChange={(e) => setPassFile(e.target.files?.[0] || null)}
              />
              {passLocked ? (
                <span className="text-xs text-muted-foreground">
                  تم قفل وثيقة الجواز
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="p-4 flex flex-wrap items-center gap-3 border-t">
          <Button
            size="sm"
            onClick={saveDocs}
            disabled={
              savingDocs || (!orFile && !passFile) || (orLocked && passLocked)
            }
          >
            حفظ الوثائق
          </Button>
          {(orLocked || passLocked) && (
            <span className="text-xs text-muted-foreground">
              الوثائق الموجودة مثبتة ولا يمكن استبدالها
            </span>
          )}
          {preCost || worker.docs?.pre_change ? (
            <div className="ms-auto rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {(() => {
                const pc = preCost ||
                  (worker.docs?.pre_change as any) || {
                    days: 0,
                    rate: 200,
                    cost: 0,
                  };
                return (
                  <span>
                    مجموع ن��قات الإقام�� قبل التغيير: ₱ {pc.cost} — أيام:{" "}
                    {pc.days} — المعدل اليومي: ₱ {pc.rate}
                  </span>
                );
              })()}
            </div>
          ) : null}
          {worker.docs?.or || worker.docs?.passport ? (
            worker.plan === "no_expense" ? (
              <Button variant="secondary" size="sm" onClick={upgradePlan}>
                تحديث العاملة
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                تم التحديث
              </Button>
            )
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">
          سجل عمليات التحقق والمبالغ
        </div>
        <ul className="divide-y">
          {worker.verifications.length === 0 && (
            <li className="p-6 text-center text-muted-foreground">
              لا توجد عمليات تحقق بعد
            </li>
          )}
          {worker.verifications.map((v) => (
            <li key={v.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      تاريخ ال��حقق:{" "}
                      {new Date(v.verifiedAt).toLocaleString("ar")}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {v.payment ? (
                        <span>
                          تم التحقق — ₱ {v.payment.amount} — محفوظ بتاريخ{" "}
                          {new Date(v.payment.savedAt).toLocaleString("ar")}
                        </span>
                      ) : (
                        <span>لا يوجد مبلغ محفوظ</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t p-4 text-right font-semibold">
          الإجمالي: ₱ {total}
        </div>
      </div>
    </main>
  );
}
