import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Bell, CheckCircle, Eye, Loader2, Play } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type SystemAlert = {
  id: string;
  type: string;
  severity: string;
  status: string;
  employeeId: string | null;
  employeeName: string | null;
  message: string;
  details: Record<string, unknown> | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

const severityColors: Record<string, string> = {
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusColors: Record<string, string> = {
  open: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  acknowledged: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const typeLabels: Record<string, string> = {
  missing_clock_out: "Missing Clock-Out",
  late_clock_in: "Late Clock-In",
  overtime_threshold: "Overtime Threshold",
  no_show: "No Show",
  repeated_exception: "Repeated Exception",
};

export default function AlertsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const queryParams = new URLSearchParams();
  if (typeFilter !== "all") queryParams.set("type", typeFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (severityFilter !== "all") queryParams.set("severity", severityFilter);
  const queryString = queryParams.toString();

  const { data: alerts, isLoading } = useQuery<SystemAlert[]>({
    queryKey: ["/api/alerts", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/alerts${queryString ? `?${queryString}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
  });

  const detectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/alerts/detect").then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: `Detection complete: ${data.detected} found, ${data.created} new alerts created` });
    },
    onError: () => toast({ title: "Failed to run detection", variant: "destructive" }),
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/alerts/${id}/acknowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert acknowledged" });
    },
    onError: () => toast({ title: "Failed to acknowledge alert", variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/alerts/${id}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert resolved" });
    },
    onError: () => toast({ title: "Failed to resolve alert", variant: "destructive" }),
  });

  const openCount = alerts?.filter(a => a.status === "open").length || 0;

  return (
    <div className="max-w-6xl space-y-6" data-testid="alerts-page">
      <PageHeader
        title="Alerts"
        subtitle="Monitor and resolve system alerts"
        actions={
          <div className="flex items-center gap-2">
            {openCount > 0 && (
              <Badge variant="destructive" data-testid="badge-open-count">{openCount} open</Badge>
            )}
            {isAdmin && (
              <Button
                onClick={() => detectMutation.mutate()}
                disabled={detectMutation.isPending}
                data-testid="button-run-detection"
              >
                {detectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Run Detection
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Type</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger data-testid="select-trigger-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="missing_clock_out">Missing Clock-Out</SelectItem>
              <SelectItem value="late_clock_in">Late Clock-In</SelectItem>
              <SelectItem value="overtime_threshold">Overtime Threshold</SelectItem>
              <SelectItem value="no_show">No Show</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-trigger-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Severity</label>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger data-testid="select-trigger-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card data-testid="card-alerts-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> Alert List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : alerts && alerts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Severity</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Message</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Created</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id} data-testid={`row-alert-${alert.id}`}>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${severityColors[alert.severity] || ""}`} data-testid={`badge-severity-${alert.id}`}>
                        {alert.severity === "critical" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {alert.severity}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-type-${alert.id}`}>
                      {typeLabels[alert.type] || alert.type}
                    </TableCell>
                    <TableCell data-testid={`text-employee-${alert.id}`}>
                      {alert.employeeName || "—"}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate" data-testid={`text-message-${alert.id}`}>
                      {alert.message}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[alert.status] || ""}`} data-testid={`badge-status-${alert.id}`}>
                        {alert.status}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-created-${alert.id}`}>
                      {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {alert.status === "open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                            disabled={acknowledgeMutation.isPending}
                            data-testid={`button-acknowledge-${alert.id}`}
                          >
                            <Eye className="h-3 w-3 mr-1" /> Ack
                          </Button>
                        )}
                        {(alert.status === "open" || alert.status === "acknowledged") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resolveMutation.mutate(alert.id)}
                            disabled={resolveMutation.isPending}
                            data-testid={`button-resolve-${alert.id}`}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" /> Resolve
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-alerts">
              No alerts found. Run detection to check for issues.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
