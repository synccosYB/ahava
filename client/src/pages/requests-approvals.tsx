import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Check, X, ClipboardList, Filter } from "lucide-react";
import type { TimeOffRequest, AttendanceException } from "@shared/schema";

type PendingPtoRequest = TimeOffRequest & { employeeName: string };
type EnrichedException = AttendanceException & { employeeName?: string };

export default function RequestsApprovalsPage() {
  return (
    <div className="p-6 space-y-6" data-testid="requests-approvals-page">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-6 w-6" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Requests & Approvals</h1>
      </div>

      <Tabs defaultValue="all" data-testid="tabs-requests">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all-requests">All Pending</TabsTrigger>
          <TabsTrigger value="pto" data-testid="tab-pto-requests">PTO Requests</TabsTrigger>
          <TabsTrigger value="exceptions" data-testid="tab-exception-requests">Missing Punch / Corrections</TabsTrigger>
        </TabsList>

        <TabsContent value="all"><AllPendingTab /></TabsContent>
        <TabsContent value="pto"><PtoRequestsTab /></TabsContent>
        <TabsContent value="exceptions"><ExceptionsTab /></TabsContent>
      </Tabs>
    </div>
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

function ExceptionsTab() {
  const { data: exceptions, isLoading } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });

  return (
    <div className="space-y-4 mt-4">
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
    </div>
  );
}

function PtoRequestCard({ request }: { request: PendingPtoRequest }) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/time-off/${request.id}/approve`, { comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off/pending"] });
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
              {request.type.charAt(0).toUpperCase() + request.type.slice(1)} — {request.startDate} to {request.endDate} ({request.daysRequested} day{request.daysRequested > 1 ? "s" : ""})
            </p>
            {request.reason && (
              <p className="text-sm text-muted-foreground" data-testid={`text-pto-reason-${request.id}`}>
                "{request.reason}"
              </p>
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
  const [notes, setNotes] = useState("");

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
        <div className="flex flex-col md:flex-row md:justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{exception.type.replace(/_/g, " ")}</Badge>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>
            </div>
            <p className="font-semibold" data-testid={`text-exc-employee-${exception.id}`}>
              {exception.employeeName || "Employee"}
            </p>
            <p className="text-sm" data-testid={`text-exc-date-${exception.id}`}>
              Date: {exception.exceptionDate}
            </p>
            <p className="text-sm text-muted-foreground" data-testid={`text-exc-reason-${exception.id}`}>
              {exception.reason}
            </p>
            <Textarea
              placeholder="Review notes (optional)..."
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
