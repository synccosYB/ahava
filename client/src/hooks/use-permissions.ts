import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

interface PermissionsResponse {
  permissions: string[];
}

export function usePermissions() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading } = useQuery<PermissionsResponse>({
    queryKey: ["/api/auth/permissions"],
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });

  const permissions = data?.permissions ?? [];
  const set = new Set(permissions);
  const isSuper = set.has("system.super_admin");

  return {
    permissions,
    isLoading,
    has: (key: string) => isSuper || set.has(key),
  };
}
