import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/app-layout";
import { ProtectedRoute } from "@/components/protected-route";
import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import MyAttendance from "@/pages/my-attendance";
import TimeOff from "@/pages/time-off";
import PlaceholderPage from "@/pages/placeholder";
import ManagerDashboardPage from "@/pages/manager-dashboard";
import ApprovalQueuePage from "@/pages/approval-queue";
import AdminDashboardPage from "@/pages/admin-dashboard";
import ReportsPage from "@/pages/reports";
import EmployeesPage from "@/pages/employees";
import LocationsDepartmentsPage from "@/pages/locations-departments";
import AttendanceExceptionsPage from "@/pages/attendance-exceptions";
import PtoLeavePage from "@/pages/pto-leave";
import RulesControlsPage from "@/pages/rules-controls";
import PayrollPrepPage from "@/pages/payroll-prep";
import RequestsApprovalsPage from "@/pages/requests-approvals";
import AlertsPage from "@/pages/alerts";
import AuditLogPage from "@/pages/audit-log";
import PermissionsPage from "@/pages/permissions";
import RoleManagementPage from "@/pages/role-management";
import KioskManagementPage from "@/pages/kiosk-management";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";
import KioskPage from "@/pages/kiosk";

function AuthenticatedRouter() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/attendance" component={MyAttendance} />
        <Route path="/time-off" component={TimeOff} />
        <Route path="/profile">{() => <PlaceholderPage title="Profile" />}</Route>
        <Route path="/team">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <ManagerDashboardPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/approvals">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <ApprovalQueuePage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/requests-approvals">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <RequestsApprovalsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/company">{() => (
          <ProtectedRoute roles={["admin"]}>
            <AdminDashboardPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/employees">{() => (
          <ProtectedRoute roles={["admin"]}>
            <EmployeesPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/locations">{() => (
          <ProtectedRoute roles={["admin"]}>
            <LocationsDepartmentsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/alerts-exceptions">{() => (
          <ProtectedRoute roles={["admin"]}>
            <AttendanceExceptionsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/pto-leave">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PtoLeavePage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/rules-controls">{() => (
          <ProtectedRoute roles={["admin"]}>
            <RulesControlsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/payroll-prep">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PayrollPrepPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/reports">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <ReportsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/alerts">{() => (
          <ProtectedRoute roles={["manager", "admin"]}>
            <AlertsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/audit-log">{() => (
          <ProtectedRoute roles={["admin"]}>
            <AuditLogPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/permissions">{() => (
          <ProtectedRoute roles={["admin"]}>
            <PermissionsPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/role-management">{() => (
          <ProtectedRoute roles={["admin"]}>
            <RoleManagementPage />
          </ProtectedRoute>
        )}</Route>
        <Route path="/kiosk-management">{() => (
          <ProtectedRoute roles={["admin"]}>
            <KioskManagementPage />
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
