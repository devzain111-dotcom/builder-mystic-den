import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "@/components/BackButton";
import { useWorkers } from "@/context/WorkersContext";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { Download, Calendar, FileText } from "lucide-react";
import * as XLSX from "xlsx";

export default function DownloadReport() {
  const navigate = useNavigate();
  const { tr } = useI18n();
  const { workers, branches, selectedBranchId } = useWorkers() as any;

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

  const handleDownloadDaily = () => {
    const now = new Date();
    const today =
      String(now.getFullYear()).padStart(4, "0") +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const fileName = "تقرير-يومي-" + today + ".xlsx";
    const dataForExport = verifiedList
      .map((w: any) => ({
        الاسم: w.name || "",
        "الفرع": branches[w.branchId]?.name || "",
        "تاريخ الوصول": new Date(w.arrivalDate || 0).toLocaleDateString("ar"),
        "التحقق": w.verifications?.length || 0,
      }))
      .concat({
        الاسم: "المجموع",
        "الفرع": "",
        "تاريخ الوصول": "",
        "التحقق": verifiedList.reduce((sum, w: any) => sum + (w.verifications?.length || 0), 0),
      });
    const ws = XLSX.utils.json_to_sheet(dataForExport, {
      header: ["الاسم", "الفرع", "تاريخ الوصول", "التحقق"],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير يومي");
    XLSX.writeFile(wb, fileName);
  };

  const handleDownloadComprehensive = () => {
    navigate("/admin-login");
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-8 flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold">
              {tr("تحميل التقارير", "Download Reports")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr(
                "اختر نوع التقرير الذي تريد تحميله",
                "Select the report type you want to download",
              )}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 max-w-2xl mx-auto mt-12">
          {/* Daily Report Download Card */}
          <div className="group relative overflow-hidden rounded-lg border-2 border-transparent bg-card p-8 shadow-sm hover:border-blue-500 hover:shadow-lg hover:bg-blue-50 transition-all">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-blue-100 group-hover:bg-blue-200 transition-colors p-4">
                <Calendar className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {tr("التقرير اليومي", "Daily Report")}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {tr(
                    "تحميل التحققات والمبالغ لليوم ال��الي",
                    "Download today's verifications and amounts",
                  )}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {tr("عدد المتحققين:", "Verified count:")} {verifiedList.length}
                </p>
              </div>
              <Button
                className="w-full mt-4 gap-2"
                variant="default"
                onClick={handleDownloadDaily}
              >
                <Download className="h-4 w-4" />
                {tr("تحميل التقرير اليومي", "Download Daily Report")}
              </Button>
            </div>
          </div>

          {/* Comprehensive Report Download Card */}
          <div className="group relative overflow-hidden rounded-lg border-2 border-transparent bg-card p-8 shadow-sm hover:border-green-500 hover:shadow-lg hover:bg-green-50 transition-all">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-green-100 group-hover:bg-green-200 transition-colors p-4">
                <FileText className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {tr("التقرير الشامل", "Comprehensive Report")}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {tr(
                    "تحميل التقرير الشامل من صفحة الإدارة",
                    "Download comprehensive report from admin page",
                  )}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {tr(
                    "إحصائيات مفصلة وتقارير شاملة",
                    "Detailed statistics and comprehensive reports",
                  )}
                </p>
              </div>
              <Button
                className="w-full mt-4 gap-2"
                variant="default"
                onClick={handleDownloadComprehensive}
              >
                <Download className="h-4 w-4" />
                {tr("الذهاب للإدارة", "Go to Admin")}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
