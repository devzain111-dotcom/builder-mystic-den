import { Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import BackButton from "@/components/BackButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isNoExpensePolicyLocked, noExpenseDaysLeft } from "@/lib/utils";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";

export default function NoExpense() {
  const {
    branches,
    workers,
    selectedBranchId,
    updateWorkerDocs,
    requestUnlock,
    refreshWorkers,
  } = useWorkers();
  const branchOptions = Object.values(branches);
  const activeBranchId =
    selectedBranchId && branches[selectedBranchId] ? selectedBranchId : null;
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const [noExpensePage, setNoExpensePage] = useState(0);
  const { tr, t } = useI18n();

  // Edit worker name, arrival date, and assigned area
  const [editWorkerDialogOpen, setEditWorkerDialogOpen] = useState(false);
  const [selectedWorkerForEdit, setSelectedWorkerForEdit] = useState<
    string | null
  >(null);
  const [editWorkerName, setEditWorkerName] = useState("");
  const [editWorkerDateText, setEditWorkerDateText] = useState("");
  const [editWorkerArea, setEditWorkerArea] = useState("");
  const [isSavingWorker, setIsSavingWorker] = useState(false);

  // Edit days for no_expense policy (admin only)
  const [editDaysDialogOpen, setEditDaysDialogOpen] = useState(false);
  const [selectedWorkerForDays, setSelectedWorkerForDays] = useState<
    string | null
  >(null);
  const [editDaysValue, setEditDaysValue] = useState("");
  const [isSavingDays, setIsSavingDays] = useState(false);

  // Edit assigned area (for everyone)
  const [editAreaDialogOpen, setEditAreaDialogOpen] = useState(false);
  const [selectedWorkerForArea, setSelectedWorkerForArea] = useState<
    string | null
  >(null);
  const [editAreaValue, setEditAreaValue] = useState("");
  const [isSavingArea, setIsSavingArea] = useState(false);
  const [availableAreas, setAvailableAreas] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteWorkerId, setDeleteWorkerId] = useState<string | null>(null);
  const [deleteWorkerName, setDeleteWorkerName] = useState("");
  const [isDeletingWorker, setIsDeletingWorker] = useState(false);

  // Check if accessed from admin context (either via admin login or admin=1 query param)
  const isAdmin =
    localStorage.getItem("adminAuth") === "1" &&
    new URLSearchParams(window.location.search).get("admin") === "1";
  // Show only workers in "no_expense" plan (those WITHOUT documents or in residency without allowance)
  // Plan is automatically set to "with_expense" when documents are uploaded
  const listAll = Object.values(workers)
    .filter((w) => {
      // Only show workers who are in "no_expense" plan
      // Once documents are uploaded, plan changes to "with_expense" and they disappear from this list
      const planValue = w.plan || w.docs?.plan;
      return planValue === "no_expense";
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const list = listAll.filter(
    (w) =>
      activeBranchId &&
      w.branchId === activeBranchId &&
      (!query || w.name.toLowerCase().includes(query.toLowerCase())),
  );

  const handleOpenEditWorker = (workerId: string) => {
    const worker = workers[workerId];
    if (!worker) return;

    setSelectedWorkerForEdit(workerId);
    setEditWorkerName(worker.name);
    setEditWorkerArea(worker.assigned_area || "");
    const arrivalDate = new Date(worker.arrivalDate);
    const dateStr = arrivalDate
      .toLocaleDateString("en-GB")
      .split("/")
      .reverse()
      .join("/");
    setEditWorkerDateText(dateStr);
    setEditWorkerDialogOpen(true);
  };

  const handleSaveWorker = async () => {
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
        assignedArea: editWorkerArea.trim() || null,
      };

      const res = await fetch("/api/workers/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-id": selectedWorkerForEdit,
          "x-name": editWorkerName.trim(),
          "x-arrival": String(arrivalTs),
          "x-assigned-area": editWorkerArea.trim(),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok) {
        // Update worker locally first
        const worker = workers[selectedWorkerForEdit];
        if (worker) {
          worker.name = editWorkerName.trim();
          worker.arrivalDate = arrivalTs;
          worker.assigned_area = editWorkerArea.trim() || null;
        }
        toast.success(tr("تم الحفظ بنجاح", "Saved successfully"));
        setEditWorkerDialogOpen(false);

        // Refresh workers from server to ensure data is synced
        if (refreshWorkers) {
          setTimeout(() => {
            refreshWorkers().catch((err) =>
              console.warn("[NoExpense] Refresh after save failed:", err)
            );
          }, 500);
        }
      } else {
        console.error("[NoExpense] Save failed:", data?.message || res.status);
        toast.error(data?.message || tr("فشل الحفظ", "Save failed"));
      }
    } catch (e: any) {
      console.error("[NoExpense] Catch error:", e);
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsSavingWorker(false);
    }
  };

  const handleOpenEditDays = (workerId: string) => {
    const worker = workers[workerId];
    if (!worker) return;

    const daysLeft = noExpenseDaysLeft(worker as any);
    setSelectedWorkerForDays(workerId);
    setEditDaysValue(String(Math.max(0, daysLeft)));
    setEditDaysDialogOpen(true);
  };

  const handleOpenEditArea = async (workerId: string) => {
    const worker = workers[workerId];
    if (!worker) return;

    setSelectedWorkerForArea(workerId);
    setEditAreaValue(worker.assigned_area || "");

    // Fetch available areas for this branch
    try {
      if (worker.branchId) {
        const response = await fetch(
          `/api/workers/branch/${worker.branchId}/areas`,
        );
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data?.areas)) {
            setAvailableAreas(data.areas);
          }
        }
      }
    } catch (err) {
      console.warn("[NoExpense] Failed to fetch branch areas:", err);
      // Use local areas if fetch fails
      const branchAreas = new Set<string>();
      Object.values(workers).forEach((w: any) => {
        if (w.branchId === worker.branchId && w.assigned_area) {
          branchAreas.add(w.assigned_area);
        }
      });
      setAvailableAreas(Array.from(branchAreas).sort());
    }

    setEditAreaDialogOpen(true);
  };

  const handleSaveArea = async () => {
    if (!selectedWorkerForArea || !editAreaValue.trim()) {
      toast.error(tr("أدخل منطقة إسناد", "Enter assigned area"));
      return;
    }

    setIsSavingArea(true);
    try {
      const res = await fetch("/api/workers/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-id": selectedWorkerForArea,
          "x-assigned-area": editAreaValue.trim(),
        },
        body: JSON.stringify({
          workerId: selectedWorkerForArea,
          assignedArea: editAreaValue.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok) {
        const worker = workers[selectedWorkerForArea];
        if (worker) {
          worker.assigned_area = editAreaValue.trim();
        }
        toast.success(tr("تم حفظ المنطقة بنجاح", "Area saved successfully"));
        setEditAreaDialogOpen(false);

        // Refresh to sync with server
        if (refreshWorkers) {
          setTimeout(() => {
            refreshWorkers().catch((err) =>
              console.warn("[NoExpense] Refresh after save failed:", err),
            );
          }, 300);
        }
      } else {
        console.error("[NoExpense] Save area failed:", data?.message);
        toast.error(data?.message || tr("فشل الحفظ", "Save failed"));
      }
    } catch (e: any) {
      console.error("[NoExpense] Save area error:", e);
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsSavingArea(false);
    }
  };

  const handleSaveDays = async () => {
    if (!selectedWorkerForDays) return;

    const daysValue = parseInt(editDaysValue.trim(), 10);
    if (isNaN(daysValue) || daysValue < 0) {
      toast.error(tr("قيمة الأيام غير صحيحة", "Invalid days value"));
      return;
    }

    if (daysValue > 14) {
      toast.error(tr("الحد الأقصى للأيام هو 14 يوم", "Maximum days is 14"));
      return;
    }

    setIsSavingDays(true);
    try {
      const overrideSetAt = daysValue > 0 ? Date.now() : null;
      const payload: Record<string, any> = {
        workerId: selectedWorkerForDays,
        no_expense_days_override: daysValue,
      };
      if (overrideSetAt) {
        payload.no_expense_days_override_set_at = overrideSetAt;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-worker-id": selectedWorkerForDays,
        "x-no-expense-days": String(daysValue),
      };
      if (overrideSetAt) {
        headers["x-no-expense-days-set-at"] = String(overrideSetAt);
      }

      const res = await fetch("/api/workers/update-days", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        updateWorkerDocs(selectedWorkerForDays, {
          no_expense_days_override: daysValue > 0 ? daysValue : undefined,
          no_expense_days_override_set_at: overrideSetAt ?? undefined,
        });
        toast.success(tr("تم الحفظ بنجاح", "Saved successfully"));
        setEditDaysDialogOpen(false);
      } else {
        console.error("[NoExpense] Days update failed:", data?.message);
        toast.error(data?.message || tr("فشل الحفظ", "Save failed"));
      }
    } catch (e: any) {
      console.error("[NoExpense] Days update error:", e);
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsSavingDays(false);
    }
  };

  const handleOpenDeleteWorker = (workerId: string) => {
    const worker = workers[workerId];
    if (!worker) return;
    setDeleteWorkerId(workerId);
    setDeleteWorkerName(worker.name);
    setDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeleteWorkerId(null);
    setDeleteWorkerName("");
  };

  const handleConfirmDeleteWorker = async () => {
    if (!deleteWorkerId) return;
    setIsDeletingWorker(true);
    try {
      const res = await fetch(`/api/workers/${deleteWorkerId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(
          tr("تم حذف المتقدمة نهائيًا", "Applicant deleted permanently"),
        );
        handleCloseDeleteDialog();
        if (refreshWorkers) {
          await refreshWorkers();
        }
      } else {
        console.error("[NoExpense] Delete failed:", data?.message);
        toast.error(data?.message || tr("فشل حذف المتقدمة", "Delete failed"));
      }
    } catch (e: any) {
      console.error("[NoExpense] Delete error:", e);
      toast.error(tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setIsDeletingWorker(false);
    }
  };

  return (
    <main className="container py-8">
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold">
              {tr("إقامة بدون مصروف", "Residency without allowance")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr(
                "اضغط على اسم العاملة لعرض جميع التفاصيل.",
                "Click the worker name to view all details.",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {t("branch_label_short")}
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

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50">
            <tr className="text-sm">
              <th className="p-3 w-12">{tr("#", "#")}</th>
              <th className="p-3">{tr("الاسم", "Name")}</th>
              <th className="p-3">{tr("تاريخ الوصول", "Arrival Date")}</th>
              <th className="p-3">{tr("الفرع", "Branch")}</th>
              <th className="p-3">{tr("المنطقة المسندة", "Assigned Area")}</th>
              <th className="p-3">{tr("إجراء", "Action")}</th>
              <th className="p-3">{tr("عرض", "View")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(() => {
              const itemsPerFirstPage = 10;
              const itemsPerOtherPage = 15;
              const totalPages = Math.ceil(
                (list.length - itemsPerFirstPage) / itemsPerOtherPage + 1,
              );
              const isFirstPage = noExpensePage === 0;
              const itemsPerPage = isFirstPage
                ? itemsPerFirstPage
                : itemsPerOtherPage;
              let startIndex = 0;
              if (isFirstPage) {
                startIndex = 0;
              } else {
                startIndex =
                  itemsPerFirstPage + (noExpensePage - 1) * itemsPerOtherPage;
              }
              const endIndex = startIndex + itemsPerPage;
              const pageList = list.slice(startIndex, endIndex);

              if (list.length === 0) {
                return (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {tr("لا يوجد عناصر.", "No items.")}
                    </td>
                  </tr>
                );
              }

              return pageList.map((w, idx) => {
                const absoluteIndex = startIndex + idx + 1;
                return (
                  <tr key={w.id} className="hover:bg-secondary/40">
                    <td className="p-3 text-center font-medium text-muted-foreground w-12">
                      {absoluteIndex}
                    </td>
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{w.name}</span>
                        {isAdmin && (
                          <button
                            onClick={() => handleOpenEditWorker(w.id)}
                            className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900"
                            title={tr("تعديل البيانات", "Edit applicant data")}
                          >
                            <PencilIcon className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {new Date(w.arrivalDate).toLocaleDateString("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="p-3 text-sm">
                      {branches[w.branchId]?.name || ""}
                    </td>
                    <td className="p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                          {w.assigned_area || w.docs?.assignedArea || "—"}
                        </span>
                        <button
                          onClick={() => handleOpenEditArea(w.id)}
                          className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900"
                          title={tr("تعديل المنطقة", "Edit area")}
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      {(() => {
                        const planValue = w.plan || w.docs?.plan;
                        const hasDocs =
                          planValue === "with_expense" ||
                          !!w.docs?.or ||
                          !!w.docs?.passport;
                        if (hasDocs) {
                          return (
                            <button
                              className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700 text-xs"
                              onClick={async () => {
                                try {
                                  const r = await fetch("/api/workers/plan", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      "x-worker-id": w.id,
                                      "x-plan": "with_expense",
                                    },
                                    body: JSON.stringify({
                                      workerId: w.id,
                                      plan: "with_expense",
                                    }),
                                  });
                                  const j = await r
                                    .json()
                                    .catch(() => ({}) as any);
                                  if (!r.ok || !j?.ok) return;
                                  try {
                                    const { toast } = await import("sonner");
                                    toast.success(
                                      tr(
                                        "تم تحديث المتقدمة ونقلها للمتقدمات",
                                        "Applicant updated and moved to active list",
                                      ),
                                    );
                                  } catch {}
                                  updateWorkerDocs(w.id, {
                                    plan: "with_expense",
                                  });
                                } catch {}
                              }}
                            >
                              {tr("تحديث المتقدمة", "Update applicant")}
                            </button>
                          );
                        }
                        const daysLeft = noExpenseDaysLeft(w as any);
                        const locked = isNoExpensePolicyLocked(w as any);
                        if (!locked) {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="text-amber-700">
                                {tr("متبقي", "Left")}: {Math.max(0, daysLeft)}{" "}
                                {tr("يوم", "days")}
                              </span>
                              {isAdmin && (
                                <button
                                  className="inline-flex items-center rounded-md bg-blue-600 px-2 py-1 text-white hover:bg-blue-700 text-xs"
                                  onClick={() => handleOpenEditDays(w.id)}
                                  title={tr(
                                    "تعديل الأيام المتبقية",
                                    "Edit remaining days",
                                  )}
                                >
                                  {tr("تعديل", "Edit")}
                                </button>
                              )}
                            </div>
                          );
                        }
                        if (w.status === "unlock_requested") {
                          return (
                            <span className="inline-flex items-center rounded-full bg-blue-600/10 px-2 py-0.5 font-semibold text-blue-700">
                              {tr("قيد المراجعة", "Pending review")}
                            </span>
                          );
                        }
                        return (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 font-semibold text-rose-700">
                              {tr("مقفل", "Locked")}
                            </span>
                            {isAdmin ? (
                              <button
                                className="inline-flex items-center rounded-md bg-blue-600 px-2 py-1 text-white hover:bg-blue-700 text-xs"
                                onClick={() => handleOpenEditDays(w.id)}
                                title={tr(
                                  "تعديل الأيام المتبقية",
                                  "Edit remaining days",
                                )}
                              >
                                {tr("تعديل", "Edit")}
                              </button>
                            ) : (
                              <button
                                className="inline-flex items-center rounded-md border px-2 py-1 hover:bg-secondary/60 text-xs"
                                onClick={async () => {
                                  try {
                                    const { toast } = await import("sonner");
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
                                {tr("طلب فتح", "Request unlock")}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-3 text-sm">
                      <div className="flex flex-col items-start gap-1">
                        <Link
                          to={`/workers/${w.id}`}
                          className="text-primary hover:underline"
                        >
                          {tr("تفاصيل", "Details")}
                        </Link>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleOpenDeleteWorker(w.id)}
                            className="text-destructive text-xs font-semibold hover:underline"
                          >
                            {tr("حذف نهائي", "Delete permanently")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
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
                onClick={() => setNoExpensePage((p) => Math.max(0, p - 1))}
                disabled={noExpensePage === 0}
                className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
              >
                ‹
              </button>
              <span className="text-xs md:text-sm">
                {noExpensePage + 1} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setNoExpensePage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={noExpensePage === totalPages - 1}
                className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
              >
                ›
              </button>
            </div>
          ) : null;
        })()}
      </div>

      {/* Edit Worker Dialog */}
      <Dialog
        open={editWorkerDialogOpen}
        onOpenChange={setEditWorkerDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("تعديل بيانات العاملة", "Edit Worker Data")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-worker-name">{tr("الاسم", "Name")}</Label>
              <Input
                id="edit-worker-name"
                value={editWorkerName}
                onChange={(e) => setEditWorkerName(e.target.value)}
                placeholder={tr("اسم العاملة", "Worker name")}
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
            <div className="space-y-2">
              <Label htmlFor="edit-worker-area">
                {tr("منطقة الإسناد", "Assigned Area")}
              </Label>
              <Input
                id="edit-worker-area"
                value={editWorkerArea}
                onChange={(e) => setEditWorkerArea(e.target.value)}
                placeholder={tr("مثال: REGULAR_1", "e.g., REGULAR_1")}
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

      {/* Edit Days Dialog */}
      <Dialog open={editDaysDialogOpen} onOpenChange={setEditDaysDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("تعديل الأيام المتبقية", "Edit Remaining Days")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-days-value">
                {tr("عدد الأيام", "Days")} ({tr("الحد الأقصى", "Max")}: 14)
              </Label>
              <Input
                id="edit-days-value"
                type="number"
                min="0"
                max="14"
                value={editDaysValue}
                onChange={(e) => setEditDaysValue(e.target.value)}
                placeholder={tr("أدخل عدد الأيام", "Enter days")}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                {tr(
                  "يمكن تعديل الأيام المتبقية من 0 إلى 14 يوم",
                  "You can set days from 0 to 14",
                )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDaysDialogOpen(false)}
              disabled={isSavingDays}
            >
              {tr("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleSaveDays} disabled={isSavingDays}>
              {isSavingDays
                ? tr("جاري الحفظ...", "Saving...")
                : tr("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Assigned Area Dialog */}
      <Dialog open={editAreaDialogOpen} onOpenChange={setEditAreaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("تعديل منطقة الإسناد", "Edit Assigned Area")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-area-value">
                {tr("منطقة الإسناد", "Assigned Area")}
              </Label>
              <Input
                id="edit-area-value"
                value={editAreaValue}
                onChange={(e) => setEditAreaValue(e.target.value)}
                placeholder={tr("مثال: REGULAR_1", "e.g., REGULAR_1")}
              />
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
            <Button onClick={handleSaveArea} disabled={isSavingArea}>
              {isSavingArea
                ? tr("جاري الحفظ...", "Saving...")
                : tr("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDeleteDialogOpen(true);
          } else {
            handleCloseDeleteDialog();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("تأكيد حذف المتقدمة", "Confirm applicant deletion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr(
                "سيتم حذف المتقدمة وجميع سجلاتها نهائيًا من القاعدة.",
                "This will permanently remove the applicant and all records.",
              )}
            </AlertDialogDescription>
            {deleteWorkerName && (
              <p className="font-semibold text-destructive">
                {deleteWorkerName}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingWorker}>
              {tr("إلغاء", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteWorker}
              disabled={isDeletingWorker}
            >
              {isDeletingWorker
                ? tr("جاري الحذف...", "Deleting...")
                : tr("حذف نهائي", "Delete permanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
