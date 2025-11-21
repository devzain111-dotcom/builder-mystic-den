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
import { Lock, Download, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [mainSystemStatus, setMainSystemStatus] = useState(
    worker.mainSystemStatus || ""
  );

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

  // Calculate days without expenses (before document submission)
  const daysWithoutExpenses = useMemo(() => {
    if (!worker.docs?.or && !worker.docs?.passport) {
      // No documents submitted, calculate from arrival date to now
      const msPerDay = 24 * 60 * 60 * 1000;
      const days = Math.ceil(
        (Date.now() - (worker.arrivalDate || Date.now())) / msPerDay
      );
      return { days, rate: 220, total: days * 220 };
    }
    // Documents were submitted, use preCost if available
    if (preCost) {
      return { days: preCost.days, rate: preCost.rate, total: preCost.cost };
    }
    return null;
  }, [worker.docs, worker.arrivalDate, preCost]);

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
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container py-8 space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-slate-900">
                {worker.name}
              </h1>
              <div
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  complete
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {complete ? tr("مكتمل", "Complete") : tr("غير مكتمل", "Incomplete")}
              </div>
            </div>
            <p className="text-slate-600 text-sm mb-4">
              {tr("تاريخ الوصول:", "Arrival date:")} <span className="font-medium text-slate-900">
                {new Date(worker.arrivalDate).toLocaleDateString("en-US", {
                  month: "2-digit",
                  day: "2-digit",
                  year: "numeric",
                })}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${
                  worker.status === "active"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {worker.status === "active" ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                <span className="hidden sm:inline">{tr("نظام الإقامة:", "Accommodation System:")}</span>
                <span className="sm:hidden">{tr("الإقامة:", "System:")}</span>
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
            </div>
          </div>
          <BackButton />
        </div>

        {/* Status in Main System Card */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                {tr("الحالة في النظام الرئيسي", "Main System Status")}
              </h2>
            </div>
            <div className="p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-slate-700 font-semibold mb-2 block">
                    {tr("الحالة", "Status")}
                  </Label>
                  {mainSystemStatus ? (
                    <Select value={mainSystemStatus} onValueChange={setMainSystemStatus}>
                      <SelectTrigger className="w-full border-slate-200 text-slate-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deployed">
                          {tr("مرسلة", "Deployed")}
                        </SelectItem>
                        <SelectItem value="on_hold">
                          {tr("قيد الانتظار", "On Hold")}
                        </SelectItem>
                        <SelectItem value="visa_rejected">
                          {tr("تأشيرة مرفوضة", "Visa Rejected")}
                        </SelectItem>
                        <SelectItem value="return_to_origin">
                          {tr("العودة للأصل", "Return to Origin")}
                        </SelectItem>
                        <SelectItem value="unfit">
                          {tr("غير مناسبة", "Unfit")}
                        </SelectItem>
                        <SelectItem value="backout">
                          {tr("الانسحاب", "Backout")}
                        </SelectItem>
                        <SelectItem value="selected">
                          {tr("مختارة", "Selected")}
                        </SelectItem>
                        <SelectItem value="repat">
                          {tr("الإعادة", "Repat")}
                        </SelectItem>
                        <SelectItem value="rtw">
                          {tr("العودة للعمل", "RTW")}
                        </SelectItem>
                        <SelectItem value="passporting">
                          {tr("جواز السفر", "Passporting")}
                        </SelectItem>
                        <SelectItem value="for_deployment">
                          {tr("للإرسال", "For Deployment")}
                        </SelectItem>
                        <SelectItem value="oce_released">
                          {tr("تم الإفراج", "OCE Released")}
                        </SelectItem>
                        <SelectItem value="visa_stamp">
                          {tr("ختم التأشيرة", "Visa Stamp")}
                        </SelectItem>
                        <SelectItem value="cancelled">
                          {tr("ملغاة", "Cancelled")}
                        </SelectItem>
                        <SelectItem value="for_contract_sig">
                          {tr("لتوقيع العقد", "For Contract Sig")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-lg bg-gray-100 border border-gray-300 px-3 py-2 text-slate-600 text-sm">
                      {tr("بدون", "Not Set")}
                    </div>
                  )}
                </div>
                {mainSystemStatus && (
                  <div className="flex items-end">
                    <Button
                      onClick={() => {
                        updateWorkerStatuses(worker.id, undefined, mainSystemStatus as any);
                        toast.success(
                          tr("تم تحديث الحالة", "Status updated successfully"),
                        );
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {tr("حفظ", "Save")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

        {/* Two Column Layout for Main Content */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Documents and Exit */}
          <div className="lg:col-span-2 space-y-6">
            {/* Required Documents Section */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-200 bg-gradient-to-r from-purple-50 to-pink-50 px-6 py-4">
                <h2 className="text-lg font-bold text-slate-900">
                  {tr("الوثائق المطلوبة", "Required Documents")}
                </h2>
              </div>
              <div className="p-6 space-y-6">
                {/* OR Document */}
                <div className="space-y-3">
                  <Label className="text-slate-700 font-semibold">
                    {tr("البطاقة الصحية (OR)", "Health Card (OR)")}
                  </Label>
                  {orLocked && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
                      <Lock className="h-4 w-4 flex-shrink-0" />
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
                        className="border-slate-200 cursor-pointer"
                      />
                      {orFile && (
                        <p className="text-xs text-slate-600">
                          {tr("الملف:", "File:")} <span className="font-medium">{orFile.name}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {worker.docs?.or && (
                    <p className="text-sm text-emerald-700 font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {tr("تم التحميل", "Uploaded")}
                    </p>
                  )}
                </div>

                {/* Passport Document */}
                <div className="space-y-3 border-t border-slate-200 pt-6">
                  <Label className="text-slate-700 font-semibold">
                    {tr("جواز السفر (Passport)", "Passport")}
                  </Label>
                  {passLocked && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
                      <Lock className="h-4 w-4 flex-shrink-0" />
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
                        className="border-slate-200 cursor-pointer"
                      />
                      {passFile && (
                        <p className="text-xs text-slate-600">
                          {tr("الملف:", "File:")} <span className="font-medium">{passFile.name}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {worker.docs?.passport && (
                    <p className="text-sm text-emerald-700 font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {tr("ت�� التحميل", "Uploaded")}
                    </p>
                  )}
                </div>

                {/* Save Documents Button */}
                <Button
                  onClick={saveDocs}
                  disabled={savingDocs || (!orFile && !passFile)}
                  className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
                >
                  {savingDocs && <span className="inline-block animate-spin">⟳</span>}
                  {tr("حفظ الوثائق", "Save Documents")}
                </Button>
              </div>
            </div>

            {/* Record Exit Section */}
            {!locked && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 bg-gradient-to-r from-orange-50 to-red-50 px-6 py-4">
                  <h2 className="text-lg font-bold text-slate-900">
                    {tr("تسجيل الخروج", "Record Exit")}
                  </h2>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <Label htmlFor="exit-date" className="text-slate-700 font-semibold">
                      {tr("تاريخ الخروج", "Exit Date")}
                    </Label>
                    <Input
                      id="exit-date"
                      type="text"
                      placeholder={tr("yyyy-mm-dd", "yyyy-mm-dd")}
                      value={exitText}
                      onChange={(e) => setExitText(e.target.value)}
                      className="mt-2 border-slate-200"
                    />
                  </div>
                  <div>
                    <Label htmlFor="exit-reason" className="text-slate-700 font-semibold">
                      {tr("سبب الخروج", "Exit Reason")}
                    </Label>
                    <Textarea
                      id="exit-reason"
                      placeholder={tr("أدخل سبب الخروج", "Enter exit reason")}
                      value={exitReason}
                      onChange={(e) => setExitReason(e.target.value)}
                      className="mt-2 border-slate-200"
                      rows={3}
                    />
                  </div>
                  {preview && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-900 mb-3">
                        {tr("ملخص الرسوم:", "Fee Summary:")}
                      </p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-slate-700">
                          <span>{tr("الأيام:", "Days:")}</span>
                          <span className="font-medium">{preview.days}</span>
                        </div>
                        <div className="flex justify-between text-slate-700">
                          <span>{tr("المعدل:", "Rate:")}</span>
                          <span className="font-medium">₱{preview.rate}</span>
                        </div>
                        <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-900">
                          <span>{tr("الإجمالي:", "Total:")}</span>
                          <span>₱{preview.total.toLocaleString()}</span>
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
                          tr(
                            "تم تسجيل الخروج بنجاح",
                            "Exit recorded successfully",
                          ),
                        );
                      }
                    }}
                    disabled={!preview}
                    className="w-full bg-orange-600 hover:bg-orange-700"
                  >
                    {tr("تأكيد الخروج", "Confirm Exit")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Summary Cards */}
          <div className="space-y-6">
            {/* Total Paid Section with Verification Details */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-200 bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4">
                <h2 className="text-lg font-bold text-slate-900">
                  {tr("إجمالي المدفوع", "Total Paid")}
                </h2>
              </div>
              <div className="p-6 space-y-6">
                {/* Total Amount */}
                <div className="text-center pb-4 border-b border-slate-200">
                  <p className="text-slate-600 text-sm mb-1">
                    {tr("المجموع", "Total Amount")}
                  </p>
                  <p className="text-4xl font-bold text-emerald-600">
                    ₱ {total.toLocaleString()}
                  </p>
                </div>

                {/* Verifications and Payments */}
                {worker.verifications.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      {tr("عمليات التحقق", "Verification Operations")}
                    </h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {worker.verifications.slice(0, 5).map((v) => (
                        <div
                          key={v.id}
                          className="flex items-center justify-between rounded-lg bg-slate-50 p-3 border border-slate-200"
                        >
                          <div className="flex-1">
                            <p className="text-xs text-slate-600">
                              {new Date(v.verifiedAt).toLocaleDateString("en-US")}
                            </p>
                          </div>
                          <div className="text-right">
                            {v.payment ? (
                              <p className="text-sm font-semibold text-emerald-600">
                                ₱ {v.payment.amount}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-500">
                                {tr("معلق", "Pending")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                      {worker.verifications.length > 5 && (
                        <p className="text-xs text-center text-slate-500 pt-2">
                          {tr("و", "and")} {worker.verifications.length - 5} {tr("أخرى", "more")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Days Without Expenses */}
                {daysWithoutExpenses && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                    <h3 className="text-sm font-semibold text-blue-900 mb-3">
                      {tr("أيام بدون مصروف", "Days Without Expenses")}
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-blue-700">
                          {tr("عدد الأيام:", "Number of Days:")}
                        </span>
                        <span className="font-semibold text-blue-900">
                          {daysWithoutExpenses.days}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-blue-700">
                          {tr("السعر اليومي:", "Daily Rate:")}
                        </span>
                        <span className="font-semibold text-blue-900">
                          ₱ {daysWithoutExpenses.rate}
                        </span>
                      </div>
                      <div className="border-t border-blue-200 pt-2 flex justify-between">
                        <span className="font-semibold text-blue-900">
                          {tr("الإجمالي:", "Total:")}
                        </span>
                        <span className="text-lg font-bold text-blue-900">
                          ₱ {daysWithoutExpenses.total.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* No Expense Policy Charge */}
                {worker.plan === "no_expense" && preCost && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                    <h3 className="text-sm font-semibold text-amber-900 mb-3">
                      {tr("رسوم سياسة عدم المصروف", "No Expense Policy")}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-amber-700">
                          {tr("الأيام قبل الوثائق:", "Days before documents:")}
                        </span>
                        <span className="font-semibold text-amber-900">
                          {preCost.days}
                        </span>
                      </div>
                      <div className="border-t border-amber-200 pt-2 flex justify-between font-semibold">
                        <span className="text-amber-900">
                          {tr("المبلغ المستحق:", "Amount Due:")}
                        </span>
                        <span className="text-amber-900">
                          ₱ {preCost.cost.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Upgrade Plan Button */}
            {!locked && worker.plan === "no_expense" && (
              <Button
                onClick={upgradePlan}
                className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700"
              >
                {tr("تحديث المتقدم", "Update Applicant")}
              </Button>
            )}

            {/* Download Report Button */}
            <Button
              onClick={handleDownloadReport}
              variant="outline"
              className="w-full border-slate-200 text-slate-900 hover:bg-slate-50 gap-2"
            >
              <Download className="h-4 w-4" />
              {tr("تحميل التقرير", "Download Report")}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
