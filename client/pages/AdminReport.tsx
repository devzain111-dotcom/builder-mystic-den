import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

function PagedDetailsList({
  items,
  locale,
}: {
  items: { verifiedAt: number; amount: number | null }[];
  locale: string;
}) {
  const PAGE = 15;
  const [page, setPage] = useState(0);
  const sorted = items.slice().sort((a, b) => b.verifiedAt - a.verifiedAt);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const start = page * PAGE;
  const current = sorted.slice(start, start + PAGE);
  return (
    <div>
      <ul className="space-y-1 text-sm">
        {current.map((d, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span>
              {new Date(d.verifiedAt).toLocaleString(
                locale === "ar" ? "ar-EG" : "en-US",
              )}
            </span>
            <span className="font-medium">
              {d.amount != null ? `PHP ${d.amount}` : "—"}
            </span>
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            className="px-2 py-1 rounded border disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ‹
          </button>
          <div className="space-x-1 rtl:space-x-reverse">
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                className={
                  "inline-flex items-center justify-center w-7 h-7 rounded border " +
                  (idx === page ? "bg-primary text-primary-foreground" : "")
                }
                onClick={() => setPage(idx)}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <button
            className="px-2 py-1 rounded border disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

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
          tr(
            "ت��ذر حفظ ا��فرع في القاعدة",
            "Failed to save branch in database",
          ),
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
            <div className="text-sm mb-1">{tr("الاس��", "Name")}</div>
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
              "سيُضاف الفرع ��ي قاعدة البيانات وس��ظهر في قائمة الفر��ع.",
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
    updateWorkerDocs,
    selectedBranchId,
    setSelectedBranchId,
    sessionVerifications,
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
    type Row = {
      workerId: string;
      name: string;
      arrivalDate: number;
      total: number;
      latest: number;
      details: { verifiedAt: number; amount: number | null }[];
    };
    const byWorker: Record<string, Row> = {};
    for (const w of list) {
      for (const v of w.verifications) {
        const rname = w.name || "";
        if (query && !rname.toLowerCase().includes(query.toLowerCase()))
          continue;
        if (fromTs != null && v.verifiedAt < fromTs) continue;
        if (toTs != null && v.verifiedAt > toTs) continue;
        const key = w.id;
        if (!byWorker[key])
          byWorker[key] = {
            workerId: w.id,
            name: rname,
            arrivalDate: w.arrivalDate,
            total: 0,
            latest: 0,
            details: [],
          };
        // Only count 40 peso payments that have been saved
        let amount: number | null = null;
        if (
          v.payment &&
          Number.isFinite(v.payment.amount) &&
          Number(v.payment.amount) === 40 &&
          v.payment.savedAt
        ) {
          amount = Number(v.payment.amount);
        }
        // Only include verifications with valid amounts
        if (amount != null && amount > 0) {
          byWorker[key].details.push({ verifiedAt: v.verifiedAt, amount });
          byWorker[key].latest = Math.max(byWorker[key].latest, v.verifiedAt);
          byWorker[key].total += amount;
        }
      }
    }
    // Filter out workers with no details (no amounts > 0)
    const arr = Object.values(byWorker)
      .filter((r) => r.details.length > 0)
      .sort((a, b) => b.latest - a.latest);
    return arr;
  }, [workers, branchId, query, fromTs, toTs]);

  const totalAmount = useMemo(
    () => branchWorkers.reduce((s, r) => s + (r.total ?? 0), 0),
    [branchWorkers],
  );

  useEffect(() => {
    setBranchId(selectedBranchId ?? Object.keys(branches)[0]);
  }, [selectedBranchId, branches]);

  const [preview, setPreview] = useState<{ src: string; name: string } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(false);

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => {
            const ref = document.referrer || "";
            const sameOrigin = ref.startsWith(window.location.origin);
            const cameFromAdmin = /\/admin/i.test(ref);
            if (sameOrigin && cameFromAdmin && window.history.length > 1) {
              navigate(-1);
            } else {
              navigate("/admin-login", { replace: true });
            }
          }}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          aria-label={tr("رجوع", "Back")}
        >
          <span>{tr("رجوع", "Back")}</span>
        </button>
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
          <Button variant="secondary" asChild>
            <Link to="/workers">
              {tr("العاملات المسجلات", "Registered workers")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/admin/status-review">
              {tr("مراجعة الحالات", "Status Review")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/no-expense">
              {tr("إقامة بدون مصروف", "Residency without allowance")}
            </Link>
          </Button>
          <Button onClick={() => setUnlockOpen(true)}>
            {tr("طلبات فتح ال��لفات", "Unlock requests")} (
            {specialRequests.filter((r: any) => r.type === "unlock").length})
          </Button>
          <Button variant="outline" onClick={() => setSpecialOpen(true)}>
            {tr("طلبات خاصة", "Special requests")} (
            {specialRequests.filter((r: any) => r.type !== "unlock").length})
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const all: {
                name: string;
                verifiedAt: number;
                amount: number;
              }[] = [];
              const branchIdSel = branchId;
              const allFromWorkers = Object.values(workers)
                .filter((w) => !branchIdSel || w.branchId === branchIdSel)
                .flatMap((w) =>
                  w.verifications.map((v) => ({ ...v, workerId: w.id })),
                );
              const fromSession = sessionVerifications.filter(
                (v) =>
                  !branchIdSel || workers[v.workerId]?.branchId === branchIdSel,
              );
              const byId: Record<string, any> = {} as any;
              for (const v of [...allFromWorkers, ...fromSession])
                byId[v.id] = v;
              Object.values(byId)
                .filter((v: any) => {
                  if (!v.payment || !Number.isFinite(v.payment.amount))
                    return false;
                  const amount = Number(v.payment.amount);
                  if (amount !== 40 || !v.payment.savedAt) return false; // only 40 peso saved payments
                  return true;
                })
                .forEach((v: any) => {
                  all.push({
                    name: workers[v.workerId]?.name || "",
                    verifiedAt: v.verifiedAt,
                    amount: Number(v.payment.amount) || 0,
                  });
                });
              import("@/lib/excelArchive").then(({ exportMonthlyArchive }) =>
                exportMonthlyArchive(all, locale),
              );
            }}
          >
            {tr("التقرير الشامل", "Comprehensive archive")}
          </Button>
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
                const pass =
                  window.prompt(
                    tr(
                      "أدخل كلمة سر الفرع للحذف",
                      "Enter branch password to delete",
                    ),
                  ) || "";
                if (!pass) return;
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
                  const v = await fetch("/api/branches/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: branchId, password: pass }),
                  });
                  const jv = await v.json().catch(() => ({}) as any);
                  if (!v.ok || !jv?.ok) {
                    try {
                      const { toast } = await import("sonner");
                      toast.error(
                        tr("كلمة ��لمرور غير صحيحة", "Wrong password"),
                      );
                    } catch {}
                    return;
                  }
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
            placeholder={tr("ابحث ��ا��اسم", "Search by name")}
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
              <tr key={r.workerId} className="hover:bg-secondary/40">
                <td className="p-3 font-medium">
                  <Link
                    className="text-primary hover:underline"
                    to={`/workers/${r.workerId}?admin=1`}
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="underline text-primary">
                        {r.details.length} عمليات
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80">
                      <div className="text-sm font-semibold mb-2">
                        تفاصيل الأوقات
                      </div>
                      <PagedDetailsList items={r.details} locale={locale} />
                    </PopoverContent>
                  </Popover>
                </td>
                <td className="p-3 text-sm">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="font-semibold underline text-primary">
                        ₱ {r.total}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72">
                      <div className="text-sm font-semibold mb-2">
                        تفاصيل المبالغ
                      </div>
                      <PagedDetailsList items={r.details} locale={locale} />
                    </PopoverContent>
                  </Popover>
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

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {tr("طلبات فتح ملفات العاملات", "Unlock requests for applicants")}
            </DialogTitle>
          </DialogHeader>
          <ul className="divide-y">
            {specialRequests.filter((r) => r.type === "unlock").length ===
              0 && (
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
                        to={`/workers/${r.workerId}?admin=1`}
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
                            onClick={async () => {
                              const raw = window.prompt(
                                tr(
                                  "أدخل عدد الأيام لفت�� مؤقت (مثال 1 أو 10)",
                                  "Enter extension days (e.g., 1 or 10)",
                                ) || "0",
                              );
                              const addDays = Number(raw);
                              if (!Number.isFinite(addDays) || addDays < 0)
                                return;
                              try {
                                if (r.workerId) {
                                  const current =
                                    Number(
                                      (workers[r.workerId]?.docs
                                        ?.no_expense_extension_days_total as any) ||
                                        0,
                                    ) || 0;
                                  const total = current + addDays;
                                  const resp = await fetch(
                                    "/api/workers/docs/patch",
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        workerId: r.workerId,
                                        patch: {
                                          no_expense_extension_days_total:
                                            total,
                                        },
                                      }),
                                    },
                                  );
                                  await resp.text().catch(() => "");
                                  updateWorkerDocs(r.workerId, {
                                    //@ts-ignore add custom field into docs JSON
                                    no_expense_extension_days_total: total,
                                  } as any);
                                }
                              } catch {}
                              decideUnlock(r.id, true);
                            }}
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
        </DialogContent>
      </Dialog>

      <Dialog open={specialOpen} onOpenChange={setSpecialOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tr("طلبات خاصة", "Special requests")}</DialogTitle>
          </DialogHeader>
          <ul className="divide-y">
            {specialRequests.filter((r) => r.type !== "unlock").length ===
              0 && (
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
                            to={`/workers/${r.workerId}?admin=1`}
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
                          <span className="font-semibold">
                            {r.adminRepName}
                          </span>
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
                          <a
                            href={r.imageDataUrl}
                            download={"request-image.png"}
                          >
                            {tr("تنزيل", "Download")}
                          </a>
                        </Button>
                      </div>
                    </div>
                  )}
                  {r.attachmentDataUrl && (
                    <div className="mt-3 space-y-2">
                      {r.attachmentMime?.includes("pdf") ||
                      (r.attachmentName || "")
                        .toLowerCase()
                        .endsWith(".pdf") ? (
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
        </DialogContent>
      </Dialog>
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
            <DialogTitle>{tr("معاينة الص��رة", "Image preview")}</DialogTitle>
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
