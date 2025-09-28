import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function AdminLogin() {
  const [pin, setPin] = useState("");
  const navigate = useNavigate();
  function handleSubmit(e: React.FormEvent) { e.preventDefault(); if (pin.trim() === "123456") { localStorage.setItem("adminAuth", "1"); navigate("/admin"); } else { toast.error("كلمة المرور غير صحيحة"); } }
  return (
    <main className="container py-12">
      <div className="mx-auto max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-center">تسجيل دخول الإدارة</h1>
        <p className="mb-6 text-center text-muted-foreground text-sm">أدخل كلمة المرور للوصول إلى لوحة التقارير.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="pin" className="mb-1 block text-sm">كلمة المرور</label>
            <Input id="pin" type="password" value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="••••••" required />
          </div>
          <Button type="submit" variant="admin" className="w-full">دخول</Button>
        </form>
      </div>
    </main>
  );
}
