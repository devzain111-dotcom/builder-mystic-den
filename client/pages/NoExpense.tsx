import { Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import BackButton from "@/components/BackButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isNoExpensePolicyLocked, noExpenseDaysLeft } from "@/lib/utils";

export default function NoExpense() {
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
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const [noExpensePage, setNoExpensePage] = useState(0);
  const { tr, t } = useI18n();
  const listAll = Object.values(workers)
    .filter((w) => w.plan === "no_expense")
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const list = listAll.filter(
    (w) =>
      (!selectedBranchId || w.branchId === selectedBranchId) &&
      (!query || w.name.toLowerCase().includes(query.toLowerCase())),
  );

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
            <Select
              value={selectedBranchId ?? undefined}
              onValueChange={(v) => setSelectedBranchId(v)}
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

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50">
            <tr className="text-sm">
              <th className="p-3">{tr("الاسم", "Name")}</th>
              <th className="p-3">{tr("تاريخ الوصول", "Arrival Date")}</th>
              <th className="p-3">{tr("الفرع", "Branch")}</th>
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
                      colSpan={5}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {tr("لا يوجد عناصر.", "No items.")}
                    </td>
                  </tr>
                );
              }

              return pageList.map((w) => (
                <tr key={w.id} className="hover:bg-secondary/40">
                  <td className="p-3 font-medium">{w.name}</td>
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
                    {(() => {
                      const hasDocs = !!(w.docs?.or || w.docs?.passport);
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
                          <span className="text-amber-700">
                            {tr("متبقي", "Left")}: {Math.max(0, daysLeft)}{" "}
                            {tr("يوم", "days")}
                          </span>
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
                            {tr("مقفول", "Locked")}
                          </span>
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
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-3 text-sm">
                    <Link
                      to={`/workers/${w.id}`}
                      className="text-primary hover:underline"
                    >
                      {tr("تفاصيل", "Details")}
                    </Link>
                  </td>
                </tr>
              ));
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
    </main>
  );
}
