import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency, noExpenseDaysLeft } from "@/lib/utils";
import { useState } from "react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import { PencilIcon } from "lucide-react";
import { Link } from "react-router-dom";

export default function Workers() {
  const {
    branches,
    workers,
    selectedBranchId,
    setSelectedBranchId,
    updateWorkerDocs,
    requestUnlock,
  } = useWorkers();
  const branchOptions = selectedBranchId
    ? Object.values(branches).filter((b) => b.id === selectedBranchId)
    : Object.values(branches);
  const { tr, locale } = useI18n();
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const [workersPage, setWorkersPage] = useState(0);
  const [editAreaDialogOpen, setEditAreaDialogOpen] = useState(false);
  const [selectedWorkerForEdit, setSelectedWorkerForEdit] = useState<
    string | null
  >(null);
  const [selectedAreaValue, setSelectedAreaValue] = useState<string>("__CLEAR");
  const [isSavingArea, setIsSavingArea] = useState(false);
  const listAll = Object.values(workers).sort((a, b) =>
    a.name.localeCompare(b.name, "ar"),
  );
  const list = listAll.filter((w) => {
    const passes =
      w.plan !== "no_expense" &&
      (!selectedBranchId || w.branchId === selectedBranchId) &&
      (!query || w.name.toLowerCase().includes(query.toLowerCase()));
    return passes;
  });
  const totalLastPayments = list.reduce(
    (sum, w) =>
      sum + (w.verifications.find((v) => v.payment)?.payment?.amount ?? 0),
    0,
  );

  const handleEditAssignedArea = (workerId: string) => {
    const worker = workers[workerId];
    if (worker) {
      setSelectedWorkerForEdit(workerId);
      setSelectedAreaValue(worker.docs?.assignedArea || "__CLEAR");
      setEditAreaDialogOpen(true);
    }
  };

  const handleSaveAssignedArea = async () => {
    if (!selectedWorkerForEdit) return;
    setIsSavingArea(true);
    try {
      const areaValue =
        selectedAreaValue === "__CLEAR"
          ? undefined
          : selectedAreaValue || undefined;
      const res = await fetch("/api/workers/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: selectedWorkerForEdit,
          assignedArea: areaValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        updateWorkerDocs(selectedWorkerForEdit, {
          assignedArea: areaValue,
        });
        toast.success(tr("تم الحفظ بنجاح", "Saved successfully"));
        setEditAreaDialogOpen(false);
      } else {
        toast.error(data?.message || tr("فشل الحفظ", "Save failed"));
      }
    } catch (e) {
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsSavingArea(false);
    }
  };

  return (
    <main className="container py-8">
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold">
              {tr("المتقدمات المسجلات", "Registered Applicants")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr(
                "اضغط على اسم المتق��مة لعرض جميع عمليات التحقق والمبالغ.",
                "Click an applicant name to view all verifications and amounts.",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {tr("الفرع:", "Branch:")}
            </span>
            <Select
              value={selectedBranchId ?? undefined}
              onValueChange={async (v) => {
                if (v === selectedBranchId) return;
                const pass =
                  window.prompt(
                    tr(
                      "أدخل كلمة مرور الفرع للتبديل:",
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
                        ? tr("كلمة المرور غير صحيحة", "Wrong password")
                        : j?.message || tr("تعذر التحقق", "Failed to verify"),
                    );
                    return;
                  }
                  setSelectedBranchId(v);
                } catch {
                  toast.error(tr("تعذر التحقق", "Failed to verify"));
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={tr("اختر الفرع", "Select branch")} />
              </SelectTrigger>
              <SelectContent>
                {branchOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
            <input
              className="col-span-1 sm:col-span-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={tr("ابحث بالاسم", "Search by name")}
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
            />
            <button
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 w-full"
              onClick={() => setQuery(qDraft)}
              type="button"
            >
              {tr("بحث", "Search")}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-right text-sm md:text-base">
          <thead className="bg-secondary/50">
            <tr className="text-xs md:text-sm">
              <th className="p-2 md:p-3 whitespace-nowrap w-8">#</th>
              <th className="p-2 md:p-3 whitespace-nowrap">
                {tr("الاسم", "Name")}
              </th>
              <th className="p-2 md:p-3 hidden sm:table-cell whitespace-nowrap">
                {tr("تاريخ الوصول", "Arrival Date")}
              </th>
              <th className="p-2 md:p-3 hidden lg:table-cell whitespace-nowrap">
                {tr("المنطقة المخصصة", "Assigned Area")}
              </th>
              <th className="p-2 md:p-3 hidden lg:table-cell whitespace-nowrap">
                {tr("عدد عمليات التحقق", "Verifications")}
              </th>
              <th className="p-2 md:p-3 whitespace-nowrap">
                {tr("الملف", "Profile")}
              </th>
              <th className="p-2 md:p-3 whitespace-nowrap">
                {tr("آخر مبلغ", "Last Amount")}
              </th>
              <th className="p-2 md:p-3 whitespace-nowrap">
                {tr("عرض", "View")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(() => {
              const itemsPerFirstPage = 10;
              const itemsPerOtherPage = 15;
              const totalPages = Math.ceil(
                (list.length - itemsPerFirstPage) / itemsPerOtherPage + 1,
              );
              const isFirstPage = workersPage === 0;
              const itemsPerPage = isFirstPage
                ? itemsPerFirstPage
                : itemsPerOtherPage;
              let startIndex = 0;
              if (isFirstPage) {
                startIndex = 0;
              } else {
                startIndex =
                  itemsPerFirstPage + (workersPage - 1) * itemsPerOtherPage;
              }
              const endIndex = startIndex + itemsPerPage;
              const pageList = list.slice(startIndex, endIndex);

              if (list.length === 0) {
                return (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {tr(
                        "لا توجد متقدمات في هذا الفرع.",
                        "No applicants in this branch.",
                      )}
                    </td>
                  </tr>
                );
              }

              return pageList.map((w, index) => {
                const absoluteIndex = startIndex + index + 1;
                const lastPayment = w.verifications.find((v) => v.payment)
                  ?.payment?.amount;
                return (
                  <tr key={w.id} className="hover:bg-secondary/40">
                    <td className="p-2 md:p-3 font-medium text-xs md:text-sm text-center">
                      {absoluteIndex}
                    </td>
                    <td className="p-2 md:p-3 font-medium text-xs md:text-sm">
                      <div className="flex flex-col">
                        <span>{w.name}</span>
                        {(() => {
                          const locked = !!w.exitDate && w.status !== "active";
                          if (!locked) return null;
                          const pending = w.status === "unlock_requested";
                          return (
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 font-semibold text-rose-700 text-xs">
                                {tr("مقفولة", "Locked")}
                              </span>
                              {pending ? (
                                <span className="text-muted-foreground text-xs">
                                  {tr("قيد الانتظار الإدارة", "Pending admin")}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                      {new Date(w.arrivalDate).toLocaleDateString("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm hidden lg:table-cell whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                          {w.docs?.assignedArea || "—"}
                        </span>
                        <button
                          onClick={() => handleEditAssignedArea(w.id)}
                          className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900"
                          title={tr(
                            "تعديل المنطقة المخصصة",
                            "Edit assigned area",
                          )}
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm hidden lg:table-cell whitespace-nowrap">
                      {w.verifications.length}
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm">
                      {(() => {
                        const hasDocs = w.docs?.or || w.docs?.passport;
                        const isLocked = !!w.exitDate && w.status !== "active";

                        if (hasDocs) {
                          // Complete - show "Complete" in green
                          return (
                            <div className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600/10">
                                <svg
                                  className="w-4 h-4 text-emerald-700"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </span>
                              <span className="font-semibold text-emerald-700">
                                {tr("مكتمل", "Complete")}
                              </span>
                            </div>
                          );
                        } else {
                          // Incomplete or locked after grace period (including extension days)
                          const daysRemaining = noExpenseDaysLeft(w);

                          if (daysRemaining > 0) {
                            // Incomplete - show "Incomplete" with remaining days
                            return (
                              <div className="flex flex-col gap-1">
                                <div className="inline-flex items-center gap-2 w-fit">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400/20">
                                    <svg
                                      className="w-4 h-4 text-amber-600"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </span>
                                  <span className="font-semibold text-amber-600">
                                    {tr("غير مكتمل", "Incomplete")}
                                  </span>
                                </div>
                                <span className="text-xs text-amber-600">
                                  {tr(
                                    `${daysRemaining} أيام متبقية`,
                                    `${daysRemaining} days left`,
                                  )}
                                </span>
                              </div>
                            );
                          } else {
                            // 14 days passed - show lock icon with "request unlock" button
                            return (
                              <div className="inline-flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-600/10">
                                  <svg
                                    className="w-4 h-4 text-rose-700"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </span>
                                <button
                                  className="inline-flex items-center rounded-md border px-2 py-1 hover:bg-secondary/60 text-xs font-semibold text-rose-700"
                                  onClick={async () => {
                                    try {
                                      requestUnlock(w.id);
                                      toast.info(
                                        tr(
                                          "تم إرسال طلب فتح إلى الإدارة",
                                          "Unlock request sent to admin",
                                        ),
                                      );
                                    } catch {}
                                  }}
                                >
                                  {tr("طلب فتح", "request unlock")}
                                </button>
                              </div>
                            );
                          }
                        }
                      })()}
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">
                      {lastPayment != null
                        ? formatCurrency(Number(lastPayment), locale)
                        : "—"}
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm">
                      <Link
                        to={`/workers/${w.id}`}
                        className="text-primary hover:underline"
                      >
                        {tr("تفاصيل", "Details")}
                      </Link>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 font-semibold">
              <td className="p-2 md:p-3" colSpan={4}>
                {tr("إجمالي آخر المبالغ", "Total of last amounts")}
              </td>
              <td className="p-2 md:p-3" colSpan={3}>
                ₱ {totalLastPayments}
              </td>
            </tr>
          </tfoot>
        </table>
        {(() => {
          const itemsPerFirstPage = 10;
          const itemsPerOtherPage = 15;
          const totalPages = Math.ceil(
            (list.length - itemsPerFirstPage) / itemsPerOtherPage + 1,
          );
          return list.length > 0 && totalPages > 1 ? (
            <div className="border-t px-3 md:px-6 py-3 md:py-4 flex items-center justify-between gap-2 text-xs md:text-sm">
              <button
                onClick={() => setWorkersPage((p) => Math.max(0, p - 1))}
                disabled={workersPage === 0}
                className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
              >
                ‹
              </button>
              <span className="text-xs md:text-sm">
                {workersPage + 1} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setWorkersPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={workersPage === totalPages - 1}
                className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
              >
                ›
              </button>
            </div>
          ) : null;
        })()}
      </div>

      {/* Edit Assigned Area Dialog */}
      <Dialog open={editAreaDialogOpen} onOpenChange={setEditAreaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("تعديل المنطقة المخصصة", "Edit Assigned Area")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {tr("المنطقة المخصصة", "Assigned Area")}
              </label>
              <Select
                value={selectedAreaValue}
                onValueChange={setSelectedAreaValue}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={tr("اختر المنطقة", "Select area")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__CLEAR">—</SelectItem>
                  <SelectItem value="NONE">NONE</SelectItem>
                  <SelectItem value="MUSANED">MUSANED</SelectItem>
                  <SelectItem value="BRANCH">BRANCH</SelectItem>
                  <SelectItem value="REGULAR_1">REGULAR 1</SelectItem>
                  <SelectItem value="REGULAR_2">REGULAR 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditAreaDialogOpen(false)}
              disabled={isSavingArea}
            >
              {tr("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleSaveAssignedArea} disabled={isSavingArea}>
              {isSavingArea
                ? tr("جاري الحفظ...", "Saving...")
                : tr("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
