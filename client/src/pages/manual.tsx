import { useState, useEffect } from "react";
import { BookOpen, Monitor, HelpCircle, Lightbulb, AlertTriangle, ChevronRight, ArrowUp, User, UserCog, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import ahavaLogoPath from "@assets/Ahava_Primary_Logo_2023_Color_1774360090942.jpg";

type SectionId =
  | "getting-started"
  | "employee-guide"
  | "kiosk-system"
  | "manager-guide"
  | "admin-guide"
  | "faq";

interface TocItem {
  id: SectionId;
  label: string;
  icon: typeof BookOpen;
  color: string;
  bgColor: string;
  subsections: { id: string; label: string }[];
}

const tocItems: TocItem[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: BookOpen,
    color: "text-primary",
    bgColor: "bg-primary/10",
    subsections: [
      { id: "gs-logging-in", label: "Logging In" },
      { id: "gs-password-change", label: "First-Time Password Change" },
      { id: "gs-navigation", label: "Navigating the Sidebar" },
      { id: "gs-roles", label: "Understanding Your Role" },
    ],
  },
  {
    id: "employee-guide",
    label: "Employee Guide",
    icon: User,
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    subsections: [
      { id: "emp-dashboard", label: "Dashboard Overview" },
      { id: "emp-clock", label: "Clocking In & Out" },
      { id: "emp-attendance", label: "Viewing Attendance History" },
      { id: "emp-timeoff", label: "Submitting Time-Off Requests" },
      { id: "emp-profile", label: "Updating Your Profile" },
    ],
  },
  {
    id: "kiosk-system",
    label: "Kiosk System",
    icon: Monitor,
    color: "text-violet-600",
    bgColor: "bg-violet-50 dark:bg-violet-950/30",
    subsections: [
      { id: "kiosk-overview", label: "What is the Kiosk?" },
      { id: "kiosk-pin", label: "Clock In/Out via PIN" },
      { id: "kiosk-search", label: "Clock In/Out via Name Search" },
    ],
  },
  {
    id: "manager-guide",
    label: "Manager Guide",
    icon: UserCog,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    subsections: [
      { id: "mgr-team", label: "Team Dashboard" },
      { id: "mgr-approvals", label: "Approving/Denying Requests" },
      { id: "mgr-monitoring", label: "Monitoring Attendance" },
      { id: "mgr-alerts", label: "Viewing Alerts" },
      { id: "mgr-reports", label: "Running Reports" },
    ],
  },
  {
    id: "admin-guide",
    label: "Admin Guide",
    icon: ShieldCheck,
    color: "text-rose-600",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    subsections: [
      { id: "admin-employees", label: "Managing Employees" },
      { id: "admin-org", label: "Divisions, Locations & Departments" },
      { id: "admin-rules", label: "Time Clock Rules & PTO Policies" },
      { id: "admin-workflows", label: "Approval Workflows" },
      { id: "admin-payroll", label: "Payroll Prep & CSV Export" },
      { id: "admin-kiosks", label: "Managing Kiosks" },
      { id: "admin-permissions", label: "Permissions & Roles" },
      { id: "admin-audit", label: "Audit Logs" },
    ],
  },
  {
    id: "faq",
    label: "FAQ & Troubleshooting",
    icon: HelpCircle,
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    subsections: [
      { id: "faq-pin", label: "Forgot My PIN" },
      { id: "faq-missed", label: "Missed Punch" },
      { id: "faq-password", label: "Password Reset" },
    ],
  },
];

function Tip({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 my-4" data-testid={`callout-tip-${id}`}>
      <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
      <div className="text-sm text-foreground/80">{children}</div>
    </div>
  );
}

function Warning({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 my-4" data-testid={`callout-warning-${id}`}>
      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-sm text-foreground/80">{children}</div>
    </div>
  );
}

function SectionHeading({ id, icon: Icon, color, bgColor, children }: { id: string; icon: typeof BookOpen; color: string; bgColor: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20 pt-8 first:pt-0" data-testid={`section-${id}`}>
      <div className="flex items-center gap-3 mb-6">
        <div className={`rounded-lg p-2.5 ${bgColor}`}>
          <Icon className={`h-6 w-6 ${color}`} />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{children}</h2>
      </div>
    </div>
  );
}

function SubHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-20 text-lg font-semibold text-foreground mt-8 mb-3 flex items-center gap-2" data-testid={`subsection-${id}`}>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      {children}
    </h3>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="list-none space-y-3 my-4">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3 items-start">
          <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {i + 1}
          </span>
          <span className="text-sm text-foreground/80 pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export default function ManualPage() {
  const [activeSection, setActiveSection] = useState<string>("getting-started");
  const [activeSubsection, setActiveSubsection] = useState<string>("");
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);

      const sections = tocItems.flatMap((item) => [
        item.id,
        ...item.subsections.map((s) => s.id),
      ]);

      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i]);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120) {
            const currentId = sections[i];
            const parent = tocItems.find(
              (t) => t.id === currentId || t.subsections.some((s) => s.id === currentId)
            );
            if (parent) {
              setActiveSection(parent.id);
              const isSubsection = parent.subsections.some((s) => s.id === currentId);
              setActiveSubsection(isSubsection ? currentId : "");
            }
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="max-w-7xl" data-testid="manual-page">
      <PageHeader
        title="User Manual"
        subtitle="Complete guide to the Ahava Medical Center Time & Attendance system"
      />

      <div className="mt-6 flex gap-8">
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-4 space-y-1 rounded-xl border bg-card p-4 shadow-sm" data-testid="manual-toc">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b">
              <img src={ahavaLogoPath} alt="Ahava Medical Center" className="h-8 w-8 rounded object-contain" data-testid="img-manual-logo" />
              <div>
                <p className="text-xs font-semibold text-foreground">Ahava Medical</p>
                <p className="text-[10px] text-muted-foreground">User Manual v1.0</p>
              </div>
            </div>
            <nav>
              {tocItems.map((item) => (
                <div key={item.id} className="space-y-0.5">
                  <button
                    onClick={() => scrollTo(item.id)}
                    className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors text-left ${
                      activeSection === item.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    data-testid={`toc-link-${item.id}`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                  {activeSection === item.id && (
                    <div className="ml-6 border-l border-border pl-2 space-y-0.5 pb-1" data-testid={`toc-subsections-${item.id}`}>
                      {item.subsections.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => scrollTo(sub.id)}
                          className={`w-full text-left rounded-md px-2 py-1 text-xs transition-colors ${
                            activeSubsection === sub.id
                              ? "bg-primary/5 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                          data-testid={`toc-link-${sub.id}`}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="lg:hidden mb-6">
            <div className="rounded-xl border bg-card p-4 shadow-sm" data-testid="manual-toc-mobile">
              <p className="text-sm font-semibold mb-3 text-foreground">Table of Contents</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {tocItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollTo(item.id)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border"
                    data-testid={`toc-mobile-link-${item.id}`}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-8 border-b">
              <div className="flex items-center gap-4">
                <img src={ahavaLogoPath} alt="Ahava Medical Center" className="h-14 w-14 rounded-lg object-contain shadow-sm border bg-white p-1" data-testid="img-manual-hero-logo" />
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-manual-title">
                    Ahava Medical Center
                  </h1>
                  <p className="text-base text-muted-foreground">Time & Attendance System — User Manual</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-foreground/70 max-w-2xl">
                This guide covers everything you need to know about using the Time & Attendance system, 
                from basic clock-in/out operations to advanced administrative features. Use the table of 
                contents to navigate to the section most relevant to your role.
              </p>
            </div>

            <div className="p-6 md:p-8 space-y-2">

              <SectionHeading id="getting-started" icon={BookOpen} color="text-primary" bgColor="bg-primary/10">
                Getting Started
              </SectionHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Welcome to the Ahava Medical Center Time & Attendance system. This section will help you get
                set up and familiar with the basics.
              </p>

              <SubHeading id="gs-logging-in">Logging In</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                To access the system, navigate to the application URL provided by your administrator. 
                You will see the login screen where you can sign in using your credentials.
              </p>
              <StepList steps={[
                "Open the application in your web browser.",
                "Enter your email address and password on the login page.",
                "Click the \"Sign In\" button to access your dashboard.",
                "If you're logging in for the first time, you'll be prompted to change your password.",
              ]} />
              <Tip id="login-bookmark">Bookmark the login page for quick access. The system works best on Chrome, Firefox, or Edge.</Tip>

              <SubHeading id="gs-password-change">First-Time Password Change</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                For security purposes, all new accounts require a password change upon first login. Your administrator
                will provide you with a temporary password that must be changed before you can access any features.
              </p>
              <StepList steps={[
                "Log in with the temporary password provided by your admin.",
                "You'll be automatically redirected to the Change Password screen.",
                "Enter your new password (must be at least 8 characters).",
                "Confirm your new password by typing it again.",
                "Click \"Change Password\" to save. You'll then be taken to your dashboard.",
              ]} />
              <Warning id="password-security">Never share your password with anyone. If you suspect your account has been compromised, contact your administrator immediately.</Warning>

              <SubHeading id="gs-navigation">Navigating the Sidebar</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The sidebar on the left side of the screen is your main navigation tool. It displays different
                menu items based on your role:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Menu</strong> — Core features available to all users (Dashboard, Attendance, Time Off, Profile)</li>
                <li><strong>Management</strong> — Visible to Managers and Admins (Team View, Requests & Approvals, Alerts)</li>
                <li><strong>Administration</strong> — Visible to Admins only (Employee management, settings, payroll, and more)</li>
              </ul>
              <Tip id="sidebar-user-info">Your name and role are displayed at the bottom of the sidebar. Click the logout icon to sign out.</Tip>

              <SubHeading id="gs-roles">Understanding Your Role</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The system has three user roles, each with increasing levels of access:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
                <div className="rounded-lg border p-4 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Employee</p>
                  </div>
                  <p className="text-xs text-foreground/70">Clock in/out, view your attendance, request time off, and manage your profile.</p>
                </div>
                <div className="rounded-lg border p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2 mb-2">
                    <UserCog className="h-4 w-4 text-emerald-600" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Manager</p>
                  </div>
                  <p className="text-xs text-foreground/70">Everything an Employee can do, plus manage team attendance, approve requests, and run reports.</p>
                </div>
                <div className="rounded-lg border p-4 bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="h-4 w-4 text-rose-600" />
                    <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">Admin</p>
                  </div>
                  <p className="text-xs text-foreground/70">Full system access including employee management, payroll, rules configuration, and audit logs.</p>
                </div>
              </div>

              <div className="border-t my-10" />

              <SectionHeading id="employee-guide" icon={User} color="text-blue-600" bgColor="bg-blue-50 dark:bg-blue-950/30">
                Employee Guide
              </SectionHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                This section covers the core features available to all employees in the system.
              </p>

              <SubHeading id="emp-dashboard">Dashboard Overview</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Your Dashboard is the first page you see after logging in. It provides a real-time snapshot of your attendance status:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Clock Status</strong> — Shows whether you're currently clocked in or out, with a quick action button</li>
                <li><strong>Today's Hours</strong> — How many hours you've worked today</li>
                <li><strong>This Week's Hours</strong> — Your total hours for the current week</li>
                <li><strong>Recent Activity</strong> — A table showing your last five attendance records</li>
              </ul>

              <SubHeading id="emp-clock">Clocking In & Out (Web)</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                You can clock in and out directly from your Dashboard:
              </p>
              <StepList steps={[
                "Navigate to the Dashboard (click \"Dashboard\" in the sidebar).",
                "Look at the clock status card at the top of the page.",
                "If you're clocked out, click the green \"Clock In\" button.",
                "If you're clocked in, click the red \"Clock Out\" button.",
                "A confirmation toast will appear confirming your punch was recorded.",
              ]} />
              <Tip id="dashboard-refresh">The dashboard refreshes your status automatically every 30 seconds, so you'll always see up-to-date information.</Tip>

              <SubHeading id="emp-attendance">Viewing Attendance History</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>My Attendance</strong> page lets you view and export your complete attendance history:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li>Use the date filters to select a specific date range (defaults to the last 30 days)</li>
                <li>View your total hours, days worked, and daily average in the summary cards</li>
                <li>Click column headers (Date, Clock In, Total Hours, Status) to sort the table</li>
                <li>Click <strong>Export to CSV</strong> to download your records as a spreadsheet file</li>
              </ul>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Each record shows the date, clock-in time, clock-out time, break duration, total hours, and status 
                (Complete, Overtime, or In Progress).
              </p>

              <SubHeading id="emp-timeoff">Submitting Time-Off Requests</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                To request time off, go to the <strong>Time Off</strong> page:
              </p>
              <StepList steps={[
                "Click \"Time Off\" in the sidebar.",
                "In the \"New Request\" form, select the request type (Vacation, Sick Leave, or Personal).",
                "Choose your start and end dates. The system automatically calculates business days.",
                "Optionally, add a reason for your request.",
                "Review the \"Days Requested\" summary shown below.",
                "Click \"Submit Request\" to send it to your manager for approval.",
              ]} />
              <p className="text-sm text-foreground/80 leading-relaxed">
                Your submitted requests will appear in the <strong>My Requests</strong> panel, showing their current 
                status (Pending, Approved, or Denied). You can also see approved time off on the Team Calendar below.
              </p>

              <SubHeading id="emp-profile">Updating Your Profile</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Profile</strong> page displays your personal and employment information:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li>Your name, email, and role</li>
                <li>Current shift status with a live timer when clocked in</li>
                <li>Organization details (Division, Location, Department)</li>
                <li>Employment details (Type, Pay Type, Hire Date, Overtime eligibility)</li>
              </ul>
              <Tip id="profile-contact-admin">If any of your information is incorrect, contact your administrator to have it updated.</Tip>

              <div className="border-t my-10" />

              <SectionHeading id="kiosk-system" icon={Monitor} color="text-violet-600" bgColor="bg-violet-50 dark:bg-violet-950/30">
                Kiosk System
              </SectionHeading>

              <SubHeading id="kiosk-overview">What is the Kiosk?</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The Kiosk is a dedicated full-screen clock-in/out station designed for shared devices such as 
                tablets at building entrances or break rooms. It allows employees to clock in and out without 
                needing to log into their personal accounts.
              </p>
              <p className="text-sm text-foreground/80 leading-relaxed mt-2">
                The kiosk displays the current date and time, and resets automatically after 30 seconds of 
                inactivity or 5 seconds after a successful punch.
              </p>

              <SubHeading id="kiosk-pin">Clock In/Out via PIN</SubHeading>
              <StepList steps={[
                "Tap \"Tap to Clock In / Out\" on the kiosk home screen.",
                "Select the \"Enter PIN\" tab (selected by default).",
                "Enter your 4-digit PIN using the on-screen number pad.",
                "Press \"OK\" to look up your account.",
                "Verify your name and current status on the confirmation screen.",
                "Tap \"CLOCK IN\" or \"CLOCK OUT\" to record your punch.",
                "A success screen will confirm the action with a timestamp.",
              ]} />
              <Tip id="kiosk-pin-clear">If you enter the wrong PIN, press "C" to clear and try again. If you've forgotten your PIN, see the FAQ section below.</Tip>

              <SubHeading id="kiosk-search">Clock In/Out via Name Search</SubHeading>
              <StepList steps={[
                "Tap \"Tap to Clock In / Out\" on the kiosk home screen.",
                "Switch to the \"Search by Name\" tab.",
                "Start typing your first or last name in the search box.",
                "Select your name from the search results.",
                "Verify your identity and current status on the confirmation screen.",
                "Tap \"CLOCK IN\" or \"CLOCK OUT\" to record your punch.",
              ]} />
              <Warning id="kiosk-wrong-employee">If you see the wrong employee, tap "Not me — Go Back" to return to the identification screen.</Warning>

              <div className="border-t my-10" />

              <SectionHeading id="manager-guide" icon={UserCog} color="text-emerald-600" bgColor="bg-emerald-50 dark:bg-emerald-950/30">
                Manager Guide
              </SectionHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                As a Manager, you have additional tools for overseeing your team's attendance and handling requests.
                All employee features are also available to you.
              </p>

              <SubHeading id="mgr-team">Team Dashboard</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Team View</strong> page gives you an at-a-glance overview of your team:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Team Size</strong> — Total number of employees on your team</li>
                <li><strong>Clocked In</strong> — How many team members are currently working</li>
                <li><strong>Using PTO</strong> — Team members with approved PTO (sick paid hours) for today. PTO does not indicate absence — employees using PTO may still be at work</li>
                <li><strong>Pending Approvals Alert</strong> — A highlighted banner if there are requests awaiting your action</li>
                <li><strong>Team Status Table</strong> — Each employee's current status, today's hours, and this week's hours</li>
              </ul>

              <SubHeading id="mgr-approvals">Approving/Denying Requests</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Navigate to <strong>Requests & Approvals</strong> to manage pending requests. The page has three tabs:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>All Pending</strong> — Shows both PTO requests and attendance exceptions together</li>
                <li><strong>PTO Requests</strong> — Time-off requests only</li>
                <li><strong>Missing Punch / Corrections</strong> — Attendance exception requests</li>
              </ul>
              <p className="text-sm text-foreground/80 leading-relaxed mt-2">
                For each request, you can review the details, add an optional comment, then click 
                <strong> Approve</strong> (green) or <strong>Deny</strong> (red).
              </p>
              <Tip id="sidebar-badge">The sidebar shows a badge with the total number of pending requests so you always know when action is needed.</Tip>

              <SubHeading id="mgr-monitoring">Monitoring Attendance</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Use the Team Status table on the Team View page to monitor who is currently clocked in, 
                their hours for the day and week. Team members with approved PTO for the day are shown with a small "PTO" badge alongside their attendance status. Note that PTO represents sick paid hours and does not imply the employee is absent.
              </p>

              <SubHeading id="mgr-alerts">Viewing Alerts</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Alerts</strong> page displays important notifications about your team, including 
                attendance anomalies, overtime warnings, and other items that need your attention.
              </p>

              <SubHeading id="mgr-reports">Running Reports</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Reports</strong> page allows you to generate and view various attendance and time-off 
                reports for your team. You can filter by date range, employee, and report type.
              </p>

              <div className="border-t my-10" />

              <SectionHeading id="admin-guide" icon={ShieldCheck} color="text-rose-600" bgColor="bg-rose-50 dark:bg-rose-950/30">
                Admin Guide
              </SectionHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Admins have complete control over the system configuration. In addition to all Employee and 
                Manager features, you can manage employees, configure rules, prepare payroll, and more.
              </p>

              <SubHeading id="admin-employees">Managing Employees</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Employees</strong> page is your central hub for employee management:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Onboarding</strong> — Add new employees by filling in their personal details, role, department, and employment information</li>
                <li><strong>Documents</strong> — View and manage employee-related documentation</li>
                <li><strong>Role Assignment</strong> — Set each employee's role (Employee, Manager, or Admin)</li>
                <li><strong>Department/Location Assignment</strong> — Assign employees to the correct organizational unit</li>
                <li><strong>PIN Management</strong> — Assign or reset kiosk PINs for employees</li>
              </ul>

              <SubHeading id="admin-org">Divisions, Locations & Departments</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Navigate to <strong>Locations</strong> in the sidebar to manage your organizational structure:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Divisions</strong> — Top-level organizational groups</li>
                <li><strong>Locations</strong> — Physical office or facility locations within a division</li>
                <li><strong>Departments</strong> — Functional teams within a location</li>
              </ul>
              <p className="text-sm text-foreground/80 leading-relaxed mt-2">
                You can create, edit, and delete entries for each level. Employees are assigned to a department, 
                which belongs to a location, which belongs to a division.
              </p>

              <SubHeading id="admin-rules">Time Clock Rules & PTO Policies</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                <strong>Time Clock Rules</strong> lets you configure how the system handles attendance:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li>Overtime thresholds (daily and weekly hour limits)</li>
                <li>Rounding rules for clock-in/out times</li>
                <li>Break deduction policies</li>
                <li>Grace periods for late arrivals</li>
              </ul>
              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>PTO & Leave</strong> lets you configure leave policies:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li>Set annual accrual rates for vacation, sick, and personal time</li>
                <li>Configure carry-over policies</li>
                <li>Set blackout dates when leave cannot be taken</li>
                <li>Manage per-employee PTO balance adjustments</li>
              </ul>

              <SubHeading id="admin-workflows">Approval Workflows</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Approval workflows decide what happens automatically when key events occur — a PTO request is
                submitted, a late arrival is detected, a clock-out is missed, and so on. They route the event
                through conditions, approvers, actions, and notifications until the request is approved, denied,
                or escalated. You can find them under <strong>Rules & Controls → Approval Workflows</strong>.
              </p>
              <p className="text-sm text-foreground/80 leading-relaxed mt-2">
                There are two ways to build automation, and they live side-by-side on the same page:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Visual Workflow Builder</strong> — A drag-and-drop canvas for multi-step flows that
                  combine conditions, multiple approvers, actions, and notifications. Use this when you need
                  branching logic (for example: "if more than 5 days, send to HR; otherwise, manager only").</li>
                <li><strong>Rule Policies</strong> — Lightweight, single-rule policies (e.g. an attendance,
                  PTO, or payroll policy with rule values). Use these when you just need a static rule applied
                  to a division, location, department, or individual employee, without the multi-step flow.</li>
              </ul>

              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>Available triggers</strong> — every workflow starts with one of these events:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>PTO request submitted</strong> — an employee submits a time-off request.</li>
                <li><strong>Attendance correction filed</strong> — a missing-punch or correction request is filed.</li>
                <li><strong>Late arrival detected</strong> — someone clocks in after their scheduled start.</li>
                <li><strong>Missed clock-out</strong> — an employee forgot to clock out.</li>
                <li><strong>Overtime threshold reached</strong> — an employee crosses the overtime limit.</li>
                <li><strong>Bonus</strong> — a bonus event needs to be reviewed and routed.</li>
              </ul>

              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>Node types</strong> — the four building blocks you drag onto the canvas:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Condition</strong> — branches the flow into Yes / No based on a value (for example,
                  days requested or overtime hours).</li>
                <li><strong>Approver</strong> — pauses the flow until the chosen role signs off. Chain these to
                  build multi-step approval (e.g. manager → HR → admin).</li>
                <li><strong>Action</strong> — does something concrete: approve, deny, raise an alert, issue a
                  warning, or update a balance.</li>
                <li><strong>Notification</strong> — sends a message to the relevant people without changing the
                  state of the request itself.</li>
              </ul>

              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>Condition fields & operators</strong> — conditions compare one of the following fields
                against a value you set:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>days_requested</strong> — number of days an employee asked for.</li>
                <li><strong>pto_balance</strong> — remaining PTO days the employee has.</li>
                <li><strong>late_count_month</strong> — late arrivals so far this month.</li>
                <li><strong>overtime_hours</strong> — overtime hours worked.</li>
                <li><strong>employee_department</strong> — the employee's department.</li>
                <li><strong>employee_location</strong> — the employee's location.</li>
              </ul>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Operators include <strong>more than (&gt;)</strong>, <strong>at least (≥)</strong>,
                <strong> less than (&lt;)</strong>, <strong>at most (≤)</strong>, <strong>equals (=)</strong>,
                and <strong>is not (≠)</strong>. The "Yes" branch runs when the comparison is true; the "No"
                branch runs when it is false.
              </p>

              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>Approvers</strong> — an Approver node waits for one of these roles to sign off before
                the flow continues:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Direct Manager</strong> — the employee's direct manager.</li>
                <li><strong>Department Head</strong> — the head of the employee's department.</li>
                <li><strong>HR</strong> — the HR team.</li>
                <li><strong>Admin</strong> — an admin user.</li>
              </ul>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Chain Approver nodes one after another to require multi-step sign-off — for example, drop a
                Direct Manager approver, then connect its output into a Department Head approver, then into HR.
              </p>

              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>Actions</strong> — Action nodes change the state of the request or the employee record:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Approve</strong> — mark the request as approved.</li>
                <li><strong>Deny</strong> — mark the request as denied.</li>
                <li><strong>Generate Alert</strong> — raise a system alert for admins/managers.</li>
                <li><strong>Generate Written Warning</strong> — add a written warning to the employee's record.</li>
                <li><strong>Update PTO Balance</strong> — adjust the employee's remaining PTO days.</li>
              </ul>

              <p className="text-sm text-foreground/80 leading-relaxed mt-3">
                <strong>Notifications</strong> — Notification nodes deliver a message without changing state.
                Recipients include the <strong>employee</strong>, the <strong>manager</strong>,
                <strong> HR</strong>, and the <strong>payroll team</strong>. Channels are <strong>email</strong>
                and <strong>in-app system alert</strong>. You can also attach a custom message to a notification.
              </p>

              <p className="text-sm text-foreground/80 leading-relaxed mt-4">
                <strong>Creating a workflow in the visual builder:</strong>
              </p>
              <StepList steps={[
                "Go to Rules & Controls → Approval Workflows and click \"New Workflow\".",
                "Give the workflow a clear name and pick a trigger from the dropdown.",
                "Drag a Trigger node onto the canvas and select the matching trigger event.",
                "Drag in the next nodes you need — Condition, Approver, Action, and/or Notification — and connect them by dragging from one node's bottom handle to the next node's top handle.",
                "For Condition nodes, connect the green \"Yes\" handle and the red \"No\" handle to the branches you want each outcome to follow.",
                "Click any node to open its settings panel and fill in the fields (trigger event, condition field/operator/value, approver role, action type, notification recipient, etc.).",
                "Use the Preview toggle to read through the flow in plain English and confirm it does what you expect.",
                "Click Save as Draft to keep working, or Save & Activate to make it live.",
              ]} />
              <Tip id="workflow-needs-setup">Nodes that are missing required fields show an amber "Needs setup" badge — fix those before activating a workflow so it runs as intended.</Tip>

              <p className="text-sm text-foreground/80 leading-relaxed mt-4">
                <strong>Creating a Rule Policy:</strong>
              </p>
              <StepList steps={[
                "Go to Rules & Controls and choose the relevant section (Attendance Rules, PTO Policies, or Payroll Rules).",
                "Click \"New Policy\" to open the policy wizard.",
                "Give the policy a name, optional description, and fill in the rule values for that policy type.",
                "Save the policy — it will appear in the list with a plain-English summary of its rules.",
                "Click \"Assign\" on the policy and pick the level it applies to: Division, Location, Department, or an individual Employee.",
                "Repeat the assign step to apply the same policy to additional targets if needed.",
              ]} />

              <p className="text-sm text-foreground/80 leading-relaxed mt-4">
                <strong>What happens at runtime (end-to-end flow):</strong>
              </p>
              <StepList steps={[
                "An event fires — for example, an employee submits a PTO request or a late arrival is detected.",
                "The workflow engine looks up every active workflow whose trigger matches that event.",
                "It walks the graph node by node: conditions are evaluated against the request data, approvers are queued for sign-off, actions are executed, and notifications are sent.",
                "Approvers are notified and act on pending items from the Requests & Approvals page (PTO Requests, Missing Punch / Corrections, or All Pending tabs).",
                "As approvers approve or deny, the request status updates and the next nodes in the flow run.",
                "Every execution and decision is recorded in the audit log so you can trace exactly what happened and why.",
              ]} />

              <Tip id="workflows-multiple-per-trigger">You can have multiple workflows on the same trigger — they all run independently. This is useful for splitting logic by department or location instead of cramming everything into one giant workflow.</Tip>
              <Tip id="workflows-test-before-activate">Build the workflow as a draft first, use the Preview toggle to read through the plain-English summary, and only flip it to Active once you're confident.</Tip>
              <Warning id="workflows-edits-apply-forward">Toggling a workflow to inactive pauses it for new requests, but does not affect requests that are already in progress. Edits to a workflow only apply to requests created after the change is saved.</Warning>

              <SubHeading id="admin-payroll">Payroll Prep & CSV Export</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Payroll Prep</strong> page helps you prepare attendance data for your payroll system:
              </p>
              <StepList steps={[
                "Navigate to Payroll Prep in the sidebar.",
                "Select the pay period you want to process.",
                "Review the summary of hours, overtime, and exceptions.",
                "Resolve any outstanding exceptions or missing punches before exporting.",
                "Click \"Export CSV\" to download the payroll-ready data file.",
              ]} />
              <Warning id="payroll-exceptions">Always review and resolve all pending exceptions before exporting payroll data to ensure accuracy.</Warning>

              <SubHeading id="admin-kiosks">Managing Kiosks</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Kiosks</strong> page lets you manage your clock-in/out kiosk stations:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li>Register new kiosk devices and assign them to locations</li>
                <li>Monitor kiosk status and connectivity</li>
                <li>Configure kiosk settings (inactivity timeout, display options)</li>
                <li>Deactivate or remove kiosks as needed</li>
              </ul>

              <SubHeading id="admin-permissions">Permissions & Roles</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Fine-tune system access through the <strong>Permissions</strong> and <strong>Roles</strong> pages:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li><strong>Permissions</strong> — View and configure what each role can access and modify</li>
                <li><strong>Roles</strong> — Manage the role definitions (Employee, Manager, Admin) and their associated permissions</li>
              </ul>

              <SubHeading id="admin-audit">Audit Logs</SubHeading>
              <p className="text-sm text-foreground/80 leading-relaxed">
                The <strong>Audit Log</strong> provides a complete history of all significant actions taken in the 
                system. This includes:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80 my-3 ml-4">
                <li>Employee record changes (created, updated, deleted)</li>
                <li>Attendance modifications and corrections</li>
                <li>PTO approvals and denials</li>
                <li>System configuration changes</li>
                <li>Login and security events</li>
              </ul>
              <Tip id="audit-compliance">Use the audit log to track who made changes and when. This is essential for compliance and dispute resolution.</Tip>

              <div className="border-t my-10" />

              <SectionHeading id="faq" icon={HelpCircle} color="text-amber-600" bgColor="bg-amber-50 dark:bg-amber-950/30">
                FAQ & Troubleshooting
              </SectionHeading>

              <SubHeading id="faq-pin">Forgot My PIN</SubHeading>
              <div className="rounded-lg border bg-muted/30 p-4 my-3">
                <p className="text-sm font-medium text-foreground mb-2">Q: I forgot my kiosk PIN. What do I do?</p>
                <p className="text-sm text-foreground/80">
                  <strong>A:</strong> You can still clock in using the <strong>Search by Name</strong> option on the kiosk.
                  To get a new PIN, contact your administrator — they can reset or reassign your kiosk PIN from the 
                  Employees management page.
                </p>
              </div>

              <SubHeading id="faq-missed">Missed Punch</SubHeading>
              <div className="rounded-lg border bg-muted/30 p-4 my-3">
                <p className="text-sm font-medium text-foreground mb-2">Q: I forgot to clock in or out. How do I fix it?</p>
                <p className="text-sm text-foreground/80">
                  <strong>A:</strong> Contact your manager or administrator. They can review and correct your attendance 
                  record through the Alerts & Exceptions system. An attendance exception can be created 
                  for the missing punch, which will go through the approval workflow before being applied 
                  to your record.
                </p>
              </div>

              <SubHeading id="faq-password">Password Reset</SubHeading>
              <div className="rounded-lg border bg-muted/30 p-4 my-3">
                <p className="text-sm font-medium text-foreground mb-2">Q: I forgot my password. How do I reset it?</p>
                <p className="text-sm text-foreground/80">
                  <strong>A:</strong> Contact your system administrator. They can reset your password and trigger 
                  the forced password change flow so you can set a new one upon your next login.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 my-3">
                <p className="text-sm font-medium text-foreground mb-2">Q: I want to change my password. How?</p>
                <p className="text-sm text-foreground/80">
                  <strong>A:</strong> Contact your administrator to request a password change. They can enable 
                  the forced password change flag on your account, which will prompt you to set a new password 
                  the next time you log in.
                </p>
              </div>

              <div className="border-t my-10" />

              <div className="text-center py-6">
                <p className="text-xs text-muted-foreground">
                  Ahava Medical Center — Time & Attendance System User Manual
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  For additional help, contact your system administrator.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 rounded-full bg-primary text-primary-foreground shadow-lg p-3 hover:bg-primary/90 transition-colors"
          aria-label="Back to top"
          data-testid="button-back-to-top"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
