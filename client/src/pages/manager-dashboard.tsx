import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { formatHoursMinutes } from "@/lib/utils";
import { Link, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Users, UserCheck, Clock, Search, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AttendancePunchTable } from "@/components/attendance-punch-table";
import { EmptyState } from "@/components/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TeamStats = {
  teamSize: number;
  clockedIn: number;
  usingPto: number;
  pendingApprovals: number;
};

type TeamMemberStatus = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  departmentIds: string[];
  departmentName: string;
  locationIds: string[];
  locationName: string;
  status: string;
  isClockedIn: boolean;
  hasPtoToday: boolean;
  todayHours: number;
  weekHours: number;
};

type Option = { id: string; name: string };

type TeamStatusResponse = {
  members: TeamMemberStatus[];
  departments: Option[];
  locations: Option[];
  total: number;
  totalAll: number;
  absentCount: number;
  page: number;
  pageSize: number;
};

const ALL = "all";
const PAGE_SIZE = 25;

type SortKey = "name" | "status" | "today" | "week";
type SortDir = "asc" | "desc";

export default function ManagerDashboardPage() {
  const [, setLocation] = useLocation();

  const { data: stats, isLoading: statsLoading } = useQuery<TeamStats>({
    queryKey: ["/api/manager/team-stats"],
  });

  // Live-update the team list + KPI cards as employees punch in/out via /ws.
  // Filter/sort/search/pagination state lives in local state, so refreshing the
  // underlying query data does not reset what the manager is looking at.
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const isAttendance =
            msg?.event === "attendance_update" ||
            msg?.type === "attendance_update" ||
            msg?.type === "kiosk_punch" ||
            msg?.data?.type === "attendance_update" ||
            msg?.data?.type === "kiosk_punch";
          if (isAttendance) {
            queryClient.invalidateQueries({ queryKey: ["/api/manager/team-status"] });
            queryClient.invalidateQueries({ queryKey: ["/api/manager/team-stats"] });
          }
        } catch {}
      };
    } catch {}
    return () => { try { ws?.close(); } catch {} };
  }, []);

  // Prefill filters from URL params so the Dashboard's "Active Today" block can
  // deep-link into a pre-filtered team view.
  const searchString = useSearch();
  const urlFilters = new URLSearchParams(searchString);
  const VALID_STATUSES = ["clocked_in", "clocked_out", "pto", "absent"];
  const statusParam = urlFilters.get("status");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [departmentFilter, setDepartmentFilter] = useState(urlFilters.get("department") || ALL);
  const [locationFilter, setLocationFilter] = useState(urlFilters.get("location") || ALL);
  const [statusFilter, setStatusFilter] = useState(
    statusParam && VALID_STATUSES.includes(statusParam) ? statusParam : ALL,
  );
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  // Server-driven filtering/sorting/pagination so the page stays fast for very
  // large teams. The query key carries every parameter so changing a filter,
  // sort or page issues a fresh request for just that slice.
  const teamStatusParams = useMemo(() => ({
    search: debouncedSearch.trim(),
    department: departmentFilter,
    location: locationFilter,
    status: statusFilter,
    sort: sortKey,
    dir: sortDir,
    page,
    pageSize: PAGE_SIZE,
  }), [debouncedSearch, departmentFilter, locationFilter, statusFilter, sortKey, sortDir, page]);

  const { data: teamStatus, isLoading: teamLoading } = useQuery<TeamStatusResponse>({
    queryKey: ["/api/manager/team-status", teamStatusParams],
    queryFn: async () => {
      const qs = new URLSearchParams({
        search: teamStatusParams.search,
        department: teamStatusParams.department,
        location: teamStatusParams.location,
        status: teamStatusParams.status,
        sort: teamStatusParams.sort,
        dir: teamStatusParams.dir,
        page: String(teamStatusParams.page),
        pageSize: String(teamStatusParams.pageSize),
      });
      const res = await fetch(`/api/manager/team-status?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  const pageRows = teamStatus?.members ?? [];
  const departments = teamStatus?.departments ?? [];
  const locations = teamStatus?.locations ?? [];
  const total = teamStatus?.total ?? 0;
  const totalAll = teamStatus?.totalAll ?? 0;
  const absentCount = teamStatus?.absentCount ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);

  // Reset to first page whenever the result set changes.
  const resetPage = () => setPage(0);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "status" ? "asc" : "desc");
    }
    resetPage();
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const SortableHead = ({ column, label, className }: { column: SortKey; label: string; className?: string }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider hover-elevate -mx-1 px-1 rounded"
        data-testid={`sort-${column}`}
      >
        {label}
        <SortIcon column={column} />
      </button>
    </TableHead>
  );

  const openProfile = (id: string) => setLocation(`/employees?employeeId=${id}`);

  return (
    <div className="max-w-5xl space-y-6" data-testid="manager-dashboard-page">
      <PageHeader title="Team Overview" subtitle="Monitor your team's attendance and status" />

      {stats && stats.pendingApprovals > 0 && (
        <Link href="/approvals">
          <Card className="border-destructive bg-destructive/5 cursor-pointer hover:bg-destructive/10 transition-colors" data-testid="card-pending-alert">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div>
                <p className="font-semibold" data-testid="text-pending-count">Pending Approvals: {stats.pendingApprovals}</p>
                <p className="text-sm text-destructive">Action required</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statsLoading ? (
          <>
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </>
        ) : (
          <>
            <Card data-testid="card-team-size">
              <CardContent className="flex flex-col items-center justify-center p-6">
                <Users className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Team Size</p>
                <p className="text-3xl font-bold tabular-nums text-primary" data-testid="text-team-size">{stats?.teamSize ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-clocked-in">
              <CardContent className="flex flex-col items-center justify-center p-6">
                <UserCheck className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Clocked In</p>
                <p className="text-3xl font-bold tabular-nums text-green-600" data-testid="text-clocked-in">{stats?.clockedIn ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-using-pto">
              <CardContent className="flex flex-col items-center justify-center p-6">
                <Clock className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Using PTO</p>
                <p className="text-3xl font-bold tabular-nums text-amber-500" data-testid="text-using-pto">{stats?.usingPto ?? 0}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card data-testid="card-team-status">
        <CardHeader>
          <CardTitle>Team Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="team-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="team-search"
                  className="pl-8"
                  placeholder="Search by name…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                  data-testid="input-team-search"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Select value={departmentFilter} onValueChange={(v) => { setDepartmentFilter(v); resetPage(); }}>
                <SelectTrigger className="w-[180px]" data-testid="select-team-department">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); resetPage(); }}>
                <SelectTrigger className="w-[180px]" data-testid="select-team-location">
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
                <SelectTrigger className="w-[180px]" data-testid="select-team-status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="clocked_in">Clocked In</SelectItem>
                  <SelectItem value="clocked_out">Clocked Out</SelectItem>
                  <SelectItem value="pto">PTO</SelectItem>
                  <SelectItem value="absent">Yet to clock in today</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!teamLoading && totalAll > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button
                type="button"
                size="sm"
                variant={statusFilter === "absent" ? "default" : "outline"}
                onClick={() => { setStatusFilter(statusFilter === "absent" ? ALL : "absent"); resetPage(); }}
                data-testid="button-toggle-absent"
              >
                Yet to clock in today: {absentCount}
              </Button>
              <span className="text-muted-foreground" data-testid="text-team-result-count">
                Showing {total} of {totalAll}
              </span>
            </div>
          )}

          {teamLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : totalAll === 0 ? (
            <EmptyState
              icon={Users}
              title="No team members found"
              description="There are no employees in your team scope yet."
              testId="text-no-team"
            />
          ) : total === 0 ? (
            <EmptyState
              icon={Search}
              title="No matches"
              description="No team members match the current search and filters."
              testId="text-no-team-matches"
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead column="name" label="Employee" />
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                    <SortableHead column="status" label="Status" />
                    <SortableHead column="today" label="Today" />
                    <SortableHead column="week" label="This Week" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((member) => (
                    <TableRow
                      key={member.id}
                      className="cursor-pointer"
                      onClick={() => openProfile(member.id)}
                      data-testid={`row-team-member-${member.id}`}
                    >
                      <TableCell className="font-medium" data-testid={`text-member-name-${member.id}`}>
                        {member.firstName} {member.lastName}
                      </TableCell>
                      <TableCell data-testid={`text-member-department-${member.id}`}>
                        {member.departmentName}
                      </TableCell>
                      <TableCell data-testid={`text-member-location-${member.id}`}>
                        {member.locationName}
                      </TableCell>
                      <TableCell data-testid={`text-member-status-${member.id}`}>
                        <span className="flex items-center gap-2">
                          <Badge variant={member.isClockedIn ? "default" : "outline"}>
                            {member.status}
                          </Badge>
                          {member.hasPtoToday && (
                            <Badge variant="secondary" data-testid={`badge-pto-${member.id}`}>
                              PTO
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums" data-testid={`text-member-today-${member.id}`}>
                        {formatHoursMinutes(member.todayHours)}
                      </TableCell>
                      <TableCell className="tabular-nums" data-testid={`text-member-week-${member.id}`}>
                        {formatHoursMinutes(member.weekHours)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm text-muted-foreground" data-testid="text-team-page-info">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      data-testid="button-team-prev"
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      data-testid="button-team-next"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AttendancePunchTable title="Punch Records" />
    </div>
  );
}
