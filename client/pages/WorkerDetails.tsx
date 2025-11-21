import { useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency, isNoExpensePolicyLocked } from "@/lib/utils";
import BackButton from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lock, Download } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export default function WorkerDetails() {
  const { id } = useParams();
  const {
    branches,
    workers,
    setWorkerExit,
    requestUnlock,
    updateWorkerDocs,
    updateWorkerStatuses,
  } = useWorkers();
  const worker = id ? workers[id] : undefined;
  const { locale, tr } = useI18n();
  const location = useLocation();
  const isAdminPage = useMemo(() => {
    try {
      const q = new URLSearchParams(location.search);
      return q.get("admin") === "1";
    } catch {
      return false;
    }
  }, [location.search]);

  if (!worker) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">
          {tr(
            "لا توجد بيانات للعاملة المطلوبة.",
            "No data found for the requested applicant.",
          )}
        </p>
        <Link to="/workers" className="text-primary hover:underline">
          {tr("للعودة إلى قائمة العاملات", "Back to applicants list")}
        </Link>
      </main>
    );
  }

  const total = worker.verifications.reduce(
    (sum, v) => sum + (v.payment?.amount ?? 0),
    0,
  );
  const complete = !!(worker.docs?.or || worker.docs?.passport);
  const exitedLocked = !!worker.exitDate && worker.status !== "active";
  const policyLocked = isNoExpensePolicyLocked(worker as any);
  const locked = exitedLocked || policyLocked;
  const [exitText, setExitText] = useState("");
  const [exitReason, setExitReason] = useState("");

  const parsedExitTs = useMemo(() => {
    const s = exitText.trim();
    if (!s) return null as number | null;
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
  }, [exitText]);

  const preview = useMemo(() => {
    if (!parsedExitTs || !exitReason.trim())
      return null as null | { days: number; rate: number; total: number };
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(
      1,
      Math.ceil((parsedExitTs - (worker.arrivalDate || Date.now())) / msPerDay),
    );
    const rate = 220;
    const total = days * rate;
    return { days, rate, total };
  }, [parsedExitTs, exitReason, worker.arrivalDate]);

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
        toast.error(tr("تعذر حفظ الوثائق", "Failed to save documents"));
        return;
      }
      setPreCost({ days: j.days, rate: j.rate, cost: j.cost });
      toast.success(tr("تم حفظ الوثائق", "Documents saved"));
    } catch {
      toast.error(tr("تعذر حفظ الوثائق", "Failed to save documents"));
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
        toast.error(tr("تعذر التحديث", "Failed to update"));
        return;
      }
      // Update local state to immediately move this worker out of "no_expense"
      updateWorkerDocs(worker.id, { plan: "with_expense" });
      toast.success(tr("تم تحديث حالة الخطة", "Plan status updated"));
    } catch {
      toast.error(tr("تعذر التحديث", "Failed to update"));
    }
  }

  function handleDownloadReport() {
    const rate = 220;
    const exitTs = (worker.exitDate || parsedExitTs || null) as number | null;
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = exitTs
      ? Math.max(
          1,
          Math.ceil((exitTs - (worker.arrivalDate || Date.now())) / msPerDay),
        )
      : null;
    const total = days ? days * rate : null;
    const branchName = branches[worker.branchId]?.name || "";

    const fieldLabel = "Field";
    const valueLabel = "Value";
    const nameLabel = "Name";
    const branchLabel = "Branch";
    const arrivalLabel = "Arrival Date";
    const exitLabel = "Exit Date";
    const reasonLabel = "Exit Reason";
    const daysLabel = "Days";
    const rateLabel = "Daily Rate (₱)";
    const totalLabel = "Total (₱)";

    const infoRows = [
      { [fieldLabel]: nameLabel, [valueLabel]: worker.name },
      { [fieldLabel]: branchLabel, [valueLabel]: branchName },
      {
        [fieldLabel]: arrivalLabel,
        [valueLabel]: new Date(worker.arrivalDate).toLocaleDateString("en-US"),
      },
      exitTs
        ? {
            [fieldLabel]: exitLabel,
            [valueLabel]: new Date(exitTs).toLocaleDateString("en-US"),
          }
        : { [fieldLabel]: exitLabel, [valueLabel]: "" },
      {
        [fieldLabel]: reasonLabel,
        [valueLabel]: worker.exitReason || exitReason || "",
      },
      { [fieldLabel]: daysLabel, [valueLabel]: days ?? "" },
      { [fieldLabel]: rateLabel, [valueLabel]: rate },
      { [fieldLabel]: totalLabel, [valueLabel]: total ?? "" },
    ];

    const verDateLabel = "Verification Date";
    const amountLabel = "Amount (₱)";
    const saveLabel = "Save Date";

    const verRows = worker.verifications.map((v) => ({
      [verDateLabel]: new Date(v.verifiedAt).toLocaleString("en-US"),
      [amountLabel]: v.payment?.amount ?? "",
      [saveLabel]: v.payment
        ? new Date(v.payment.savedAt).toLocaleString("en-US")
        : "",
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(infoRows);
    const ws2 = XLSX.utils.json_to_sheet(verRows);
    const sheet1Name = "Applicant Data";
    const sheet2Name = "Verifications and Payments";
    XLSX.utils.book_append_sheet(wb, ws1, sheet1Name);
    XLSX.utils.book_append_sheet(wb, ws2, sheet2Name);
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, "0");
    const d = String(new Date().getDate()).padStart(2, "0");
    const safeName = worker.name.replace(/[^\w\u0600-\u06FF]+/g, "-");
    XLSX.writeFile(wb, `worker-report-${safeName}-${y}-${m}-${d}.xlsx`);
  }

  return (
    <main className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {tr("بيانات العاملة:", "Applicant details:")} {worker.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tr("تاريخ الوصول:", "Arrival date:")}{" "}
            {new Date(worker.arrivalDate).toLocaleDateString(
              locale === "ar" ? "ar-EG" : "en-US",
            )}
          </p>
          <p className="mt-1 text-sm">
            {tr("الملف:", "Profile:")}{" "}
            <span
              className={`${complete ? "text-emerald-700" : "text-amber-700"} font-semibold`}
            >
              {complete
                ? tr("مكتمل", "Complete")
                : tr("غير مكتمل", "Incomplete")}
            </span>
          </p>
          <p className="mt-2 text-sm">
            {tr("الحالة في نظام الإقامة:", "Status in Accommodation System:")}{" "}
            <span
              className={`font-semibold ${worker.status === "active" ? "text-emerald-700" : "text-rose-700"}`}
            >
              {worker.status === "active"
                ? tr("نشطة", "Active")
                : worker.status === "exited"
                  ? tr("مغلقة", "Closed")
                  : tr("قيد الانتظار", "Pending")}
            </span>
            {worker.status !== "active" &&
              worker.status !== "unlock_requested" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ms-2"
                  onClick={() => {
                    const req = requestUnlock(worker.id);
                    if (req) {
                      toast.success(
                        tr(
                          "تم إرسال طلب فتح الملف إلى الإدارة",
                          "Unlock request sent to admin",
                        ),
                      );
                    }
                  }}
                >
                  {tr("فتح الملف", "Unlock Profile")}
                </Button>
              )}
          </p>
        </div>
        <BackButton />
      </div>

      {/* Required Documents Section */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-bold">
            {tr("الوثائق المطلوبة", "Required Documents")}
          </h2>
        </div>
        <div className="p-6 space-y-4">
          {/* OR Document */}
          <div className="space-y-2">
            <Label className="font-semibold">
              {tr("البطاقة الصحية (OR)", "Health Card (OR)")}
            </Label>
            {orLocked && (
              <div className="flex items-center gap-2 rounded bg-secondary/50 p-2 text-xs text-muted-foreground">
                <Lock className="h-4 w-4" />
                {tr("محمي من التعديل", "Locked for editing")}
              </div>
            )}
            {!orLocked && (
              <div className="space-y-2">
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setOrFile(e.target.files?.[0] || null)}
                  disabled={savingDocs}
                />
                {orFile && (
                  <p className="text-xs text-muted-foreground">
                    {tr("الملف:", "File:")} {orFile.name}
                  </p>
                )}
              </div>
            )}
            {worker.docs?.or && (
              <p className="text-xs text-emerald-700 font-semibold">
                ✓ {tr("تم التحميل", "Uploaded")}
              </p>
            )}
          </div>

          {/* Passport Document */}
          <div className="space-y-2">
            <Label className="font-semibold">
              {tr("جواز السفر (Passport)", "Passport")}
            </Label>
            {passLocked && (
              <div className="flex items-center gap-2 rounded bg-secondary/50 p-2 text-xs text-muted-foreground">
                <Lock className="h-4 w-4" />
                {tr("محمي من التعديل", "Locked for editing")}
              </div>
            )}
            {!passLocked && (
              <div className="space-y-2">
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setPassFile(e.target.files?.[0] || null)}
                  disabled={savingDocs}
                />
                {passFile && (
                  <p className="text-xs text-muted-foreground">
                    {tr("الملف:", "File:")} {passFile.name}
                  </p>
                )}
              </div>
            )}
            {worker.docs?.passport && (
              <p className="text-xs text-emerald-700 font-semibold">
                ✓ {tr("تم التحميل", "Uploaded")}
              </p>
            )}
          </div>

          {/* Save Documents Button */}
          <Button
            onClick={saveDocs}
            disabled={savingDocs || (!orFile && !passFile)}
            className="w-full gap-2"
          >
            {savingDocs && <span className="inline-block animate-spin">⟳</span>}
            {tr("حفظ الوثائق", "Save Documents")}
          </Button>
        </div>
      </div>

      {/* Exit Fee Summary */}
      {preview && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-bold">
              {tr("ملخص رسوم الخروج", "Exit Fee Summary")}
            </h2>
          </div>
          <div className="p-6">
            <div className="grid gap-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {tr("الأيام:", "Days:")}
                </span>
                <span className="font-semibold">{preview.days}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {tr("المعدل اليومي (₱):", "Daily rate (₱):")}
                </span>
                <span className="font-semibold">₱ {preview.rate}</span>
              </div>
              <div className="border-t pt-4 flex justify-between">
                <span className="font-semibold">
                  {tr("الإجمالي (₱):", "Total (₱):")}
                </span>
                <span className="text-lg font-bold">
                  ₱ {preview.total.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Exit Section */}
      {!locked && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-bold">
              {tr("تسجيل الخروج", "Record Exit")}
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <Label htmlFor="exit-date" className="font-semibold">
                {tr("تاريخ الخروج", "Exit Date")}
              </Label>
              <Input
                id="exit-date"
                type="text"
                placeholder={tr("yyyy-mm-dd", "yyyy-mm-dd")}
                value={exitText}
                onChange={(e) => setExitText(e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="exit-reason" className="font-semibold">
                {tr("سبب الخروج", "Exit Reason")}
              </Label>
              <Textarea
                id="exit-reason"
                placeholder={tr("أدخل سبب الخروج", "Enter exit reason")}
                value={exitReason}
                onChange={(e) => setExitReason(e.target.value)}
                className="mt-2"
              />
            </div>
            {preview && (
              <div className="rounded bg-secondary/50 p-4">
                <p className="text-sm font-semibold mb-2">
                  {tr("ملخص الرسوم:", "Fee Summary:")}
                </p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>{tr("الأيام:", "Days:")}</span>
                    <span>{preview.days}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("المعدل:", "Rate:")}</span>
                    <span>₱{preview.rate}</span>
                  </div>
                  <div className="border-t pt-1 flex justify-between font-bold">
                    <span>{tr("الإجمالي:", "Total:")}</span>
                    <span>₱{preview.total}</span>
                  </div>
                </div>
              </div>
            )}
            <Button
              onClick={() => {
                if (parsedExitTs && exitReason.trim()) {
                  setWorkerExit(worker.id, parsedExitTs, exitReason.trim());
                  setExitText("");
                  setExitReason("");
                  toast.success(
                    tr("تم تسجيل الخروج بنجاح", "Exit recorded successfully"),
                  );
                }
              }}
              disabled={!preview}
              className="w-full"
            >
              {tr("تأكيد الخروج", "Confirm Exit")}
            </Button>
          </div>
        </div>
      )}

      {/* Paid Summary */}
      {total > 0 && (
        <div className="rounded-xl border bg-card shadow-sm p-6">
          <div className="flex justify-between items-center">
            <span className="font-semibold">
              {tr("إجمالي المدفوع:", "Total Paid:")}
            </span>
            <span className="text-2xl font-bold">
              ₱ {total.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Download Report Button */}
      <Button
        onClick={handleDownloadReport}
        variant="outline"
        className="w-full gap-2"
      >
        <Download className="h-4 w-4" />
        {tr("تحميل التقرير", "Download Report")}
      </Button>

      {/* Upgrade Plan Button */}
      {!locked && worker.plan === "no_expense" && (
        <Button onClick={upgradePlan} className="w-full">
          {tr("تحديث المتقدم", "Update Applicant")}
        </Button>
      )}
    </main>
  );
}
