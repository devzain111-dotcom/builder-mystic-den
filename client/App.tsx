import "@/lib/patchResizeObserver";
import "@/global.css";

import { Toaster } from "@/components/ui/toaster";
import * as ReactDOM from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Workers from "./pages/Workers";
import WorkerDetails from "./pages/WorkerDetails";
import AdminLogin from "./pages/AdminLogin";
import AdminReport from "./pages/AdminReport";
import AdminStatusReview from "./pages/AdminStatusReview";
import NoExpense from "./pages/NoExpense";
import DailyReport from "./pages/DailyReport";
import BranchAuth from "./pages/BranchAuth";
import BranchPasswords from "./pages/BranchPasswords";
import VerificationRecords from "./pages/VerificationRecords";
import SelectReport from "./pages/SelectReport";
import DownloadReport from "./pages/DownloadReport";
import { WorkersProvider } from "@/context/WorkersContext";
import { I18nProvider } from "@/context/I18nContext";
import { PageRefreshProvider } from "@/context/PageRefreshContext";
import Header from "@/components/Header";
import { useWorkers } from "@/context/WorkersContext";

const AppContent = () => {
  const workers = useWorkers();
  const { selectedBranchId } = workers;

  if (!selectedBranchId) {
    return <BranchAuth />;
  }

  // Show loading state while initial data is being fetched
  const hasWorkers = Object.values(workers.workers).length > 0;
  if (!hasWorkers) {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
        <div className="text-center space-y-6">
          <svg
            className="w-12 h-12 text-blue-600 animate-spin mx-auto"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-gray-900">جاري تحميل البيانات...</h2>
            <p className="text-gray-600">يرجى الانتظار بينما يتم تحميل بيانات النظام</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/workers" element={<Workers />} />
        <Route path="/workers/:id" element={<WorkerDetails />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminReport />} />
        <Route path="/admin/status-review" element={<AdminStatusReview />} />
        <Route path="/admin/branch-passwords" element={<BranchPasswords />} />
        <Route
          path="/admin/verification-records"
          element={<VerificationRecords />}
        />
        <Route path="/select-report" element={<SelectReport />} />
        <Route path="/download-report" element={<DownloadReport />} />
        <Route path="/no-expense" element={<NoExpense />} />
        <Route path="/daily-report" element={<DailyReport />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <I18nProvider>
      <PageRefreshProvider>
        <WorkersProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </WorkersProvider>
      </PageRefreshProvider>
    </I18nProvider>
  </TooltipProvider>
);

export default App;

const container = document.getElementById("root")! as HTMLElement & {
  _reactRoot?: ReactDOM.Root;
};

function renderApp() {
  const existing = container._reactRoot;
  const root = existing ?? ReactDOM.createRoot(container);
  container._reactRoot = root;
  root.render(<App />);
}

// Initial render
renderApp();

if (import.meta && (import.meta as any).hot) {
  (import.meta as any).hot.dispose?.(() => {
    // Clean up root on HMR to ensure fresh context initialization
    if (container._reactRoot) {
      try {
        container._reactRoot.unmount();
      } catch {}
      container._reactRoot = undefined;
    }
  });
  (import.meta as any).hot.accept?.(() => {
    // Re-render on HMR with fresh context
    renderApp();
  });
}
