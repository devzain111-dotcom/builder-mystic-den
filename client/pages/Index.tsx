import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, UsersRound, Download, Lock } from "lucide-react";
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
import { formatCurrency, isNoExpensePolicyLocked } from "@/lib/utils";
import AlertsBox from "@/components/AlertsBox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Index() {
  const {
    branches,
    workers,
    specialRequests,
    sessionPendingIds,
    sessionVerifications,
    selectedBranchId,
    setSelectedBranchId,
    addWorker,
    addVerification,
    savePayment,
    requestUnlock,
    upsertExternalWorker,
  } = useWorkers();
  const navigate = useNavigate();
  const { tr, t, locale } = useI18n();
  const [notifOpen, setNotifOpen] = useState(false);
  const unregisteredCount = (() => {
    const perBranch = specialRequests.filter((r) => {
      if (r.type !== "worker") return false;
      const worker = r.workerId ? workers[r.workerId] : undefined;
      const b = worker?.branchId || r.branchId || null;
      return selectedBranchId ? b === selectedBranchId : true;
    });
    const list = perBranch.filter(
      (r) => !!r.unregistered || !r.workerId || !workers[r.workerId!],
    );
    return list.length;
  })();
  const pendingAll = sessionPendingIds.map((id) => workers[id]).filter(Boolean);
  const pending = pendingAll.filter(
    (w) => !selectedBranchId || w.branchId === selectedBranchId,
  );
  const verified = useMemo(() => {
    // Merge persisted verifications loaded into workers with any new session-only items
    const fromWorkers = Object.values(workers)
      .filter((w) => !selectedBranchId || w.branchId === selectedBranchId)
      .flatMap((w) => w.verifications);
    const fromSession = sessionVerifications.filter(
      (v) =>
        !selectedBranchId || workers[v.workerId]?.branchId === selectedBranchId,
    );
    const byId: Record<string, (typeof fromWorkers)[number]> = {} as any;
    for (const v of [...fromWorkers, ...fromSession]) byId[v.id] = v;
    return Object.values(byId)
      .filter((v) => !!v.payment && Number(v.payment.amount) > 0)
      .sort((a, b) => b.verifiedAt - a.verifiedAt);
  }, [sessionVerifications, workers, selectedBranchId]);

  const [identifying, setIdentifying] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<{
    id?: string;
    workerId: string;
    workerName: string;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");

  const PAGE_SIZE = 15;
  const [verifiedPage, setVerifiedPage] = useState(0);
  useEffect(() => {
    // reset to first page when data or branch changes
    setVerifiedPage(0);
  }, [selectedBranchId, verified.length]);

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
    // Create a verification entry immediately; amount will be confirmed (₱40)
    const created = addVerification(workerId, Date.now());
    if (created) {
      setPaymentFor({ workerId, workerName });
      setPaymentAmount("40");
      setPaymentOpen(true);
    }
  }

  function handleAddWorker(payload: AddWorkerPayload) {
    const docs = {
      or: payload.orDataUrl,
      passport: payload.passportDataUrl,
      avatar: payload.avatarDataUrl,
      plan: payload.plan,
    } as any;
    if (payload.id) {
      // Insert using the real DB id to prevent duplicates between lists
      upsertExternalWorker({
        id: payload.id,
        name: payload.name,
        arrivalDate: payload.arrivalDate,
        branchId: payload.branchId,
        docs,
        status: "active",
        plan: payload.plan,
      });
    } else {
      addWorker(
        payload.name,
        payload.arrivalDate,
        payload.branchId,
        docs,
        payload.plan,
      );
    }
    toast.success(tr("تم الحفظ", "Saved successfully"));
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
      toast.info(tr("لا توجد بيانات تحقق اليوم", "No verification data today"));
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Name", "Date", "Branch", "Amount (PHP)"],
    });
    ws["!cols"] = [12, 22, 12, 12].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير اليوم");
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, `daily-report-${y}-${m}-${d}.xlsx`);
  }

  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  async function handleSaveAmount(verificationId: string) {
    const raw = amountDraft[verificationId];
    const amount = Number(raw);
    if (!isFinite(amount) || amount <= 0) return;
    const owner = Object.values(workers).find((w) =>
      w.verifications.some((v) => v.id === verificationId),
    );
    const exitedLocked = owner
      ? !!owner.exitDate && owner.status !== "active"
      : false;
    const policyLocked = owner ? isNoExpensePolicyLocked(owner as any) : false;
    if (exitedLocked || policyLocked) {
      toast.error(
        tr(
          "ملف العاملة مقفول. اطلب من الإدارة فتح الملف.",
          "Applicant file is locked. Request admin to unlock the file.",
        ),
      );
      return;
    }
    const complete = !!(owner?.docs?.or || owner?.docs?.passport);
    if (!complete) {
      toast.error(
        tr(
          "الملف غير مكتمل. لا يمكن إدخال المبلغ.",
          "File is incomplete. Cannot enter amount.",
        ),
      );
      return;
    }
    // Persist to backend (link to latest verification in DB)
    if (owner) {
      try {
        const r = await fetch("/api/verification/payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-id": owner.id,
            "x-amount": String(amount),
          },
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
    toast.success(tr("تم التحقق والدفع", "Verification and payment completed"));
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-foreground">
            {tr("نظام التحقق من السكن", "Accommodation Verification System")}
          </h1>
          <p className="text-muted-foreground">
            {tr(
              "التحقق يتم بالوجه مباشرةً. قِف أمام الكاميرا للتعرّف ثم أدخل المبلغ لإكمال العملية.",
              "Face verification: stand in front of the camera, then enter the amount to complete.",
            )}
          </p>
        </div>

        <div className="mb-4">
          <div className="flex items-center">
            <button
              className="relative inline-flex items-center gap-3 rounded-xl bg-amber-500 px-4 py-3 text-white shadow hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-300"
              onClick={() => setNotifOpen(true)}
            >
              <span className="text-lg font-extrabold">
                {tr("الإشعارات", "Notifications")}
              </span>
              <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-white/90 px-2 py-1 text-amber-700 font-bold">
                {unregisteredCount}
              </span>
            </button>
          </div>
          <Dialog open={notifOpen} onOpenChange={setNotifOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tr("الإشعارات", "Notifications")}</DialogTitle>
              </DialogHeader>
              <div>
                <AlertsBox />
              </div>
            </DialogContent>
          </Dialog>
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
                let pass =
                  window.prompt(
                    tr(
                      "أدخل كلمة مرور الفرع ��لتبديل:",
                      "Enter branch password to switch:",
                    ),
                  ) || "";
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
                  toast.error(tr("تعذر التحقق", "Verification failed"));
                }
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={tr("اختر الفرع", "Select branch")} />
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
          <Button variant="secondary" className="gap-2" asChild>
            <Link to="/workers">
              <UsersRound className="h-4 w-4" />
              {tr("المتقدمات", "Applicants")}
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <Link to="/no-expense">
              {tr("إقامة بدون مصروف", "Residency without allowance")}
            </Link>
          </Button>
          <Button variant="admin" asChild>
            <Link to="/admin-login">{tr("الإدارة", "Admin")}</Link>
          </Button>
          <SpecialRequestDialog />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-10 gap-6 items-start">
          <div className="md:col-span-7">
            <FaceVerifyCard onVerified={handleVerifiedByFace} />
          </div>

          <div className="md:col-span-3 grid gap-6">
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="font-bold text-emerald-700">
                  {tr("تم التحقق", "Verified")}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-2"
                    asChild
                  >
                    <Link to="/daily-report">
                      <Download className="h-4 w-4" />{" "}
                      {tr("التقرير اليومي", "Daily report")}
                    </Link>
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    {verified.length} {tr("موثَّق", "entries")}
                  </div>
                </div>
              </div>
              {(() => {
                const totalPages = Math.max(
                  1,
                  Math.ceil(verified.length / PAGE_SIZE),
                );
                const start = verifiedPage * PAGE_SIZE;
                const slice = verified.slice(start, start + PAGE_SIZE);
                return (
                  <>
                    <ul className="max-h-[70vh] overflow-auto divide-y">
                      {verified.length === 0 && (
                        <li className="p-6 text-center text-muted-foreground">
                          {tr(
                            "لا يوجد عمليات تحقق بعد",
                            "No verifications yet",
                          )}
                        </li>
                      )}
                      {slice.map((v) => (
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
                                      {tr("تم التحقق —", "Verified —")}{" "}
                                      {formatCurrency(
                                        Number(v.payment.amount),
                                        locale,
                                      )}
                                    </span>
                                  </div>
                                ) : (
                                  (() => {
                                    const w = workers[v.workerId];
                                    const exitedLocked = w
                                      ? !!w.exitDate && w.status !== "active"
                                      : false;
                                    const policyLocked = w
                                      ? isNoExpensePolicyLocked(w as any)
                                      : false;
                                    if (exitedLocked || policyLocked) {
                                      const pending =
                                        w?.status === "unlock_requested";
                                      return (
                                        <div className="flex items-center gap-3">
                                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-600/10 text-rose-700 px-3 py-1 text-xs font-semibold">
                                            <Lock className="h-3 w-3" />{" "}
                                            {tr("مقفول", "Locked")}
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
                                                  tr(
                                                    "تم إرسال طلب فتح الملف إلى الإدارة",
                                                    "Unlock request sent to admin",
                                                  ),
                                                );
                                              }}
                                            >
                                              {tr(
                                                "اطلب من الإدارة فتح ملف المتقدمة",
                                                "Ask admin to unlock applicant",
                                              )}
                                            </Button>
                                          )}
                                        </div>
                                      );
                                    }
                                    return (
                                      <div className="flex items-center gap-3">
                                        <span className="text-sm">
                                          {tr(
                                            "المبلغ الإلزامي:",
                                            "Required amount:",
                                          )}{" "}
                                          ₱ 40
                                        </span>
                                        <Button
                                          size="sm"
                                          onClick={async () => {
                                            try {
                                              const r = await fetch(
                                                "/api/verification/payment",
                                                {
                                                  method: "POST",
                                                  headers: {
                                                    "Content-Type":
                                                      "application/json",
                                                    "x-worker-id": v.workerId,
                                                    "x-amount": "40",
                                                  },
                                                  body: JSON.stringify({
                                                    workerId: v.workerId,
                                                    amount: 40,
                                                  }),
                                                },
                                              );
                                              const j = await r
                                                .json()
                                                .catch(() => ({}) as any);
                                              if (!r.ok || !j?.ok) {
                                                toast.error(
                                                  j?.message || "تعذر الحفظ",
                                                );
                                                return;
                                              }
                                            } catch {}
                                            savePayment(v.id, 40);
                                            toast.success(
                                              tr(
                                                "تمت الموافقة على ٤٠ بيسو",
                                                "Approved ₱40",
                                              ),
                                            );
                                          }}
                                        >
                                          {tr("��وافق", "OK")}
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
                    {totalPages > 1 && (
                      <div className="p-3 flex items-center justify-between text-xs">
                        <button
                          className="px-2 py-1 rounded border disabled:opacity-50"
                          onClick={() =>
                            setVerifiedPage(Math.max(0, verifiedPage - 1))
                          }
                          disabled={verifiedPage === 0}
                        >
                          ‹
                        </button>
                        <div className="space-x-1 rtl:space-x-reverse">
                          {Array.from({ length: totalPages }).map((_, i) => (
                            <button
                              key={i}
                              className={
                                "inline-flex items-center justify-center w-7 h-7 rounded border " +
                                (i === verifiedPage
                                  ? "bg-primary text-primary-foreground"
                                  : "")
                              }
                              onClick={() => setVerifiedPage(i)}
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>
                        <button
                          className="px-2 py-1 rounded border disabled:opacity-50"
                          onClick={() =>
                            setVerifiedPage(
                              Math.min(totalPages - 1, verifiedPage + 1),
                            )
                          }
                          disabled={verifiedPage >= totalPages - 1}
                        >
                          ›
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirm_amount_title")}</DialogTitle>
            </DialogHeader>
            {paymentFor ? (
              <div className="space-y-3">
                <div className="text-sm">
                  {t("applicant_label")}{" "}
                  <span className="font-semibold">{paymentFor.workerName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={paymentAmount}
                    disabled
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("philippine_peso")}
                  </span>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPaymentOpen(false)}>
                {t("cancel_btn")}
              </Button>
              {paymentFor ? (
                <Button
                  onClick={async () => {
                    const amount = 40;
                    try {
                      const r = await fetch("/api/verification/payment", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "x-worker-id": paymentFor.workerId,
                          "x-amount": String(amount),
                        },
                        body: JSON.stringify({
                          workerId: paymentFor.workerId,
                          amount,
                        }),
                      });
                      const j = await r.json().catch(() => ({}) as any);
                      if (!r.ok || !j?.ok) {
                        toast.error(
                          j?.message || tr("تعذر الحفظ", "Failed to save"),
                        );
                        return;
                      }
                      const maybe = addVerification(
                        paymentFor.workerId,
                        Date.now(),
                      );
                      if (maybe) {
                        savePayment(maybe.id, amount);
                      }
                      toast.success(
                        tr(
                          "تم التحقق والدفع",
                          "Verification and payment completed",
                        ),
                      );
                      setPaymentOpen(false);
                      setPaymentAmount("");
                    } catch (e: any) {
                      toast.error(
                        e?.message || tr("تعذر الحفظ", "Failed to save"),
                      );
                    }
                  }}
                >
                  {t("save_btn")}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </main>
  );
}
