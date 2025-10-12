import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Calendar as CalendarIcon } from "lucide-react";
import * as XLSX from "xlsx";
import { formatCurrency } from "@/lib/utils";
import BackButton from "@/components/BackButton";

function fmtYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDayTs(ymd: string) {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function endOfDayTs(ymd: string) {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export default function DailyReport() {
  const { tr, locale } = useI18n();
  const {
    branches,
    workers,
    selectedBranchId,
    setSelectedBranchId,
    sessionVerifications,
  } = useWorkers();
  const [branchId, setBranchId] = useState<string | undefined>(
    selectedBranchId ?? Object.keys(branches)[0],
  );
  const [ymd, setYmd] = useState<string>(fmtYMD(new Date()));

  useEffect(() => {
    setBranchId(selectedBranchId ?? Object.keys(branches)[0]);
  }, [selectedBranchId, branches]);

  const verified = useMemo(() => {
    const fromWorkers = Object.values(workers)
      .filter((w) => !branchId || w.branchId === branchId)
      .flatMap((w) => w.verifications.map((v) => ({ ...v, workerId: w.id })));
    const fromSession = sessionVerifications.filter(
      (v) => !branchId || workers[v.workerId]?.branchId === branchId,
    );
    const byId: Record<string, (typeof fromSession)[number]> = {} as any;
    for (const v of [...fromWorkers, ...fromSession]) byId[v.id] = v as any;
    return Object.values(byId)
      .filter((v) => {
        if (!v.payment || !Number.isFinite(v.payment.amount)) return false;
        const delta = (v.payment.savedAt || 0) - (v.verifiedAt || 0);
        return delta > 5000; // only amounts saved after face verification (exclude residency charges)
      })
      .sort((a, b) => b.verifiedAt - a.verifiedAt);
  }, [workers, sessionVerifications, branchId]);

  const filtered = useMemo(() => {
    const start = startOfDayTs(ymd);
    const end = endOfDayTs(ymd);
    return verified.filter((v) => v.verifiedAt >= start && v.verifiedAt <= end);
  }, [verified, ymd]);

  function downloadExcel() {
    const rows = filtered.map((v) => {
      const w = workers[v.workerId];
      const branchName = w ? branches[w.branchId]?.name || "" : "";
      return {
        Name: w?.name || "",
        "Verified At": new Date(v.verifiedAt).toLocaleString("en-US"),
        Branch: branchName,
        "Amount (PHP)": Number(v.payment?.amount ?? 0),
      } as Record<string, any>;
    });
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Name", "Verified At", "Branch", "Amount (PHP)"],
    });
    ws["!cols"] = [18, 24, 18, 16].map((w) => ({ wch: w }));
    // Number format for amount column (D)
    for (let R = 1; R <= rows.length; R++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: 3 });
      const cell = ws[ref];
      if (cell) (cell as any).z = "[$₱-en-PH] #,##0.00";
    }
    const range = XLSX.utils.decode_range(ws["!ref"] as string);
    ws["!autofilter"] = { ref: XLSX.utils.encode_range(range) } as any;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Report");
    const d = new Date(ymd);
    const fname = `daily-report-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold">
            {tr("التقرير اليومي", "Daily report")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {tr(
              "اختر اليوم لعرض جميع العمليات الناجحة وتحميل تقرير إكسل.",
              "Pick a day to view successful verifications and export to Excel.",
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
                if (!r.ok || !j?.ok) return;
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {tr("التاريخ:", "Date:")}
            </span>
            <Input
              type="date"
              dir="ltr"
              className="w-44"
              value={ymd}
              onChange={(e) => setYmd(e.target.value)}
            />
          </div>
          <Button
            onClick={downloadExcel}
            disabled={filtered.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {tr("تحميل التقرير", "Download report")}
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
                  const delta = (v.payment.savedAt || 0) - (v.verifiedAt || 0);
                  return delta > 5000; // only face-verified amounts
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
            className="gap-2"
          >
            {tr("التقرير الشامل", "Comprehensive archive")}
          </Button>
          <div className="hidden sm:block">
            <BackButton />
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50">
            <tr className="text-sm">
              <th className="p-3">{tr("الاسم", "Name")}</th>
              <th className="p-3">{tr("وقت التحقق", "Verified At")}</th>
              <th className="p-3">{tr("الفرع", "Branch")}</th>
              <th className="p-3">{tr("المبلغ", "Amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((v) => {
              const w = workers[v.workerId];
              const branchName = w ? branches[w.branchId]?.name || "" : "";
              return (
                <tr key={v.id} className="hover:bg-secondary/40">
                  <td className="p-3 font-medium">{w?.name || "—"}</td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {new Date(v.verifiedAt).toLocaleString(
                      locale === "ar" ? "ar-EG" : "en-US",
                    )}
                  </td>
                  <td className="p-3 text-sm">{branchName || "—"}</td>
                  <td className="p-3 text-sm">
                    {v.payment?.amount != null
                      ? formatCurrency(Number(v.payment.amount), locale)
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-6 text-center text-muted-foreground"
                >
                  {tr(
                    "لا توجد عمليات تحقق لهذا اليوم.",
                    "No verifications for this day.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
