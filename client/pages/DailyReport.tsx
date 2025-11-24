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
import ExcelJS from "exceljs";
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
  const [dailyPage, setDailyPage] = useState(0);

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
    const expectedVerificationAmount =
      branches[branchId]?.verificationAmount || 75;
    return Object.values(byId)
      .filter((v) => {
        // Only include verifications with exact verification amount payment that has been saved
        if (
          !v.payment ||
          Number(v.payment.amount) !== expectedVerificationAmount ||
          !v.payment.savedAt
        )
          return false;
        return true;
      })
      .sort((a, b) => b.verifiedAt - a.verifiedAt);
  }, [workers, sessionVerifications, branchId, branches]);

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
        "Arrival Date": w ? new Date(w.arrivalDate).toLocaleDateString("en-US") : "",
        "Verified At": new Date(v.verifiedAt).toLocaleString("en-US"),
        Branch: branchName,
        "Amount (PHP)": Number(v.payment?.amount ?? 0),
      } as Record<string, any>;
    });
    if (rows.length === 0) return;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Daily Report");

    // Headers
    const headers = ["Name", "Arrival Date", "Verified At", "Branch", "Amount (PHP)"];
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
      fgColor: { argb: "FF3B82F6" },
    }; // Blue
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
    let totalAmount = 0;
    rows.forEach((row, idx) => {
      const dataRow = ws.addRow([
        row.Name,
        row["Arrival Date"],
        row["Verified At"],
        row.Branch,
        row["Amount (PHP)"],
      ]);
      const isAlt = idx % 2 === 0;
      totalAmount += row["Amount (PHP)"] || 0;

      dataRow.font = { color: { argb: "FF374151" }, size: 11, name: "Calibri" };
      dataRow.fill = isAlt
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } } // Light blue
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

        // Right-align amount column (now column 5)
        if (colNum === 5) {
          cell.alignment = { horizontal: "right", vertical: "center" };
          cell.numFmt = "₱#,##0.00";
        } else if (colNum === 2 || colNum === 3) {
          // Center align date columns (Arrival Date and Verified At)
          cell.alignment = { horizontal: "center", vertical: "center" };
        }
      });
    });

    // Add total row
    const totalRow = ws.addRow(["", "", "", "TOTAL", totalAmount]);
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
      if (colNum === 5) {
        cell.alignment = { horizontal: "right", vertical: "center" };
        cell.numFmt = "₱#,##0.00";
      }
    });

    // Set column widths
    ws.columns = [
      { width: 20 }, // Name
      { width: 18 }, // Arrival Date
      { width: 28 }, // Verified At
      { width: 18 }, // Branch
      { width: 18 }, // Amount
    ];

    ws.pageSetup = { paperSize: 9, orientation: "landscape" };
    ws.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };

    // Enable autofilter (only if there is data)
    if (rows.length > 0) {
      ws.autoFilter = { from: "A1", to: `E${rows.length + 1}` };
    }

    // Download
    const d = new Date(ymd);
    const fname = `daily-report-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`;

    wb.xlsx
      .writeBuffer()
      .then((buffer: any) => {
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(() => {
        // toast.error(tr("تعذر تحميل التقرير", "Failed to download report"));
      });
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
        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
              <SelectTrigger className="w-full sm:w-48">
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
            <span className="text-sm text-muted-foreground">
              {tr("التاريخ:", "Date:")}
            </span>
            <Input
              type="date"
              dir="ltr"
              className="w-full sm:w-44"
              value={ymd}
              onChange={(e) => setYmd(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
            <Button
              onClick={downloadExcel}
              disabled={filtered.length === 0}
              className="gap-2 justify-center w-full"
            >
              <Download className="h-4 w-4 flex-shrink-0" />
              <span>{tr("تحميل التقرير", "Download report")}</span>
            </Button>
            <Button
              variant="secondary"
              className="gap-2 justify-center w-full"
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
                    !branchIdSel ||
                    workers[v.workerId]?.branchId === branchIdSel,
                );
                const byId: Record<string, any> = {} as any;
                for (const v of [...allFromWorkers, ...fromSession])
                  byId[v.id] = v;
                Object.values(byId)
                  .filter((v: any) => {
                    if (!v.payment || !Number.isFinite(v.payment.amount))
                      return false;
                    const delta =
                      (v.payment.savedAt || 0) - (v.verifiedAt || 0);
                    return delta > 5000;
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
            <div className="hidden sm:block">
              <BackButton />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50">
            <tr className="text-sm">
              <th className="p-3">{tr("الاسم", "Name")}</th>
              <th className="p-3">{tr("تاريخ الوصول", "Arrival Date")}</th>
              <th className="p-3">{tr("وقت التحقق", "Verified At")}</th>
              <th className="p-3">{tr("الفرع", "Branch")}</th>
              <th className="p-3">{tr("المبلغ", "Amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(() => {
              const itemsPerFirstPage = 10;
              const itemsPerOtherPage = 15;
              const totalPages = Math.ceil(
                (filtered.length - itemsPerFirstPage) / itemsPerOtherPage + 1,
              );
              const isFirstPage = dailyPage === 0;
              const itemsPerPage = isFirstPage
                ? itemsPerFirstPage
                : itemsPerOtherPage;
              let startIndex = 0;
              if (isFirstPage) {
                startIndex = 0;
              } else {
                startIndex =
                  itemsPerFirstPage + (dailyPage - 1) * itemsPerOtherPage;
              }
              const endIndex = startIndex + itemsPerPage;
              const pageItems = filtered.slice(startIndex, endIndex);

              if (filtered.length === 0) {
                return (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {tr(
                        "لا توجد عمليات تحقق لهذا اليوم.",
                        "No verifications for this day.",
                      )}
                    </td>
                  </tr>
                );
              }

              return pageItems.map((v) => {
                const w = workers[v.workerId];
                const branchName = w ? branches[w.branchId]?.name || "" : "";
                return (
                  <tr key={v.id} className="hover:bg-secondary/40">
                    <td className="p-3 font-medium">{w?.name || "—"}</td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {new Date(v.verifiedAt).toLocaleString("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </td>
                    <td className="p-3 text-sm">{branchName || "—"}</td>
                    <td className="p-3 text-sm">
                      {v.payment?.amount != null
                        ? formatCurrency(Number(v.payment.amount), locale)
                        : "—"}
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
            (filtered.length - itemsPerFirstPage) / itemsPerOtherPage + 1,
          );
          return filtered.length > 0 && totalPages > 1 ? (
            <div className="border-t px-3 md:px-6 py-3 md:py-4 flex items-center justify-between gap-2 text-xs md:text-sm">
              <button
                onClick={() => setDailyPage((p) => Math.max(0, p - 1))}
                disabled={dailyPage === 0}
                className="px-2 md:px-3 py-1 md:py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
              >
                ‹
              </button>
              <span className="text-xs md:text-sm">
                {dailyPage + 1} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setDailyPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={dailyPage === totalPages - 1}
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
