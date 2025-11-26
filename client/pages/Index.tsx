import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, UsersRound, Download, Lock, RefreshCw } from "lucide-react";
import DeviceFeed from "@/components/DeviceFeed";
import FaceVerifyCard from "@/components/FaceVerifyCard";
import AddWorkerDialog, {
  AddWorkerPayload,
} from "@/components/AddWorkerDialog";
import ExcelJS from "exceljs";
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
import { SPECIAL_REQ_GRACE_MS } from "@/context/WorkersContext";
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

function timeLeft(ms: number, locale: "ar" | "en") {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hAbbr = locale === "ar" ? "س" : "h";
  const mAbbr = locale === "ar" ? "د" : "m";
  return `${h}${hAbbr} ${m}${mAbbr}`;
}

// Face verification and applicant management dashboard
export default function Index() {
  const {
    workers,
    branches,
    selectedBranchId,
    setSelectedBranchId,
    specialRequests,
    addWorker,
    resolveWorkerRequest,
    refreshWorkers,
  } = useWorkers() as any;
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  const { t, tr, locale } = useI18n();
  const [identifying, setIdentifying] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const [addWorkerDefaultName, setAddWorkerDefaultName] = useState("");
  const [addWorkerSpecialRequestId, setAddWorkerSpecialRequestId] = useState<
    string | undefined
  >(undefined);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [paymentFor, setPaymentFor] = useState<{
    id?: string;
    workerId: string;
    workerName?: string;
    current: number;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("75");
  const [verifiedPage, setVerifiedPage] = useState(0);

  const currentVerificationAmount = useMemo(() => {
    if (!selectedBranchId || !branches[selectedBranchId]) return 75;
    return branches[selectedBranchId].verificationAmount || 75;
  }, [selectedBranchId, branches]);

  const verifiedList = useMemo(
    () =>
      Object.values(workers)
        .filter(
          (w: any) =>
            (!selectedBranchId || w.branchId === selectedBranchId) &&
            w.verifications.length > 0,
        )
        .sort(
          (a: any, b: any) =>
            (b.verifications[0]?.verifiedAt ?? 0) -
            (a.verifications[0]?.verifiedAt ?? 0),
        ),
    [workers, selectedBranchId],
  );

  const now = Date.now();
  const applicantsNeedingData = useMemo(
    () =>
      specialRequests
        .filter((r: any) => {
          if (r.type !== "worker") return false;
          const worker = r.workerId ? workers[r.workerId] : undefined;
          const b = worker?.branchId || r.branchId || null;
          return selectedBranchId ? b === selectedBranchId : true;
        })
        .filter(
          (r: any) => !!r.unregistered || !r.workerId || !workers[r.workerId!],
        )
        .map((r: any) => ({
          id: r.id,
          name:
            r.workerName ||
            (r.workerId ? workers[r.workerId]?.name : "") ||
            "اسم غير محدد",
          createdAt: r.createdAt,
          amount: r.amount,
          left: r.createdAt + SPECIAL_REQ_GRACE_MS - now,
        }))
        .sort((a: any, b: any) => a.left - b.left),
    [specialRequests, workers, selectedBranchId, now],
  );

  async function handleChangePassword() {
    if (!newPassword) {
      toast.error(tr("أدخل كلمة المرور الجديدة", "Enter new password"));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast.error(tr("كلمات المرور غير متطابقة", "Passwords do not match"));
      return;
    }
    if (!selectedBranchId) {
      toast.error(tr("لم يتم تحديد فرع", "No branch selected"));
      return;
    }

    setPasswordLoading(true);
    try {
      const r = await fetch("/api/branches/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedBranchId,
          oldPassword,
          newPassword,
        }),
      });
      const j = await r.json().catch(() => ({}) as any);

      if (!r.ok || !j?.ok) {
        toast.error(
          j?.message === "wrong_password"
            ? tr("كلمة المرور القديمة غير صح��حة", "Old password is incorrect")
            : j?.message ||
                tr("��شل تحديث كلمة المرور", "Failed to update password"),
        );
        setPasswordLoading(false);
        return;
      }

      toast.success(
        tr("تم تحديث كلمة المرور بنجاح", "Password updated successfully"),
      );
      setChangePasswordOpen(false);
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");

      localStorage.removeItem("hv_selected_branch");
      setSelectedBranchId(null);
      navigate("/");
    } catch (e: any) {
      toast.error(e?.message || tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setPasswordLoading(false);
    }
  }

  function handleDownloadDaily() {
    const now = new Date();
    const today =
      String(now.getFullYear()).padStart(4, "0") +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const fileName = "report-" + today + ".xlsx";

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Report");

    // Headers
    const headers = ["Name", "Branch", "Arrival Date", "Verifications"];
    const headerRow = ws.addRow(headers);
    headerRow.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 12,
      name: "Calibri",
    };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF10B981" },
    }; // Green
    headerRow.alignment = {
      horizontal: "center",
      vertical: "center",
      wrapText: true,
    };
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });

    // Data rows
    verifiedList.forEach((w: any, idx: number) => {
      const isAlt = idx % 2 === 0;
      const dataRow = ws.addRow([
        w.name || "",
        branches[w.branchId]?.name || "",
        new Date(w.arrivalDate || 0).toLocaleDateString("en-US"),
        w.verifications?.length || 0,
      ]);

      dataRow.font = { color: { argb: "FF374151" }, size: 11, name: "Calibri" };
      dataRow.fill = isAlt
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } } // Light green
        : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      dataRow.alignment = { horizontal: "left", vertical: "center" };
      dataRow.height = 20;

      dataRow.eachCell((cell, colNum) => {
        cell.border = {
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        };

        if (colNum === 3) {
          cell.alignment = { horizontal: "center", vertical: "center" };
        } else if (colNum === 4) {
          cell.alignment = { horizontal: "right", vertical: "center" };
        }
      });
    });

    // Total row
    const totalVerifications = verifiedList.reduce(
      (sum, w: any) => sum + (w.verifications?.length || 0),
      0,
    );
    const totalRow = ws.addRow(["TOTAL", "", "", totalVerifications]);
    totalRow.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 12,
      name: "Calibri",
    };
    totalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    }; // Dark gray
    totalRow.alignment = { horizontal: "left", vertical: "center" };
    totalRow.height = 22;
    totalRow.eachCell((cell, colNum) => {
      cell.border = {
        left: { style: "medium" },
        right: { style: "medium" },
        top: { style: "medium" },
        bottom: { style: "medium" },
      };
      if (colNum === 4) {
        cell.alignment = { horizontal: "right", vertical: "center" };
      }
    });

    // Set column widths
    ws.columns = [
      { width: 20 }, // Name
      { width: 18 }, // Branch
      { width: 18 }, // Arrival Date
      { width: 15 }, // Verifications
    ];

    ws.pageSetup = { paperSize: 9, orientation: "landscape" };
    ws.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };

    // Enable autofilter (only if there is data)
    if (verifiedList.length > 0) {
      ws.autoFilter = { from: "A1", to: `D${verifiedList.length + 1}` };
    }

    // Download
    wb.xlsx
      .writeBuffer()
      .then((buffer: any) => {
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(() => {
        // Error handling
      });
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        {/* Header section */}
        <div className="mb-8 space-y-2 md:mb-12">
          <h1 className="text-3xl font-bold text-blue-700 md:text-4xl lg:text-5xl">
            {t("page_title")}
          </h1>
          <p className="text-sm md:text-base lg:text-lg text-black">
            {t("page_subtitle")}
          </p>
        </div>

        {/* Top controls */}
        <div className="mb-8 flex flex-col gap-4 md:mb-10 md:gap-6">
          <div className="flex flex-wrap items-center gap-3 md:gap-4">
            <span className="text-sm md:text-base text-muted-foreground">
              {tr("الفرع:", "Branch:")}
            </span>
            <Select
              value={selectedBranchId ?? undefined}
              onValueChange={async (v) => {
                if (v === selectedBranchId) return;
                const pass =
                  window.prompt(
                    tr(
                      "أدخل كلمة مرور الف����ع للتبديل:",
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
                        : j?.message || "تعذر ��لت��قق",
                    );
                    return;
                  }
                  setSelectedBranchId(v);
                } catch {
                  toast.error(tr("تعذر ال��ح��ق", "Verification failed"));
                }
              }}
            >
              <SelectTrigger className="w-40 md:w-48 h-10 md:h-11 text-base md:text-lg">
                <SelectValue placeholder={tr("اختر الفرع", "Select branch")} />
              </SelectTrigger>
              <SelectContent>
                {Object.values(branches).map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
            <button
              onClick={() => setNotificationsOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-500 px-4 py-2 md:px-5 md:py-3 text-sm md:text-base font-semibold text-white hover:bg-orange-600 whitespace-nowrap"
            >
              <span className="inline-flex h-6 w-6 md:h-7 md:w-7 items-center justify-center rounded-full bg-white text-orange-500 text-xs md:text-sm font-bold flex-shrink-0">
                {applicantsNeedingData.length}
              </span>
              <span>{tr("الإشعارات", "Notifications")}</span>
            </button>
            <div className="w-full">
              <AddWorkerDialog
                onAdd={(payload: AddWorkerPayload) => {
                  // Handle add worker
                }}
                open={addWorkerOpen}
                onOpenChange={(v) => {
                  setAddWorkerOpen(v);
                  if (!v) setAddWorkerSpecialRequestId(undefined);
                }}
                defaultName={addWorkerDefaultName}
                specialRequestId={addWorkerSpecialRequestId}
              />
            </div>
            <Button
              variant="secondary"
              className="gap-2 justify-center w-full"
              asChild
            >
              <Link to="/workers">
                <UsersRound className="h-4 w-4 flex-shrink-0" />
                <span className="font-bold">
                  {tr("المتقدمات", "Applicants")}
                </span>
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-center" asChild>
              <Link to="/no-expense">
                {tr("إقامة بدون مصروف", "Residency without allowance")}
              </Link>
            </Button>
            <Button variant="admin" className="w-full justify-center" asChild>
              <Link to="/admin-login">{tr("الإدارة", "Admin")}</Link>
            </Button>
            <Button
              variant="secondary"
              onClick={() => setChangePasswordOpen(true)}
              className="gap-2 justify-center w-full"
            >
              <Lock className="h-4 w-4 flex-shrink-0" />
              <span>{tr("تغيير كلمة المرو��", "Change Password")}</span>
            </Button>
            <div className="w-full">
              <SpecialRequestDialog />
            </div>
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid gap-6 md:gap-8 lg:grid-cols-12">
          {/* Left column - Face Verify Card */}
          <div className="lg:col-span-7">
            <FaceVerifyCard
              onIdentifying={setIdentifying}
              onVerified={(data: any) => {
                if (data.workerId) {
                  setPaymentFor({
                    id: undefined,
                    workerId: data.workerId,
                    workerName: data.workerName,
                    current: 0,
                  });
                  setPaymentOpen(true);
                }
              }}
            />
          </div>

          {/* Right column - Verified list */}
          <div className="lg:col-span-5 space-y-4 md:space-y-6">
            {/* Verified card */}
            <div className="rounded-lg border bg-card shadow-sm">
              <div className="border-b px-6 md:px-8 py-4 md:py-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 md:h-6 md:w-6 text-green-500" />
                    <h2 className="text-lg md:text-xl lg:text-2xl font-semibold">
                      {tr("��م ا����ت��قق", "Verified")} ({verifiedList.length})
                    </h2>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 text-xs md:text-sm"
                    asChild
                  >
                    <Link to="/download-report">
                      <Download className="h-4 w-4" />
                      {tr("تحميل", "Download")}
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Verified list */}
              {verifiedList.length === 0 ? (
                <div className="px-6 md:px-8 py-8 md:py-12 text-center text-sm md:text-base text-muted-foreground">
                  {tr("لا توجد تحققات", "No verifications")}
                </div>
              ) : (
                <>
                  <div className="max-h-96 md:max-h-[500px] overflow-y-auto">
                    <ul className="space-y-0">
                      {(() => {
                        const itemsPerFirstPage = 10;
                        const itemsPerOtherPage = 15;
                        const totalPages = Math.ceil(
                          (verifiedList.length - itemsPerFirstPage) /
                            itemsPerOtherPage +
                            1,
                        );
                        const isFirstPage = verifiedPage === 0;
                        const itemsPerPage = isFirstPage
                          ? itemsPerFirstPage
                          : itemsPerOtherPage;
                        let startIndex = 0;
                        if (isFirstPage) {
                          startIndex = 0;
                        } else {
                          startIndex =
                            itemsPerFirstPage +
                            (verifiedPage - 1) * itemsPerOtherPage;
                        }
                        const endIndex = startIndex + itemsPerPage;
                        const pageItems = verifiedList.slice(
                          startIndex,
                          endIndex,
                        );

                        return pageItems.map((worker: any, index: number) => {
                          const absoluteIndex = startIndex + index + 1;
                          return (
                            <li
                              key={worker.id}
                              className="border-t px-6 md:px-8 py-4 md:py-6 hover:bg-accent transition-colors"
                            >
                              <div className="space-y-2 md:space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-3">
                                    <span className="inline-flex items-center justify-center min-w-6 h-6 rounded-full bg-primary/10 text-primary font-semibold text-xs md:text-sm">
                                      {absoluteIndex}
                                    </span>
                                    <span className="font-medium text-sm md:text-base">
                                      {worker.name}
                                    </span>
                                  </div>
                                  <span className="text-xs md:text-sm text-muted-foreground whitespace-nowrap">
                                    {new Date(
                                      worker.verifications[0]?.verifiedAt || 0,
                                    ).toLocaleString("en-US", {
                                      month: "2-digit",
                                      day: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    })}
                                  </span>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  {worker.verifications?.length > 0 && (
                                    <span className="inline-flex items-center rounded-full bg-green-50 px-2 md:px-3 py-1 md:py-2 text-xs md:text-sm font-medium text-green-700">
                                      ✓ {worker.verifications.length}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        });
                      })()}
                    </ul>
                  </div>

                  {(() => {
                    const itemsPerFirstPage = 10;
                    const itemsPerOtherPage = 15;
                    const totalPages = Math.ceil(
                      (verifiedList.length - itemsPerFirstPage) /
                        itemsPerOtherPage +
                        1,
                    );
                    return totalPages > 1 ? (
                      <div className="border-t px-6 md:px-8 py-3 md:py-4 flex items-center justify-between gap-2 text-xs md:text-sm">
                        <button
                          onClick={() =>
                            setVerifiedPage((p) => Math.max(0, p - 1))
                          }
                          disabled={verifiedPage === 0}
                          className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
                        >
                          ‹
                        </button>
                        <span className="text-xs md:text-sm">
                          {verifiedPage + 1} / {totalPages}
                        </span>
                        <button
                          onClick={() =>
                            setVerifiedPage((p) =>
                              Math.min(totalPages - 1, p + 1),
                            )
                          }
                          disabled={verifiedPage === totalPages - 1}
                          className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
                        >
                          ›
                        </button>
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Notifications Modal */}
        <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <DialogContent className="max-w-sm sm:max-w-lg md:max-w-2xl w-[95vw] sm:w-auto">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg md:text-xl">
                {tr(
                  "متقدمات يجب إدخال بيان��تهن",
                  "Applicants needing data entry",
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] sm:max-h-96 md:max-h-[500px] overflow-y-auto">
              {applicantsNeedingData.length === 0 ? (
                <div className="px-3 sm:px-4 py-6 sm:py-8 md:py-12 text-center text-xs sm:text-sm md:text-base text-muted-foreground">
                  {tr("لا توجد إشعارات", "No notifications")}
                </div>
              ) : (
                <div className="space-y-2 sm:space-y-3 md:space-y-4">
                  {applicantsNeedingData.map((item: any) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-amber-300 bg-amber-50 p-3 sm:p-4 md:p-6"
                    >
                      <div className="flex flex-col gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-xs sm:text-sm md:text-base mb-2">
                            {item.name}
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-xs md:text-sm text-muted-foreground">
                            <span>
                              {tr("المبلغ:", "Amount:")} ₱{item.amount}
                            </span>
                            <span className="hidden sm:inline">•</span>
                            <span>
                              {tr("منذ", "Since")}{" "}
                              {new Date(item.createdAt).toLocaleString(
                                "en-US",
                                {
                                  month: "2-digit",
                                  day: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                },
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 justify-end">
                          <span
                            className={`rounded-full px-2 sm:px-3 md:px-4 py-1 md:py-2 text-xs md:text-sm font-semibold whitespace-nowrap text-center ${
                              item.left <= 0
                                ? "bg-red-600 text-white"
                                : "bg-amber-200 text-amber-900"
                            }`}
                          >
                            {item.left <= 0
                              ? tr("م��ظورة", "Locked")
                              : `${tr("متبق", "Remaining")} ${timeLeft(
                                  item.left,
                                  locale,
                                )}`}
                          </span>
                          <button
                            onClick={() => {
                              setAddWorkerDefaultName(item.name);
                              setAddWorkerSpecialRequestId(item.id);
                              setAddWorkerOpen(true);
                            }}
                            className="px-2 sm:px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm bg-blue-500 text-white rounded hover:bg-blue-600 font-medium whitespace-nowrap"
                          >
                            {tr("أدخل", "Enter")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Payment Dialog */}
        <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-lg md:text-xl">
                {tr("تأكيد الدفع", "Confirm Payment")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 md:space-y-6">
              <div>
                <label className="block text-sm md:text-base font-medium mb-2">
                  {tr("اسم المتقدمة", "Applicant Name")}
                </label>
                <div className="p-3 md:p-4 rounded-md border bg-muted/50 text-base md:text-lg font-medium">
                  {paymentFor?.workerName || "—"}
                </div>
              </div>
              <div>
                <label className="block text-sm md:text-base font-medium mb-2">
                  {tr("المبلغ (ثابت)", "Amount (Fixed)")}
                </label>
                <div className="p-3 md:p-4 rounded-md border bg-muted/50 text-base md:text-lg font-medium">
                  ₱ {currentVerificationAmount}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-3 md:gap-4">
              <Button
                variant="outline"
                onClick={() => {
                  setPaymentOpen(false);
                  setPaymentFor(null);
                }}
              >
                {tr("إلغاء", "Cancel")}
              </Button>
              <Button
                onClick={async () => {
                  if (!paymentFor) return;
                  try {
                    const res = await fetch("/api/verification/payment", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        workerId: paymentFor.workerId,
                        amount: currentVerificationAmount,
                      }),
                    });
                    const json = await res.json();
                    if (res.ok && json?.ok) {
                      toast.success(
                        tr(
                          `تم إضافة ${currentVerificationAmount} بيسو`,
                          `Added ₱${currentVerificationAmount}`,
                        ),
                      );
                      setPaymentOpen(false);
                      setPaymentFor(null);
                      setPaymentAmount(String(currentVerificationAmount));
                    } else {
                      toast.error(tr("فشل الدفع", "Payment failed"));
                    }
                  } catch (err) {
                    toast.error(tr("فشل الدفع", "Payment failed"));
                  }
                }}
              >
                {tr("تأكيد", "Confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Change Password Dialog */}
        <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-lg md:text-xl">
                {tr("تغيير كلمة المرور", "Change Password")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 md:space-y-6">
              <div>
                <label className="block text-sm md:text-base font-medium mb-2">
                  {tr("كلمة المرور القديمة", "Old Password")}
                </label>
                <Input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder={tr(
                    "أدخل كلم�� المرور القديمة",
                    "Enter old password",
                  )}
                  disabled={passwordLoading}
                  className="h-10 md:h-11 text-base md:text-lg"
                />
              </div>
              <div>
                <label className="block text-sm md:text-base font-medium mb-2">
                  {tr("كلمة المرور الجديدة", "New Password")}
                </label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={tr(
                    "أدخل كلمة المرور الجديدة",
                    "Enter new password",
                  )}
                  disabled={passwordLoading}
                  className="h-10 md:h-11 text-base md:text-lg"
                />
              </div>
              <div>
                <label className="block text-sm md:text-base font-medium mb-2">
                  {tr("تأكيد كلمة المرور", "Confirm Password")}
                </label>
                <Input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder={tr(
                    "أعد إدخال كلمة المرور الجديدة",
                    "Re-enter new password",
                  )}
                  disabled={passwordLoading}
                  className="h-10 md:h-11 text-base md:text-lg"
                />
              </div>
            </div>
            <DialogFooter className="gap-3 md:gap-4">
              <Button
                variant="outline"
                onClick={() => setChangePasswordOpen(false)}
                disabled={passwordLoading}
              >
                {tr("إلغا��", "Cancel")}
              </Button>
              <Button onClick={handleChangePassword} disabled={passwordLoading}>
                {passwordLoading
                  ? tr("جاري...", "Processing...")
                  : tr("حفظ", "Save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </main>
  );
}
