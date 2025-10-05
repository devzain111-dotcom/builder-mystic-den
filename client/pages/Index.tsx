import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Upload, UsersRound, Download, Lock } from "lucide-react";
import DeviceFeed from "@/components/DeviceFeed";
import FaceVerifyCard from "@/components/FaceVerifyCard";
import AddWorkerDialog, {
  AddWorkerPayload,
} from "@/components/AddWorkerDialog";
import * as XLSX from "xlsx";
import { useWorkers } from "@/context/WorkersContext";
import { toast } from "sonner";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;
import { Link, useNavigate } from "react-router-dom";
import SpecialRequestDialog from "@/components/SpecialRequestDialog";
import { useI18n } from "@/context/I18nContext";
import AlertsBox from "@/components/AlertsBox";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Index() {
  const {
    branches,
    workers,
    sessionPendingIds,
    sessionVerifications,
    selectedBranchId,
    setSelectedBranchId,
    addWorker,
    addWorkersBulk,
    addVerification,
    savePayment,
    requestUnlock,
    upsertExternalWorker,
  } = useWorkers();
  const navigate = useNavigate();
  const { tr, locale } = useI18n();
  const pendingAll = sessionPendingIds.map((id) => workers[id]).filter(Boolean);
  const pending = pendingAll.filter(
    (w) => !selectedBranchId || w.branchId === selectedBranchId,
  );
  const verified = sessionVerifications.filter(
    (v) =>
      !selectedBranchId || workers[v.workerId]?.branchId === selectedBranchId,
  );

  const [identifying, setIdentifying] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<{
    id?: string;
    workerId: string;
    workerName: string;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");

  async function handleVerifiedByFace(out: {
    workerId: string;
    workerName?: string;
  }) {
    const workerId = out.workerId;
    let workerName = out.workerName || (workers[workerId]?.name ?? "");
    if (!workers[workerId] && SUPABASE_URL && SUPABASE_ANON) {
      try {
        const u = new URL(
          `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/hv_workers`,
        );
        u.searchParams.set(
          "select",
          "id,name,arrival_date,branch_id,docs,exit_date,exit_reason,status",
        );
        u.searchParams.set("id", `eq.${workerId}`);
        const r = await fetch(u.toString(), {
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${SUPABASE_ANON}`,
          },
        });
        const arr = await r.json();
        const w = Array.isArray(arr) ? arr[0] : null;
        if (w?.id) {
          const arrivalDate = w.arrival_date
            ? new Date(w.arrival_date).getTime()
            : Date.now();
          const exitDate = w.exit_date ? new Date(w.exit_date).getTime() : null;
          upsertExternalWorker({
            id: w.id,
            name: w.name || "",
            arrivalDate,
            branchId: w.branch_id || Object.keys(branches)[0],
            docs: w.docs || {},
            exitDate,
            exitReason: w.exit_reason || null,
            status: w.status || "active",
          });
          workerName = w.name || workerName;
        }
      } catch {}
    }
    setPaymentFor({ workerId, workerName });
    setPaymentAmount("");
    setPaymentOpen(true);
  }

  function handleAddWorker(payload: AddWorkerPayload) {
    const w = addWorker(
      payload.name,
      payload.arrivalDate,
      payload.branchId,
      {
        or: payload.orDataUrl,
        passport: payload.passportDataUrl,
        avatar: payload.avatarDataUrl,
      },
      payload.plan,
    );
    toast.success("تم الحفظ");
    if (payload.plan === "no_expense") navigate("/no-expense");
    else navigate("/workers");
  }

  function handleDownloadDaily() {
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    ).getTime();
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    ).getTime();
    const rows = verified
      .filter((v) => v.verifiedAt >= start && v.verifiedAt <= end)
      .map((v) => {
        const w = workers[v.workerId];
        const branchName = w ? branches[w.branchId]?.name || "" : "";
        return {
          الاسم: w?.name || "",
          التاريخ: new Date(v.verifiedAt).toLocaleString("ar-EG"),
          الفرع: branchName,
          "المبلغ (₱)": v.payment?.amount ?? "",
        };
      });
    if (rows.length === 0) {
      toast.info("لا توجد بيانات تحقق اليوم");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["الاسم", "التاريخ", "الفرع", "المبلغ (₱)"],
    });
    ws["!cols"] = [12, 22, 12, 12].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير اليوم");
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, `daily-report-${y}-${m}-${d}.xlsx`);
  }

  async function handleExcel(file: File) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    const parsed = rows
      .map((r) => {
        const name =
          r.name ||
          r["الاسم"] ||
          r["اسم"] ||
          r["اسم العاملة"] ||
          r["worker"] ||
          "";
        let arrival =
          r.arrival ||
          r["تاريخ الوصول"] ||
          r["الوصول"] ||
          r["date"] ||
          r["arrivalDate"] ||
          "";
        let ts: number | null = null;
        if (typeof arrival === "number") {
          const d = XLSX.SSF.parse_date_code(arrival);
          if (d) {
            const date = new Date(
              Date.UTC(d.y, (d.m || 1) - 1, d.d || 1) + 12 * 60 * 60 * 1000,
            );
            ts = date.getTime();
          }
        } else if (typeof arrival === "string" && arrival.trim()) {
          const parsedDate = new Date(arrival);
          if (!isNaN(parsedDate.getTime())) {
            const midLocal = new Date(
              parsedDate.getFullYear(),
              parsedDate.getMonth(),
              parsedDate.getDate(),
              12,
              0,
              0,
              0,
            );
            ts = midLocal.getTime();
          }
        }
        if (!name) return null;
        const branch =
          r.branch ||
          r["الفرع"] ||
          r["branchName"] ||
          (selectedBranchId
            ? Object.values(branches).find((b) => b.id === selectedBranchId)
                ?.name
            : "");
        return {
          name: String(name).trim(),
          arrivalDate: ts ?? Date.now(),
          branchName: branch || undefined,
        } as { name: string; arrivalDate: number; branchName?: string };
      })
      .filter(Boolean) as {
      name: string;
      arrivalDate: number;
      branchName?: string;
    }[];
    if (parsed.length) addWorkersBulk(parsed);
  }

  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  async function handleSaveAmount(verificationId: string) {
    const raw = amountDraft[verificationId];
    const amount = Number(raw);
    if (!isFinite(amount) || amount <= 0) return;
    const owner = Object.values(workers).find((w) =>
      w.verifications.some((v) => v.id === verificationId),
    );
    const locked = owner
      ? !!owner.exitDate && owner.status !== "active"
      : false;
    if (locked) {
      toast.error("ملف العاملة مقفول بسبب الخروج. اطلب من الإدارة فتح الملف.");
      return;
    }
    // Persist to backend (link to latest verification in DB)
    if (owner) {
      try {
        const r = await fetch("/api/verification/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workerId: owner.id, amount }),
        });
        const j = await r.json().catch(() => ({}) as any);
        if (!r.ok || !j?.ok) {
          toast.error(j?.message || "تعذر حفظ الدفع في القاعدة");
        }
      } catch {}
    }
    savePayment(verificationId, amount);
    setAmountDraft((p) => ({ ...p, [verificationId]: "" }));
    toast.success("تم التحقق والدفع");
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-foreground">
            {tr("نظام تحقق المقيمين في السكن", "Residents Verification System")}
          </h1>
          <p className="text-muted-foreground">
            {tr(
              "التحقق يتم بالوجه مباشرةً. قِف أمام الكاميرا للتعرّف ثم أدخل المبلغ لإكمال العملية.",
              "Face verification: stand in front of the camera, then enter the amount to complete.",
            )}
          </p>
        </div>

        <div className="mb-4">
          {/* صندوق التنبيهات */}
          <AlertsBox />
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <AddWorkerDialog
            onAdd={handleAddWorker}
            defaultBranchId={selectedBranchId ?? undefined}
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {tr("الفرع:", "Branch:")}
            </span>
            <Select
              value={selectedBranchId ?? undefined}
              onValueChange={async (v) => {
                if (v === selectedBranchId) return;
                let pass = window.prompt("أدخل كلمة مرور الفرع للتبديل:") || "";
                try {
                  const r = await fetch("/api/branches/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: v, password: pass }),
                  });
                  const j = await r.json().catch(() => ({}) as any);
                  if (!r.ok || !j?.ok) {
                    toast.error(
                      j?.message === "wrong_password"
                        ? "كلمة المرور غير صحيحة"
                        : j?.message || "تعذر التحقق",
                    );
                    return;
                  }
                  setSelectedBranchId(v);
                } catch {
                  toast.error("تعذر التحقق");
                }
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(branches).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input
            id="excel-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleExcel(f);
              e.currentTarget.value = "";
            }}
          />
          <Button variant="outline" className="gap-2" asChild>
            <label
              htmlFor="excel-input"
              className="cursor-pointer flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              {tr("رفع ملف إكسل", "Upload Excel")}
            </label>
          </Button>
          <Button variant="secondary" className="gap-2" asChild>
            <Link to="/workers">
              <UsersRound className="h-4 w-4" />
              {tr("العاملات", "Workers")}
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <Link to="/no-expense">إقامة بدون مصروف</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/workers-status">
              {tr("التحقق من حالات العاملات", "Check workers status")}
            </Link>
          </Button>
          <Button variant="admin" asChild>
            <Link to="/admin-login">{tr("الإدارة", "Admin")}</Link>
          </Button>
          <SpecialRequestDialog />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <FaceVerifyCard onVerified={handleVerifiedByFace} />

          <div className="grid gap-6">
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="font-bold text-emerald-700">
                  {tr("تم التحقق", "Verified")}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadDaily}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />{" "}
                    {tr("تحميل التقرير اليومي", "Download daily report")}
                  </button>
                  <div className="text-sm text-muted-foreground">
                    {verified.length} {tr("موثَّق", "entries")}
                  </div>
                </div>
              </div>
              <ul className="max-h-[340px] overflow-auto divide-y">
                {verified.length === 0 && (
                  <li className="p-6 text-center text-muted-foreground">
                    لا يوجد عمليات تحقق بعد
                  </li>
                )}
                {verified.map((v) => (
                  <li key={v.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex items-center justify-center rounded-full bg-green-600/10 text-green-700 p-1">
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-green-700">
                            {workers[v.workerId]?.name}
                          </span>
                          <time className="text-xs text-muted-foreground">
                            {new Date(v.verifiedAt).toLocaleString(
                              locale === "ar" ? "ar-EG" : "en-US",
                            )}
                          </time>
                        </div>
                        <div className="mt-2 flex items-center gap-4">
                          {v.payment ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full bg-emerald-600/10 text-emerald-700 px-3 py-1 text-xs font-medium">
                                تم التحقق
                              </span>
                            </div>
                          ) : (
                            (() => {
                              const w = workers[v.workerId];
                              const locked = w
                                ? !!w.exitDate && w.status !== "active"
                                : false;
                              if (locked) {
                                const pending =
                                  w?.status === "unlock_requested";
                                return (
                                  <div className="flex items-center gap-3">
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-600/10 text-rose-700 px-3 py-1 text-xs font-semibold">
                                      <Lock className="h-3 w-3" />{" "}
                                      {tr("مقفولة", "Locked")}
                                    </span>
                                    {pending ? (
                                      <span className="text-xs text-muted-foreground">
                                        {tr(
                                          "قيد انتظار الإدارة",
                                          "Pending admin",
                                        )}
                                      </span>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          requestUnlock(w.id);
                                          toast.info(
                                            "تم إرسال طلب فتح الملف إلى الإدارة",
                                          );
                                        }}
                                      >
                                        {tr(
                                          "اطلب من الإدارة فتح ملف العاملة",
                                          "Ask admin to unlock worker",
                                        )}
                                      </Button>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    placeholder={tr(
                                      "المبلغ بالبيسو",
                                      "Amount in peso",
                                    )}
                                    value={amountDraft[v.id] ?? ""}
                                    onChange={(e) =>
                                      setAmountDraft((p) => ({
                                        ...p,
                                        [v.id]: e.target.value,
                                      }))
                                    }
                                    className="w-40"
                                  />
                                  <span className="text-sm text-muted-foreground">
                                    ₱ {tr("بيسو فلبيني", "Philippine Peso")}
                                  </span>
                                  <Button
                                    onClick={() => handleSaveAmount(v.id)}
                                  >
                                    {tr("حفظ", "Save")}
                                  </Button>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إدخال المبلغ</DialogTitle>
            </DialogHeader>
            {paymentFor ? (
              <div className="space-y-3">
                <div className="text-sm">
                  العاملة:{" "}
                  <span className="font-semibold">{paymentFor.workerName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="المبلغ بالبيسو"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-48"
                  />
                  <span className="text-sm text-muted-foreground">
                    ₱ بيسو فلبيني
                  </span>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPaymentOpen(false)}>
                إلغاء
              </Button>
              {paymentFor ? (
                <Button
                  onClick={async () => {
                    const amount = Number(paymentAmount);
                    if (!isFinite(amount) || amount <= 0) {
                      toast.error("أدخل مبلغًا صالحًا");
                      return;
                    }
                    try {
                      const r = await fetch("/api/verification/payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          workerId: paymentFor.workerId,
                          amount,
                        }),
                      });
                      const j = await r.json().catch(() => ({}) as any);
                      if (!r.ok || !j?.ok) {
                        toast.error(j?.message || "تعذر الحفظ");
                        return;
                      }
                      const maybe = addVerification(
                        paymentFor.workerId,
                        Date.now(),
                      );
                      if (maybe) {
                        savePayment(maybe.id, amount);
                      }
                      toast.success("تم التحقق والدفع");
                      setPaymentOpen(false);
                      setPaymentAmount("");
                    } catch (e: any) {
                      toast.error(e?.message || "تعذر الحفظ");
                    }
                  }}
                >
                  حفظ
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </main>
  );
}
