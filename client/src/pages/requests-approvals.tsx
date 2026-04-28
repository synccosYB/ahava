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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate, formatDateRange } from "@/lib/utils";
import { Check, X, ClipboardList, Filter, RotateCcw, Building2, MapPin, UserCheck, Calendar, Clock, AlertTriangle, User, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { TimeOffRequest, AttendanceException, Department, Location, TimeOffBalanceBucket } from "@shared/schema";
import { parseExceptionTimeInfo, buildTimeCorrectionPayload } from "@/lib/exceptionTimeInfo";
import { formatTime12FromHHmm } from "@/lib/utils";
import {
  isHighCorrectionCount,
  HIGH_CORRECTION_THRESHOLD,
  emptyCorrectionCountSummary,
  type CorrectionCountSummary,
} from "@shared/correctionCounts";

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
  currentBalance: TimeOffBalanceBucket | null;
};

function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
type EnrichedException = AttendanceException & {
  employeeName?: string;
  departmentName?: string;
  locationName?: string;
  managerNames?: string[];
  correctionCounts?: CorrectionCountSummary;
  correctionCount90d?: CorrectionCountSummary;
};

function CorrectionCountBreakdown({
  summary,
  exceptionId,
}: {
  summary: CorrectionCountSummary;
  exceptionId: string;
}) {
  const allTotal = summary.all.total;
  const high = isHighCorrectionCount(allTotal);
  return (
    <span
      className="text-xs text-muted-foreground inline-flex items-center gap-1 flex-wrap"
      data-testid={`text-correction-counts-${exceptionId}`}
      title={
        high
          ? `Frequent corrections — may need attention (≥${HIGH_CORRECTION_THRESHOLD} all-time)`
          : `Correction requests by time window`
      }
    >
      <span data-testid={`text-correction-count-pay-period-${exceptionId}`}>
        Pay Period: {summary.payPeriod.total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid={`text-correction-count-week-${exceptionId}`}>
        Week: {summary.week.total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid={`text-correction-count-month-${exceptionId}`}>
        Month: {summary.month.total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid={`text-correction-count-year-${exceptionId}`}>
        Year: {summary.year.total}
      </span>
      <span aria-hidden="true">·</span>
      <span
        className={high ? "font-semibold text-amber-700 dark:text-amber-400" : undefined}
        data-testid={`text-correction-count-all-${exceptionId}`}
      >
        All: {allTotal}
      </span>
    </span>
  );
}

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

  const [selectedRequest, setSelectedRequest] = useState<ProcessedPtoRequest | null>(null);

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
            <ProcessedRequestCard key={req.id} request={req} showDeptLocation={isAdmin} onClick={() => setSelectedRequest(req)} />
          ))}
        </div>
      )}

      <ProcessedRequestDetailDialog
        request={selectedRequest}
        open={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
      />
    </div>
  );
}

function ProcessedRequestCard({ request, showDeptLocation, onClick }: { request: ProcessedPtoRequest; showDeptLocation?: boolean; onClick?: () => void }) {
  const statusColor = request.status === "approved"
    ? "bg-green-100 text-green-800"
    : request.status === "partially_approved"
    ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-800";

  return (
    <Card
      data-testid={`card-processed-request-${request.id}`}
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">
                {formatTimeOffTypeLabel(request.type)}
              </Badge>
              <Badge variant="secondary" className={statusColor} data-testid={`badge-status-${request.id}`}>
                {request.status === "partially_approved" ? "Partially Approved" : request.status.charAt(0).toUpperCase() + request.status.slice(1)}
              </Badge>
            </div>
            <p className="font-semibold" data-testid={`text-processed-employee-${request.id}`}>
              {request.employeeName}
            </p>
            <p className="text-sm" data-testid={`text-processed-dates-${request.id}`}>
              {`${formatDateRange(request.startDate, request.status === "partially_approved" && request.approvedEndDate ? request.approvedEndDate : request.endDate)} (${request.status === "partially_approved" && request.hoursApproved ? `${request.hoursApproved} of ${request.hoursRequested}` : request.hoursRequested} hrs)`}
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
                  on {formatDate(request.reviewedAt)}
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

function ProcessedRequestDetailDialog({ request, open, onClose }: { request: ProcessedPtoRequest | null; open: boolean; onClose: () => void }) {
  if (!request) return null;

  const isPartial = request.status === "partially_approved";

  const statusLabel = request.status === "partially_approved"
    ? "Partially Approved"
    : request.status.charAt(0).toUpperCase() + request.status.slice(1);

  const statusColor = request.status === "approved"
    ? "bg-green-100 text-green-800"
    : request.status === "partially_approved"
    ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-800";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-processed-request-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="dialog-title-request-detail">
            <FileText className="h-5 w-5" />
            Request Details
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detailed view of the processed time-off request
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" data-testid="detail-badge-type">
              {formatTimeOffTypeLabel(request.type)}
            </Badge>
            <Badge variant="secondary" className={statusColor} data-testid="detail-badge-status">
              {statusLabel}
            </Badge>
            {request.exceedsBalance && (
              <Badge variant="destructive" className="flex items-center gap-1" data-testid="detail-badge-exceeds-balance">
                <AlertTriangle className="h-3 w-3" />
                Exceeds Balance
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-muted-foreground flex items-center gap-1"><User className="h-3.5 w-3.5" />Employee</p>
              <p className="font-medium" data-testid="detail-employee-name">{request.employeeName}</p>
            </div>

            <div>
              <p className="text-muted-foreground flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />Department</p>
              <p className="font-medium" data-testid="detail-department">{request.departmentName}</p>
            </div>

            <div>
              <p className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Location</p>
              <p className="font-medium" data-testid="detail-location">{request.locationName}</p>
            </div>

            <div>
              <p className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Start Date</p>
              <p className="font-medium" data-testid="detail-start-date">{formatDate(request.startDate)}</p>
            </div>

            <div>
              <p className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />End Date</p>
              <p className="font-medium" data-testid="detail-end-date">{formatDate(request.endDate)}</p>
            </div>

            {isPartial && request.approvedEndDate && (
              <div>
                <p className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Approved End Date</p>
                <p className="font-medium text-amber-700" data-testid="detail-approved-end-date">{formatDate(request.approvedEndDate)}</p>
              </div>
            )}

            <div>
              <p className="text-muted-foreground">Hours Requested</p>
              <p className="font-medium" data-testid="detail-hours-requested">{request.hoursRequested}</p>
            </div>

            {isPartial && request.hoursApproved != null && (
              <div>
                <p className="text-muted-foreground">Hours Approved</p>
                <p className="font-medium text-amber-700" data-testid="detail-hours-approved">{request.hoursApproved} of {request.hoursRequested}</p>
              </div>
            )}

            <div>
              <p className="text-muted-foreground flex items-center gap-1"><UserCheck className="h-3.5 w-3.5" />Reviewed By</p>
              <p className="font-medium" data-testid="detail-reviewer">{request.reviewerName}</p>
            </div>

            {request.reviewedAt && (
              <div>
                <p className="text-muted-foreground">Review Date</p>
                <p className="font-medium" data-testid="detail-review-date">{formatDate(request.reviewedAt)}</p>
              </div>
            )}

            {request.createdAt && (
              <div>
                <p className="text-muted-foreground">Submitted</p>
                <p className="font-medium" data-testid="detail-submitted-date">{formatDate(request.createdAt)}</p>
              </div>
            )}
          </div>

          {request.reason && (
            <div className="border-t pt-3">
              <p className="text-sm text-muted-foreground mb-1">Employee's Reason</p>
              <p className="text-sm" data-testid="detail-reason">"{request.reason}"</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
                      <TableCell className="text-sm">{formatDate(ex.exceptionDate)}</TableCell>
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

  const balance = request.currentBalance;
  const projectedRemaining = balance
    ? Math.round((balance.remaining - (request.hoursRequested ?? 0)) * 100) / 100
    : null;
  const projectedExceeds = projectedRemaining !== null && projectedRemaining < 0;

  return (
    <Card data-testid={`card-pto-request-${request.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">PTO</Badge>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>
              {request.exceedsBalance && (
                <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300" data-testid={`badge-pto-exceeds-balance-${request.id}`}>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Exceeds Balance
                </Badge>
              )}
            </div>
            <p className="font-semibold" data-testid={`text-pto-employee-${request.id}`}>
              {request.employeeName}
            </p>
            <p className="text-sm" data-testid={`text-pto-type-${request.id}`}>
              {`${formatTimeOffTypeLabel(request.type)} — ${formatDateRange(request.startDate, request.endDate)} (${request.hoursRequested} hrs)`}
            </p>
            {balance && projectedRemaining !== null && (
              <div
                className={`rounded-md border p-3 space-y-1 ${
                  projectedExceeds
                    ? "bg-orange-50 dark:bg-orange-950/20 border-orange-400"
                    : "bg-muted/30 border-border"
                }`}
                data-testid={`balance-section-${request.id}`}
              >
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {formatTimeOffTypeLabel(request.type)} Balance
                </p>
                <p className="text-sm" data-testid={`text-current-balance-${request.id}`}>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="font-medium tabular-nums">{formatDays(balance.total)}</span>
                  <span className="text-muted-foreground"> · Used:</span>{" "}
                  <span className="font-medium tabular-nums">{formatDays(balance.used)}</span>
                  <span className="text-muted-foreground"> · Remaining:</span>{" "}
                  <span className="font-semibold tabular-nums">{formatDays(balance.remaining)}</span>
                </p>
                <p className="text-sm" data-testid={`text-projected-balance-${request.id}`}>
                  <span className="text-muted-foreground">If approved as-is:</span>{" "}
                  <span
                    className={`font-semibold tabular-nums ${projectedExceeds ? "text-orange-700 dark:text-orange-400" : ""}`}
                    data-testid={`text-projected-balance-value-${request.id}`}
                  >
                    {formatDays(projectedRemaining)}
                  </span>{" "}
                  <span className="text-muted-foreground">day{projectedRemaining === 1 ? "" : "s"} remaining</span>
                </p>
                {projectedExceeds && (
                  <p
                    className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1"
                    data-testid={`warning-projected-exceeds-${request.id}`}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Approving this request will exceed the employee's available balance.
                  </p>
                )}
              </div>
            )}
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

function ExceptionCard({ exception }: { exception: EnrichedException }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [notes, setNotes] = useState("");
  const parsedReason = parseExceptionTimeInfo(exception.reason);
  const timeInfo = {
    origIn: parsedReason.origIn,
    origOut: parsedReason.origOut,
    reqIn: parsedReason.reqIn,
    reqOut: parsedReason.reqOut,
    cleanReason: parsedReason.cleanReason,
  };
  const hasTimeInfo = !!(timeInfo.origIn || timeInfo.origOut || timeInfo.reqIn || timeInfo.reqOut);
  const isTimeCorrection = exception.type === "time_correction";
  const needsManualTimes = isTimeCorrection && !timeInfo.reqIn && !timeInfo.reqOut;
  const [manualReqIn, setManualReqIn] = useState("");
  const [manualReqOut, setManualReqOut] = useState("");

  const initials = (exception.employeeName || "E")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const approveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { action: "approve", reviewNotes: notes };
      if (isTimeCorrection) {
        const reqIn = needsManualTimes ? manualReqIn : timeInfo.reqIn;
        const reqOut = needsManualTimes ? manualReqOut : timeInfo.reqOut;
        const payload = buildTimeCorrectionPayload(exception.exceptionDate, reqIn, reqOut);
        if (!payload.correctedClockIn && !payload.correctedClockOut) {
          throw new Error("Enter at least one corrected time before approving.");
        }
        Object.assign(body, payload);
      }
      await apiRequest("POST", `/api/attendance/exceptions/${exception.id}/resolve`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/correction-counts"] });
      toast({ title: "Exception approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/attendance/exceptions/${exception.id}/resolve`, { action: "deny", reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/correction-counts"] });
      toast({ title: "Exception denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveDisabled =
    approveMutation.isPending ||
    denyMutation.isPending ||
    (needsManualTimes && !manualReqIn && !manualReqOut);

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
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold" data-testid={`text-exc-employee-${exception.id}`}>
                {exception.employeeName || "Employee"}
              </p>
            </div>
            <CorrectionCountBreakdown
              summary={
                exception.correctionCounts ??
                exception.correctionCount90d ??
                emptyCorrectionCountSummary()
              }
              exceptionId={exception.id}
            />
            <p className="text-xs text-muted-foreground" data-testid={`text-exc-date-${exception.id}`}>
              {formatDate(exception.exceptionDate)}
            </p>
            {isHighCorrectionCount(
              (exception.correctionCounts ?? exception.correctionCount90d)?.all.total ?? 0,
            ) && (
              <p
                className="text-xs text-amber-700 dark:text-amber-400"
                data-testid={`text-frequent-corrections-${exception.id}`}
              >
                Frequent corrections — may need attention.
              </p>
            )}

            {hasTimeInfo && (
              <div className="grid grid-cols-2 gap-3 max-w-[400px] mt-2">
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3" data-testid={`box-recorded-${exception.id}`}>
                  <div className="text-[10px] font-bold uppercase text-red-600 mb-1">Recorded</div>
                  <div className="text-xs text-muted-foreground">{formatDate(exception.exceptionDate)}</div>
                  <div className="text-sm font-mono font-bold text-red-700 dark:text-red-400">
                    {timeInfo.origIn ? formatTime12FromHHmm(timeInfo.origIn) : "—"} – {timeInfo.origOut ? formatTime12FromHHmm(timeInfo.origOut) : "—"}
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3" data-testid={`box-requested-${exception.id}`}>
                  <div className="text-[10px] font-bold uppercase text-green-600 mb-1">Requested</div>
                  <div className="text-xs text-muted-foreground">{formatDate(exception.exceptionDate)}</div>
                  <div className="text-sm font-mono font-bold text-green-700 dark:text-green-400">
                    {timeInfo.reqIn ? formatTime12FromHHmm(timeInfo.reqIn) : "—"} – {timeInfo.reqOut ? formatTime12FromHHmm(timeInfo.reqOut) : "—"}
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
            {needsManualTimes && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 mt-2 space-y-2" data-testid={`box-manual-times-${exception.id}`}>
                <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>This request didn't include corrected times. Enter at least one before approving.</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Corrected In</label>
                    <Input
                      type="time"
                      value={manualReqIn}
                      onChange={(e) => setManualReqIn(e.target.value)}
                      data-testid={`input-manual-corrected-in-${exception.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Corrected Out</label>
                    <Input
                      type="time"
                      value={manualReqOut}
                      onChange={(e) => setManualReqOut(e.target.value)}
                      data-testid={`input-manual-corrected-out-${exception.id}`}
                    />
                  </div>
                </div>
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
              disabled={approveDisabled}
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
