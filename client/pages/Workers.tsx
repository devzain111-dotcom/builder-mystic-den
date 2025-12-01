import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency, noExpenseDaysLeft } from "@/lib/utils";
import { useState, useEffect, useMemo, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import { PencilIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { usePageRefresh } from "@/context/PageRefreshContext";

export default function Workers() {
  const {
    branches,
    workers,
    selectedBranchId,
    updateWorkerDocs,
    requestUnlock,
    refreshWorkers,
  } = useWorkers();

  const { registerRefreshHandler, unregisterRefreshHandler } = usePageRefresh();

  // Register this page's refresh handler
  useEffect(() => {
    const handlePageRefresh = async () => {
      await refreshWorkers();
    };
    registerRefreshHandler(handlePageRefresh);
    return () => {
      unregisterRefreshHandler();
    };
  }, [refreshWorkers, registerRefreshHandler, unregisterRefreshHandler]);

  // Listen for verification updates from the Index page
  useEffect(() => {
    const handleVerificationUpdated = (e: any) => {
      const { verificationId, workerId } = e.detail || {};
      console.log("[Workers] 🔔 Verification updated event received", {
        verificationId: verificationId?.slice(0, 8),
        workerId: workerId?.slice(0, 8),
      });
      // The workers state will automatically update through the WorkersContext
      // No need to do anything here, just log the event
    };

    window.addEventListener(
      "verificationUpdated",
      handleVerificationUpdated as any,
    );
    return () => {
      window.removeEventListener(
        "verificationUpdated",
        handleVerificationUpdated as any,
      );
    };
  }, []);

  // Debug logging
  useEffect(() => {
    const totalWorkers = Object.keys(workers).length;
    const withExpense = Object.values(workers).filter(
      (w) => (w.docs?.plan || w.plan) === "with_expense",
    ).length;
    console.log("[Workers] 📊 Data state updated:", {
      totalWorkers,
      withExpense,
      branches: Object.keys(branches).length,
      selectedBranchId,
      timestamp: new Date().toISOString(),
    });
  }, [workers, branches, selectedBranchId]);

  const activeBranchId =
    selectedBranchId && branches[selectedBranchId] ? selectedBranchId : null;
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

  // Edit worker name and arrival date
  const [editWorkerDialogOpen, setEditWorkerDialogOpen] = useState(false);
  const [editWorkerName, setEditWorkerName] = useState("");
  const [editWorkerDateText, setEditWorkerDateText] = useState("");
  const [isSavingWorker, setIsSavingWorker] = useState(false);

  // Check if accessed from admin context (either via admin login or admin=1 query param)
  const isAdmin = localStorage.getItem("adminAuth") === "1" && new URLSearchParams(window.location.search).get("admin") === "1";

  // Note: Auto-move to no-expense is now handled in WorkersContext for applicants without documents
  const listAll = useMemo(() => {
    return Object.values(workers).sort((a, b) =>
      a.name.localeCompare(b.name, "ar"),
    );
  }, [workers]);

  // Workers in "with_expense" plan (Registered Applicants)
  // Only show those who explicitly have documents (plan set to with_expense)
  const list = useMemo(() => {
    return listAll.filter((w) => {
      const planValue = w.docs?.plan || w.plan;
      const passes =
        planValue === "with_expense" &&
        activeBranchId &&
        w.branchId === activeBranchId &&
        (!query || w.name.toLowerCase().includes(query.toLowerCase()));
      return passes;
    });
  }, [listAll, activeBranchId, query]);

  const totalLastPayments = useMemo(() => {
    return list.reduce((sum, w) => {
      // Find the LATEST payment (most recent savedAt), not the first one
      const latestPayment = (w.verifications || [])
        .filter((v) => v.payment?.savedAt)
        .sort(
          (a, b) => (b.payment?.savedAt ?? 0) - (a.payment?.savedAt ?? 0),
        )[0];
      return sum + (latestPayment?.payment?.amount ?? 0);
    }, 0);
  }, [list]);

  const handleEditAssignedArea = useCallback(
    (workerId: string) => {
      const worker = workers[workerId];
      if (!worker) return;

      setSelectedWorkerForEdit(workerId);
      setSelectedAreaValue(worker.docs?.assignedArea || "__CLEAR");
      setEditAreaDialogOpen(true);
    },
    [workers],
  );

  const handleSaveAssignedArea = useCallback(async () => {
    if (!selectedWorkerForEdit) return;
    setIsSavingArea(true);
    try {
      const areaValue =
        selectedAreaValue === "__CLEAR"
          ? undefined
          : selectedAreaValue || undefined;

      console.log("[Workers] Saving assigned area:", {
        workerId: selectedWorkerForEdit,
        areaValue,
        selectedAreaValue,
      });

      const payload = {
        workerId: selectedWorkerForEdit,
        assignedArea: areaValue,
      };

      console.log("[Workers] Fetch payload:", payload);

      const res = await fetch("/api/workers/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("[Workers] Response status:", res.status);

      const data = await res.json().catch(() => ({}));

      console.log("[Workers] Response data:", data);

      if (res.ok) {
        console.log("[Workers] Update local state with:", {
          assignedArea: areaValue,
        });
        updateWorkerDocs(selectedWorkerForEdit, {
          assignedArea: areaValue,
        });
        toast.success(tr("تم الحفظ بنجاح", "Saved successfully"));
        setEditAreaDialogOpen(false);
      } else {
        console.error("[Workers] Save failed:", data?.message);
        toast.error(data?.message || tr("فشل الحفظ", "Save failed"));
      }
    } catch (e: any) {
      console.error("[Workers] Catch error:", e);
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsSavingArea(false);
    }
  }, [selectedWorkerForEdit, selectedAreaValue, updateWorkerDocs, tr]);

  const handleOpenEditWorker = useCallback(
    (workerId: string) => {
      const worker = workers[workerId];
      if (!worker) return;

      setSelectedWorkerForEdit(workerId);
      setEditWorkerName(worker.name);
      const arrivalDate = new Date(worker.arrivalDate);
      const dateStr = arrivalDate
        .toLocaleDateString("en-GB")
        .split("/")
        .reverse()
        .join("/");
      setEditWorkerDateText(dateStr);
      setEditWorkerDialogOpen(true);
    },
    [workers],
  );

  const handleSaveWorker = useCallback(async () => {
    if (!selectedWorkerForEdit || !editWorkerName.trim()) return;

    const parts = editWorkerDateText.split("/");
    if (parts.length !== 3 || parts.some((p) => !p.trim())) {
      toast.error(tr("صيغة التاريخ غير صحيحة", "Invalid date format"));
      return;
    }

    const [day, month, year] = parts.map((p) => parseInt(p.trim(), 10));
    if (
      isNaN(day) ||
      isNaN(month) ||
      isNaN(year) ||
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12
    ) {
      toast.error(tr("التاريخ غير صحيح", "Invalid date"));
      return;
    }

    const fullYear = year < 100 ? year + 2000 : year;
    const arrivalTs = new Date(fullYear, month - 1, day, 12, 0, 0, 0).getTime();

    setIsSavingWorker(true);
    try {
      const payload = {
        workerId: selectedWorkerForEdit,
        name: editWorkerName.trim(),
        arrivalDate: arrivalTs,
      };

      const res = await fetch("/api/workers/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const worker = workers[selectedWorkerForEdit];
        if (worker) {
          worker.name = editWorkerName.trim();
          worker.arrivalDate = arrivalTs;
        }
        toast.success(tr("تم الحفظ بنجاح", "Saved successfully"));
        setEditWorkerDialogOpen(false);
      } else {
        console.error("[Workers] Save failed:", data?.message);
        toast.error(data?.message || tr("فشل الحفظ", "Save failed"));
      }
    } catch (e: any) {
      console.error("[Workers] Catch error:", e);
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsSavingWorker(false);
    }
  }, [selectedWorkerForEdit, editWorkerName, editWorkerDateText, workers, tr]);

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
                "اضغط على اسم المتقدمة لعرض جميع عمليات التحقق والمبالغ.",
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
            <div className="text-sm font-medium px-3 py-2 bg-background rounded-md border">
              {activeBranchId && branches[activeBranchId]
                ? branches[activeBranchId].name
                : tr("غير محدد", "Not selected")}
            </div>
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
                {tr("عد�� عمليات التحقق", "Verifications")}
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

              return (
                <>
                  {pageList.map((w, index) => {
                    const absoluteIndex = startIndex + index + 1;
                    // Get LATEST payment (most recent savedAt), not the first one
                    const lastPayment = (w.verifications || [])
                      .filter((v) => v.payment?.savedAt)
                      .sort(
                        (a, b) =>
                          (b.payment?.savedAt ?? 0) - (a.payment?.savedAt ?? 0),
                      )[0]?.payment?.amount;
                    return (
                      <tr key={w.id} className="hover:bg-secondary/40">
                        <td className="p-2 md:p-3 font-medium text-xs md:text-sm text-center">
                          {absoluteIndex}
                        </td>
                        <td className="p-2 md:p-3 font-medium text-xs md:text-sm">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span>{w.name}</span>
                              {isAdmin && (
                                <button
                                  onClick={() => handleOpenEditWorker(w.id)}
                                  className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900"
                                  title={tr(
                                    "تعديل البيانات",
                                    "Edit applicant data",
                                  )}
                                >
                                  <PencilIcon className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {(() => {
                              const locked =
                                !!w.exitDate && w.status !== "active";
                              if (!locked) return null;
                              const pending = w.status === "unlock_requested";
                              return (
                                <div className="mt-1 flex items-center gap-2 text-xs">
                                  <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 font-semibold text-rose-700 text-xs">
                                    {tr("مقفولة", "Locked")}
                                  </span>
                                  {pending ? (
                                    <span className="text-muted-foreground text-xs">
                                      {tr(
                                        "قيد الانتظار الإدارة",
                                        "Pending admin",
                                      )}
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
                          {(w.verifications || []).length}
                        </td>
                        <td className="p-2 md:p-3 text-xs md:text-sm">
                          {(() => {
                            // Check if in "with_expense" plan - if so, it's complete (has documents or was explicitly moved)
                            const planValue =
                              w.docs?.plan || w.plan || "with_expense";
                            const isComplete = planValue === "with_expense";
                            const isLocked =
                              !!w.exitDate && w.status !== "active";

                            if (isComplete) {
                              // Complete - show "Complete" in green only
                              return (
                                <span className="font-semibold text-emerald-700">
                                  {tr("مكتمل", "Complete")}
                                </span>
                              );
                            } else {
                              // Incomplete or locked after grace period (including extension days)
                              const daysRemaining = noExpenseDaysLeft(w);

                              if (daysRemaining > 0) {
                                // Incomplete - show "Incomplete" with remaining days
                                // Note: Workers without documents are automatically moved to no-expense in WorkersContext
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
                  })}
                </>
              );
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
                {tr("الم��طقة المخصصة", "Assigned Area")}
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
                  <SelectItem value="REGULAR_3">REGULAR 3</SelectItem>
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

      {/* Edit Worker Dialog */}
      <Dialog
        open={editWorkerDialogOpen}
        onOpenChange={setEditWorkerDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("تعديل بيانات المتقدمة", "Edit Applicant Data")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-worker-name">{tr("الاسم", "Name")}</Label>
              <Input
                id="edit-worker-name"
                value={editWorkerName}
                onChange={(e) => setEditWorkerName(e.target.value)}
                placeholder={tr("اسم المتقدمة", "Applicant name")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-worker-date">
                {tr("تاريخ الوصول", "Arrival Date")} (dd/mm/yyyy)
              </Label>
              <Input
                id="edit-worker-date"
                value={editWorkerDateText}
                onChange={(e) => setEditWorkerDateText(e.target.value)}
                placeholder="dd/mm/yyyy"
                inputMode="numeric"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditWorkerDialogOpen(false)}
              disabled={isSavingWorker}
            >
              {tr("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleSaveWorker} disabled={isSavingWorker}>
              {isSavingWorker
                ? tr("جاري الحفظ...", "Saving...")
                : tr("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
