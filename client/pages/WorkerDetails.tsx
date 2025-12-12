import { useMemo, useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { usePageRefresh } from "@/context/PageRefreshContext";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency, isNoExpensePolicyLocked } from "@/lib/utils";
import BackButton from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Lock,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function WorkerDetails() {
  const { id } = useParams();
  console.log("[WorkerDetails] useParams result:", {
    id,
    type: typeof id,
  });
  const {
    branches,
    workers,
    setWorkerExit,
    requestUnlock,
    updateWorkerDocs,
    updateWorkerStatuses,
    refreshWorkers,
    loadWorkerFullDocs,
  } = useWorkers();
  const { locale, tr } = useI18n();
  const { registerRefreshHandler, unregisterRefreshHandler } = usePageRefresh();

  // All hooks must be called unconditionally, before any early returns
  const [exitText, setExitText] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [passFile, setPassFile] = useState<File | null>(null);
  const [savingDocs, setSavingDocs] = useState(false);
  const [preCost, setPreCost] = useState<{
    days: number;
    rate: number;
    cost: number;
  } | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    title: string;
    src: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const worker = id ? workers[id] : undefined;
  console.log("[WorkerDetails] Worker lookup:", {
    id,
    workerExists: !!worker,
    totalWorkers: Object.keys(workers).length,
    workerIds: Object.keys(workers).slice(0, 5),
  });

  // Register this page's refresh handler
  useEffect(() => {
    const handlePageRefresh = async () => {
      if (id) {
        await loadWorkerFullDocs(id);
        await refreshWorkers();
      }
    };
    registerRefreshHandler(handlePageRefresh);
    return () => {
      unregisterRefreshHandler();
    };
  }, [
    id,
    loadWorkerFullDocs,
    refreshWorkers,
    registerRefreshHandler,
    unregisterRefreshHandler,
  ]);

  // Load full documents on page mount (lazy-load)
  useEffect(() => {
    if (
      id &&
      loadWorkerFullDocs &&
      !worker?.docs?.or &&
      !worker?.docs?.passport
    ) {
      loadWorkerFullDocs(id).catch((err) => {
        console.error("[WorkerDetails] Failed to load worker documents:", err);
      });
    }
  }, [id, loadWorkerFullDocs, worker?.docs?.or, worker?.docs?.passport]);

  // Manual refresh function - refreshes from context, no extra API call needed
  const handleManualRefresh = async () => {
    if (!id || !refreshWorkers) return;
    setIsRefreshing(true);
    try {
      await refreshWorkers();
      console.log("[WorkerDetails] Manual refresh completed");
    } catch (e) {
      console.error("[WorkerDetails] Manual refresh error:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const parsedExitTs = useMemo(() => {
    if (!worker) return null;
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
  }, [exitText, worker]);

  const preview = useMemo(() => {
    if (!worker || !parsedExitTs || !exitReason.trim())
      return null as null | { days: number; rate: number; total: number };
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(
      1,
      Math.ceil((parsedExitTs - (worker.arrivalDate || Date.now())) / msPerDay),
    );
    const rate = branches[worker.branchId]?.residencyRate || 220;
    const total = days * rate;
    return { days, rate, total };
  }, [parsedExitTs, exitReason, worker, branches]);

  const daysWithoutExpenses = useMemo(() => {
    if (!worker) return null;
    const msPerDay = 24 * 60 * 60 * 1000;
    let days = 0;

    if (!worker.docs?.or && !worker.docs?.passport) {
      // No documents submitted, calculate from arrival date to now
      days = Math.ceil(
        (Date.now() - (worker.arrivalDate || Date.now())) / msPerDay,
      );
    } else if (preCost) {
      // Documents were submitted, use preCost if available
      days = preCost.days;
    } else {
      // Default calculation based on arrival date
      days = Math.ceil(
        (Date.now() - (worker.arrivalDate || Date.now())) / msPerDay,
      );
    }

    if (days > 0) {
      const rate = branches[worker.branchId]?.residencyRate || 220;
      return { days, rate, total: days * rate };
    }
    return null;
  }, [worker, preCost, branches]);

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

  const total = (worker.verifications || []).reduce(
    (sum, v) => sum + (v.payment?.amount ?? 0),
    0,
  );
  const complete = !!(worker.docs?.or || worker.docs?.passport);
  const exitedLocked = !!worker.exitDate && worker.status !== "active";
  const policyLocked = isNoExpensePolicyLocked(worker as any);
  const locked = exitedLocked || policyLocked;

  const passLocked = !!worker.docs?.passport;

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
      const passB64 = passFile ? await compressImage(passFile) : "";

      console.log("[WorkerDetails] Document compression complete:", {
        workerId: worker.id.slice(0, 8),
        hasPassport: !!passB64,
        passportSize: passB64.length,
      });

      if (passB64) payload.passportDataUrl = passB64;

      // Optimistic local update of docs
      const patch: any = {};
      if (passB64 && !passLocked) patch.passport = passB64;
      if (Object.keys(patch).length) {
        console.log("[WorkerDetails] Applying optimistic update:", {
          workerId: worker.id.slice(0, 8),
          fields: Object.keys(patch),
        });
        updateWorkerDocs(worker.id, patch);
      }

      console.log("[WorkerDetails] Sending document upload request...", {
        workerId: worker.id.slice(0, 8),
        orLen: (payload.orDataUrl || "").length,
        passLen: (payload.passportDataUrl || "").length,
      });

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

      console.log("[WorkerDetails] Document upload response:", {
        workerId: worker.id.slice(0, 8),
        status: r.status,
        ok: r.ok,
        responseOk: j?.ok,
        message: j?.message,
      });

      if (!r.ok || !j?.ok) {
        const errorMsg = j?.message || "Failed to save documents";
        console.error("[WorkerDetails] Save failed:", errorMsg);
        toast.error(
          tr("تعذر حفظ الوثائق", "Failed to save documents") + `: ${errorMsg}`,
        );
        return;
      }

      setPreCost({ days: j.days, rate: j.rate, cost: j.cost });

      // Reload full documents from server to confirm save
      console.log(
        "[WorkerDetails] Reloading documents after successful save...",
      );
      if (loadWorkerFullDocs) {
        try {
          await loadWorkerFullDocs(worker.id);
          console.log("[WorkerDetails] ✓ Documents reloaded successfully");
        } catch (err) {
          console.warn("[WorkerDetails] Failed to reload documents:", err);
        }
      }

      // Clear file inputs
      setPassFile(null);

      toast.success(tr("تم حفظ الوثائق بنجاح", "Documents saved successfully"));
    } catch (err: any) {
      console.error("[WorkerDetails] Save error:", err);
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
    const rate = branches[worker.branchId]?.residencyRate || 220;
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

    const verRows = (worker.verifications || []).map((v) => ({
      [verDateLabel]: new Date(v.verifiedAt).toLocaleString("en-US"),
      [amountLabel]: v.payment?.amount ?? "",
      [saveLabel]: v.payment
        ? new Date(v.payment.savedAt).toLocaleString("en-US")
        : "",
    }));

    const wb = new ExcelJS.Workbook();

    // ==================== SHEET 1: APPLICANT DATA ====================
    const ws1 = wb.addWorksheet("Applicant Data");

    // Add header row
    const headerRow = ws1.addRow([fieldLabel, valueLabel]);
    headerRow.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 12,
      name: "Calibri",
    };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E40AF" },
    };
    headerRow.alignment = {
      horizontal: "center",
      vertical: "center",
      wrapText: true,
    };
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });

    // Add data rows with alternating colors
    infoRows.forEach((row, idx) => {
      const dataRow = ws1.addRow([row[fieldLabel], row[valueLabel]]);
      const isAlt = idx % 2 === 0;

      dataRow.font = { color: { argb: "FF374151" }, size: 11, name: "Calibri" };
      dataRow.fill = isAlt
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } }
        : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      dataRow.alignment = { horizontal: "left", vertical: "center" };
      dataRow.height = 20;

      dataRow.eachCell((cell) => {
        cell.border = {
          left: { style: "thin", color: { argb: "FFD1D5DB" } },
          right: { style: "thin", color: { argb: "FFD1D5DB" } },
          top: { style: "thin", color: { argb: "FFD1D5DB" } },
          bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        };
      });

      // Right-align numbers
      if (typeof dataRow.getCell(2).value === "number") {
        dataRow.getCell(2).alignment = {
          horizontal: "right",
          vertical: "center",
        };
      }
    });

    ws1.columns = [{ width: 25 }, { width: 30 }];
    ws1.pageSetup = { paperSize: 9, orientation: "portrait" };
    ws1.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };

    // ==================== SHEET 2: VERIFICATIONS ====================
    const ws2 = wb.addWorksheet("Verifications and Payments");

    if (verRows.length > 0) {
      // Add header row
      const verHeaders = Object.keys(verRows[0]);
      const verHeaderRow = ws2.addRow(verHeaders);
      verHeaderRow.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
        size: 12,
        name: "Calibri",
      };
      verHeaderRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF059669" },
      }; // Green
      verHeaderRow.alignment = {
        horizontal: "center",
        vertical: "center",
        wrapText: true,
      };
      verHeaderRow.height = 25;
      verHeaderRow.eachCell((cell) => {
        cell.border = {
          left: { style: "thin" },
          right: { style: "thin" },
          top: { style: "thin" },
          bottom: { style: "thin" },
        };
      });

      // Add data rows
      verRows.forEach((row, idx) => {
        const verDataRow = ws2.addRow(Object.values(row));
        const isAlt = idx % 2 === 0;

        verDataRow.font = {
          color: { argb: "FF4B5563" },
          size: 11,
          name: "Calibri",
        };
        verDataRow.fill = isAlt
          ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDFA" } } // Light green
          : {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFFFFFF" },
            };
        verDataRow.alignment = { horizontal: "left", vertical: "center" };
        verDataRow.height = 20;

        verDataRow.eachCell((cell, colNum) => {
          cell.border = {
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
          };

          // Right-align numeric columns
          if (
            verHeaders[colNum - 1].includes("Amount") ||
            verHeaders[colNum - 1].includes("Rate")
          ) {
            cell.alignment = { horizontal: "right", vertical: "center" };
            cell.numFmt = verHeaders[colNum - 1].includes("Amount")
              ? "₱#,##0.00"
              : "0.00";
          } else if (verHeaders[colNum - 1].includes("Date")) {
            cell.alignment = { horizontal: "center", vertical: "center" };
          }
        });
      });

      // Set column widths
      ws2.columns = verHeaders.map((h) => ({
        width: h.includes("Date") ? 28 : h.includes("Amount") ? 18 : 20,
      }));
    }

    ws2.pageSetup = { paperSize: 9, orientation: "landscape" };
    ws2.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };

    // Generate file and download
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, "0");
    const d = String(new Date().getDate()).padStart(2, "0");
    const safeName = worker.name.replace(/[^\w\u0600-\u06FF]+/g, "-");
    const filename = `worker-report-${safeName}-${y}-${m}-${d}.xlsx`;

    wb.xlsx
      .writeBuffer()
      .then((buffer: any) => {
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(() => {
        toast.error(tr("تعذر تحميل التقرير", "Failed to download report"));
      });
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
                {complete
                  ? tr("مكتمل", "Complete")
                  : tr("غير مكتمل", "Incomplete")}
              </div>
              {isRefreshing && (
                <span className="text-xs text-slate-500 animate-spin">⟳</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                title={tr("إعادة تحميل البيانات", "Refresh data")}
                className="h-6 w-6 p-0"
              >
                ⟳
              </Button>
            </div>
            <p className="text-slate-600 text-sm mb-4">
              {tr("تاريخ الوصول:", "Arrival date:")}{" "}
              <span className="font-medium text-slate-900">
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
                <span className="hidden sm:inline">
                  {tr("نظام الإقامة:", "Accommodation System:")}
                </span>
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
        {worker.mainSystemStatus && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                {tr("الحالة في النظام الرئيسي", "Main System Status")}
              </h2>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <Label className="text-slate-700 font-semibold">
                  {tr("الحالة", "Status")}
                </Label>
                <div className="px-4 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-sm font-semibold text-blue-900">
                    {worker.mainSystemStatus === "deployed" &&
                      tr("مرسلة", "Deployed")}
                    {worker.mainSystemStatus === "on_hold" &&
                      tr("قيد الانتظار", "On Hold")}
                    {worker.mainSystemStatus === "visa_rejected" &&
                      tr("تأشيرة مرفوضة", "Visa Rejected")}
                    {worker.mainSystemStatus === "return_to_origin" &&
                      tr("العودة للأصل", "Return to Origin")}
                    {worker.mainSystemStatus === "unfit" &&
                      tr("غير مناسبة", "Unfit")}
                    {worker.mainSystemStatus === "backout" &&
                      tr("الانسحاب", "Backout")}
                    {worker.mainSystemStatus === "selected" &&
                      tr("مختارة", "Selected")}
                    {worker.mainSystemStatus === "repat" &&
                      tr("إعادة", "Repat")}
                    {worker.mainSystemStatus === "rtw" &&
                      tr("العودة للعمل", "RTW")}
                    {worker.mainSystemStatus === "passporting" &&
                      tr("جواز السفر", "Passporting")}
                    {worker.mainSystemStatus === "for_deployment" &&
                      tr("للإرسال", "For Deployment")}
                    {worker.mainSystemStatus === "oce_released" &&
                      tr("تم الإفراج", "OCE Released")}
                    {worker.mainSystemStatus === "visa_stamp" &&
                      tr("ختم التأشيرة", "Visa Stamp")}
                    {worker.mainSystemStatus === "cancelled" &&
                      tr("ملغاة", "Cancelled")}
                    {worker.mainSystemStatus === "for_contract_sig" &&
                      tr("لتوقيع العقد", "For Contract Sig")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

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
                        onChange={(e) =>
                          setPassFile(e.target.files?.[0] || null)
                        }
                        disabled={savingDocs}
                        className="border-slate-200 cursor-pointer"
                      />
                      {passFile && (
                        <p className="text-xs text-slate-600">
                          {tr("الملف:", "File:")}{" "}
                          <span className="font-medium">{passFile.name}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {worker.docs?.passport &&
                    typeof worker.docs.passport === "string" && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-emerald-700 font-semibold flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4" />
                            {tr("تم الت��مي��", "Uploaded")}
                          </p>
                          <button
                            onClick={async () => {
                              if (
                                window.confirm(
                                  tr(
                                    "هل تريد حذف هذه الصورة؟",
                                    "Delete this image?",
                                  ),
                                )
                              ) {
                                try {
                                  setSavingDocs(true);
                                  const r = await fetch("/api/workers/docs", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      "x-worker-id": worker.id,
                                    },
                                    body: JSON.stringify({
                                      workerId: worker.id,
                                      name: worker.name,
                                      branchId: worker.branchId,
                                      arrivalDate: worker.arrivalDate,
                                      deletePassport: true,
                                    }),
                                  });
                                  const j = await r
                                    .json()
                                    .catch(() => ({}) as any);
                                  if (r.ok && j?.ok) {
                                    updateWorkerDocs(worker.id, {
                                      passport: null as any,
                                    });
                                    toast.success(
                                      tr("تم حذف الصورة", "Image deleted"),
                                    );
                                  } else {
                                    toast.error(
                                      tr(
                                        "تعذر حذف الصورة",
                                        "Failed to delete image",
                                      ),
                                    );
                                  }
                                } catch (err) {
                                  toast.error(
                                    tr(
                                      "تعذر حذف الصورة",
                                      "Failed to delete image",
                                    ),
                                  );
                                } finally {
                                  setSavingDocs(false);
                                }
                              }
                            }}
                            disabled={savingDocs}
                            className="text-xs px-2 py-1 rounded bg-red-600/10 text-red-700 hover:bg-red-600/20 transition-colors disabled:opacity-50"
                          >
                            {tr("حذف", "Delete")}
                          </button>
                        </div>
                        <button
                          onClick={() =>
                            setImagePreview({
                              title: tr("جواز السفر (Passport)", "Passport"),
                              src: worker.docs.passport,
                            })
                          }
                          className="relative group inline-block rounded-lg overflow-hidden border-2 border-slate-200 hover:border-purple-400 transition-all cursor-pointer"
                        >
                          <img
                            src={worker.docs.passport}
                            alt="Passport"
                            className="w-20 h-24 object-cover group-hover:opacity-75 transition-opacity"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ZoomIn className="w-5 h-5 text-white" />
                          </div>
                        </button>
                      </div>
                    )}
                </div>

                {/* Save Documents Button */}
                <Button
                  onClick={saveDocs}
                  disabled={savingDocs || !passFile}
                  className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
                >
                  {savingDocs && (
                    <span className="inline-block animate-spin">⟳</span>
                  )}
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
                    <Label
                      htmlFor="exit-date"
                      className="text-slate-700 font-semibold"
                    >
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
                    <Label
                      htmlFor="exit-reason"
                      className="text-slate-700 font-semibold"
                    >
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
                        {tr("����خص الرسوم:", "Fee Summary:")}
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
                          <span>₱{preview.total.toLocaleString("en-US")}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <Button
                    onClick={() => {
                      if (parsedExitTs && exitReason.trim()) {
                        setWorkerExit(
                          worker.id,
                          parsedExitTs,
                          exitReason.trim(),
                        );
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
                    ₱ {total.toLocaleString("en-US")}
                  </p>
                </div>

                {/* Verifications and Payments */}
                {(worker.verifications || []).length > 0 && (
                  <div>
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900 mb-1">
                        {tr(
                          "عمليات التحقق الناجحة",
                          "Successful Verifications",
                        )}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {tr(
                          "قائمة بعمليات التحقق من الهوية المكتملة والمبالغ المدفوعة",
                          "List of completed identity verifications with payment amounts",
                        )}
                      </p>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(worker.verifications || []).slice(0, 5).map((v) => (
                        <div
                          key={v.id}
                          className="flex items-center justify-between rounded-lg bg-slate-50 p-3 border border-slate-200"
                        >
                          <div className="flex-1">
                            <p className="text-xs text-slate-600">
                              {new Date(v.verifiedAt).toLocaleDateString(
                                "en-US",
                              )}
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
                      {(worker.verifications || []).length > 5 && (
                        <p className="text-xs text-center text-slate-500 pt-2">
                          {tr("و", "and")}{" "}
                          {(worker.verifications || []).length - 5}{" "}
                          {tr("أخرى", "more")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Days Without Expenses */}
                {daysWithoutExpenses && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-blue-900 mb-1">
                        {tr("أيام بدون مصروف", "Days Without Expenses")}
                      </h3>
                      <p className="text-xs text-blue-600">
                        {tr(
                          `عدد الأيام قبل إرفاق المستندات - يتم احتسابها بسعر ${daysWithoutExpenses?.rate || 220} بيسو يومياً`,
                          `Days before document submission - calculated at ${daysWithoutExpenses?.rate || 220} pesos per day`,
                        )}
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-blue-700">
                          {tr("تاريخ الوصول:", "Arrival Date:")}
                        </span>
                        <span className="font-semibold text-blue-900">
                          {new Date(worker.arrivalDate).toLocaleDateString(
                            "en-US",
                            {
                              month: "2-digit",
                              day: "2-digit",
                              year: "numeric",
                            },
                          )}
                        </span>
                      </div>
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
                      <div className="border-t border-blue-200 pt-3 flex justify-between">
                        <span className="font-semibold text-blue-900">
                          {tr("الإجمالي:", "Total:")}
                        </span>
                        <span className="text-lg font-bold text-blue-900">
                          ₱ {daysWithoutExpenses.total.toLocaleString("en-US")}
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
                          ₱ {preCost.cost.toLocaleString("en-US")}
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
                {tr("تحديث ا��متقدم", "Update Applicant")}
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

      {/* Image Preview Dialog */}
      <Dialog
        open={!!imagePreview}
        onOpenChange={(open) => !open && setImagePreview(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{imagePreview?.title}</DialogTitle>
          </DialogHeader>
          {imagePreview && (
            <div className="flex flex-col items-center justify-center p-4">
              <img
                src={imagePreview.src}
                alt={imagePreview.title}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
