import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/context/I18nContext";

export default function AdminLogin() {
  const [pin, setPin] = useState("");
  const navigate = useNavigate();
  const { t } = useI18n();
  function handleSubmit(e: React.FormEvent) { e.preventDefault(); if (pin.trim() === "123456") { localStorage.setItem("adminAuth", "1"); navigate("/admin"); } else { toast.error(t("wrong_password_error")); } }
  return (
    <main className="container py-12">
      <div className="mx-auto max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-center">{t("admin_login_title")}</h1>
        <p className="mb-6 text-center text-muted-foreground text-sm">{t("admin_login_desc")}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="pin" className="mb-1 block text-sm">{t("password_label")}</label>
            <Input id="pin" type="password" value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="••••••" required />
          </div>
          <Button type="submit" variant="admin" className="w-full">{t("login_btn")}</Button>
        </form>
      </div>
    </main>
  );
}
