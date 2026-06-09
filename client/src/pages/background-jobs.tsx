import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, Play, CheckCircle2, AlertTriangle, Clock, CircleSlash } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type JobHealth = "ok" | "stale" | "failing" | "never_run";

interface JobHealthEntry {
  type: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  retryCount: number;
  consecutiveFailures: number;
  totalRuns: number;
  pending: number;
  running: number;
  failed: number;
  expectedWindowHours: number | null;
  stale: boolean;
  health: JobHealth;
}

interface JobHealthResponse {
  jobs: JobHealthEntry[];
  config: { maxAttempts: number; visibilityTimeoutMinutes: number };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTitle(type: string): string {
  return type
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const HEALTH_META: Record<
  JobHealth,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    label: "Healthy",
    className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-transparent",
    icon: CheckCircle2,
  },
  failing: {
    label: "Failing",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-transparent",
    icon: AlertTriangle,
  },
  stale: {
    label: "Stale",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-transparent",
    icon: Clock,
  },
  never_run: {
    label: "Never run",
    className: "bg-muted text-muted-foreground border-transparent",
    icon: CircleSlash,
  },
};

function HealthBadge({ health }: { health: JobHealth }) {
  const meta = HEALTH_META[health];
  const Icon = meta.icon;
  return (
    <Badge className={meta.className} data-testid={`badge-health-${health}`}>
      <Icon className="mr-1 h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export default function BackgroundJobsPage() {
  const { toast } = useToast();

  const { data, isLoading, isError, refetch, isFetching } = useQuery<JobHealthResponse>({
    queryKey: ["/api/admin/jobs/health"],
    refetchInterval: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/jobs/run");
      return res.json();
    },
    onSuccess: (result: {
      processed?: number;
      failed?: number;
      retried?: number;
      reclaimed?: number;
    }) => {
      toast({
        title: "Job queue processed",
        description: `Processed ${result.processed ?? 0}, failed ${result.failed ?? 0}, retried ${result.retried ?? 0}, reclaimed ${result.reclaimed ?? 0}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/health"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to run jobs", description: err.message, variant: "destructive" });
    },
  });

  const jobs = data?.jobs ?? [];
  const failingCount = jobs.filter((j) => j.health === "failing").length;
  const staleCount = jobs.filter((j) => j.health === "stale").length;

  return (
    <div className="max-w-5xl space-y-6" data-testid="page-background-jobs">
      <PageHeader
        title="Background Jobs"
        subtitle="Monitor scheduled jobs — last run, success, failures, and retries. Stale or failing jobs are flagged so silent failures don't go unnoticed."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-jobs"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              data-testid="button-run-jobs"
            >
              <Play className="mr-2 h-4 w-4" />
              {runMutation.isPending ? "Running..." : "Run now"}
            </Button>
          </div>
        }
      />

      {(failingCount > 0 || staleCount > 0) && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20"
          data-testid="banner-job-warnings"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-800 dark:text-amber-200">
            {failingCount > 0 && (
              <span data-testid="text-failing-count">
                {failingCount} job{failingCount > 1 ? "s" : ""} failing.{" "}
              </span>
            )}
            {staleCount > 0 && (
              <span data-testid="text-stale-count">
                {staleCount} job{staleCount > 1 ? "s" : ""} overdue.
              </span>
            )}
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job Status</CardTitle>
          {data?.config && (
            <p className="text-xs text-muted-foreground" data-testid="text-job-config">
              Retries up to {data.config.maxAttempts} attempts · stuck jobs reclaimed after{" "}
              {data.config.visibilityTimeoutMinutes}m
            </p>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive" data-testid="text-jobs-error">
              Failed to load job health.
            </p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-jobs-empty">
              No background jobs have been recorded yet.
            </p>
          ) : (
            <TooltipProvider delayDuration={150}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Last success</TableHead>
                    <TableHead>Last failure</TableHead>
                    <TableHead className="text-right">Retries</TableHead>
                    <TableHead className="text-right">Queue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.type} data-testid={`row-job-${job.type}`}>
                      <TableCell className="font-medium" data-testid={`text-job-name-${job.type}`}>
                        {formatTitle(job.type)}
                        {job.expectedWindowHours !== null && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (every ~{job.expectedWindowHours}h)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <HealthBadge health={job.health} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(job.lastRunAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(job.lastSuccessAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {job.lastFailureAt ? (
                          job.lastError ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="cursor-help text-red-600 underline decoration-dotted dark:text-red-400"
                                  data-testid={`text-job-failure-${job.type}`}
                                >
                                  {formatRelative(job.lastFailureAt)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm">
                                <p className="break-words text-xs">{job.lastError}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground">
                              {formatRelative(job.lastFailureAt)}
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-job-retries-${job.type}`}>
                        {job.retryCount}
                        {job.consecutiveFailures > 0 && (
                          <span className="ml-1 text-xs text-red-600 dark:text-red-400">
                            ({job.consecutiveFailures} in a row)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground" data-testid={`text-job-queue-${job.type}`}>
                        {job.pending > 0 && <span>{job.pending} pending </span>}
                        {job.running > 0 && <span>{job.running} running </span>}
                        {job.failed > 0 && (
                          <span className="text-red-600 dark:text-red-400">{job.failed} failed</span>
                        )}
                        {job.pending === 0 && job.running === 0 && job.failed === 0 && "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
