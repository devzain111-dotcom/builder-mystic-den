import { useMemo, useState } from "react";
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
import { Download, FileText } from "lucide-react";
import * as XLSX from "xlsx";

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
  if (!isNaN(d2.getTime())) return d2.getTime();
  return null;
};

interface ReportRow {
  name: string;
  branchName: string;
  arrivalDate: number;
  verificationCount: number;
  totalAmount: number;
}

export default function DownloadReport() {
  const navigate = useNavigate();
  const { tr } = useI18n();
  const { workers, branches, selectedBranchId } = useWorkers() as any;
  const [branchId, setBranchId] = useState<string>(selectedBranchId ?? "all");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [reportType, setReportType] = useState<"daily" | "comprehensive">("daily");

  const fromTs = useMemo(() => parseDateText(fromText), [fromText]);
  const toTs = useMemo(() => {
    const t = parseDateText(toText);
    return t != null ? t + 24 * 60 * 60 * 1000 - 1 : null;
  }, [toText]);

  const reportData = useMemo(() => {
    const rows: ReportRow[] = [];

    for (const w of Object.values(workers) as any[]) {
      if (branchId && w.branchId !== branchId) continue;
      if (w.verifications.length === 0) continue;

      let totalAmount = 0;
      let verificationCount = 0;
      
      for (const v of w.verifications) {
        if (fromTs != null && v.verifiedAt < fromTs) continue;
        if (toTs != null && v.verifiedAt > toTs) continue;

        let amount: number | null = null;
        if (
          v.payment &&
          Number.isFinite(v.payment.amount) &&
          Number(v.payment.amount) === 40 &&
          v.payment.savedAt
        ) {
          amount = Number(v.payment.amount);
        }

        if (amount != null && amount > 0) {
          totalAmount += amount;
          verificationCount += 1;
        }
      }

      if (verificationCount > 0) {
        rows.push({
          name: w.name || "",
          branchName: branches[w.branchId]?.name || w.branchId,
          arrivalDate: w.arrivalDate,
          verificationCount,
          totalAmount,
        });
      }
    }

    return rows.sort((a, b) => b.arrivalDate - a.arrivalDate);
  }, [workers, branchId, branches, fromTs, toTs]);

  const totalAmount = useMemo(
    () => reportData.reduce((sum, row) => sum + row.totalAmount, 0),
    [reportData],
  );

  const handleDownload = () => {
    if (reportType === "daily") {
      const now = new Date();
      const today =
        String(now.getFullYear()).padStart(4, "0") +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0");
      const fileName = "تقرير-يومي-" + today + ".xlsx";

      const dataForExport = reportData
        .map((row) => ({
          الاسم: row.name,
          "الفرع": row.branchName,
          "تاريخ الوصول": new Date(row.arrivalDate || 0).toLocaleDateString("ar"),
          "التحققات": row.verificationCount,
          "المبلغ الإجمالي": row.totalAmount,
        }))
        .concat({
          الاسم: "الإجمالي",
          "الفرع": "",
          "تاريخ الوصول": "",
          "التحققات": reportData.reduce((sum, row) => sum + row.verificationCount, 0),
          "المبلغ الإجمالي": totalAmount,
        });

      const ws = XLSX.utils.json_to_sheet(dataForExport, {
        header: ["الاسم", "الفرع", "تاريخ الوصول", "التحققات", "المبلغ الإجمالي"],
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "تقرير يومي");
      XLSX.writeFile(wb, fileName);
    } else {
      navigate("/admin-login");
    }
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const arabicDate = `${day}/${month}/${year}`;
    return arabicDate
      .replace(/\d/g, (d) => arabicDigits[parseInt(d)]);
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
          <div className="grid gap-4 md:grid-cols-6">
            {/* Report Type */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("نوع التقرير", "Report Type")}
              </label>
              <Select value={reportType} onValueChange={(v: any) => setReportType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">
                    {tr("التقرير اليومي", "Daily Report")}
                  </SelectItem>
                  <SelectItem value="comprehensive">
                    {tr("التقرير الشامل", "Comprehensive Report")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Branch Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("الفرع", "Branch")}
              </label>
              <Select value={branchId ?? ""} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder={tr("جميع الفروع", "All branches")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">
                    {tr("جميع الفروع", "All branches")}
                  </SelectItem>
                  {Object.values(branches).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            {/* Comprehensive Report Button */}
            {reportType === "comprehensive" && (
              <div className="flex items-end">
                <Button
                  onClick={() => navigate("/admin-login")}
                  className="w-full gap-2"
                  variant="outline"
                >
                  <FileText className="h-4 w-4" />
                  {tr("الإدارة", "Admin")}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Results Table */}
        {reportData.length === 0 ? (
          <div className="text-center py-12 rounded-lg border bg-card">
            <p className="text-muted-foreground">
              {tr("لا توجد عمليات تحقق لهذه الفترة", "No verifications for this period")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">
                    {tr("الاسم", "Name")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("الفرع", "Branch")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("وقت التحقق", "Verification Time")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("المبلغ", "Amount")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.branchName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(row.arrivalDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.totalAmount > 0 ? `₱ ${row.totalAmount}` : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Total Row */}
            <div className="border-t bg-muted/50 px-6 py-3 flex justify-between items-center">
              <span className="font-semibold">
                {tr("الإجمالي", "Total")}
              </span>
              <span className="font-bold text-lg">
                ₱ {totalAmount}
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
