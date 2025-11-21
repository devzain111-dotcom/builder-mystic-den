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
      toast.success(tr("تم تحدي�� حالة الخطة", "Plan status updated"));
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
    const rateLabel = locale === "ar" ? "المعدل اليومي (��)" : "Daily Rate (₱)";
    const totalLabel = locale === "ar" ? "الإجمالي (₱)" : "Total (₱)";

    const infoRows = [
      { [fieldLabel]: nameLabel, [valueLabel]: worker.name },
      { [fieldLabel]: branchLabel, [valueLabel]: branchName },
      {
        [fieldLabel]: arrivalLabel,
        [valueLabel]: new Date(worker.arrivalDate).toLocaleDateString(
          locale === "ar" ? "ar-EG" : "en-US",
        ),
      },
      exitTs
        ? {
            [fieldLabel]: exitLabel,
            [valueLabel]: new Date(exitTs).toLocaleDateString(
              locale === "ar" ? "ar-EG" : "en-US",
            ),
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

    const verDateLabel = locale === "ar" ? "تاريخ التحقق" : "Verification Date";
    const amountLabel = locale === "ar" ? "المبلغ (₱)" : "Amount (₱)";
    const saveLabel = locale === "ar" ? "تاريخ الحفظ" : "Save Date";

    const verRows = worker.verifications.map((v) => ({
      [verDateLabel]: new Date(v.verifiedAt).toLocaleString(
        locale === "ar" ? "ar-EG" : "en-US",
      ),
      [amountLabel]: v.payment?.amount ?? "",
      [saveLabel]: v.payment
        ? new Date(v.payment.savedAt).toLocaleString(
            locale === "ar" ? "ar-EG" : "en-US",
          )
        : "",
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(infoRows);
    const ws2 = XLSX.utils.json_to_sheet(verRows);
    const sheet1Name = locale === "ar" ? "بيانات العاملة" : "Applicant Data";
    const sheet2Name =
      locale === "ar" ? "التحققات والدفوعات" : "Verifications and Payments";
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
                  {tr("اطلب الفتح", "Request Unlock")}
                </Button>
              )}
            {worker.status === "unlock_requested" && (
              <span className="ms-2 text-sm text-amber-700">
                {tr("بانتظار ال��وافقة...", "Pending approval...")}
              </span>
            )}
          </p>
          {worker.mainSystemStatus && (
            <p className="mt-1 text-sm">
              {tr("الحالة في النظام الرئيسي:", "Status in Main System:")}{" "}
              <span className="font-semibold capitalize">
                {worker.mainSystemStatus}
              </span>
            </p>
          )}
          {worker.exitDate && (
            <p className="mt-1 text-sm">
              {tr("تاريخ الخروج:", "Exit Date:")}{" "}
              <span className="font-semibold">
                {new Date(worker.exitDate).toLocaleDateString(
                  locale === "ar" ? "ar-EG" : "en-US",
                )}
              </span>
            </p>
          )}
          {worker.exitReason && (
            <p className="mt-1 text-sm">
              {tr("سبب الخروج:", "Exit Reason:")}{" "}
              <span className="font-semibold">{worker.exitReason}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadReport}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {tr("تحميل", "Download")}
          </Button>
          <BackButton />
        </div>
      </div>

      {locked ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-rose-600" />
            <span className="font-semibold text-rose-700">
              {tr(
                "ملف العاملة مقفول. اطلب من الإدارة فتح الملف.",
                "Applicant file is locked. Contact admin to unlock.",
              )}
            </span>
          </div>
          {worker.status !== "unlock_requested" && (
            <Button
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
              className="w-full bg-rose-600 hover:bg-rose-700"
            >
              {tr("اطلب من الإدا��ة فتح الملف", "Request Admin to Unlock File")}
            </Button>
          )}
          {worker.status === "unlock_requested" && (
            <div className="rounded-md bg-amber-100 p-2 text-center text-sm text-amber-800">
              {tr(
                "تم إرسال الطلب. بانتظار موافقة الإدارة...",
                "Request sent. Waiting for admin approval...",
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className="space-y-6">
        {!worker.exitDate ? (
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">
              {tr("تسجيل الخروج", "Record Exit")}
            </h2>
            <div className="space-y-2">
              <Label>{tr("تاريخ الخروج", "Exit Date")}</Label>
              <Input
                type="text"
                placeholder="dd/mm/yyyy"
                value={exitText}
                onChange={(e) => setExitText(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr("سبب الخروج", "Exit Reason")}</Label>
              <Textarea
                placeholder={tr("أدخل سبب الخروج", "Enter the reason for exit")}
                value={exitReason}
                onChange={(e) => setExitReason(e.target.value)}
              />
            </div>
            {preview ? (
              <div className="rounded-md border bg-blue-50 p-3 text-sm">
                <p>
                  {tr("معاينة الحساب:", "Preview:")} {preview.days}{" "}
                  {tr("يوم", "days")} × ₱{preview.rate} ={" "}
                  <span className="font-semibold">
                    ₱ {formatCurrency(preview.total, locale)}
                  </span>
                </p>
              </div>
            ) : null}
            <Button
              onClick={async () => {
                if (!parsedExitTs || !exitReason.trim()) {
                  toast.error(
                    tr(
                      "الرجاء إدخال التاريخ والسب��",
                      "Please enter date and reason",
                    ),
                  );
                  return;
                }
                const r = await fetch("/api/workers/exit", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-worker-id": worker.id,
                  },
                  body: JSON.stringify({
                    workerId: worker.id,
                    exitDate: parsedExitTs,
                    exitReason,
                  }),
                });
                const j = await r.json().catch(() => ({}) as any);
                if (!r.ok || !j?.ok) {
                  toast.error(j?.message || tr("تعذر الحفظ", "Failed to save"));
                  return;
                }
                setWorkerExit(worker.id, parsedExitTs, exitReason);
                setExitText("");
                setExitReason("");
                // Request unlock immediately since file is now locked
                const req = requestUnlock(worker.id);
                toast.success(
                  tr(
                    "تم تسجيل الخروج. تم قفل الملف حتى موافقة الإدارة.",
                    "Exit recorded. File is now locked until admin approval.",
                  ),
                );
              }}
              disabled={!parsedExitTs || !exitReason.trim()}
              className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tr("تسجيل الخروج", "Record Exit")}
            </Button>
          </section>
        ) : null}

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {tr("الوثائق المطلوبة", "Required Documents")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{tr("صورة OR", "OR Photo")}</Label>
              {worker.docs?.or ? (
                <img
                  src={worker.docs.or}
                  alt="OR"
                  className="max-h-40 rounded-md border"
                />
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  {tr("لم يتم التحميل", "Not uploaded")}
                </div>
              )}
              {!orLocked && (
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setOrFile(e.target.files?.[0] || null)}
                    className="text-sm"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{tr("صورة الجواز", "Passport Photo")}</Label>
              {worker.docs?.passport ? (
                <img
                  src={worker.docs.passport}
                  alt="Passport"
                  className="max-h-40 rounded-md border"
                />
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  {tr("لم يتم التحميل", "Not uploaded")}
                </div>
              )}
              {!passLocked && (
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPassFile(e.target.files?.[0] || null)}
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          </div>
          {(orFile || passFile) && !savingDocs && (
            <Button onClick={saveDocs} className="w-full">
              {tr("حفظ الوثائق", "Save Documents")}
            </Button>
          )}
          {savingDocs && (
            <div className="text-sm text-muted-foreground">
              {tr("جاري الحفظ...", "Saving...")}
            </div>
          )}
        </section>

        {preCost ? (
          <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="font-semibold text-emerald-900">
              {tr("ملخص رسوم الخروج", "Exit Fee Summary")}
            </h2>
            <div className="text-sm space-y-1">
              <div>
                {tr("الأيام:", "Days:")}{" "}
                <span className="font-semibold">{preCost.days}</span>
              </div>
              <div>
                {tr("المعدل اليومي:", "Daily rate:")}{" "}
                <span className="font-semibold">₱ {preCost.rate}</span>
              </div>
              <div className="border-t border-emerald-200 pt-1 font-semibold text-base">
                {tr("الإجمالي:", "Total:")}{" "}
                <span>₱ {formatCurrency(preCost.cost, locale)}</span>
              </div>
            </div>
            <Button onClick={upgradePlan} className="w-full">
              {tr("تحديث المتقدم", "Update Applicant")}
            </Button>
          </section>
        ) : null}

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {tr("سجل التحققات", "Verification History")}
          </h2>
          {worker.verifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tr("لا توجد تحققات بعد", "No verifications yet")}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {worker.verifications.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between rounded-md border bg-muted/50 p-2"
                >
                  <span>
                    {new Date(v.verifiedAt).toLocaleString(
                      locale === "ar" ? "ar-EG" : "en-US",
                    )}
                  </span>
                  {v.payment ? (
                    <span className="font-semibold text-emerald-700">
                      ₱ {formatCurrency(v.payment.amount, locale)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {tr("بدون دفع", "No payment")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {tr("الإجمالي ال��دفوع", "Total Paid")}
          </h2>
          <div className="text-3xl font-bold text-emerald-700">
            ₱ {formatCurrency(total, locale)}
          </div>
        </section>
      </div>
    </main>
  );
}
