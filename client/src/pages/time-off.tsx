import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate, formatDateRange } from "@/lib/utils";
import { Calendar, ChevronLeft, ChevronRight, Pencil, AlertTriangle, Wallet } from "lucide-react";
import type { TimeOffRequest, TimeOffBalanceDetailed } from "@shared/schema";
import { isBalanceTrackedTimeOffType } from "@shared/schema";

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

function formatTypeLabel(type: string): string {
  return TIME_OFF_TYPE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export default function TimeOff() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [type, setType] = useState("vacation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const [editingRequest, setEditingRequest] = useState<TimeOffRequest | null>(null);
  const [editType, setEditType] = useState("vacation");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editReason, setEditReason] = useState("");


  const { data: requests, isLoading: requestsLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off"],
    enabled: isAuthenticated,
  });

  const { data: teamRequests, isLoading: teamLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off/team"],
    enabled: isAuthenticated,
  });

  const canViewBalance = user?.role === "admin";
  const { data: balance, isLoading: balanceLoading } = useQuery<TimeOffBalanceDetailed>({
    queryKey: ["/api/time-off/my-balance"],
    enabled: isAuthenticated && canViewBalance,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const hoursRequested = calculateDays() * 8;
      return apiRequest("POST", "/api/time-off", {
        type,
        startDate,
        endDate,
        hoursRequested,
        reason: reason || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/my-balance"] });

      queryClient.invalidateQueries({ queryKey: ["/api/attendance/status"] });
      setType("vacation");
      setStartDate("");
      setEndDate("");
      setReason("");
      toast({ title: "Request Submitted", description: "Your time off request has been submitted." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingRequest) return;
      const hoursRequested = calculateDaysForRange(editStartDate, editEndDate) * 8;
      return apiRequest("PUT", `/api/time-off/${editingRequest.id}`, {
        type: editType,
        startDate: editStartDate,
        endDate: editEndDate,
        hoursRequested,
        reason: editReason || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/my-balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/status"] });
      setEditingRequest(null);
      toast({ title: "Request Updated", description: "Your time off request has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });



  const openEditDialog = (request: TimeOffRequest) => {
    setEditingRequest(request);
    setEditType(request.type);
    setEditStartDate(request.startDate);
    setEditEndDate(request.endDate);
    setEditReason(request.reason || "");
  };

  const calculateDaysForRange = (start: string, end: string) => {
    if (!start || !end) return 0;
    const parts1 = start.split("-").map(Number);
    const parts2 = end.split("-").map(Number);
    if (parts1.length !== 3 || parts2.length !== 3) return 0;
    const s = new Date(Date.UTC(parts1[0], parts1[1] - 1, parts1[2]));
    const e = new Date(Date.UTC(parts2[0], parts2[1] - 1, parts2[2]));
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    if (e < s) return 0;
    let count = 0;
    const current = new Date(s);
    while (current <= e) {
      const day = current.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return count;
  };

  const editDaysRequested = calculateDaysForRange(editStartDate, editEndDate);
  const editHoursRequested = editDaysRequested * 8;

  const calculateDays = () => {
    if (!startDate || !endDate) return 0;
    const parts1 = startDate.split("-").map(Number);
    const parts2 = endDate.split("-").map(Number);
    if (parts1.length !== 3 || parts2.length !== 3) return 0;
    const start = new Date(Date.UTC(parts1[0], parts1[1] - 1, parts1[2]));
    const end = new Date(Date.UTC(parts2[0], parts2[1] - 1, parts2[2]));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    if (end < start) return 0;
    let count = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return count;
  };

  const daysRequested = calculateDays();
  const hoursRequested = daysRequested * 8;

  const isBalanceTracked = isBalanceTrackedTimeOffType(type);
  const selectedBalance = isBalanceTracked && balance ? balance[type as "vacation" | "sick" | "personal"] : null;
  const projectedRemaining = selectedBalance ? round2(selectedBalance.remaining - hoursRequested) : null;
  const projectedExceeds = projectedRemaining !== null && projectedRemaining < 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300" data-testid="badge-status-pending">Pending</Badge>;
      case "approved":
        return <Badge variant="default" className="bg-green-600" data-testid="badge-status-approved">Approved</Badge>;
      case "partially_approved":
        return <Badge variant="default" className="bg-amber-500" data-testid="badge-status-partially-approved">Partially Approved</Badge>;
      case "denied":
        return <Badge variant="destructive" data-testid="badge-status-denied">Denied</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Time Off"
        subtitle="Request time off and view your upcoming schedule"
      />

      {!canViewBalance ? (
        <Card data-testid="card-balance-notice">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              PTO Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground" data-testid="text-balance-message-notice">
              Your PTO balance isn't shown here. If you have a balance inquiry, please send a message to HR.
            </p>
          </CardContent>
        </Card>
      ) : (
      <Card data-testid="card-balance-summary">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            My PTO Balance ({new Date().getFullYear()})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balanceLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : balance ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["vacation", "sick", "personal"] as const).map((bucketKey) => {
                const bucket = balance[bucketKey];
                const remainingLow = bucket.remaining <= 0;
                return (
                  <div
                    key={bucketKey}
                    className="rounded-md border p-3 bg-muted/20"
                    data-testid={`card-balance-${bucketKey}`}
                  >
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {formatTypeLabel(bucketKey)}
                    </p>
                    <p className="mt-1">
                      <span
                        className={`text-2xl font-semibold tabular-nums ${remainingLow ? "text-orange-600 dark:text-orange-400" : ""}`}
                        data-testid={`text-balance-remaining-${bucketKey}`}
                      >
                        {formatDays(bucket.remaining)}
                      </span>
                      <span className="text-sm text-muted-foreground"> hr{bucket.remaining === 1 ? "" : "s"} remaining</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      <span data-testid={`text-balance-used-${bucketKey}`}>{formatDays(bucket.used)}</span> used of{" "}
                      <span data-testid={`text-balance-total-${bucketKey}`}>{formatDays(bucket.total)}</span> total
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-balance-unavailable">
              Balance information is currently unavailable.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-new-request">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Request Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-request-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIME_OFF_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value} data-testid={`option-type-${value}`}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="time-off-start" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Start Date</Label>
              <Input
                id="time-off-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="time-off-end" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Return Date</Label>
              <Input
                id="time-off-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="time-off-reason" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reason (Optional)</Label>
              <Textarea
                id="time-off-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add a reason..."
                data-testid="input-reason"
              />
            </div>

            {startDate && endDate && daysRequested > 0 && (
              <div
                className={`rounded-md border p-3 space-y-1 ${
                  projectedExceeds
                    ? "bg-orange-50 dark:bg-orange-950/20 border-orange-400"
                    : "bg-amber-50 dark:bg-amber-950/20 border-amber-300"
                }`}
                data-testid="card-hours-summary"
              >
                <p className="text-sm font-semibold">
                  Hours Requested: <span className="tabular-nums">{hoursRequested}</span> hrs
                </p>
                {selectedBalance && projectedRemaining !== null && (
                  <p className="text-sm" data-testid="text-projected-remaining">
                    Remaining after this request:{" "}
                    <span
                      className={`font-semibold tabular-nums ${
                        projectedExceeds ? "text-orange-700 dark:text-orange-400" : ""
                      }`}
                      data-testid="text-projected-remaining-value"
                    >
                      {formatDays(projectedRemaining)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      hr{projectedRemaining === 1 ? "" : "s"} of {formatTypeLabel(type)}
                    </span>
                  </p>
                )}
                {projectedExceeds && (
                  <p className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1" data-testid="warning-projected-exceeds">
                    <AlertTriangle className="h-3 w-3" />
                    This request exceeds your remaining balance.
                  </p>
                )}
              </div>
            )}

            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!startDate || !endDate || daysRequested === 0 || submitMutation.isPending}
              className="w-full"
              data-testid="button-submit-request"
            >
              {submitMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-my-requests">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {requestsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : !requests || requests.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-sm" data-testid="text-no-requests">
                No time off requests yet.
              </p>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-md border p-3"
                    data-testid={`card-request-${request.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      {getStatusBadge(request.status)}
                      {request.exceedsBalance && (
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300 text-xs" data-testid={`badge-exceeds-balance-${request.id}`}>
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Exceeds Balance
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-semibold mt-2">
                      {formatDateRange(request.startDate, request.endDate)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatTypeLabel(request.type)} &bull; <span className="tabular-nums">{request.hoursRequested}</span> hrs
                    </p>
                    {request.status === "pending" && (
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-sm text-amber-600">Awaiting manager approval</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(request)}
                          data-testid={`button-edit-request-${request.id}`}
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      </div>
                    )}
                    {request.status === "approved" && (
                      <p className="text-sm text-green-600 mt-1">Approved</p>
                    )}
                    {request.status === "partially_approved" && (
                      <p className="text-sm text-amber-600 mt-1">
                        Partially Approved — {request.hoursApproved} of {request.hoursRequested} hrs
                        {request.approvedEndDate ? ` (through ${formatDate(request.approvedEndDate)})` : ""}
                      </p>
                    )}
                    {request.reason && (
                      <p className="text-xs text-muted-foreground mt-1 italic">{request.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TeamCalendar
        teamRequests={teamRequests || []}
        isLoading={teamLoading}
        currentUserId={user?.id}
      />


      <Dialog open={!!editingRequest} onOpenChange={(open) => { if (!open) setEditingRequest(null); }}>
        <DialogContent data-testid="dialog-edit-request">
          <DialogHeader>
            <DialogTitle>Edit Time Off Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Request Type</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger data-testid="select-edit-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIME_OFF_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value} data-testid={`option-edit-type-${value}`}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Start Date</Label>
              <Input
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                data-testid="input-edit-start-date"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">End Date</Label>
              <Input
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
                data-testid="input-edit-end-date"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reason (Optional)</Label>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Add a reason..."
                data-testid="input-edit-reason"
              />
            </div>

            {editStartDate && editEndDate && editDaysRequested > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 rounded-md p-3" data-testid="card-edit-hours-summary">
                <p className="text-sm font-semibold">Hours Requested: <span className="tabular-nums">{editHoursRequested}</span> hrs</p>
              </div>
            )}

            <Button
              onClick={() => editMutation.mutate()}
              disabled={!editStartDate || !editEndDate || editDaysRequested === 0 || editMutation.isPending}
              className="w-full"
              data-testid="button-save-edit"
            >
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamCalendar({
  teamRequests,
  isLoading,
  currentUserId,
}: {
  teamRequests: TimeOffRequest[];
  isLoading: boolean;
  currentUserId?: string;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const approvedRequests = teamRequests.filter((r) => r.status === "approved" || r.status === "partially_approved" || r.status === "pending");

  const getRequestsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return approvedRequests.filter((r) => r.startDate <= dateStr && r.endDate >= dateStr);
  };

  const monthName = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <Card data-testid="card-team-calendar">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            Team Calendar
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth} data-testid="button-prev-month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center" data-testid="text-calendar-month">
              {monthName}
            </span>
            <Button variant="outline" size="icon" onClick={nextMonth} data-testid="button-next-month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="bg-muted p-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {d}
                </div>
              ))}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-card p-2 min-h-[60px]" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayRequests = getRequestsForDay(day);
                const isToday =
                  day === new Date().getDate() &&
                  month === new Date().getMonth() &&
                  year === new Date().getFullYear();

                return (
                  <div
                    key={day}
                    className={`bg-card p-1 min-h-[60px] ${isToday ? "ring-2 ring-primary ring-inset" : ""}`}
                    data-testid={`calendar-day-${day}`}
                  >
                    <span className={`text-xs ${isToday ? "font-bold text-primary" : ""}`}>{day}</span>
                    <div className="mt-1 space-y-0.5">
                      {dayRequests.slice(0, 2).map((req) => (
                        <div
                          key={req.id}
                          className={`text-[10px] px-1 py-0.5 rounded truncate ${
                            req.userId === currentUserId
                              ? "bg-primary/20 text-primary font-medium"
                              : "bg-muted text-muted-foreground"
                          }`}
                          title={`${formatTypeLabel(req.type)} - ${req.userId === currentUserId ? "You" : "Team member"}`}
                        >
                          {req.userId === currentUserId ? "You" : "Team"}
                        </div>
                      ))}
                      {dayRequests.length > 2 && (
                        <div className="text-[10px] text-muted-foreground">+{dayRequests.length - 2}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-4 text-xs flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-primary/20" />
                <span>Your time off</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-muted" />
                <span>Team members' time off</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
