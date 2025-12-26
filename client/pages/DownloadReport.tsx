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
  const { branches, selectedBranchId, workers } = useWorkers() as any;
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [assignedArea, setAssignedArea] = useState("");

  const assignedAreaFilterValue = useMemo(
    () => assignedArea.trim(),
    [assignedArea],
  );
  const assignedAreaFilterLower = assignedAreaFilterValue.toLowerCase();

  const isEmbeddedPreview = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  // Use selected branch only, no switching allowed
  const branchId = selectedBranchId || null;
  const branchName = useMemo(() => {
    if (!branchId) return "";
    return branches[branchId]?.name || branchId;
  }, [branchId, branches]);

  const [branchAreas, setBranchAreas] = useState<string[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);

  // Fetch all unique assigned areas for the selected branch from server
  useEffect(() => {
    if (!branchId) {
      setBranchAreas([]);
      return;
    }

    const fetchAreas = async () => {
      setAreasLoading(true);
      try {
        // Try to fetch from dedicated endpoint
        const response = await fetch(`/api/workers/branch/${branchId}/areas`);
        if (response.ok) {
          const data = await response.json();
          console.log("[DownloadReport] Fetched areas:", data?.areas);
          if (Array.isArray(data?.areas)) {
            const sorted = data.areas
              .filter((area: string) => typeof area === "string" && area.trim())
              .map((area: string) => area.trim())
              .sort((a: string, b: string) => a.localeCompare(b));
            const unique = [...new Set(sorted)];
            console.log("[DownloadReport] Setting branch areas:", unique);
            setBranchAreas(unique);
            setAreasLoading(false);
            return;
          }
        }

        console.warn("[DownloadReport] Areas endpoint failed, using fallback");
        // Fallback: fetch all workers and extract unique areas
        const workersResponse = await fetch(
          `/api/workers/branch/${branchId}?pageSize=1000&nocache=1`,
        );
        if (workersResponse.ok) {
          const workersData = await workersResponse.json();
          const unique = new Set<string>();
          if (Array.isArray(workersData?.data)) {
            workersData.data.forEach((worker: any) => {
              const area = worker?.assigned_area || "";
              if (typeof area === "string" && area.trim().length > 0) {
                unique.add(area.trim());
              }
            });
          }
          const sorted = Array.from(unique).sort((a, b) => a.localeCompare(b));
          console.log("[DownloadReport] Using fallback areas:", sorted);
          setBranchAreas(sorted);
        } else {
          throw new Error("Failed to fetch workers");
        }
      } catch (error) {
        console.warn("Failed to fetch branch areas:", error);
        // Fallback to local workers data
        const unique = new Set<string>();
        Object.values(workers as Record<string, any>).forEach((worker) => {
          if (worker?.branchId !== branchId) return;
          const area =
            worker?.assigned_area ||
            worker?.docs?.assignedArea ||
            worker?.docs?.assigned_area ||
            worker?.assignedArea ||
            "";
          if (typeof area === "string" && area.trim().length > 0) {
            unique.add(area.trim());
          }
        });
        const localAreas = Array.from(unique).sort((a, b) =>
          a.localeCompare(b),
        );
        console.log("[DownloadReport] Using local areas:", localAreas);
        setBranchAreas(localAreas);
      } finally {
        setAreasLoading(false);
      }
    };

    fetchAreas();
  }, [branchId, workers]);

  useEffect(() => {
    setAssignedArea("");
  }, [branchId]);

  const fromTs = useMemo(() => parseDateText(fromText), [fromText]);
  const toTs = useMemo(() => {
    const t = parseDateText(toText);
    return t != null ? t + DAY_MS - 1 : null;
  }, [toText]);

  const hasRange = !!branchId && fromTs != null && toTs != null;

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [branchId, fromTs, toTs, assignedAreaFilterValue]);

  useEffect(() => {
    if (isEmbeddedPreview) {
      setReportData([]);
      setFetchError("preview_blocked");
      setLoading(false);
      return;
    }

    if (!branchId || fromTs == null || toTs == null) {
      setReportData([]);
      setFetchError(null);
      setLoading(false);
      return;
    }

    const activeBranchId = branchId;
    let cancelled = false;

    const matchesAssignedArea = (area?: string | null) => {
      if (!assignedAreaFilterLower) return true;
      return (area || "").trim().toLowerCase() === assignedAreaFilterLower;
    };

    const mapRows = (rows: any[]) => {
      const branchLabel = branchName || activeBranchId;
      return rows
        .map((row) => {
          const assignedAreaValue = String(
            row.assignedArea || row.assigned_area || "",
          ).trim();
          return {
            workerId: String(row.workerId || row.worker_id || ""),
            branchId: String(
              row.branchId || row.branch_id || activeBranchId || "",
            ),
            name: String(row.name || ""),
            branchName:
              branchLabel || String(row.branchId || activeBranchId || ""),
            arrivalDate: Number(row.arrivalDate || row.arrival_date || 0) || 0,
            assignedArea: assignedAreaValue,
            verificationCount: Number(row.verificationCount || 0) || 0,
            totalAmount: Number(row.totalAmount || 0) || 0,
            lastVerifiedAt: Number(row.lastVerifiedAt || 0) || 0,
          };
        })
        .filter((row) => matchesAssignedArea(row.assignedArea));
    };

    const mapSupabaseRecords = (records: any[]) => {
      const rowsMap = new Map<string, ReportRow>();
      const parseDocs = (raw: any) => {
        if (!raw) return {} as Record<string, any>;
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return {} as Record<string, any>;
          }
        }
        if (typeof raw === "object") return raw;
        return {} as Record<string, any>;
      };

      records.forEach((item) => {
        const worker = item?.verification?.worker;
        if (!worker?.id) return;
        const amount = Number(item?.amount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        const verifiedAtIso = item?.verification?.verified_at;
        const verifiedAtTs = verifiedAtIso
          ? new Date(verifiedAtIso).getTime()
          : 0;
        if (!Number.isFinite(verifiedAtTs) || verifiedAtTs <= 0) return;
        const workerId = String(worker.id);
        const docs = parseDocs(worker.docs);
        const assignedAreaValue =
          worker.assigned_area ||
          docs?.assignedArea ||
          docs?.assigned_area ||
          "";
        const normalizedAssignedArea = (assignedAreaValue || "").trim();
        const arrivalTs = worker.arrival_date
          ? new Date(worker.arrival_date).getTime()
          : 0;

        if (!matchesAssignedArea(normalizedAssignedArea)) {
          return;
        }

        if (!rowsMap.has(workerId)) {
          rowsMap.set(workerId, {
            workerId,
            branchId: worker.branch_id || activeBranchId,
            name: worker.name || "",
            branchName: branchName || worker.branch_id || activeBranchId,
            arrivalDate: Number.isFinite(arrivalTs) ? arrivalTs : 0,
            assignedArea: normalizedAssignedArea,
            verificationCount: 0,
            totalAmount: 0,
            lastVerifiedAt: verifiedAtTs,
          });
        }

        const entry = rowsMap.get(workerId)!;
        entry.verificationCount += 1;
        entry.totalAmount += amount;
        entry.lastVerifiedAt = Math.max(entry.lastVerifiedAt, verifiedAtTs);
      });

      return Array.from(rowsMap.values()).sort(
        (a, b) => b.lastVerifiedAt - a.lastVerifiedAt,
      );
    };

    const fetchViaSupabase = async () => {
      const supaUrl = import.meta.env.VITE_SUPABASE_URL;
      const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supaUrl || !supaAnon) {
        throw new Error("supabase_env_missing");
      }

      const rest = `${supaUrl.replace(/\/$/, "")}/rest/v1`;
      const headers = {
        apikey: supaAnon,
        Authorization: `Bearer ${supaAnon}`,
      };

      // OPTIMIZATION: Reduced limit from 20000 to 1000 for faster load times
      const limitParam = 1000;
      const fromIso = new Date(fromTs).toISOString();
      const toIso = new Date(toTs).toISOString();

      // STEP 1: Fetch payments with minimal columns (using indexed columns only)
      const paymentsUrl = new URL(`${rest}/hv_payments`);
      paymentsUrl.searchParams.set(
        "select",
        "worker_id,amount,saved_at,verification_id",
      );
      paymentsUrl.searchParams.append("saved_at", `gte.${fromIso}`);
      paymentsUrl.searchParams.append("saved_at", `lte.${toIso}`);
      paymentsUrl.searchParams.set("order", "saved_at.asc");
      paymentsUrl.searchParams.set("limit", limitParam.toString());

      const paymentsRes = await fetch(paymentsUrl.toString(), { headers });
      if (!paymentsRes.ok) {
        const body = await paymentsRes.text().catch(() => "");
        throw new Error(body || `supabase_http_${paymentsRes.status}`);
      }

      const payments = (await paymentsRes.json().catch(() => [])) as any[];

      if (payments.length === 0) {
        return [];
      }

      // STEP 2: Get verification data for payments
      const verificationIds = Array.from(
        new Set(payments.map((p: any) => p.verification_id).filter(Boolean)),
      );

      const verificationsUrl = new URL(`${rest}/hv_verifications`);
      verificationsUrl.searchParams.set("select", "id,verified_at");
      verificationsUrl.searchParams.set(
        "id",
        `in.(${verificationIds.join(",")})`,
      );

      const verificationsRes = await fetch(verificationsUrl.toString(), {
        headers,
      });
      const verifications = (await verificationsRes
        .json()
        .catch(() => [])) as any[];
      const verificationMap = new Map(verifications.map((v: any) => [v.id, v]));

      // STEP 3: Get worker details for payments
      const workerIds = Array.from(
        new Set(payments.map((p: any) => p.worker_id).filter(Boolean)),
      );

      const workersUrl = new URL(`${rest}/hv_workers`);
      workersUrl.searchParams.set(
        "select",
        "id,name,branch_id,arrival_date,assigned_area,docs",
      );
      workersUrl.searchParams.set("id", `in.(${workerIds.join(",")})`);

      const workersRes = await fetch(workersUrl.toString(), { headers });
      const workers = (await workersRes.json().catch(() => [])) as any[];
      const workerMap = new Map(workers.map((w: any) => [w.id, w]));

      // STEP 4: Merge data in memory
      const parseDocs = (raw: any) => {
        if (!raw) return {};
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        }
        return typeof raw === "object" ? raw : {};
      };

      const records = payments
        .map((payment: any) => {
          const worker = workerMap.get(payment.worker_id);
          const verification = verificationMap.get(payment.verification_id);

          if (!worker || !verification) return null;

          const docs = parseDocs(worker.docs);
          const assignedArea =
            worker.assigned_area ||
            docs?.assignedArea ||
            docs?.assigned_area ||
            "";

          // Apply assigned area filter
          if (
            assignedAreaFilterValue &&
            assignedArea.toLowerCase() !== assignedAreaFilterValue.toLowerCase()
          ) {
            return null;
          }

          // Filter by branch
          if (worker.branch_id !== activeBranchId) return null;

          return {
            verification_id: payment.verification_id,
            amount: payment.amount,
            saved_at: payment.saved_at,
            verification: {
              verified_at: verification.verified_at,
              worker: {
                id: worker.id,
                name: worker.name,
                arrival_date: worker.arrival_date,
                assigned_area: assignedArea,
                branch_id: worker.branch_id,
                docs: worker.docs,
              },
            },
          };
        })
        .filter(Boolean);

      if (cancelled) return [];
      return mapSupabaseRecords(records);
    };

    const fetchViaServer = async () => {
      const params = new URLSearchParams({
        branchId: activeBranchId,
        from: new Date(fromTs).toISOString(),
        to: new Date(toTs).toISOString(),
      });
      if (assignedAreaFilterValue) {
        params.set("assignedArea", assignedAreaFilterValue);
      }
      const res = await fetch(`/api/reports/branch-verifications?${params}`);
      if (!res.ok) {
        throw new Error(`http_${res.status}`);
      }
      if (cancelled) return [];
      const payload = await res.json();
      if (cancelled) return [];
      if (payload?.ok && Array.isArray(payload.rows)) {
        return mapRows(payload.rows);
      }
      throw new Error(payload?.message || "unable_to_load_report");
    };

    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const supaRows = await fetchViaSupabase();
        if (cancelled) return;
        setReportData(supaRows);
        setFetchError(null);
      } catch (primaryErr: any) {
        if (cancelled) return;
        try {
          const serverRows = await fetchViaServer();
          if (cancelled) return;
          setReportData(serverRows);
          setFetchError(null);
        } catch (serverErr: any) {
          if (cancelled) return;
          setReportData([]);
          setFetchError(
            serverErr?.message || primaryErr?.message || "network_error",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [
    branchId,
    branchName,
    fromTs,
    toTs,
    isEmbeddedPreview,
    assignedAreaFilterLower,
    assignedAreaFilterValue,
  ]);

  const totalAmount = useMemo(
    () => reportData.reduce((sum, row) => sum + row.totalAmount, 0),
    [reportData],
  );

  const totalVerifications = useMemo(
    () => reportData.reduce((sum, row) => sum + row.verificationCount, 0),
    [reportData],
  );

  const totalPages = Math.ceil(reportData.length / ITEMS_PER_PAGE);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return reportData.slice(startIndex, endIndex);
  }, [reportData, currentPage]);

  const downloadDisabled = loading || !reportData.length;

  const emptyStateMessage = useMemo(() => {
    if (!branchId) {
      return tr(
        "لم يتم اختيار فرع حتى الآن",
        "No branch has been selected yet.",
      );
    }
    if (!hasRange) {
      return tr(
        "يرجى إدخال تاريخ البداية والنهاية لعرض العمليات.",
        "Please enter both start and end dates to load verifications.",
      );
    }
    if (fetchError) {
      if (fetchError === "preview_blocked") {
        return tr(
          "لا يمكن تحميل التقارير أثناء المعاينة، الرجاء فتح الصفحة مباشرة.",
          "Reports cannot be loaded inside the preview; please open the page directly.",
        );
      }
      return (
        tr("تعذر تحميل البيانات", "Failed to load data") + `: ${fetchError}`
      );
    }
    return tr(
      "لا توجد عمليات تحقق لهذه الفترة",
      "No verifications for this period",
    );
  }, [branchId, fetchError, hasRange, tr]);

  const handleDownload = async () => {
    if (!reportData.length) {
      try {
        const { toast } = await import("sonner");
        toast.error(
          tr("لا توجد بيانات لتحميلها", "No data available to download"),
        );
      } catch {}
      return;
    }

    const now = new Date();
    const today =
      String(now.getFullYear()).padStart(4, "0") +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const branchSlug = (branchName || branchId || "branch")
      .toString()
      .replace(/\s+/g, "-");
    const fileName = "report-" + branchSlug + "-" + today + ".xlsx";

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(
      "Branch Report " + (branchName || branchId || "Unknown"),
    );

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

            {/* Assigned Area */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {tr("منطقة الإسناد", "Assigned Area")}
              </label>
              <Select
                value={assignedAreaFilterValue || "all"}
                onValueChange={(value) =>
                  setAssignedArea(value === "all" ? "" : value)
                }
                disabled={!branchAreas.length}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tr("كل المناطق", "All areas")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {tr("كل المناطق", "All areas")}
                  </SelectItem>
                  {branchAreas.map((area) => (
                    <SelectItem key={area} value={area}>
                      {area}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Download Button */}
            <div className="flex items-end">
              <Button
                onClick={handleDownload}
                className="w-full gap-2"
                variant="default"
                disabled={downloadDisabled}
              >
                <Download className="h-4 w-4" />
                {tr("تحميل", "Download")}
              </Button>
            </div>
          </div>
        </div>

        {/* Results Table */}
        {loading ? (
          <div className="text-center py-12 rounded-lg border bg-card">
            <p className="text-muted-foreground">
              {tr("جاري تحميل البيانات...", "Loading verifications...")}
            </p>
          </div>
        ) : reportData.length === 0 ? (
          <div className="text-center py-12 rounded-lg border bg-card">
            <p className="text-muted-foreground">{emptyStateMessage}</p>
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
                    {tr("منطقة الإسناد", "Assigned Area")}
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
                    <TableRow key={row.workerId || index}>
                      <TableCell className="font-medium text-gray-500 w-8">
                        {rowNumber}
                      </TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.arrivalDate)}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {row.assignedArea || tr("غير محدد", "Unassigned")}
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
                    {totalVerifications}
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
