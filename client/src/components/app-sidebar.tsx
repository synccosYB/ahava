import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  UserCircle,
  Users,
  CheckSquare,
  Building2,
  Settings2,
  BarChart3,
  LogOut,
  MapPin,
  AlertTriangle,
  DollarSign,
  ClipboardList,
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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { TimeOffRequest, AttendanceException } from "@shared/schema";

type NavItem = {
  title: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: string[];
  badge?: number;
};

const employeeItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["employee", "manager", "admin"] },
  { title: "My Attendance", href: "/attendance", icon: Clock, roles: ["employee", "manager", "admin"] },
  { title: "Time Off", href: "/time-off", icon: CalendarDays, roles: ["employee", "manager", "admin"] },
  { title: "Profile", href: "/profile", icon: UserCircle, roles: ["employee", "manager", "admin"] },
];

const managerItems: NavItem[] = [
  { title: "Team View", href: "/team", icon: Users, roles: ["manager", "admin"] },
  { title: "Requests & Approvals", href: "/requests-approvals", icon: ClipboardList, roles: ["manager", "admin"] },
];

const adminItems: NavItem[] = [
  { title: "Admin Dashboard", href: "/company", icon: LayoutDashboard, roles: ["admin"] },
  { title: "Employees", href: "/employees", icon: Users, roles: ["admin"] },
  { title: "Locations", href: "/locations", icon: MapPin, roles: ["admin"] },
  { title: "Time Clock Rules", href: "/rules-controls", icon: Settings2, roles: ["admin"] },
  { title: "PTO & Leave", href: "/pto-leave", icon: CalendarDays, roles: ["admin"] },
  { title: "Alerts & Exceptions", href: "/alerts-exceptions", icon: AlertTriangle, roles: ["admin"] },
  { title: "Payroll Prep", href: "/payroll-prep", icon: DollarSign, roles: ["admin"] },
  { title: "Reports", href: "/reports", icon: BarChart3, roles: ["manager", "admin"] },
];

function getInitials(firstName?: string | null, lastName?: string | null) {
  const f = firstName?.[0] || "";
  const l = lastName?.[0] || "";
  return (f + l).toUpperCase() || "?";
}

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const role = user?.role ?? "employee";

  const { data: pendingRequests } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off/pending"],
    enabled: role === "manager" || role === "admin",
  });

  const { data: pendingExceptions } = useQuery<(AttendanceException & { employeeName?: string })[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
    enabled: role === "manager" || role === "admin",
  });

  const pendingCount = (pendingRequests?.length || 0) + (pendingExceptions?.length || 0);
  const exceptionCount = pendingExceptions?.length || 0;

  const filterByRole = (items: NavItem[]) =>
    items.filter((item) => item.roles.includes(role));

  const visibleEmployee = filterByRole(employeeItems);
  const visibleManager = filterByRole(managerItems);
  const visibleAdmin = filterByRole(adminItems);

  return (
    <Sidebar data-testid="app-sidebar">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img
            src="/ahava-logo.jpg"
            alt="Ahava Medical Center"
            className="h-8 w-8 rounded object-cover"
            data-testid="img-sidebar-logo"
          />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground" data-testid="text-sidebar-title">
              Ahava Medical
            </span>
            <span className="text-xs text-sidebar-foreground/60" data-testid="text-sidebar-subtitle">
              Time & Attendance
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarMenu>
            {visibleEmployee.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={location === item.href} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Link href={item.href}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {visibleManager.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
            <SidebarMenu>
              {visibleManager.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={location === item.href} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.title === "Requests & Approvals" && pendingCount > 0 && (
                    <SidebarMenuBadge data-testid="badge-pending-approvals">{pendingCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {visibleAdmin.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarMenu>
              {visibleAdmin.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={location === item.href || (item.href !== "/" && location.startsWith(item.href))} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.title === "Alerts & Exceptions" && exceptionCount > 0 && (
                    <SidebarMenuBadge data-testid="badge-pending-exceptions">{exceptionCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
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
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium text-sidebar-foreground truncate" data-testid="text-user-name">
                {user?.firstName} {user?.lastName}
              </span>
              <Badge variant="outline" className="w-fit text-[10px] px-1.5 py-0 text-sidebar-foreground/60 border-sidebar-foreground/20" data-testid="badge-user-role">
                {role}
              </Badge>
            </div>
            <button
              onClick={() => logout()}
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              title="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <a href="/api/login" data-testid="link-login">
            <Button variant="outline" className="w-full">Sign In</Button>
          </a>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
