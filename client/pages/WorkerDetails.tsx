import { useParams, Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";

export default function WorkerDetails() {
  const { id } = useParams();
  const { workers } = useWorkers();
  const worker = id ? workers[id] : undefined;

  if (!worker) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">لا توجد بيانات للعاملة المطلوبة.</p>
        <Link to="/workers" className="text-primary hover:underline">��لعودة إلى قائمة العاملات</Link>
      </main>
    );
  }

  const total = worker.verifications.reduce((sum, v) => sum + (v.payment?.amount ?? 0), 0);

  return (
    <main className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">بيانات العاملة: {worker.name}</h1>
          <p className="text-sm text-muted-foreground">تاريخ الوصول: {new Date(worker.arrivalDate).toLocaleDateString("ar-EG")}</p>
        </div>
        <Link to="/workers" className="text-primary hover:underline">العودة</Link>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">سجل عمليات التحقق والمبالغ</div>
        <ul className="divide-y">
          {worker.verifications.length === 0 && (<li className="p-6 text-center text-muted-foreground">لا توجد عمليات تحقق بعد</li>)}
          {worker.verifications.map((v) => (
            <li key={v.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">تاريخ التحقق: {new Date(v.verifiedAt).toLocaleString("ar")}</div>
                    <div className="text-sm text-muted-foreground">{v.payment ? (<span>تم التحقق — ₱ {v.payment.amount} — محفوظ بتاريخ {new Date(v.payment.savedAt).toLocaleString("ar")}</span>) : (<span>لا يوجد مبلغ محفوظ</span>)}</div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t p-4 text-right font-semibold">الإجمالي: ₱ {total}</div>
      </div>
    </main>
  );
}
