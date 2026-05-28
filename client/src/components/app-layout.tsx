import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SynkDexWidget } from "@/components/synkdex-widget";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function getShortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl + B";
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  return isMac ? "⌘ B" : "Ctrl + B";
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const shortcut = getShortcutLabel();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-4">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger data-testid="button-sidebar-trigger" className="-ml-1" />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>Toggle sidebar</span>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    {shortcut}
                  </kbd>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
            Ahava Medical Center
          </span>
        </header>
        <main className="flex-1 overflow-auto p-6" data-testid="main-content">
          {children}
        </main>
      </SidebarInset>
      <SynkDexWidget />
    </SidebarProvider>
  );
}
