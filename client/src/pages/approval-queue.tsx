import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Check, X } from "lucide-react";
import type { TimeOffRequest } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  const { data: pendingRequests, isLoading: pendingLoading } = useQuery<PendingRequest[]>({
    queryKey: ["/api/time-off/pending"],
  });

  const { data: processedRequests, isLoading: processedLoading } = useQuery<EnrichedRequest[]>({
    queryKey: ["/api/time-off/processed"],
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment?: string }) => {
      await apiRequest("POST", `/api/time-off/${id}/approve`, { comment });
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

  const formatDateRange = (start: string, end: string) => {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
    if (start === end) return s.toLocaleDateString("en-US", opts);
    return `${s.toLocaleDateString("en-US", opts)} - ${e.toLocaleDateString("en-US", opts)}`;
  };

  const getDayCount = (start: string, end: string) => {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  return (
    <div className="p-6 space-y-6" data-testid="approval-queue-page">
      <h1 className="text-2xl font-bold" data-testid="text-page-title">
        Pending Approvals ({pendingRequests?.length ?? 0})
      </h1>

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
                      {request.employeeName} - {request.type.charAt(0).toUpperCase() + request.type.slice(1)} Request
                    </p>
                    <p className="text-base" data-testid={`text-request-dates-${request.id}`}>
                      {formatDateRange(request.startDate, request.endDate)} ({getDayCount(request.startDate, request.endDate)} day{getDayCount(request.startDate, request.endDate) > 1 ? "s" : ""})
                    </p>
                    <p className="text-sm text-muted-foreground" data-testid={`text-request-submitted-${request.id}`}>
                      Submitted: {request.createdAt ? new Date(request.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "N/A"}
                    </p>
                    {request.reason && (
                      <p className="text-sm bg-muted/50 p-2 rounded" data-testid={`text-request-reason-${request.id}`}>
                        "{request.reason}"
                      </p>
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
                      onClick={() => approveMutation.mutate({ id: request.id, comment: comments[request.id] })}
                      disabled={approveMutation.isPending || denyMutation.isPending}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      data-testid={`button-approve-${request.id}`}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
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
        <h2 className="text-xl font-semibold mb-4" data-testid="text-recently-processed-title">Recently Processed</h2>
        {processedLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : processedRequests && processedRequests.length > 0 ? (
          <Card data-testid="card-processed-requests">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Processed By</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedRequests.map((request) => (
                    <TableRow key={request.id} data-testid={`row-processed-${request.id}`}>
                      <TableCell data-testid={`text-processed-employee-${request.id}`}>
                        {request.employeeName}
                      </TableCell>
                      <TableCell data-testid={`text-processed-type-${request.id}`}>
                        {request.type.charAt(0).toUpperCase() + request.type.slice(1)}
                      </TableCell>
                      <TableCell data-testid={`text-processed-dates-${request.id}`}>
                        {formatDateRange(request.startDate, request.endDate)}
                      </TableCell>
                      <TableCell data-testid={`text-processed-status-${request.id}`}>
                        <Badge variant={request.status === "approved" ? "default" : "destructive"}>
                          {request.status === "approved" ? "✓ Approved" : "✗ Denied"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-processed-reviewer-${request.id}`}>
                        {request.reviewerName}
                      </TableCell>
                      <TableCell data-testid={`text-processed-date-${request.id}`}>
                        {request.reviewedAt ? new Date(request.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "N/A"}
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
