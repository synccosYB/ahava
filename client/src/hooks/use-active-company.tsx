import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Company } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "activeCompanyId";

interface ActiveCompanyContextValue {
  companies: Company[];
  activeCompanyId: string | undefined;
  activeCompany: Company | undefined;
  setActiveCompanyId: (id: string) => void;
  isLoading: boolean;
}

const ActiveCompanyContext = createContext<ActiveCompanyContextValue | undefined>(undefined);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isAuthenticated,
  });

  const [stored, setStored] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(STORAGE_KEY) || undefined;
  });

  // Resolve the active company: an explicit, still-valid selection wins; then
  // the user's own assigned company; then the first company as the default.
  const activeCompanyId = useMemo(() => {
    const isValid = (id: string | undefined | null) =>
      !!id && companies.some((c) => c.id === id);
    if (isValid(stored)) return stored;
    if (isValid(user?.companyId)) return user?.companyId ?? undefined;
    return companies[0]?.id;
  }, [stored, user?.companyId, companies]);

  // Keep the persisted selection in sync once it resolves to a real company so
  // the choice survives reloads even when it originated from a default.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeCompanyId && activeCompanyId !== stored) {
      localStorage.setItem(STORAGE_KEY, activeCompanyId);
      setStored(activeCompanyId);
    }
  }, [activeCompanyId, stored]);

  const setActiveCompanyId = (id: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
    setStored(id);
  };

  const value = useMemo<ActiveCompanyContextValue>(
    () => ({
      companies,
      activeCompanyId,
      activeCompany: companies.find((c) => c.id === activeCompanyId),
      setActiveCompanyId,
      isLoading,
    }),
    [companies, activeCompanyId, isLoading],
  );

  return <ActiveCompanyContext.Provider value={value}>{children}</ActiveCompanyContext.Provider>;
}

export function useActiveCompany(): ActiveCompanyContextValue {
  const ctx = useContext(ActiveCompanyContext);
  if (!ctx) {
    throw new Error("useActiveCompany must be used within an ActiveCompanyProvider");
  }
  return ctx;
}
