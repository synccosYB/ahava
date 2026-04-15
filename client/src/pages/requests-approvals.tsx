import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, ClipboardList, Filter, RotateCcw, Building2, MapPin, UserCheck, DollarSign } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { TimeOffRequest, AttendanceException, Department, Location } from "@shared/schema";

const TIME_OFF_TYPE_LABELS: Record<string, string> = {
  vacation: "Vacation",
  sick: "Sick Leave",
  personal: "Personal",
  bereavement: "Bereavement",
  jury_duty: "Jury Duty",
  maternity_paternity: "Maternity/Paternity",
  fmla: "FMLA",
  unpaid: "Unpaid Leave",
};

function formatTimeOffTypeLabel(type: string): string {
  return TIME_OFF_TYPE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

type PendingPtoRequest = TimeOffRequest & {
  employeeName: string;
  departmentName?: string;
  locationName?: string;
  managerNames?: string[];
};
type EnrichedException = AttendanceException & {
  employeeName?: string;
  departmentName?: string;
  locationName?: string;
  managerNames?: string[];
};
type ProcessedPtoRequest = TimeOffRequest & {
  employeeName: string;
  departmentName: string;
  locationName: string;
  reviewerName: string;
};

export default function RequestsApprovalsPage() {
  return (
    <div className="max-w-5xl space-y-6" data-testid="requests-approvals-page">
      <PageHeader title="Requests & Approvals" subtitle="Manage pending PTO and exception requests" />

      <Tabs defaultValue="all" data-testid="tabs-requests">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all-requests">All Pending</TabsTrigger>
          <TabsTrigger value="pto" data-testid="tab-pto-requests">PTO Requests</TabsTrigger>
          <TabsTrigger value="exceptions" data-testid="tab-exception-requests">Missing Punch / Corrections</TabsTrigger>
          <TabsTrigger value="processed" data-testid="tab-processed-requests">Processed</TabsTrigger>
        </TabsList>

        <TabsContent value="all"><AllPendingTab /></TabsContent>
        <TabsContent value="pto"><PtoRequestsTab /></TabsContent>
        <TabsContent value="exceptions"><ExceptionsTab /></TabsContent>
        <TabsContent value="processed"><ProcessedTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ProcessedTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [departmentFilter, setDepartmentFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (isAdmin && departmentFilter) params.set("department", departmentFilter);
    if (isAdmin && locationFilter) params.set("location", locationFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const queryString = buildQueryString();

  const { data: requests, isLoading } = useQuery<ProcessedPtoRequest[]>({
    queryKey: ["/api/time-off/processed", queryString],
    queryFn: async () => {
      const r = await fetch(`/api/time-off/processed${queryString}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to fetch processed requests`);
      return r.json();
    },
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    enabled: isAdmin,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: isAdmin,
  });

  const clearFilters = () => {
    setDepartmentFilter("");
    setLocationFilter("");
    setTypeFilter("");
    setStatusFilter("");
    setStartDate("");
    setEndDate("");
  };

  const hasActiveFilters = departmentFilter || locationFilter || typeFilter || statusFilter || startDate || endDate;

  return (
    <div className="space-y-4 mt-4">
      <Card data-testid="filter-bar-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto h-7 text-xs" data-testid="button-clear-filters">
                <RotateCcw className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {isAdmin && (
              <>
                <Select value={departmentFilter} onValueChange={setDepartmentFilter} data-testid="select-department-filter">
                  <SelectTrigger data-testid="select-trigger-department">
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent>
                    {(departments || []).map(d => (
                      <SelectItem key={d.id} value={d.id} data-testid={`option-department-${d.id}`}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={locationFilter} onValueChange={setLocationFilter} data-testid="select-location-filter">
                  <SelectTrigger data-testid="select-trigger-location">
                    <SelectValue placeholder="All Locations" />
                  </SelectTrigger>
                  <SelectContent>
                    {(locations || []).map(l => (
                      <SelectItem key={l.id} value={l.id} data-testid={`option-location-${l.id}`}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            <Select value={typeFilter} onValueChange={setTypeFilter} data-testid="select-type-filter">
              <SelectTrigger data-testid="select-trigger-type">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation" data-testid="option-type-vacation">Vacation</SelectItem>
                <SelectItem value="sick" data-testid="option-type-sick">Sick Leave</SelectItem>
                <SelectItem value="personal" data-testid="option-type-personal">Personal</SelectItem>
                <SelectItem value="bereavement" data-testid="option-type-bereavement">Bereavement</SelectItem>
                <SelectItem value="jury_duty" data-testid="option-type-jury-duty">Jury Duty</SelectItem>
                <SelectItem value="maternity_paternity" data-testid="option-type-maternity-paternity">Maternity/Paternity</SelectItem>
                <SelectItem value="fmla" data-testid="option-type-fmla">FMLA</SelectItem>
                <SelectItem value="unpaid" data-testid="option-type-unpaid">Unpaid Leave</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
              <SelectTrigger data-testid="select-trigger-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved" data-testid="option-status-approved">Approved</SelectItem>
                <SelectItem value="partially_approved" data-testid="option-status-partially-approved">Partially Approved</SelectItem>
                <SelectItem value="denied" data-testid="option-status-denied">Denied</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start date"
              data-testid="input-start-date"
            />

            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End date"
              data-testid="input-end-date"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !requests || requests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-processed">
            No processed requests found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <Badge variant="secondary" data-testid="badge-processed-count">{requests.length} result{requests.length !== 1 ? "s" : ""}</Badge>
          {requests.map((req) => (
            <ProcessedRequestCard key={req.id} request={req} showDeptLocation={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProcessedRequestCard({ request, showDeptLocation }: { request: ProcessedPtoRequest; showDeptLocation?: boolean }) {
  const statusColor = request.status === "approved"
    ? "bg-green-100 text-green-800"
    : request.status === "partially_approved"
    ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-800";

  return (
    <Card data-testid={`card-processed-request-${request.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">
                {(request as any).requestCategory === "cashout" ? (
                  <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />Cash-Out ({formatTimeOffTypeLabel(request.type)})</span>
                ) : formatTimeOffTypeLabel(request.type)}
              </Badge>
              <Badge variant="secondary" className={statusColor} data-testid={`badge-status-${request.id}`}>
                {request.status === "partially_approved" ? "Partially Approved" : request.status.charAt(0).toUpperCase() + request.status.slice(1)}
              </Badge>
            </div>
            <p className="font-semibold" data-testid={`text-processed-employee-${request.id}`}>
              {request.employeeName}
            </p>
            <p className="text-sm" data-testid={`text-processed-dates-${request.id}`}>
              {(request as any).requestCategory === "cashout"
                ? `${request.daysRequested * 8} hours (${request.daysRequested} day${request.daysRequested > 1 ? "s" : ""})`
                : `${request.startDate} to ${request.status === "partially_approved" && request.approvedEndDate ? request.approvedEndDate : request.endDate} (${request.status === "partially_approved" && request.daysApproved ? `${request.daysApproved} of ${request.daysRequested}` : request.daysRequested} day${(request.daysRequested || 1) > 1 ? "s" : ""})`}
            </p>
            {request.reason && (
              <p className="text-sm text-muted-foreground" data-testid={`text-processed-reason-${request.id}`}>
                "{request.reason}"
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
              <span data-testid={`text-processed-reviewer-${request.id}`}>Reviewed by: {request.reviewerName}</span>
              {request.reviewedAt && (
                <span data-testid={`text-processed-reviewed-at-${request.id}`}>
                  on {new Date(request.reviewedAt).toLocaleDateString()}
                </span>
              )}
              {showDeptLocation && (
                <>
                  <span data-testid={`text-processed-dept-${request.id}`}>Dept: {request.departmentName}</span>
                  <span data-testid={`text-processed-loc-${request.id}`}>Location: {request.locationName}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AllPendingTab() {
  const { data: ptoRequests, isLoading: ptoLoading } = useQuery<PendingPtoRequest[]>({
    queryKey: ["/api/time-off/pending"],
  });

  const { data: exceptions, isLoading: excLoading } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });

  const isLoading = ptoLoading || excLoading;
  const totalPending = (ptoRequests?.length || 0) + (exceptions?.length || 0);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" data-testid="badge-total-pending">{totalPending} pending</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : totalPending === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-pending">
            All caught up! No pending requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(ptoRequests || []).map((req) => (
            <PtoRequestCard key={`pto-${req.id}`} request={req} />
          ))}
          {(exceptions || []).map((ex) => (
            <ExceptionCard key={`exc-${ex.id}`} exception={ex} />
          ))}
        </div>
      )}
    </div>
  );
}

function PtoRequestsTab() {
  const { data: ptoRequests, isLoading } = useQuery<PendingPtoRequest[]>({
    queryKey: ["/api/time-off/pending"],
  });

  return (
    <div className="space-y-4 mt-4">
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !ptoRequests || ptoRequests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-pto-requests">
            No pending PTO requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ptoRequests.map((req) => (
            <PtoRequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
}

type DecidedException = AttendanceException & {
  employeeName: string;
  reviewerName: string;
};

function ExceptionsTab() {
  const { data: exceptions, isLoading } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });

  const { data: recentDecided, isLoading: decidedLoading } = useQuery<DecidedException[]>({
    queryKey: ["/api/attendance/exceptions/recent-decided"],
  });

  return (
    <div className="space-y-6 mt-4">
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !exceptions || exceptions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-exception-requests">
            No pending attendance exceptions.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {exceptions.map((ex) => (
            <ExceptionCard key={ex.id} exception={ex} />
          ))}
        </div>
      )}

      <div data-testid="section-recently-decided">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Recently Decided</h3>
        {decidedLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !recentDecided || recentDecided.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recently decided exceptions.</p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reviewed By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentDecided.map((ex) => (
                    <TableRow key={ex.id} data-testid={`row-decided-${ex.id}`}>
                      <TableCell className="font-medium">{ex.employeeName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{ex.type.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{ex.exceptionDate}</TableCell>
                      <TableCell>
                        <Badge variant={ex.status === "approved" ? "default" : "destructive"} className={ex.status === "approved" ? "bg-green-600" : ""}>
                          {ex.status.charAt(0).toUpperCase() + ex.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ex.reviewerName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function PtoRequestCard({ request }: { request: PendingPtoRequest }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [comment, setComment] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/time-off/${request.id}/approve`, { comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/processed"] });
      toast({ title: "PTO request approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/time-off/${request.id}/deny`, { comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/processed"] });
      toast({ title: "PTO request denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-pto-request-${request.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">PTO</Badge>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>
            </div>
            <p className="font-semibold" data-testid={`text-pto-employee-${request.id}`}>
              {request.employeeName}
            </p>
            <p className="text-sm" data-testid={`text-pto-type-${request.id}`}>
              {(request as any).requestCategory === "cashout"
                ? `PTO Cash-Out: ${request.daysRequested * 8} hours (${request.daysRequested} day${request.daysRequested > 1 ? "s" : ""}) - ${formatTimeOffTypeLabel(request.type)}`
                : `${formatTimeOffTypeLabel(request.type)} — ${request.startDate} to ${request.endDate} (${request.daysRequested} day${request.daysRequested > 1 ? "s" : ""})`}
            </p>
            {request.reason && (
              <p className="text-sm text-muted-foreground" data-testid={`text-pto-reason-${request.id}`}>
                "{request.reason}"
              </p>
            )}
            {isAdmin && (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1" data-testid={`info-pto-context-${request.id}`}>
                <span className="flex items-center gap-1" data-testid={`text-pto-department-${request.id}`}>
                  <Building2 className="h-3 w-3" /> {request.departmentName || "Unassigned"}
                </span>
                <span className="flex items-center gap-1" data-testid={`text-pto-location-${request.id}`}>
                  <MapPin className="h-3 w-3" /> {request.locationName || "Unassigned"}
                </span>
                <span className="flex items-center gap-1" data-testid={`text-pto-manager-${request.id}`}>
                  <UserCheck className="h-3 w-3" /> {request.managerNames && request.managerNames.length > 0 ? request.managerNames.join(", ") : "No manager"}
                </span>
              </div>
            )}
            <Textarea
              placeholder="Comment (optional)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-2"
              data-testid={`input-pto-comment-${request.id}`}
            />
          </div>
          <div className="flex md:flex-col gap-2 md:min-w-[120px]">
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || denyMutation.isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              data-testid={`button-approve-pto-${request.id}`}
            >
              <Check className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button
              onClick={() => denyMutation.mutate()}
              disabled={approveMutation.isPending || denyMutation.isPending}
              variant="destructive"
              className="flex-1"
              data-testid={`button-deny-pto-${request.id}`}
            >
              <X className="h-4 w-4 mr-1" /> Deny
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface TimeInfoResult {
  origIn?: string;
  origOut?: string;
  reqIn?: string;
  reqOut?: string;
  cleanReason: string;
}

function parseTimeInfo(reason: string): TimeInfoResult {
  const match = reason.match(/\[([^\]]+)\]$/);
  if (!match) return { cleanReason: reason };
  const cleanReason = reason.replace(/\s*\[[^\]]+\]$/, "").trim();
  const parts = match[1].split(", ");
  const result: TimeInfoResult = { cleanReason };
  for (const part of parts) {
    if (part.startsWith("Original In: ")) result.origIn = part.replace("Original In: ", "");
    if (part.startsWith("Original Out: ")) result.origOut = part.replace("Original Out: ", "");
    if (part.startsWith("Corrected In: ")) result.reqIn = part.replace("Corrected In: ", "");
    if (part.startsWith("Corrected Out: ")) result.reqOut = part.replace("Corrected Out: ", "");
  }
  return result;
}

function ExceptionCard({ exception }: { exception: EnrichedException }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [notes, setNotes] = useState("");
  const timeInfo = parseTimeInfo(exception.reason);
  const hasTimeInfo = timeInfo.origIn || timeInfo.origOut || timeInfo.reqIn || timeInfo.reqOut;

  const initials = (exception.employeeName || "E")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/attendance/exceptions/${exception.id}/approve`, { reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      toast({ title: "Exception approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/attendance/exceptions/${exception.id}/deny`, { reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      toast({ title: "Exception denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-exception-request-${exception.id}`}>
      <CardContent className="p-5">
        <div className="flex gap-4 items-start flex-wrap">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-[200px] space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{exception.type.replace(/_/g, " ")}</Badge>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>
            </div>
            <p className="font-semibold" data-testid={`text-exc-employee-${exception.id}`}>
              {exception.employeeName || "Employee"}
            </p>
            <p className="text-xs text-muted-foreground" data-testid={`text-exc-date-${exception.id}`}>
              {exception.exceptionDate}
            </p>

            {hasTimeInfo && (
              <div className="grid grid-cols-2 gap-3 max-w-[400px] mt-2">
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3" data-testid={`box-recorded-${exception.id}`}>
                  <div className="text-[10px] font-bold uppercase text-red-600 mb-1">Recorded</div>
                  <div className="text-xs text-muted-foreground">{exception.exceptionDate}</div>
                  <div className="text-sm font-mono font-bold text-red-700 dark:text-red-400">
                    {timeInfo.origIn || "—"} – {timeInfo.origOut || "—"}
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3" data-testid={`box-requested-${exception.id}`}>
                  <div className="text-[10px] font-bold uppercase text-green-600 mb-1">Requested</div>
                  <div className="text-xs text-muted-foreground">{exception.exceptionDate}</div>
                  <div className="text-sm font-mono font-bold text-green-700 dark:text-green-400">
                    {timeInfo.reqIn || "—"} – {timeInfo.reqOut || "—"}
                  </div>
                </div>
              </div>
            )}

            {timeInfo.cleanReason && (
              <p className="text-sm text-muted-foreground italic" data-testid={`text-exc-reason-${exception.id}`}>
                "{timeInfo.cleanReason}"
              </p>
            )}

            {isAdmin && (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1" data-testid={`info-exc-context-${exception.id}`}>
                <span className="flex items-center gap-1" data-testid={`text-exc-department-${exception.id}`}>
                  <Building2 className="h-3 w-3" /> {exception.departmentName || "Unassigned"}
                </span>
                <span className="flex items-center gap-1" data-testid={`text-exc-location-${exception.id}`}>
                  <MapPin className="h-3 w-3" /> {exception.locationName || "Unassigned"}
                </span>
                <span className="flex items-center gap-1" data-testid={`text-exc-manager-${exception.id}`}>
                  <UserCheck className="h-3 w-3" /> {exception.managerNames && exception.managerNames.length > 0 ? exception.managerNames.join(", ") : "No manager"}
                </span>
              </div>
            )}
            <Textarea
              placeholder="Comment (optional)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-2"
              data-testid={`input-exc-notes-${exception.id}`}
            />
          </div>
          <div className="flex md:flex-col gap-2 md:min-w-[120px]">
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || denyMutation.isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              data-testid={`button-approve-exc-${exception.id}`}
            >
              <Check className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button
              onClick={() => denyMutation.mutate()}
              disabled={approveMutation.isPending || denyMutation.isPending}
              variant="destructive"
              className="flex-1"
              data-testid={`button-deny-exc-${exception.id}`}
            >
              <X className="h-4 w-4 mr-1" /> Deny
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
