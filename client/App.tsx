import "@/lib/patchResizeObserver";
import "@/global.css";

import { Toaster } from "@/components/ui/toaster";
import * as ReactDOM from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Workers from "./pages/Workers";
import WorkerDetails from "./pages/WorkerDetails";
import AdminLogin from "./pages/AdminLogin";
import AdminReport from "./pages/AdminReport";
import WorkersStatus from "./pages/WorkersStatus";
import NoExpense from "./pages/NoExpense";
import DailyReport from "./pages/DailyReport";
import { WorkersProvider } from "@/context/WorkersContext";
import { I18nProvider } from "@/context/I18nContext";
import Header from "@/components/Header";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <I18nProvider>
          <WorkersProvider>
            <Header />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/workers" element={<Workers />} />
              <Route path="/workers/:id" element={<WorkerDetails />} />
              <Route path="/admin-login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminReport />} />
              <Route path="/workers-status" element={<WorkersStatus />} />
              <Route path="/no-expense" element={<NoExpense />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </WorkersProvider>
        </I18nProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

const container = document.getElementById("root")! as HTMLElement & { _reactRoot?: ReactDOM.Root };
const existing = container._reactRoot;
const root = existing ?? ReactDOM.createRoot(container);
container._reactRoot = root;
root.render(<App />);

if (import.meta && (import.meta as any).hot) {
  (import.meta as any).hot.accept?.();
}
