import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/app-layout";
import { ProtectedRoute } from "@/components/protected-route";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import PlaceholderPage from "@/pages/placeholder";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";
import KioskPage from "@/pages/kiosk";

function AuthenticatedRouter() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/attendance">{() => <PlaceholderPage title="My Attendance" />}</Route>
        <Route path="/time-off">{() => <PlaceholderPage title="Time Off" />}</Route>
        <Route path="/profile">{() => <PlaceholderPage title="Profile" />}</Route>
        <Route path="/team">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <PlaceholderPage title="Team View" />
          </ProtectedRoute>
        )}</Route>
        <Route path="/approvals">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <PlaceholderPage title="Approvals" />
          </ProtectedRoute>
        )}</Route>
        <Route path="/company">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PlaceholderPage title="Company" />
          </ProtectedRoute>
        )}</Route>
        <Route path="/users">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PlaceholderPage title="Users" />
          </ProtectedRoute>
        )}</Route>
        <Route path="/settings">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PlaceholderPage title="Settings" />
          </ProtectedRoute>
        )}</Route>
        <Route path="/reports">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PlaceholderPage title="Reports" />
          </ProtectedRoute>
        )}</Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function AppContent() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background" data-testid="loading-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Switch>
          <Route path="/kiosk" component={KioskPage} />
          <Route>
            {() => <AppContent />}
          </Route>
        </Switch>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
