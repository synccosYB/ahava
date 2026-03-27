import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger data-testid="button-sidebar-trigger" />
        </header>
        <main className="flex-1 overflow-auto" data-testid="main-content">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
