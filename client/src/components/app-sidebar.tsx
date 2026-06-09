import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  UserCircle,
  Users,
  Settings2,
  BarChart3,
  LogOut,
  MapPin,
  DollarSign,
  ClipboardList,
  Bell,
  FileText,
  ShieldCheck,
  Shield,
  Monitor,
  BookOpen,
  ScanFace,
  Activity,
  Settings,
  RefreshCw,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { TimeOffRequest, AttendanceException } from "@shared/schema";

type NavItem = {
  title: string;
  href: string;
  icon: typeof LayoutDashboard;
};

const youItemsCommon: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "My Attendance", href: "/attendance", icon: Clock },
  { title: "Time Off", href: "/time-off", icon: CalendarDays },
  { title: "My Pay Docs", href: "/my-pay-docs", icon: DollarSign },
  { title: "Profile", href: "/profile", icon: UserCircle },
];

const userManualItem: NavItem = { title: "User Manual", href: "/manual", icon: BookOpen };

const teamItems: NavItem[] = [
  { title: "Team View", href: "/team", icon: Users },
  { title: "Requests & Approvals", href: "/requests-approvals", icon: ClipboardList },
  { title: "Alerts", href: "/alerts", icon: Bell },
];

const adminItems: NavItem[] = [
  { title: "Admin Dashboard", href: "/company", icon: LayoutDashboard },
  { title: "Employees", href: "/employees", icon: Users },
  { title: "Locations", href: "/locations", icon: MapPin },
  { title: "Reports", href: "/reports", icon: BarChart3 },
];

const payrollItems: NavItem[] = [
  { title: "Payroll Prep", href: "/payroll-prep", icon: DollarSign },
  { title: "Payroll Documents", href: "/payroll-documents", icon: FileText },
  { title: "Reconciliation", href: "/reconciliation", icon: RefreshCw },
];

const settingsItems: NavItem[] = [
  { title: "Time Clock Rules", href: "/rules-controls", icon: Settings2 },
  { title: "PTO & Leave", href: "/pto-leave", icon: CalendarDays },
  { title: "Roles", href: "/role-management", icon: Shield },
  { title: "Permissions", href: "/permissions", icon: ShieldCheck },
  { title: "Kiosks", href: "/kiosk-management", icon: Monitor },
  { title: "Biometrics", href: "/biometrics", icon: ScanFace },
  { title: "Background Jobs", href: "/background-jobs", icon: Activity },
  { title: "Audit Log", href: "/audit-log", icon: FileText },
  { title: "User Manual", href: "/manual", icon: BookOpen },
];

function useShortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl + B";
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  return isMac ? "⌘ B" : "Ctrl + B";
}

function SidebarCollapseToggle() {
  const { state, isMobile, toggleSidebar, openMobile } = useSidebar();
  const shortcut = useShortcutLabel();
  const isCollapsed = !isMobile && state === "collapsed";
  const Icon = isMobile
    ? openMobile
      ? PanelLeftClose
      : PanelLeftOpen
    : isCollapsed
      ? PanelLeftOpen
      : PanelLeftClose;
  const label = isCollapsed || (isMobile && !openMobile) ? "Expand sidebar" : "Collapse sidebar";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={label}
            data-testid="button-sidebar-collapse-toggle"
            className={cn(
              "inline-flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
              "h-7 w-7 shrink-0",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={isCollapsed ? "right" : "bottom"}>
          <div className="flex items-center gap-2">
            <span>{label}</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {shortcut}
            </kbd>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function testIdFor(title: string) {
  return `link-nav-${title.toLowerCase().replace(/\s+/g, "-")}`;
}

function getInitials(firstName?: string | null, lastName?: string | null) {
  const f = firstName?.[0] || "";
  const l = lastName?.[0] || "";
  return (f + l).toUpperCase() || "?";
}

function NavLinkItem({
  item,
  badge,
  badgeTestId,
}: {
  item: NavItem;
  badge?: number;
  badgeTestId?: string;
}) {
  const [location] = useLocation();
  const isActive =
    location === item.href || (item.href !== "/" && location.startsWith(item.href));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.title}
        data-testid={testIdFor(item.title)}
      >
        <Link href={item.href}>
          <item.icon className="h-4 w-4" />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {badge !== undefined && badge > 0 && (
        <SidebarMenuBadge data-testid={badgeTestId}>{badge}</SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

function SettingsGroup({ exceptionCount }: { exceptionCount: number }) {
  const [open, setOpen] = useState(false);
  const { state, isMobile } = useSidebar();
  const [location] = useLocation();
  const isIconCollapsed = state === "collapsed" && !isMobile;
  const isAnyChildActive = settingsItems.some(
    (i) => location === i.href || (i.href !== "/" && location.startsWith(i.href)),
  );

  const triggerButton = (
    <SidebarMenuButton
      tooltip="Settings"
      isActive={isAnyChildActive}
      data-testid="button-nav-settings-toggle"
      className="justify-between"
    >
      <span className="flex items-center gap-2">
        <Settings className="h-4 w-4" />
        <span>Settings</span>
      </span>
      <ChevronRight
        className={cn(
          "h-4 w-4 transition-transform duration-200",
          !isIconCollapsed && open && "rotate-90",
          "group-data-[collapsible=icon]:hidden",
        )}
      />
    </SidebarMenuButton>
  );

  const childrenList = (
    <ul className="flex flex-col gap-1">
      {settingsItems.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== "/" && location.startsWith(item.href));
        return (
          <li key={item.href} className="relative">
            <SidebarMenuButton
              asChild
              isActive={isActive}
              data-testid={testIdFor(item.title)}
            >
              <Link href={item.href}>
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
            {item.title === "PTO & Leave" && exceptionCount > 0 && (
              <SidebarMenuBadge data-testid="badge-pending-exceptions">
                {exceptionCount}
              </SidebarMenuBadge>
            )}
          </li>
        );
      })}
    </ul>
  );

  const showSettingsDot =
    exceptionCount > 0 && (isIconCollapsed || !open);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Settings</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          {isIconCollapsed ? (
            <Popover>
              <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-56 p-2"
                data-testid="popover-settings-flyout"
              >
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Settings
                </div>
                {childrenList}
              </PopoverContent>
            </Popover>
          ) : (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>{triggerButton}</CollapsibleTrigger>
              <CollapsibleContent className="pt-1 pl-4">
                {childrenList}
              </CollapsibleContent>
            </Collapsible>
          )}
          {showSettingsDot && (
            <SidebarMenuBadge
              data-testid="badge-settings-pending-dot"
              className="group-data-[collapsible=icon]:flex"
            >
              {exceptionCount}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { user, logout } = useAuth();
  const role = user?.role ?? "employee";
  const isManager = role === "manager" || role === "admin";
  const isAdmin = role === "admin";

  const { data: pendingRequests } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off/pending"],
    enabled: isManager,
  });

  const { data: pendingExceptions } = useQuery<
    (AttendanceException & { employeeName?: string })[]
  >({
    queryKey: ["/api/attendance/exceptions/pending"],
    enabled: isManager,
  });

  const pendingCount =
    (pendingRequests?.length || 0) + (pendingExceptions?.length || 0);
  const exceptionCount = pendingExceptions?.length || 0;

  const youItems: NavItem[] = isAdmin
    ? youItemsCommon
    : [...youItemsCommon, userManualItem];

  return (
    <Sidebar data-testid="app-sidebar" collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img
            src="/ahava-icon.png"
            alt="Ahava Medical Center"
            className="h-8 w-8 rounded object-contain"
            data-testid="img-sidebar-logo"
          />
          <div className="flex flex-col flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <span
              className="text-sm font-semibold text-sidebar-foreground"
              data-testid="text-sidebar-title"
            >
              Ahava Medical
            </span>
            <span
              className="text-xs text-sidebar-foreground/60"
              data-testid="text-sidebar-subtitle"
            >
              Time & Attendance
            </span>
          </div>
          <div className="ml-auto group-data-[collapsible=icon]:hidden">
            <SidebarCollapseToggle />
          </div>
        </div>
        <div className="mt-2 hidden justify-center group-data-[collapsible=icon]:flex">
          <SidebarCollapseToggle />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>You</SidebarGroupLabel>
          <SidebarMenu>
            {youItems.map((item) => (
              <NavLinkItem key={item.href} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {isManager && (
          <SidebarGroup>
            <SidebarGroupLabel>Team</SidebarGroupLabel>
            <SidebarMenu>
              {teamItems.map((item) => (
                <NavLinkItem
                  key={item.href}
                  item={item}
                  badge={
                    item.title === "Requests & Approvals" ? pendingCount : undefined
                  }
                  badgeTestId={
                    item.title === "Requests & Approvals"
                      ? "badge-pending-approvals"
                      : undefined
                  }
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              {adminItems.map((item) => (
                <NavLinkItem key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Payroll</SidebarGroupLabel>
            <SidebarMenu>
              {payrollItems.map((item) => (
                <NavLinkItem key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {isAdmin && <SettingsGroup exceptionCount={exceptionCount} />}
      </SidebarContent>

      <SidebarFooter className="p-4">
        {user ? (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8" data-testid="img-user-avatar">
              <AvatarImage src={user?.profileImageUrl || undefined} />
              <AvatarFallback className="text-xs bg-sidebar-accent text-sidebar-accent-foreground">
                {getInitials(user?.firstName, user?.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
              <span
                className="text-sm font-medium text-sidebar-foreground truncate"
                data-testid="text-user-name"
              >
                {user?.firstName} {user?.lastName}
              </span>
              <Badge
                variant="outline"
                className="w-fit text-[10px] px-1.5 py-0 text-sidebar-foreground/60 border-sidebar-foreground/20"
                data-testid="badge-user-role"
              >
                {role}
              </Badge>
            </div>
            <button
              onClick={() => logout()}
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors group-data-[collapsible=icon]:hidden"
              title="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <a href="/api/login" data-testid="link-login">
            <Button variant="outline" className="w-full">
              Sign In
            </Button>
          </a>
        )}
      </SidebarFooter>
      <SidebarRail data-testid="sidebar-rail" />
    </Sidebar>
  );
}
