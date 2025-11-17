import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "@/components/BackButton";
import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { formatCurrency } from "@/lib/utils";

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

interface VerificationRecord {
  workerId: string;
  workerName: string;
  branchId: string;
  verifiedAt: number;
  amount: number | null;
}

export default function VerificationRecords() {
  const navigate = useNavigate();
  const { tr } = useI18n();
  const { workers, branches, selectedBranchId } = useWorkers() as any;
  const [branchId, setBranchId] = useState<string>(selectedBranchId ?? "all");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [query, setQuery] = useState("");
  const [qDraft, setQDraft] = useState("");

  useEffect(() => {
    if (localStorage.getItem("adminAuth") !== "1") {
      navigate("/admin-login", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (selectedBranchId && selectedBranchId !== branchId) {
      setBranchId(selectedBranchId);
    }
  }, [selectedBranchId, branchId]);

  const fromTs = useMemo(() => parseDateText(fromText), [fromText]);
  const toTs = useMemo(() => {
    const t = parseDateText(toText);
    return t != null ? t + 24 * 60 * 60 * 1000 - 1 : null;
  }, [toText]);

  const verificationRecords = useMemo(() => {
    const records: VerificationRecord[] = [];

    for (const w of Object.values(workers) as any[]) {
      if (branchId && branchId !== "all" && w.branchId !== branchId) continue;

      for (const v of w.verifications) {
        const wname = w.name || "";
        if (query && !wname.toLowerCase().includes(query.toLowerCase()))
          continue;
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

        records.push({
          workerId: w.id,
          workerName: wname,
          branchId: w.branchId,
          verifiedAt: v.verifiedAt,
          amount,
        });
      }
    }

    return records.sort((a, b) => b.verifiedAt - a.verifiedAt);
  }, [workers, branchId, query, fromTs, toTs]);

  const totalAmount = useMemo(
    () => verificationRecords.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    [verificationRecords],
  );

  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");

    const arabicDate = `${day}/${month}/${year} ${hour}:${minute}:${second}`;
    return arabicDate
      .replace(/\d/g, (d) => arabicDigits[parseInt(d)])
      .replace(/:/g, " : ");
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold">
                {tr("صفحة التحقق", "Verification Records")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {tr(
                  "عرض جميع عمليات التحقق في الفروع",
                  "View all verification operations in branches",
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-lg border bg-card p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {/* Branch Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("الفرع", "Branch")}
              </label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={tr("اختر الفرع", "Select branch")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
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
                {tr("من (yyyy-mm-dd)", "From (yyyy-mm-dd)")}
              </label>
              <Input
                type="text"
                value={fromText}
                onChange={(e) => setFromText(e.target.value)}
                placeholder="من"
              />
            </div>

            {/* To Date */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("إلى (yyyy-mm-dd)", "To (yyyy-mm-dd)")}
              </label>
              <Input
                type="text"
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                placeholder="إلى"
              />
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("بحث باسم", "Search by name")}
              </label>
              <Input
                type="text"
                value={qDraft}
                onChange={(e) => {
                  setQDraft(e.target.value);
                  setQuery(e.target.value);
                }}
                placeholder={tr("ابحث باسم", "Search by name")}
              />
            </div>
          </div>
        </div>

        {/* Results Table */}
        {verificationRecords.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {tr("لا توجد عمليات تحقق", "No verification records found")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">
                    {tr("اسم المتقدم", "Applicant Name")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("الفرع", "Branch")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("تاريخ ووقت التحقق", "Verification Date/Time")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("المبلغ", "Amount")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verificationRecords.map((record, index) => (
                  <TableRow
                    key={`${record.workerId}-${record.verifiedAt}-${index}`}
                  >
                    <TableCell className="font-medium">
                      {record.workerName}
                    </TableCell>
                    <TableCell>
                      {branches[record.branchId]?.name || record.branchId}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(record.verifiedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {record.amount ? formatCurrency(record.amount) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Total Row */}
            <div className="border-t bg-muted/50 px-6 py-3 flex justify-between items-center">
              <span className="font-semibold">{tr("الإجمالي", "Total")}</span>
              <span className="font-bold text-lg">
                {formatCurrency(totalAmount)}
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
