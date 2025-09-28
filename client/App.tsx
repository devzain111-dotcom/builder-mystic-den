import "./global.css";
import "@/lib/patchResizeObserver";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
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
              <Route path="*" element={<NotFound />} />
            </Routes>
          </WorkersProvider>
        </I18nProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
