import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "@/components/BackButton";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";
import ExcelJS from "exceljs";

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
  if (!isNaN(d2.getTime())) {
    return new Date(
      d2.getFullYear(),
      d2.getMonth(),
      d2.getDate(),
      0,
      0,
      0,
      0,
    ).getTime();
  }
  return null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface ReportRow {
  workerId: string;
  branchId: string;
  name: string;
  branchName: string;
  arrivalDate: number;
  assignedArea: string;
  verificationCount: number;
  totalAmount: number;
  lastVerifiedAt: number;
}

const ITEMS_PER_PAGE = 30;

export default function DownloadReport() {
  const navigate = useNavigate();
  const { tr } = useI18n();
  const { branches, selectedBranchId } = useWorkers() as any;
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Listen for verification updates to ensure real-time display
  useEffect(() => {
    const handleVerificationUpdated = (e: any) => {
      const { verificationId, workerId } = e.detail || {};
      console.log("[DownloadReport] Verification updated event received", {
        verificationId: verificationId?.slice(0, 8),
        workerId: workerId?.slice(0, 8),
      });
      // The workers state will automatically update through the WorkersContext
      // useMemo will re-compute reportData when workers changes
    };

    window.addEventListener(
      "verificationUpdated",
      handleVerificationUpdated as any,
    );
    return () => {
      window.removeEventListener(
        "verificationUpdated",
        handleVerificationUpdated as any,
      );
    };
  }, []);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [fromText, toText]);

  // Use selected branch only, no switching allowed
  const branchId = selectedBranchId;
  const branchName = branches[branchId]?.name || branchId;

  const fromTs = useMemo(() => parseDateText(fromText), [fromText]);
  const toTs = useMemo(() => {
    const t = parseDateText(toText);
    return t != null ? t + 24 * 60 * 60 * 1000 - 1 : null;
  }, [toText]);

  const reportData = useMemo(() => {
    const rows: ReportRow[] = [];
    const expectedVerificationAmount =
      branches[branchId]?.verificationAmount || 75;

    for (const w of Object.values(workers) as any[]) {
      if (w.branchId !== branchId) continue;
      if (w.verifications.length === 0) continue;

      let totalAmount = 0;
      let verificationCount = 0;
      let lastVerifiedAt = 0;

      for (const v of w.verifications) {
        if (fromTs != null && v.verifiedAt < fromTs) continue;
        if (toTs != null && v.verifiedAt > toTs) continue;

        let amount: number | null = null;
        if (
          v.payment &&
          Number.isFinite(v.payment.amount) &&
          Number(v.payment.amount) === expectedVerificationAmount &&
          v.payment.savedAt
        ) {
          amount = Number(v.payment.amount);
        }

        if (amount != null && amount > 0) {
          totalAmount += amount;
          verificationCount += 1;
          lastVerifiedAt = Math.max(lastVerifiedAt, v.verifiedAt);
        }
      }

      if (verificationCount > 0) {
        rows.push({
          name: w.name || "",
          branchName: branches[w.branchId]?.name || w.branchId,
          arrivalDate: w.arrivalDate,
          assignedArea: w.docs?.assignedArea || "",
          verificationCount,
          totalAmount,
          lastVerifiedAt,
        });
      }
    }

    return rows.sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt);
  }, [workers, branchId, branches, fromTs, toTs]);

  const totalAmount = useMemo(
    () => reportData.reduce((sum, row) => sum + row.totalAmount, 0),
    [reportData],
  );

  const totalPages = Math.ceil(reportData.length / ITEMS_PER_PAGE);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return reportData.slice(startIndex, endIndex);
  }, [reportData, currentPage]);

  const handleDownload = () => {
    const now = new Date();
    const today =
      String(now.getFullYear()).padStart(4, "0") +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const fileName = "report-" + branchName + "-" + today + ".xlsx";

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Branch Report " + branchName);

    // Headers
    const headers = [
      "Name",
      "Arrival Date",
      "Assigned Area",
      "Last Verified At",
      "Verifications",
      "Total Amount",
    ];
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
      fgColor: { argb: "FF8B5CF6" },
    }; // Purple
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
    reportData.forEach((row, idx) => {
      const isAlt = idx % 2 === 0;
      const dataRow = ws.addRow([
        row.name,
        new Date(row.arrivalDate || 0).toLocaleDateString("en-US"),
        row.assignedArea,
        new Date(row.lastVerifiedAt || 0).toLocaleString("en-US"),
        row.verificationCount,
        row.totalAmount,
      ]);

      dataRow.font = { color: { argb: "FF374151" }, size: 11, name: "Calibri" };
      dataRow.fill = isAlt
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAF5FF" } } // Light purple
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

        if (colNum === 2 || colNum === 3) {
          cell.alignment = { horizontal: "center", vertical: "center" };
        } else if (colNum === 4 || colNum === 5) {
          cell.alignment = { horizontal: "right", vertical: "center" };
          if (colNum === 5) {
            cell.numFmt = "₱#,##0.00";
          }
        }
      });
    });

    // Total row
    const totalVerifications = reportData.reduce(
      (sum, row) => sum + row.verificationCount,
      0,
    );
    const totalRow = ws.addRow([
      "TOTAL",
      "",
      "",
      "",
      totalVerifications,
      totalAmount,
    ]);
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
      if (colNum === 4 || colNum === 5) {
        cell.alignment = { horizontal: "right", vertical: "center" };
        if (colNum === 5) {
          cell.numFmt = "₱#,##0.00";
        }
      }
    });

    // Set column widths
    ws.columns = [
      { width: 20 }, // Name
      { width: 18 }, // Arrival Date
      { width: 18 }, // Assigned Area
      { width: 28 }, // Last Verified At
      { width: 15 }, // Verifications
      { width: 18 }, // Total Amount
    ];

    ws.pageSetup = { paperSize: 9, orientation: "landscape" };
    ws.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };

    // Enable autofilter (only if there is data)
    if (reportData.length > 0) {
      ws.autoFilter = { from: "A1", to: `F${reportData.length + 1}` };
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
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleDateString("en-US");
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold">
                {tr("التقرير اليومي", "Daily Report")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {tr(
                  "عرض وتحميل التقارير اليومية والشاملة",
                  "View and download daily and comprehensive reports",
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Filters and Controls */}
        <div className="mb-6 rounded-lg border bg-card p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-5">
            {/* Branch Display (Read-only) */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("الفرع", "Branch")}
              </label>
              <div className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground">
                {branchName}
              </div>
            </div>

            {/* From Date */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("من", "From")}
              </label>
              <Input
                type="text"
                value={fromText}
                onChange={(e) => setFromText(e.target.value)}
                placeholder="yyyy-mm-dd"
              />
            </div>

            {/* To Date */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("إلى", "To")}
              </label>
              <Input
                type="text"
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                placeholder="yyyy-mm-dd"
              />
            </div>

            {/* Download Button */}
            <div className="flex items-end">
              <Button
                onClick={handleDownload}
                className="w-full gap-2"
                variant="default"
              >
                <Download className="h-4 w-4" />
                {tr("تحميل", "Download")}
              </Button>
            </div>
          </div>
        </div>

        {/* Results Table */}
        {reportData.length === 0 ? (
          <div className="text-center py-12 rounded-lg border bg-card">
            <p className="text-muted-foreground">
              {tr(
                "لا توجد عمليات تحقق لهذه الفترة",
                "No verifications for this period",
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-8">#</TableHead>
                  <TableHead className="text-right">
                    {tr("الاسم", "Name")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("تاريخ الوصول", "Arrival Date")}
                  </TableHead>
                  <TableHead className="text-center">
                    {tr("وقت التحقق", "Verification Time")}
                  </TableHead>
                  <TableHead className="text-center">
                    {tr("عدد التحققات", "Verification Count")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("المبلغ الإجمالي", "Total Amount")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedData.map((row, index) => {
                  const rowNumber =
                    (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
                  return (
                    <TableRow key={index}>
                      <TableCell className="font-medium text-gray-500 w-8">
                        {rowNumber}
                      </TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.arrivalDate)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(row.lastVerifiedAt).toLocaleString("en-US", {
                          month: "2-digit",
                          day: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.verificationCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.totalAmount > 0 ? `₱ ${row.totalAmount}` : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Total Row */}
            <div className="border-t bg-muted/50 px-6 py-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold">{tr("الإجمالي", "Total")}</span>
                <div className="flex gap-12">
                  <span className="font-semibold text-center min-w-[80px]">
                    {reportData.reduce(
                      (sum, row) => sum + row.verificationCount,
                      0,
                    )}
                  </span>
                  <span className="font-bold text-lg min-w-[100px] text-right">
                    ₱ {totalAmount}
                  </span>
                </div>
              </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="border-t bg-muted/30 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {tr(
                      `الصفحة ${currentPage} من ${totalPages}`,
                      `Page ${currentPage} of ${totalPages}`,
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage(Math.max(1, currentPage - 1))
                      }
                      disabled={currentPage === 1}
                    >
                      {tr("السابق", "Previous")}
                    </Button>

                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                        (pageNum) => (
                          <Button
                            key={pageNum}
                            variant={
                              currentPage === pageNum ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setCurrentPage(pageNum)}
                            className="min-w-10"
                          >
                            {pageNum}
                          </Button>
                        ),
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage(Math.min(totalPages, currentPage + 1))
                      }
                      disabled={currentPage === totalPages}
                    >
                      {tr("التالي", "Next")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
