import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-4">
          <SidebarTrigger data-testid="button-sidebar-trigger" className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
            Ahava Medical Center
          </span>
        </header>
        <main className="flex-1 overflow-auto p-6" data-testid="main-content">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
