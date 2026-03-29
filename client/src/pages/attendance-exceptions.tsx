import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Check, X, Filter } from "lucide-react";
import type { AttendanceException } from "@shared/schema";

type EnrichedException = AttendanceException & {
  employeeName?: string;
  reviewerName?: string;
};

export default function AttendanceExceptionsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("all");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const { data: exceptions, isLoading, isError } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions"],
  });

  const { data: pendingExceptions } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      await apiRequest("POST", `/api/attendance/exceptions/${id}/resolve`, { action: "approve", reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      toast({ title: "Exception approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      await apiRequest("POST", `/api/attendance/exceptions/${id}/resolve`, { action: "deny", reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      toast({ title: "Exception denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const allExceptions = exceptions || [];
  const filtered = allExceptions.filter((ex) => {
    if (statusFilter !== "all" && ex.status !== statusFilter) return false;
    if (typeFilter !== "all" && ex.type !== typeFilter) return false;
    return true;
  });

  const exceptionTypes = [...new Set(allExceptions.map((e) => e.type))];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>;
      case "approved": return <Badge variant="default" className="bg-green-600">Approved</Badge>;
      case "denied": return <Badge variant="destructive">Denied</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    const labels: Record<string, string> = {
      missing_punch: "Missing Punch",
      late_arrival: "Late Arrival",
      early_departure: "Early Departure",
      missed_break: "Missed Break",
      manual_correction: "Manual Correction",
    };
    return <Badge variant="outline">{labels[type] || type}</Badge>;
  };

  return (
    <div className="p-6 space-y-6" data-testid="attendance-exceptions-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Alerts & Exceptions
          </h1>
          {pendingExceptions && pendingExceptions.length > 0 && (
            <Badge variant="destructive" data-testid="badge-pending-count">
              {pendingExceptions.length} pending
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {exceptionTypes.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-destructive" data-testid="error-exceptions">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm">Failed to load exceptions.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-exceptions">
            No exceptions found matching your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((ex) => (
            <Card key={ex.id} data-testid={`card-exception-${ex.id}`}>
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getTypeBadge(ex.type)}
                      {getStatusBadge(ex.status)}
                    </div>
                    <p className="font-semibold" data-testid={`text-exception-employee-${ex.id}`}>
                      {ex.employeeName || "Employee"}
                    </p>
                    <p className="text-sm text-muted-foreground" data-testid={`text-exception-date-${ex.id}`}>
                      Date: {ex.exceptionDate}
                      {ex.exceptionTime && ` at ${new Date(ex.exceptionTime).toLocaleTimeString()}`}
                    </p>
                    <p className="text-sm" data-testid={`text-exception-reason-${ex.id}`}>
                      {ex.reason}
                    </p>
                    {ex.reviewNotes && (
                      <p className="text-sm text-muted-foreground italic" data-testid={`text-exception-review-notes-${ex.id}`}>
                        Review: {ex.reviewNotes}
                      </p>
                    )}
                    {ex.status === "pending" && (
                      <Textarea
                        placeholder="Review notes (optional)..."
                        value={reviewNotes[ex.id] || ""}
                        onChange={(e) => setReviewNotes((prev) => ({ ...prev, [ex.id]: e.target.value }))}
                        className="mt-2"
                        data-testid={`input-review-notes-${ex.id}`}
                      />
                    )}
                  </div>
                  {ex.status === "pending" && (
                    <div className="flex md:flex-col gap-2 md:min-w-[140px]">
                      <Button
                        onClick={() => approveMutation.mutate({ id: ex.id, notes: reviewNotes[ex.id] })}
                        disabled={approveMutation.isPending || denyMutation.isPending}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        data-testid={`button-approve-exception-${ex.id}`}
                      >
                        <Check className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button
                        onClick={() => denyMutation.mutate({ id: ex.id, notes: reviewNotes[ex.id] })}
                        disabled={approveMutation.isPending || denyMutation.isPending}
                        variant="destructive"
                        className="flex-1"
                        data-testid={`button-deny-exception-${ex.id}`}
                      >
                        <X className="h-4 w-4 mr-1" /> Deny
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
