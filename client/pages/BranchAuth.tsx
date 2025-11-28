import { useState, useEffect } from "react";
import { useWorkers } from "@/context/WorkersContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export default function BranchAuth() {
  const { branches, setSelectedBranchId } = useWorkers();
  const [selectedId, setSelectedId] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [localBranches, setLocalBranches] = useState<any[]>([]);

  // Get branches list - first from context, then from API if needed
  const branchList = Object.values(branches);

  useEffect(() => {
    // If no branches in context, fetch from API
    if (branchList.length === 0) {
      const fetchBranches = async () => {
        try {
          const response = await fetch("/api/branches");
          const data = await response.json();
          if (data.ok && Array.isArray(data.branches)) {
            setLocalBranches(data.branches);
            if (data.branches.length > 0) {
              setSelectedId(data.branches[0].id);
            }
          }
        } catch (err) {
          console.error("Failed to fetch branches:", err);
        }
      };
      fetchBranches();
    }
  }, [branchList.length]);

  // Use context branches if available, otherwise use fetched branches
  const displayBranches = branchList.length > 0 ? branchList : localBranches;

  useEffect(() => {
    if (displayBranches.length > 0 && !selectedId) {
      setSelectedId(displayBranches[0].id);
    }
  }, [displayBranches, selectedId]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!selectedId) {
        setError("الرجاء اختيار فرع");
        setLoading(false);
        return;
      }

      if (!password) {
        setError("الرجاء إدخال كلمة المرور");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/branches/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedId, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setError(
          data.message === "wrong_password"
            ? "كلمة مرور غير صحيحة"
            : "فشل التحقق من البيانات",
        );
        setLoading(false);
        return;
      }

      // Set selected branch in context (will save to session storage automatically)
      setSelectedBranchId(selectedId);

      toast.success("تم تسجيل الدخول بنجاح");
    } catch (err: any) {
      setError(err?.message || "حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8 space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="flex justify-center mb-4">
              <Lock className="w-12 h-12 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">اختر الفرع</h1>
            <p className="text-gray-600">قم بتسجيل الدخول إلى نظام التحقق</p>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-4">
            {/* Branch Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                اسم الفرع
              </label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {branchList.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                كلمة المرور
              </label>
              <Input
                type="password"
                placeholder="أدخل كلمة المرور"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="w-full"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading || !selectedId}
              className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {loading ? "جاري التحقق..." : "تسجيل الدخول"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
