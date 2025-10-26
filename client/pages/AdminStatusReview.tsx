import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";

const MAIN_SYSTEM_STATUSES = [
  "deployed",
  "unfit",
  "backout",
  "selected",
  "repat",
  "rtw",
  "passporting",
  "for_deployment",
  "oce_released",
  "visa_stamp",
  "cancelled",
  "for_contract_sig",
];

const STATUS_LABELS: Record<string, string> = {
  deployed: "deployed",
  unfit: "unfit",
  backout: "backout",
  selected: "selected",
  repat: "repat",
  rtw: "rtw",
  passporting: "passporting",
  for_deployment: "for_deployment",
  oce_released: "oce_released",
  visa_stamp: "visa_stamp",
  cancelled: "cancelled",
  for_contract_sig: "for_contract_sig",
};

export default function AdminStatusReview() {
  const { tr, locale } = useI18n();
  const navigate = useNavigate();
  const { workers, updateWorkerStatuses, selectedBranchId } = useWorkers();

  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [housingStatuses, setHousingStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (localStorage.getItem("adminAuth") !== "1") {
      navigate("/admin-login", { replace: true });
    }
  }, [navigate]);

  const workerList = useMemo(() => {
    const list = Object.values(workers)
      .filter((w) => !selectedBranchId || w.branchId === selectedBranchId)
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    if (!query) return list;
    return list.filter((w) =>
      w.name.toLowerCase().includes(query.toLowerCase())
    );
  }, [workers, selectedBranchId, query]);

  const handleStatusUpdate = async (
    workerId: string,
    housingStatus: string,
    mainStatus: string
  ) => {
    setUpdatingId(workerId);
    try {
      updateWorkerStatuses(workerId, housingStatus, mainStatus as any);
      toast.success(tr("تم تحديث الحالة بنجاح", "Status updated successfully"));
    } catch (error) {
      toast.error(tr("فشل تحديث الحالة", "Failed to update status"));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold">
            {tr("مراجعة الحالات", "Status Review")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {tr(
              "عرض وتعديل حالات العاملات المسجلات.",
              "View and edit registered applicants statuses."
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-48 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder={tr("ابحث بالاسم", "Search by name")}
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <button
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            onClick={() => setQuery(qDraft)}
            type="button"
          >
            {tr("بحث", "Search")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="p-3 font-semibold">
                  {tr("الاسم", "Name")}
                </th>
                <th className="p-3 font-semibold">
                  {tr("الحالة في نظام السكن", "Housing System Status")}
                </th>
                <th className="p-3 font-semibold">
                  {tr("الحالة في النظام الرئيسي", "Main System Status")}
                </th>
                <th className="p-3 font-semibold">
                  {tr("الإجراء", "Action")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {workerList.map((worker) => (
                <tr key={worker.id} className="hover:bg-secondary/40">
                  <td className="p-3 font-medium">{worker.name}</td>
                  <td className="p-3">
                    <input
                      type="text"
                      value={(housingStatuses[worker.id] ?? worker.housingSystemStatus) || ""}
                      onChange={(e) => {
                        setHousingStatuses((prev) => ({
                          ...prev,
                          [worker.id]: e.target.value,
                        }));
                      }}
                      placeholder={tr(
                        "ادخل الحالة...",
                        "Enter status..."
                      )}
                      className="w-full rounded border bg-background px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <Select
                      value={worker.mainSystemStatus || ""}
                      onValueChange={(value) => {
                        handleStatusUpdate(
                          worker.id,
                          (housingStatuses[worker.id] ?? worker.housingSystemStatus) || "",
                          value
                        );
                      }}
                      disabled={updatingId === worker.id}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={tr(
                            "اختر الحالة",
                            "Select status"
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {MAIN_SYSTEM_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {STATUS_LABELS[status] || status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updatingId === worker.id}
                      onClick={() => {
                        const housingValue =
                          (housingStatuses[worker.id] ?? worker.housingSystemStatus) || "";
                        handleStatusUpdate(
                          worker.id,
                          housingValue,
                          worker.mainSystemStatus || ""
                        );
                      }}
                    >
                      {updatingId === worker.id
                        ? tr("جاري...", "Saving...")
                        : tr("حفظ", "Save")}
                    </Button>
                  </td>
                </tr>
              ))}
              {workerList.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {tr(
                      "لا توجد عاملات مسجلات.",
                      "No registered applicants."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold mb-2">
          {tr("ملاحظات:", "Notes:")}
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            {tr(
              "الحالة في نظام السكن: حالة العاملة في نظام الإسكان",
              "Housing System Status: The applicant's status in the housing system"
            )}
          </li>
          <li>
            {tr(
              "الحالة في النظام الرئيسي: الحالة المرتبطة بإجراءات التوظيف الرئيسية",
              "Main System Status: Status related to main employment procedures"
            )}
          </li>
          <li>
            {tr(
              "يتم تحديث الحالات تلقائياً عند تغيير القيم",
              "Statuses are updated automatically when values change"
            )}
          </li>
        </ul>
      </div>
    </main>
  );
}
