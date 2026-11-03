import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  roles: string[];
  /**
   * Optional: also admit a user who holds ANY of these permissions, even if
   * their base role isn't in `roles`. Lets a permission-based role (e.g. a
   * bookkeeper with attendance.view_all) reach a page without being a manager.
   */
  anyPermission?: string[];
  children: React.ReactNode;
}

export function ProtectedRoute({ roles, anyPermission, children }: ProtectedRouteProps) {
  const { user } = useAuth();
  const { has, isLoading } = usePermissions();
  const userRole = user?.role ?? "employee";

  const roleOk = roles.includes(userRole);
  const permOk = (anyPermission ?? []).some((p) => has(p));

  // Wait for permissions to load before redirecting a permission-admitted user.
  if (!roleOk && anyPermission && anyPermission.length > 0 && isLoading) {
    return null;
  }

  if (!roleOk && !permOk) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}
