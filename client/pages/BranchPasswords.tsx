import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "@/components/BackButton";
import { useI18n } from "@/context/I18nContext";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BranchPassword {
  id: string;
  name: string;
  passwordHash: string;
}

export default function BranchPasswords() {
  const navigate = useNavigate();
  const { tr } = useI18n();
  const [branches, setBranches] = useState<BranchPassword[]>([]);
  const [loading, setLoading] = useState(true);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    // Check if admin is logged in
    const isAdmin = localStorage.getItem("adminAuth");
    if (!isAdmin) {
      navigate("/admin-login");
      return;
    }

    // Fetch branches with passwords
    fetchBranches();
  }, [navigate]);

  async function fetchBranches() {
    try {
      const response = await fetch("/api/branches");
      const data = await response.json();

      if (!response.ok || !data.branches) {
        toast.error(tr("فشل تحميل البيانات", "Failed to load data"));
        setLoading(false);
        return;
      }

      // Map the response to include password_hash
      console.log("Fetched branch data:", data.branches);
      const branchesWithPasswords = data.branches.map((branch: any) => ({
        id: branch.id,
        name: branch.name,
        passwordHash: branch.password_hash || "لم يتم تعيين كلمة مرور",
      }));

      console.log("Mapped branches:", branchesWithPasswords);
      setBranches(branchesWithPasswords);
    } catch (error: any) {
      toast.error(error?.message || tr("خطأ في ا��اتصال", "Connection error"));
    } finally {
      setLoading(false);
    }
  }

  function togglePasswordVisibility(branchId: string) {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) {
        next.delete(branchId);
      } else {
        next.add(branchId);
      }
      return next;
    });
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-6 flex items-center gap-3">
          <BackButton />
          <h1 className="text-3xl font-bold">
            {tr("كلمات مرور الفروع", "Branch Passwords")}
          </h1>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {tr("جاري التحميل...", "Loading...")}
            </p>
          </div>
        ) : branches.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {tr("لا توجد فروع", "No branches found")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">
                    {tr("اسم الفرع", "Branch Name")}
                  </TableHead>
                  <TableHead className="text-right">
                    {tr("كلمة المرور", "Password")}
                  </TableHead>
                  <TableHead className="text-center">
                    {tr("الإجراء", "Action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">{branch.name}</TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">
                        {visiblePasswords.has(branch.id)
                          ? branch.passwordHash
                          : "••••••••••••••"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => togglePasswordVisibility(branch.id)}
                      >
                        {visiblePasswords.has(branch.id) ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </main>
  );
}
