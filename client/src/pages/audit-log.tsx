import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Search, ChevronLeft, ChevronRight } from "lucide-react";

type AuditLogEntry = {
  id: string;
  actorUserId: string;
  actorName: string;
  targetType: string;
  targetId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  context: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type AuditResponse = {
  logs: AuditLogEntry[];
  total: number;
};

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [targetType, setTargetType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const pageSize = 25;

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (targetType !== "all") queryParams.set("targetType", targetType);
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  queryParams.set("limit", String(pageSize));
  queryParams.set("offset", String(page * pageSize));

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["/api/audit-logs/filtered", search, targetType, startDate, endDate, page],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs/filtered?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / pageSize);

  function renderJson(val: unknown) {
    if (val === null || val === undefined) return <span className="text-muted-foreground">—</span>;
    return <pre className="text-xs whitespace-pre-wrap max-w-full">{JSON.stringify(val, null, 2)}</pre>;
  }

  return (
    <div className="p-6 space-y-6" data-testid="audit-log-page">
      <h1 className="text-2xl font-bold" data-testid="text-page-title">Audit Log</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-1">
          <Label>Search</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search actions, targets..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-8"
              data-testid="input-search"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Entity Type</Label>
          <Select value={targetType} onValueChange={(v) => { setTargetType(v); setPage(0); }}>
            <SelectTrigger data-testid="select-trigger-entity-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="time_off_request">Time Off Request</SelectItem>
              <SelectItem value="attendance_exception">Attendance Exception</SelectItem>
              <SelectItem value="punch_log">Punch Log</SelectItem>
              <SelectItem value="payroll_export">Payroll Export</SelectItem>
              <SelectItem value="policy">Policy</SelectItem>
              <SelectItem value="role">Role</SelectItem>
              <SelectItem value="kiosk_device">Kiosk Device</SelectItem>
              <SelectItem value="system_alert">System Alert</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
            data-testid="input-start-date"
          />
        </div>
        <div className="space-y-1">
          <Label>End Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
            data-testid="input-end-date"
          />
        </div>
      </div>

      <Card data-testid="card-audit-logs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Audit Entries
            {data && <span className="text-sm font-normal text-muted-foreground">({data.total} total)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : data && data.logs.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Target ID</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.logs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                      <TableCell className="text-xs whitespace-nowrap" data-testid={`text-timestamp-${log.id}`}>
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell data-testid={`text-actor-${log.id}`}>
                        {log.actorName}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded" data-testid={`text-action-${log.id}`}>
                          {log.action}
                        </code>
                      </TableCell>
                      <TableCell data-testid={`text-entity-${log.id}`}>
                        {log.targetType}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[120px] truncate" data-testid={`text-target-${log.id}`}>
                        {log.targetId}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedLog(log)}
                          data-testid={`button-view-${log.id}`}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => p + 1)}
                    data-testid="button-next-page"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-logs">
              No audit log entries found.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-audit-detail">
          <DialogHeader>
            <DialogTitle>Audit Log Detail</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 p-1">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted-foreground">Actor</p>
                    <p data-testid="text-detail-actor">{selectedLog.actorName}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Timestamp</p>
                    <p data-testid="text-detail-timestamp">{new Date(selectedLog.createdAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Action</p>
                    <code className="text-xs" data-testid="text-detail-action">{selectedLog.action}</code>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Entity</p>
                    <p data-testid="text-detail-entity">{selectedLog.targetType} ({selectedLog.targetId})</p>
                  </div>
                  {selectedLog.ipAddress && (
                    <div>
                      <p className="font-medium text-muted-foreground">IP Address</p>
                      <p data-testid="text-detail-ip">{selectedLog.ipAddress}</p>
                    </div>
                  )}
                </div>

                {(selectedLog.oldValue || selectedLog.newValue) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="font-medium text-muted-foreground text-sm mb-1">Old Value</p>
                      <div className="bg-red-50 dark:bg-red-950 p-3 rounded text-sm" data-testid="text-detail-old-value">
                        {renderJson(selectedLog.oldValue)}
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground text-sm mb-1">New Value</p>
                      <div className="bg-green-50 dark:bg-green-950 p-3 rounded text-sm" data-testid="text-detail-new-value">
                        {renderJson(selectedLog.newValue)}
                      </div>
                    </div>
                  </div>
                )}

                {selectedLog.context && (
                  <div>
                    <p className="font-medium text-muted-foreground text-sm mb-1">Context</p>
                    <div className="bg-muted p-3 rounded text-sm" data-testid="text-detail-context">
                      {renderJson(selectedLog.context)}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
