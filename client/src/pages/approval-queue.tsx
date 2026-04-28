import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateRange } from "@/lib/utils";
import { Check, X, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { TimeOffRequest } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

type PendingRequest = TimeOffRequest & {
  employeeName: string;
};

type EnrichedRequest = TimeOffRequest & {
  employeeName: string;
  reviewerName: string;
};

export default function ApprovalQueuePage() {
  const { toast } = useToast();
  const [comments, setComments] = useState<Record<string, string>>({});
  const [partialMode, setPartialMode] = useState<Record<string, boolean>>({});
  const [partialHours, setPartialHours] = useState<Record<string, number>>({});
  const [partialEndDate, setPartialEndDate] = useState<Record<string, string>>({});

  const { data: pendingRequests, isLoading: pendingLoading } = useQuery<PendingRequest[]>({
    queryKey: ["/api/time-off/pending"],
  });

  const { data: processedRequests, isLoading: processedLoading } = useQuery<EnrichedRequest[]>({
    queryKey: ["/api/time-off/processed"],
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment, hoursApproved, approvedEndDate }: { id: string; comment?: string; hoursApproved?: number; approvedEndDate?: string }) => {
      await apiRequest("POST", `/api/time-off/${id}/approve`, { comment, hoursApproved, approvedEndDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/processed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/team-stats"] });
      toast({ title: "Request approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment?: string }) => {
      await apiRequest("POST", `/api/time-off/${id}/deny`, { comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/processed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/team-stats"] });
      toast({ title: "Request denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getDayCount = (start: string, end: string) => {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  const handleApprove = (request: PendingRequest) => {
    const isPartial = partialMode[request.id];
    const hours = partialHours[request.id];
    const endDate = partialEndDate[request.id] || request.endDate;

    if (isPartial && hours && hours < (request.hoursRequested || 8)) {
      approveMutation.mutate({
        id: request.id,
        comment: comments[request.id],
        hoursApproved: hours,
        approvedEndDate: endDate,
      });
    } else {
      approveMutation.mutate({ id: request.id, comment: comments[request.id] });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="default" className="bg-green-600">✓ Approved</Badge>;
      case "partially_approved":
        return <Badge variant="default" className="bg-amber-500">◐ Partially Approved</Badge>;
      case "denied":
        return <Badge variant="destructive">✗ Denied</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="max-w-5xl space-y-6" data-testid="approval-queue-page">
      <PageHeader title={`Pending Approvals (${pendingRequests?.length ?? 0})`} subtitle="Review and action time-off requests" />

      {pendingLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : pendingRequests && pendingRequests.length > 0 ? (
        <div className="space-y-4">
          {pendingRequests.map((request) => (
            <Card key={request.id} data-testid={`card-pending-request-${request.id}`}>
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <p className="text-lg font-semibold" data-testid={`text-request-title-${request.id}`}>
                      {request.employeeName} - {formatTimeOffTypeLabel(request.type)} Request
                    </p>
                    <p className="text-base" data-testid={`text-request-dates-${request.id}`}>
                      {formatDateRange(request.startDate, request.endDate)} ({request.hoursRequested} hrs)
                    </p>
                    <p className="text-sm text-muted-foreground" data-testid={`text-request-submitted-${request.id}`}>
                      Submitted: {formatDate(request.createdAt) || "N/A"}
                      {request.editedAt && (
                        <Badge variant="outline" className="ml-2 text-xs bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-700" data-testid={`badge-edited-${request.id}`}>
                          Edited
                        </Badge>
                      )}
                    </p>
                    {request.exceedsBalance && (
                      <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-400 rounded-md p-2 flex items-start gap-2" data-testid={`warning-exceeds-balance-${request.id}`}>
                        <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-orange-800 dark:text-orange-300">
                          Exceeds balance: Requested {request.hoursRequested} hrs, balance was {request.balanceAtSubmission ?? "N/A"} hrs ({request.type})
                        </p>
                      </div>
                    )}
                    {request.reason && (
                      <p className="text-sm bg-muted/50 p-2 rounded" data-testid={`text-request-reason-${request.id}`}>
                        "{request.reason}"
                      </p>
                    )}

                    <button
                      type="button"
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setPartialMode(prev => ({ ...prev, [request.id]: !prev[request.id] }))}
                      data-testid={`button-toggle-partial-${request.id}`}
                    >
                      {partialMode[request.id] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      Partial approval options
                    </button>

                    {partialMode[request.id] && (
                      <div className="border rounded-md p-3 space-y-3 bg-muted/30" data-testid={`partial-approval-section-${request.id}`}>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Hours to Approve</Label>
                            <Input
                              type="number"
                              min={1}
                              max={request.hoursRequested || 8}
                              value={partialHours[request.id] ?? request.hoursRequested ?? 8}
                              onChange={(e) => setPartialHours(prev => ({ ...prev, [request.id]: parseFloat(e.target.value) || 1 }))}
                              data-testid={`input-partial-hours-${request.id}`}
                            />
                            <p className="text-xs text-muted-foreground">of {request.hoursRequested} hrs requested</p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Approved End Date</Label>
                            <Input
                              type="date"
                              min={request.startDate}
                              max={request.endDate}
                              value={partialEndDate[request.id] ?? request.endDate}
                              onChange={(e) => setPartialEndDate(prev => ({ ...prev, [request.id]: e.target.value }))}
                              data-testid={`input-partial-end-date-${request.id}`}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <Textarea
                      placeholder="Add a comment (optional)..."
                      value={comments[request.id] || ""}
                      onChange={(e) => setComments(prev => ({ ...prev, [request.id]: e.target.value }))}
                      className="mt-2"
                      data-testid={`input-comment-${request.id}`}
                    />
                  </div>
                  <div className="flex md:flex-col gap-2 md:min-w-[140px]">
                    <Button
                      onClick={() => handleApprove(request)}
                      disabled={approveMutation.isPending || denyMutation.isPending}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      data-testid={`button-approve-${request.id}`}
                    >
                      <Check className="h-4 w-4 mr-1" /> {partialMode[request.id] && partialHours[request.id] && partialHours[request.id] < (request.hoursRequested || 8) ? "Partial Approve" : "Approve"}
                    </Button>
                    <Button
                      onClick={() => denyMutation.mutate({ id: request.id, comment: comments[request.id] })}
                      disabled={approveMutation.isPending || denyMutation.isPending}
                      variant="destructive"
                      className="flex-1"
                      data-testid={`button-deny-${request.id}`}
                    >
                      <X className="h-4 w-4 mr-1" /> Deny
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-pending">
            No pending approval requests.
          </CardContent>
        </Card>
      )}

      <div className="pt-4">
        <h2 className="text-lg font-semibold" data-testid="text-recently-processed-title">Recently Processed</h2>
        {processedLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : processedRequests && processedRequests.length > 0 ? (
          <Card data-testid="card-processed-requests">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Dates</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Hours</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Processed By</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedRequests.map((request) => (
                    <TableRow key={request.id} data-testid={`row-processed-${request.id}`}>
                      <TableCell data-testid={`text-processed-employee-${request.id}`}>
                        {request.employeeName}
                      </TableCell>
                      <TableCell data-testid={`text-processed-type-${request.id}`}>
                        {formatTimeOffTypeLabel(request.type)}
                      </TableCell>
                      <TableCell data-testid={`text-processed-dates-${request.id}`}>
                        {request.status === "partially_approved" && request.approvedEndDate
                          ? formatDateRange(request.startDate, request.approvedEndDate)
                          : formatDateRange(request.startDate, request.endDate)}
                      </TableCell>
                      <TableCell data-testid={`text-processed-hours-${request.id}`}>
                        {request.status === "partially_approved" && request.hoursApproved !== null
                          ? `${request.hoursApproved} / ${request.hoursRequested}`
                          : request.hoursRequested}
                      </TableCell>
                      <TableCell data-testid={`text-processed-status-${request.id}`}>
                        {getStatusBadge(request.status)}
                      </TableCell>
                      <TableCell data-testid={`text-processed-reviewer-${request.id}`}>
                        {request.reviewerName}
                      </TableCell>
                      <TableCell data-testid={`text-processed-date-${request.id}`}>
                        {formatDate(request.reviewedAt) || "N/A"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-processed">
              No recently processed requests.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
