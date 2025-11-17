import { useNavigate } from "react-router-dom";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { Button } from "@/components/ui/button";
import { Calendar, FileText } from "lucide-react";

export default function SelectReport() {
  const navigate = useNavigate();
  const { tr } = useI18n();

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-8 flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold">
              {tr("اختر نوع التقرير", "Select Report Type")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr(
                "اختر بين التقرير اليومي أو الشامل",
                "Choose between daily or comprehensive report",
              )}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 max-w-2xl mx-auto mt-12">
          {/* Daily Report Card */}
          <button
            onClick={() => navigate("/daily-report")}
            className="group relative overflow-hidden rounded-lg border-2 border-transparent bg-card p-8 shadow-sm transition-all hover:border-blue-500 hover:shadow-lg hover:bg-blue-50"
          >
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-blue-100 p-4 group-hover:bg-blue-200 transition-colors">
                <Calendar className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {tr("التقرير اليومي", "Daily Report")}
                </h3>
                <p className="text-muted-foreground">
                  {tr(
                    "عرض التحققات والمبالغ لليوم الحالي",
                    "View verifications and amounts for today",
                  )}
                </p>
              </div>
              <Button className="w-full mt-4 gap-2" variant="default">
                <Calendar className="h-4 w-4" />
                {tr("التقرير اليومي", "Daily Report")}
              </Button>
            </div>
          </button>

          {/* Comprehensive Report Card */}
          <button
            onClick={() => navigate("/admin-login")}
            className="group relative overflow-hidden rounded-lg border-2 border-transparent bg-card p-8 shadow-sm transition-all hover:border-green-500 hover:shadow-lg hover:bg-green-50"
          >
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-green-100 p-4 group-hover:bg-green-200 transition-colors">
                <FileText className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {tr("التقرير الشامل", "Comprehensive Report")}
                </h3>
                <p className="text-muted-foreground">
                  {tr(
                    "عرض التقرير الشامل والإحصائيات المفصلة",
                    "View comprehensive report and detailed statistics",
                  )}
                </p>
              </div>
              <Button className="w-full mt-4 gap-2" variant="default">
                <FileText className="h-4 w-4" />
                {tr("التقرير الشامل", "Comprehensive Report")}
              </Button>
            </div>
          </button>
        </div>
      </section>
    </main>
  );
}
