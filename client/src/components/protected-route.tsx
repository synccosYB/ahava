import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  roles: string[];
  children: React.ReactNode;
}

export function ProtectedRoute({ roles, children }: ProtectedRouteProps) {
  const { user } = useAuth();
  const userRole = user?.role ?? "employee";

  if (!roles.includes(userRole)) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}
