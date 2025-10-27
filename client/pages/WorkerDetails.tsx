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

    const infoRows = [
      { الحقل: "الاسم", القيمة: worker.name },
      { الحقل: "الفرع", القيمة: branchName },
      {
        الحقل: "تاريخ الوصول",
        القيمة: new Date(worker.arrivalDate).toLocaleDateString(
          locale === "ar" ? "ar-EG" : "en-US",
        ),
      },
      exitTs
        ? {
            الحقل: "تاريخ الخروج",
            القيمة: new Date(exitTs).toLocaleDateString(
              locale === "ar" ? "ar-EG" : "en-US",
            ),
          }
        : { الحقل: "تاريخ الخروج", القيمة: "" },
      { الحقل: "سبب الخروج", القيمة: worker.exitReason || exitReason || "" },
      { الحقل: "الأيام", القيمة: days ?? "" },
      { الحقل: "المعدل اليومي (₱)", القيمة: rate },
      { الحقل: "الإجمالي (₱)", القيمة: total ?? "" },
    ];

    const verRows = worker.verifications.map((v) => ({
      "تاريخ التحقق": new Date(v.verifiedAt).toLocaleString(
        locale === "ar" ? "ar-EG" : "en-US",
      ),
      "المبلغ (₱)": v.payment?.amount ?? "",
      "تاريخ الحفظ": v.payment
        ? new Date(v.payment.savedAt).toLocaleString(
            locale === "ar" ? "ar-EG" : "en-US",
          )
        : "",
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(infoRows);
    const ws2 = XLSX.utils.json_to_sheet(verRows);
    XLSX.utils.book_append_sheet(wb, ws1, "بيانات العاملة");
    XLSX.utils.book_append_sheet(wb, ws2, "التحققات وال��دفوعات");
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
            {tr("بي��نات العاملة:", "Applicant details:")} {worker.name}
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
        </div>
        <div className="hidden sm:block">
          <BackButton />
        </div>
        {typeof window !== "undefined" &&
        localStorage.getItem("adminAuth") === "1" && isAdminPage ? (
          <button
            className="ms-3 inline-flex items-center rounded-md bg-rose-600 px-3 py-2 text-sm text-white hover:bg-rose-700"
            onClick={async () => {
              if (
                !confirm(
                  tr(
                    "تأكيد حذف العاملة وكل سجلاتها؟",
                    "Confirm deleting the applicant and all her records?",
                  ),
                )
              )
                return;
              try {
                const r = await fetch(`/api/workers/${worker.id}`, {
                  method: "DELETE",
                });
                if (!r.ok) throw new Error("delete_failed");
                window.location.href = "/workers";
              } catch {
                try {
                  const { toast } = await import("sonner");
                  toast.error(tr("تعذر الحذف", "Delete failed"));
                } catch {}
              }
            }}
          >
            {tr("حذف العاملة", "Delete applicant")}
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">
          {tr("الحالة وتاريخ الخروج", "Status and exit date")}
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-700">{tr("الحالة في النظام الرئيسي:", "Main System Status:")}</span>
            <span className="px-3 py-1 text-xs rounded-md border border-blue-300 bg-blue-50 text-gray-800 font-semibold">
              {worker.mainSystemStatus || tr("لم يتم التحديد", "Not set")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              {tr("الحالة في نظام الاقامة:", "Status in residence system:")}{" "}
              {locked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-600/10 px-3 py-1 text-rose-700 text-sm font-semibold">
                  <Lock className="h-3 w-3" /> {tr("مقفولة", "Locked")}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-600/10 px-3 py-1 text-emerald-700 text-sm font-semibold">
                  {tr("نشطة", "Active")}
                </span>
              )}
            </div>
            {locked ? (
              worker.status === "unlock_requested" ? (
                <span className="text-xs text-muted-foreground">
                  {tr(
                    "تم إرسال طلب فتح الملف — بانتظار الإدارة",
                    "Unlock request sent — awaiting admin",
                  )}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestUnlock(worker.id)}
                >
                  {tr(
                    "اطلب من الإدارة فتح ملف العاملة",
                    "Request admin to unlock profile",
                  )}
                </Button>
              )
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {tr("تاريخ الخروج:", "Exit date:")}
            </span>
            <Input
              value={exitText}
              onChange={(e) => setExitText(e.target.value)}
              dir="ltr"
              placeholder={tr(
                "yyyy-mm-dd أو dd/mm/yyyy",
                "yyyy-mm-dd or dd/mm/yyyy",
              )}
              className="w-60"
            />
            {worker.exitDate ? (
              <span className="text-xs text-muted-foreground">
                {tr("الحالي:", "Current:")}{" "}
                {new Date(worker.exitDate).toLocaleDateString(
                  locale === "ar" ? "ar-EG" : "en-US",
                )}
              </span>
            ) : null}
          </div>

          {preview ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3">
              <div className="text-sm">
                {tr("الإجمالي حتى الخروج:", "Total until exit:")}{" "}
                <span className="font-semibold text-emerald-700">
                  {formatCurrency(preview.total, locale)}
                </span>
                {" — "}
                {tr("أيام:", "Days:")} {preview.days}
                {" — "}
                {tr("المعدل اليومي:", "Daily rate:")}{" "}
                {formatCurrency(preview.rate, locale)}
              </div>
              <div className="ms-auto flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setWorkerExit(
                      worker.id,
                      parsedExitTs as number,
                      exitReason.trim(),
                    );
                    toast.success(tr("تم الحفظ", "Saved"));
                  }}
                >
                  {tr("حفظ", "Save")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-2"
                  onClick={() => handleDownloadReport()}
                >
                  <Download className="h-4 w-4" />{" "}
                  {tr("تحميل تقرير", "Download report")}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {tr(
                "أدخل تاريخ الخروج وسبب الخروج لعرض الإجمالي وزر الحفظ والتقرير.",
                "Enter exit date and reason to show total and actions.",
              )}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="exit-reason">
              {tr(
                "أسباب الخروج (إلزامي عند حفظ التاريخ)",
                "Exit reasons (required when saving date)",
              )}
            </Label>
            <Textarea
              id="exit-reason"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              placeholder={tr("اكتب أسباب الخروج", "Write exit reasons")}
              rows={3}
            />
            {worker.exitReason ? (
              <p className="text-xs text-muted-foreground">
                {tr("المسجل حالياً:", "Recorded:")} {worker.exitReason}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">
          {tr("الحالات", "Statuses")}
        </div>
        <div className="p-4 space-y-4">
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">
          {tr("الوثائق", "Documents")}
        </div>
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
                {tr("لا يوجد", "None")}
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
                  {tr("تم قفل وثيقة OR", "OR document is locked")}
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
                {tr("لا يوجد", "None")}
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
                  {tr("تم قفل وثيقة الجواز", "Passport document is locked")}
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
              savingDocs ||
              (!orFile && !passFile) ||
              (orLocked && passLocked) ||
              policyLocked
            }
          >
            {tr("حفظ الوثائق", "Save documents")}
          </Button>
          {policyLocked ? (
            <span className="text-xs text-rose-700">
              {tr(
                "الحساب مقفول بسبب تجاوز 14 يومًا بدون وثائق — اطلب فتح من الإدارة",
                "Locked after 14 days without documents ��� request admin unlock",
              )}
            </span>
          ) : null}
          {(orLocked || passLocked) && (
            <span className="text-xs text-muted-foreground">
              {tr(
                "الوثائق الموجودة مثبتة ولا يمكن استبدالها",
                "Existing documents are fixed and cannot be replaced",
              )}
            </span>
          )}
          {preCost || worker.docs?.pre_change ? (
            <div className="ms-auto rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {(() => {
                const pc = preCost ||
                  (worker.docs?.pre_change as any) || {
                    days: 0,
                    rate: 220,
                    cost: 0,
                  };
                return (
                  <span>
                    {tr(
                      "مجموع نفقات الإقامة قبل التغيير:",
                      "Total residency cost before change:",
                    )}{" "}
                    {formatCurrency(pc.cost, locale)} — {tr("أيام:", "Days:")}{" "}
                    {pc.days} — {tr("المعدل اليومي:", "Daily rate:")}{" "}
                    {formatCurrency(pc.rate, locale)}
                  </span>
                );
              })()}
            </div>
          ) : null}
          {worker.docs?.or || worker.docs?.passport ? (
            worker.plan === "no_expense" ? (
              <Button variant="secondary" size="sm" onClick={upgradePlan}>
                {tr("تحديث العاملة", "Update applicant")}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                {tr("تم التحديث", "Updated")}
              </Button>
            )
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">
          {tr("سجل عمليات التحقق والمبالغ", "Verification and payments log")}
        </div>
        {complete ? (
          <div className="mx-4 mt-3 rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-800 text-sm">
            {tr(
              "تنبيه: سيتم إضافة 220 بيسو يوميًا عند اكتمال الملف. يتم احتساب الإجمالي عند الخروج.",
              "Note: ₱220 per day will be added when the profile is complete. Total is calculated at exit.",
            )}
          </div>
        ) : null}
        <ul className="divide-y">
          {worker.verifications.length === 0 && (
            <li className="p-6 text-center text-muted-foreground">
              {tr("لا توجد عمليات تحقق بعد", "No verifications yet")}
            </li>
          )}
          {worker.verifications.map((v) => (
            <li key={v.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {tr("تاريخ التحقق:", "Verified at:")}{" "}
                      {new Date(v.verifiedAt).toLocaleString(
                        locale === "ar" ? "ar-EG" : "en-US",
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {v.payment ? (
                        <span>
                          {tr("تم التحقق", "Verified")} — ₱ {v.payment.amount} —{" "}
                          {tr("محفوظ بتاريخ", "saved at")}{" "}
                          {new Date(v.payment.savedAt).toLocaleString(
                            locale === "ar" ? "ar-EG" : "en-US",
                          )}
                        </span>
                      ) : (
                        <span>
                          {tr("لا يوجد مبلغ محفوظ", "No payment saved")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t p-4 text-right font-semibold">
          {tr("الإجمالي:", "Total:")} ₱ {total}
        </div>
      </div>
    </main>
  );
}
