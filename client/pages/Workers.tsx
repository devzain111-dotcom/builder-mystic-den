import { Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";

export default function Workers() {
  const { branches, workers, selectedBranchId, setSelectedBranchId } =
    useWorkers();
  const branchOptions = selectedBranchId
    ? Object.values(branches).filter((b) => b.id === selectedBranchId)
    : Object.values(branches);
  const { tr, locale } = useI18n();
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const [workersPage, setWorkersPage] = useState(0);
  const listAll = Object.values(workers).sort((a, b) =>
    a.name.localeCompare(b.name, "ar"),
  );
  const list = listAll.filter((w) => {
    const hasDocuments = !!(w.docs?.or || w.docs?.passport);
    const passes = (
      w.plan !== "no_expense" &&
      hasDocuments &&
      (!selectedBranchId || w.branchId === selectedBranchId) &&
      (!query || w.name.toLowerCase().includes(query.toLowerCase()))
    );
    if (!passes && listAll.length > 0 && listAll.indexOf(w) === 0) {
      console.log("[Workers] Filter debug for first worker:", {
        name: w.name,
        plan: w.plan,
        hasDocuments,
        branchId: w.branchId,
        selectedBranchId,
        branchMatch: !selectedBranchId || w.branchId === selectedBranchId,
      });
    }
    return passes;
  });
  const totalLastPayments = list.reduce(
    (sum, w) =>
      sum + (w.verifications.find((v) => v.payment)?.payment?.amount ?? 0),
    0,
  );

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
                {tr("تاريخ الخروج", "Exit Date")}
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
                        "لا توجد متقدمات في هذ�� الفرع.",
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
                const complete = !!(w.docs?.or || w.docs?.passport);
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
                                  {tr("قيد ا��تظار الإدارة", "Pending admin")}
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
                    <td className="p-2 md:p-3 text-xs md:text-sm text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                      {w.exitDate
                        ? new Date(w.exitDate).toLocaleDateString("en-US", {
                            month: "2-digit",
                            day: "2-digit",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm hidden lg:table-cell whitespace-nowrap">
                      {w.verifications.length}
                    </td>
                    <td className="p-2 md:p-3 text-xs md:text-sm">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${complete ? "bg-emerald-600/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}
                      >
                        {tr(
                          complete ? "��كتمل" : "غير مكتمل",
                          complete ? "Complete" : "Incomplete",
                        )}
                      </span>
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
    </main>
  );
}
