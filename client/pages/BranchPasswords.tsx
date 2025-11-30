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
import { Eye, EyeOff, RefreshCw, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
  const [refreshing, setRefreshing] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set(),
  );
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string>("");
  const [editingBranchName, setEditingBranchName] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    // Check if admin is logged in
    const isAdmin = localStorage.getItem("adminAuth");
    if (!isAdmin) {
      navigate("/admin-login");
      return;
    }

    // Fetch branches with passwords
    fetchBranches();

    // Refresh data when window regains focus
    const handleFocus = () => {
      fetchBranches();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
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
      const branchesWithPasswords = data.branches.map((branch: any) => {
        console.log(
          `Branch ${branch.name}: password_hash = ${branch.password_hash ? "SET" : "EMPTY"}`,
        );
        return {
          id: branch.id,
          name: branch.name,
          passwordHash:
            branch.password_hash && branch.password_hash.trim()
              ? branch.password_hash
              : "لم يتم تعيين كلمة مرور",
        };
      });

      console.log("Mapped branches:", branchesWithPasswords);
      setBranches(branchesWithPasswords);

      // Show toast if any branch has no password
      const hasEmptyPassword = branchesWithPasswords.some(
        (b) => b.passwordHash === "لم يتم تعيين كلمة مرور",
      );
      if (hasEmptyPassword) {
        console.warn("Some branches have empty passwords");
      }
    } catch (error: any) {
      toast.error(error?.message || tr("خطأ في ا��اتصال", "Connection error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchBranches();
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

  function handleEditBranch(branch: BranchPassword) {
    setEditingBranchId(branch.id);
    setEditingBranchName(branch.name);
    setNewPassword("");
    setConfirmPassword("");
    setEditDialogOpen(true);
  }

  async function handleSavePassword() {
    if (!newPassword.trim()) {
      toast.error(tr("يرجى إدخال كلمة مرور", "Please enter a password"));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(tr("كلمات المرور غير متطابقة", "Passwords do not match"));
      return;
    }

    if (newPassword.length < 3) {
      toast.error(tr("كلمة المرور قصيرة جداً", "Password is too short"));
      return;
    }

    setEditLoading(true);
    try {
      const response = await fetch("/api/branches/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: editingBranchId,
          password: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(
          data.message || tr("فشل تحديث كلمة المرور", "Failed to update password"),
        );
        setEditLoading(false);
        return;
      }

      toast.success(tr("تم تحديث كلمة المرور بنجاح", "Password updated successfully"));
      setEditDialogOpen(false);
      await fetchBranches();
    } catch (error: any) {
      toast.error(error?.message || tr("خطأ في الاتصال", "Connection error"));
    } finally {
      setEditLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-3xl font-bold">
              {tr("كلمات مرور الفروع", "Branch Passwords")}
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {tr("تحديث", "Refresh")}
          </Button>
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
                    <TableCell className="text-center flex items-center justify-center gap-2">
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditBranch(branch)}
                      >
                        <Edit2 className="h-4 w-4" />
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
