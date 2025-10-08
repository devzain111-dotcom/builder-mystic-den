import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BackButton from "@/components/BackButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/context/I18nContext";

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const normalizeDigits = (s: string) =>
  s
    .replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(persianDigits.indexOf(d)));
const parseDateText = (t: string): number | null => {
  const s = normalizeDigits(t).trim();
  if (!s) return null;
  const m = s.match(/(\d{1,4})\D(\d{1,2})\D(\d{2,4})/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const y = a > 31 ? a : c;
    const d = a > 31 ? c : a;
    const mo = b;
    const Y = y < 100 ? y + 2000 : y;
    const ts = new Date(Y, mo - 1, d, 0, 0, 0, 0).getTime();
    if (!isNaN(ts)) return ts;
  }
  const d2 = new Date(s);
  if (!isNaN(d2.getTime()))
    return new Date(
      d2.getFullYear(),
      d2.getMonth(),
      d2.getDate(),
      0,
      0,
      0,
      0,
    ).getTime();
  return null;
};

function BranchDialog() {
  const { tr } = useI18n();
  const { branches, setSelectedBranchId, createBranch } = useWorkers() as any;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  async function save() {
    const n = name.trim();
    if (!n) return;
    let b = null;
    if (createBranch) b = await createBranch(n, password);
    if (!b) {
      try {
        const r = await fetch("/api/branches/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: n, password }),
        });
        const j = await r.json();
        if (r.ok && j?.ok) b = j.branch;
      } catch {}
    }
    if (b?.id) {
      setSelectedBranchId(b.id);
      setOpen(false);
      setName("");
      setPassword("");
    } else {
      try {
        const { toast } = await import("sonner");
        toast.error(
          tr("تعذر حفظ الفرع في القاعدة", "Failed to save branch in database"),
        );
      } catch {}
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{tr("الفروع", "Branches")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("إضافة فرع جديد", "Add new branch")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-sm mb-1">{tr("الاسم", "Name")}</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("مثال: الفرع 2", "e.g., Branch 2")}
            />
          </div>
          <div>
            <div className="text-sm mb-1">{tr("كلمة المرور", "Password")}</div>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {tr(
              "سيُضاف الفرع في قاعدة البيانات وسيظهر في قائمة الفروع.",
              "The branch will be added to the database and appear in the branches list.",
            )}
          </div>
          <div className="text-sm">
            {tr("الفروع الحالية:", "Current branches:")}{" "}
            {Object.values(branches)
              .map((b: any) => b.name)
              .join("، ") || "—"}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tr("إلغاء", "Cancel")}
          </Button>
          <Button onClick={save}>{tr("حفظ", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminReport() {
  const { tr, locale } = useI18n();
  const navigate = useNavigate();
  const {
    branches,
    workers,
    specialRequests,
    decideUnlock,
    selectedBranchId,
    setSelectedBranchId,
  } = useWorkers() as any;
  const [branchId, setBranchId] = useState<string | undefined>(
    selectedBranchId ?? Object.keys(branches)[0],
  );
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const [branchRate, setBranchRate] = useState<number | "">(300);
  useEffect(() => {
    setBranchRate(300);
  }, [branchId]);
  useEffect(() => {
    if (localStorage.getItem("adminAuth") !== "1")
      navigate("/admin-login", { replace: true });
  }, [navigate]);
  const fromTs = useMemo(() => parseDateText(fromText), [fromText]);
  const toTs = useMemo(() => {
    const t = parseDateText(toText);
    return t != null ? t + 24 * 60 * 60 * 1000 - 1 : null;
  }, [toText]);

  const branchWorkers = useMemo(() => {
    const list = Object.values(workers).filter(
      (w) =>
        (!branchId || w.branchId === branchId) && w.verifications.length > 0,
    );
    const rows = list.flatMap((w) =>
      w.verifications.map((v) => ({
        workerId: w.id,
        name: w.name,
        arrivalDate: w.arrivalDate,
        verifiedAt: v.verifiedAt,
        payment: v.payment?.amount ?? null,
      })),
    );
    const filtered = rows.filter((r) => {
      if (query && !r.name.toLowerCase().includes(query.toLowerCase()))
        return false;
      if (fromTs != null && r.verifiedAt < fromTs) return false;
      if (toTs != null && r.verifiedAt > toTs) return false;
      return true;
    });
    filtered.sort((a, b) => b.verifiedAt - a.verifiedAt);
    return filtered;
  }, [workers, branchId, query, fromTs, toTs]);

  const totalAmount = useMemo(
    () => branchWorkers.reduce((s, r) => s + (r.payment ?? 0), 0),
    [branchWorkers],
  );

  useEffect(() => {
    setBranchId(selectedBranchId ?? Object.keys(branches)[0]);
  }, [selectedBranchId, branches]);

  const [preview, setPreview] = useState<{ src: string; name: string } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold">
            {tr("تقرير الإدارة", "Admin report")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {tr(
              "اختر الفرع وفلتر الفترة، ثم ابحث بالاسم.",
              "Select a branch and filter by period, then search by name.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {tr("الفرع:", "Branch:")}
          </span>
          <Select
            value={branchId}
            onValueChange={async (v) => {
              if (v === branchId) return;
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
                  return;
                }
                setBranchId(v);
                setSelectedBranchId(v);
              } catch {}
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
          <BranchDialog />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {tr("مبلغ الإقامة/اليوم", "Residency fee/day")}
            </span>
            <Input
              type="number"
              className="w-28"
              value={branchRate}
              readOnly
              disabled
            />
            <Button
              variant="destructive"
              onClick={async () => {
                if (!branchId) return;
                if (
                  !confirm(
                    tr(
                      "تأكيد حذف الفرع وكل العاملات والسجلات التابعة له؟",
                      "Confirm deleting the branch and all associated applicants and records?",
                    ),
                  )
                )
                  return;
                try {
                  const r = await fetch(`/api/branches/${branchId}`, {
                    method: "DELETE",
                  });
                  if (!r.ok) throw new Error("delete_failed");
                  location.reload();
                } catch {
                  try {
                    const { toast } = await import("sonner");
                    toast.error(
                      tr("تعذر حذف الفرع", "Failed to delete branch"),
                    );
                  } catch {}
                }
              }}
            >
              {tr("حذف الفرع", "Delete branch")}
            </Button>
          </div>
          <Input
            placeholder={tr("من (yyyy-mm-dd)", "From (yyyy-mm-dd)")}
            dir="ltr"
            className="w-40"
            value={fromText}
            onChange={(e) => setFromText(e.target.value)}
          />
          <Input
            placeholder={tr("إلى (yyyy-mm-dd)", "To (yyyy-mm-dd)")}
            dir="ltr"
            className="w-40"
            value={toText}
            onChange={(e) => setToText(e.target.value)}
          />
          <Input
            placeholder={tr("ابحث بالاسم", "Search by name")}
            className="w-40"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <Button onClick={() => setQuery(qDraft)}>
            {tr("بحث", "Search")}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50">
            <tr className="text-sm">
              <th className="p-3">{tr("الاسم", "Name")}</th>
              <th className="p-3">{tr("تاريخ الوصول", "Arrival date")}</th>
              <th className="p-3">{tr("وقت التحقق", "Verified at")}</th>
              <th className="p-3">{tr("المبلغ", "Amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {branchWorkers.map((r) => (
              <tr
                key={`${r.workerId}-${r.verifiedAt}`}
                className="hover:bg-secondary/40"
              >
                <td className="p-3 font-medium">
                  <Link
                    className="text-primary hover:underline"
                    to={`/workers/${r.workerId}`}
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {new Date(r.arrivalDate).toLocaleDateString(
                    locale === "ar" ? "ar-EG" : "en-US",
                  )}
                </td>
                <td className="p-3 text-sm">
                  {new Date(r.verifiedAt).toLocaleString(
                    locale === "ar" ? "ar-EG" : "en-US",
                  )}
                </td>
                <td className="p-3 text-sm">
                  {r.payment != null ? `PHP ${r.payment}` : "—"}
                </td>
              </tr>
            ))}
            {branchWorkers.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-6 text-center text-muted-foreground"
                >
                  {tr(
                    "لا توجد بيانات تحقق لهذا الفرع.",
                    "No verification data for this branch.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 font-semibold">
              <td className="p-3" colSpan={3}>
                {tr("الإجمالي", "Total")}
              </td>
              <td className="p-3">₱ {totalAmount}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-4 border-b font-semibold">
          {tr("طلبات فتح ملفات العاملات", "Unlock requests for applicants")}
        </div>
        <ul className="divide-y">
          {specialRequests.filter((r) => r.type === "unlock").length === 0 && (
            <li className="p-6 text-center text-muted-foreground">
              {tr("لا توجد طلبات فتح بعد.", "No unlock requests yet.")}
            </li>
          )}
          {specialRequests
            .filter((r) => r.type === "unlock")
            .map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-medium">
                    {tr("طلب فتح لاسم:", "Unlock request for:")}{" "}
                    <Link
                      className="text-primary hover:underline"
                      to={`/workers/${r.workerId}`}
                    >
                      {r.workerName}
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tr("التاريخ:", "Date:")}{" "}
                    {new Date(r.createdAt).toLocaleString(
                      locale === "ar" ? "ar-EG" : "en-US",
                    )}
                  </div>
                  <div className="text-sm">
                    {!r.decision ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => decideUnlock(r.id, true)}
                        >
                          {tr("موافقة", "Approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => decideUnlock(r.id, false)}
                        >
                          {tr("رفض", "Reject")}
                        </Button>
                      </div>
                    ) : (
                      <span
                        className={
                          r.decision === "approved"
                            ? "text-emerald-700"
                            : "text-rose-700"
                        }
                      >
                        {r.decision === "approved"
                          ? tr("تمت الموافقة", "Approved")
                          : tr("تم الرفض", "Rejected")}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
        </ul>
      </div>

      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-4 border-b font-semibold">
          {tr("طلبات خاصة", "Special requests")}
        </div>
        <ul className="divide-y">
          {specialRequests.filter((r) => r.type !== "unlock").length === 0 && (
            <li className="p-6 text-center text-muted-foreground">
              {tr("لا توجد طلبات خاصة بعد.", "No special requests yet.")}
            </li>
          )}
          {specialRequests
            .filter((r) => r.type !== "unlock")
            .map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-medium">
                    {r.type === "worker" ? (
                      <>
                        {tr("طلب لعاملة:", "Request for applicant:")}{" "}
                        <Link
                          className="text-primary hover:underline"
                          to={`/workers/${r.workerId}`}
                        >
                          {r.workerName}
                        </Link>
                      </>
                    ) : (
                      <>
                        {tr(
                          "طلب لإدارة الفرع — ممثل:",
                          "Request for branch admin — Representative:",
                        )}{" "}
                        <span className="font-semibold">{r.adminRepName}</span>
                      </>
                    )}
                  </div>
                  <div className="text-sm">
                    {tr("المبلغ:", "Amount:")} PHP {r.amount}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tr("التاريخ:", "Date:")}{" "}
                    {new Date(r.createdAt).toLocaleString(
                      locale === "ar" ? "ar-EG" : "en-US",
                    )}
                  </div>
                </div>
                {r.imageDataUrl && (
                  <div className="mt-3 space-y-2">
                    <img
                      src={r.imageDataUrl}
                      alt={tr("صورة الطلب", "Request image")}
                      className="max-h-40 rounded-md border cursor-zoom-in"
                      onClick={() =>
                        setPreview({
                          src: r.imageDataUrl!,
                          name: "request-image.png",
                        })
                      }
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPreview({
                            src: r.imageDataUrl!,
                            name: "request-image.png",
                          })
                        }
                      >
                        {tr("تكبير", "Zoom")}
                      </Button>
                      <Button size="sm" variant="secondary" asChild>
                        <a href={r.imageDataUrl} download={"request-image.png"}>
                          {tr("تنزيل", "Download")}
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
                {r.attachmentDataUrl && (
                  <div className="mt-3 space-y-2">
                    {r.attachmentMime?.includes("pdf") ||
                    (r.attachmentName || "").toLowerCase().endsWith(".pdf") ? (
                      <a
                        href={r.attachmentDataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-md border px-3 py-1 text-sm text-primary hover:bg-secondary/40"
                      >
                        {tr("عرض الملف (PDF):", "View file (PDF):")}{" "}
                        {r.attachmentName || tr("مرفق", "Attachment")}
                      </a>
                    ) : (
                      <>
                        <img
                          src={r.attachmentDataUrl}
                          alt={r.attachmentName || tr("مرفق", "Attachment")}
                          className="max-h-40 rounded-md border cursor-zoom-in"
                          onClick={() =>
                            setPreview({
                              src: r.attachmentDataUrl!,
                              name: r.attachmentName || "attachment",
                            })
                          }
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPreview({
                                src: r.attachmentDataUrl!,
                                name: r.attachmentName || "attachment",
                              })
                            }
                          >
                            {tr("تكبير", "Zoom")}
                          </Button>
                          <Button size="sm" variant="secondary" asChild>
                            <a
                              href={r.attachmentDataUrl}
                              download={r.attachmentName || "attachment"}
                            >
                              {tr("تنزيل", "Download")}
                            </a>
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
        </ul>
      </div>
      {/* Image Preview Dialog */}
      <Dialog
        open={!!preview}
        onOpenChange={(o) => {
          if (!o) {
            setPreview(null);
            setZoom(1);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{tr("معاينة الصورة", "Image preview")}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))
                  }
                >
                  −
                </Button>
                <div className="min-w-16 text-center text-sm">
                  {Math.round(zoom * 100)}%
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))
                  }
                >
                  +
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
                  {tr("إعادة الضبط", "Reset")}
                </Button>
                <div className="ms-auto">
                  <Button size="sm" variant="secondary" asChild>
                    <a href={preview.src} download={preview.name}>
                      {tr("تنزيل", "Download")}
                    </a>
                  </Button>
                </div>
              </div>
              <div className="max-h-[75vh] overflow-auto rounded-md border bg-muted/20 p-2">
                <div className="flex items-center justify-center">
                  <img
                    src={preview.src}
                    alt={preview.name}
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "center",
                    }}
                    className="max-h-[70vh] object-contain"
                  />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
