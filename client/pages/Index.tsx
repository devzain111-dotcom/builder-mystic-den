import { useState, useMemo } from "react";
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

export default function Index() {
  const { workers, branches, selectedBranchId, setSelectedBranchId, specialRequests } =
    useWorkers() as any;
  const navigate = useNavigate();
  const { t, tr, locale } = useI18n();
  const [identifying, setIdentifying] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [paymentFor, setPaymentFor] = useState<{
    id?: string;
    workerId: string;
    current: number;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("40");

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
      toast.error(tr("لم يتم تحديد ��رع", "No branch selected"));
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
            ? tr("كلمة المرور القديمة غير صحيحة", "Old password is incorrect")
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
    const fileName = "تقرير-" + today + ".xlsx";
    const dataForExport = verifiedList
      .map((w: any) => ({
        الاسم: w.name || "",
        الفرع: branches[w.branchId]?.name || "",
        "تاريخ الوصول": new Date(w.arrivalDate || 0).toLocaleDateString("ar"),
        التحقق: w.verifications?.length || 0,
      }))
      .concat({
        الاسم: "المجموع",
        الفرع: "",
        "تاريخ الوصول": "",
        التحقق: verifiedList.reduce(
          (sum, w: any) => sum + (w.verifications?.length || 0),
          0,
        ),
      });
    const ws = XLSX.utils.json_to_sheet(dataForExport, {
      header: ["الاسم", "الفرع", "تاريخ الوصول", "التحقق"],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير");
    XLSX.writeFile(wb, fileName);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        {/* Header section */}
        <div className="mb-8 space-y-2">
          <h1 className="text-4xl font-bold text-foreground">
            {t("page_title")}
          </h1>
          <p className="text-muted-foreground">{t("page_subtitle")}</p>
        </div>

        {/* Top controls */}
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
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
                {Object.values(branches).map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AddWorkerDialog
              onAdd={(payload: AddWorkerPayload) => {
                // Handle add worker
              }}
            />
            <Button variant="secondary" className="gap-2" asChild>
              <Link to="/workers">
                <UsersRound className="h-4 w-4" />
                {tr("المتقدمات", "Applicants")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/no-expense">
                {tr("إقامة بدون مصروف", "Residency without allowance")}
              </Link>
            </Button>
            <Button variant="admin" asChild>
              <Link to="/admin-login">{tr("الإدارة", "Admin")}</Link>
            </Button>
            <Button
              variant="secondary"
              onClick={() => setChangePasswordOpen(true)}
              className="gap-2"
            >
              <Lock className="h-4 w-4" />
              {tr("تغيير كلمة المرور", "Change Password")}
            </Button>
            <SpecialRequestDialog />
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left column - Face Verify Card */}
          <div className="lg:col-span-7">
            <FaceVerifyCard
              onIdentifying={setIdentifying}
              onVerified={() => {
                // Reload verification list
              }}
            />
          </div>

          {/* Right column - Verified list */}
          <div className="lg:col-span-5 space-y-4">
            {/* Verified card */}
            <div className="rounded-lg border bg-card shadow-sm">
              <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <h2 className="text-lg font-semibold">
                      {tr("تم التحقق", "Verified")} ({verifiedList.length})
                    </h2>
                  </div>
                  <Button size="sm" variant="outline" className="gap-2" asChild>
                    <Link to="/download-report">
                      <Download className="h-4 w-4" />
                      {tr("تحميل", "Download")}
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Verified list */}
              <div className="max-h-96 overflow-y-auto">
                {verifiedList.length === 0 ? (
                  <div className="px-6 py-8 text-center text-muted-foreground">
                    {tr("لا توجد تحققات", "No verifications")}
                  </div>
                ) : (
                  <ul className="space-y-0">
                    {verifiedList.map((worker: any) => (
                      <li
                        key={worker.id}
                        className="border-t px-6 py-4 hover:bg-accent transition-colors"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{worker.name}</span>
                            <span className="text-sm text-muted-foreground">
                              {new Date(
                                worker.verifications[0]?.verifiedAt || 0,
                              ).toLocaleDateString("ar-EG", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {worker.verifications?.length > 0 && (
                              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                                ✓ {worker.verifications.length}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Dialog */}
        <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {tr("تغيير كلمة المرور", "Change Password")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {tr("كلمة المرور القديمة", "Old Password")}
                </label>
                <Input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder={tr(
                    "أدخل كلمة ا��مرور القديمة",
                    "Enter old password",
                  )}
                  disabled={passwordLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
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
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {tr("تأكيد كلمة المرور", "Confirm Password")}
                </label>
                <Input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder={tr(
                    "أعد إدخال كلمة المر��ر الجديدة",
                    "Re-enter new password",
                  )}
                  disabled={passwordLoading}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setChangePasswordOpen(false)}
                disabled={passwordLoading}
              >
                {tr("إلغاء", "Cancel")}
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
