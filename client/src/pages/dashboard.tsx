import { useAuth } from "@/hooks/use-auth";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="p-6" data-testid="dashboard-page">
      <h1 className="text-2xl font-bold mb-4" data-testid="text-page-title">Dashboard</h1>
      <p className="text-muted-foreground" data-testid="text-welcome">
        Welcome{user?.firstName ? `, ${user.firstName}` : ""}! This is the Ahava Medical Center Time & Attendance system.
      </p>
    </div>
  );
}
