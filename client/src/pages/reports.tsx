import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Department } from "@shared/schema";

type ReportRow = {
  employeeId: string;
  employeeName: string;
  department: string;
  totalHours: number;
  daysWorked: number;
  daysOff: number;
  overtime: number;
};

export default function ReportsPage() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState("company");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [department, setDepartment] = useState("all");
  const [reportData, setReportData] = useState<ReportRow[] | null>(null);

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports/generate", {
        reportType,
        startDate,
        endDate,
        department: department !== "all" ? department : undefined,
      });
      return res.json();
    },
    onSuccess: (data: ReportRow[]) => {
      setReportData(data);
      toast({ title: "Report generated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const downloadCSV = () => {
    if (!reportData || reportData.length === 0) return;
    const headers = ["Employee", "Department", "Total Hours", "Days Worked", "Days Off", "Overtime"];
    const rows = reportData.map(r => [r.employeeName, r.department, r.totalHours, r.daysWorked, r.daysOff, r.overtime]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${reportType}-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6" data-testid="reports-page">
      <h1 className="text-2xl font-bold" data-testid="text-page-title">Generate Report</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Report Type</Label>
          <Select value={reportType} onValueChange={setReportType} data-testid="select-report-type">
            <SelectTrigger data-testid="select-trigger-report-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="employee" data-testid="option-employee">Employee</SelectItem>
              <SelectItem value="team" data-testid="option-team">Team</SelectItem>
              <SelectItem value="company" data-testid="option-company">Company</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            data-testid="input-start-date"
          />
        </div>

        <div className="space-y-2">
          <Label>End Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            data-testid="input-end-date"
          />
        </div>
      </div>

      <Card data-testid="card-filters">
        <CardContent className="p-4">
          <p className="font-medium mb-3">Optional Filters</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger data-testid="select-trigger-department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-dept-all">All</SelectItem>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id} data-testid={`option-dept-${d.id}`}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-center">
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          size="lg"
          data-testid="button-generate-report"
        >
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 mr-2" />
          )}
          Generate Report
        </Button>
      </div>

      {reportData && (
        <>
          <Card data-testid="card-report-preview">
            <CardHeader>
              <CardTitle>Report Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Total Hours</TableHead>
                      <TableHead>Days Worked</TableHead>
                      <TableHead>Days Off</TableHead>
                      <TableHead>Overtime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((row) => (
                      <TableRow key={row.employeeId} data-testid={`row-report-${row.employeeId}`}>
                        <TableCell className="font-medium" data-testid={`text-report-name-${row.employeeId}`}>
                          {row.employeeName}
                        </TableCell>
                        <TableCell data-testid={`text-report-dept-${row.employeeId}`}>{row.department}</TableCell>
                        <TableCell data-testid={`text-report-hours-${row.employeeId}`}>{row.totalHours}</TableCell>
                        <TableCell data-testid={`text-report-days-${row.employeeId}`}>{row.daysWorked}</TableCell>
                        <TableCell data-testid={`text-report-off-${row.employeeId}`}>{row.daysOff}</TableCell>
                        <TableCell data-testid={`text-report-overtime-${row.employeeId}`}>
                          <span className={row.overtime > 0 ? "text-amber-500 font-bold" : ""}>
                            {row.overtime}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4" data-testid="text-no-report-data">
                  No data found for the selected criteria.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={downloadCSV} data-testid="button-download-csv">
              <Download className="h-4 w-4 mr-2" /> Download CSV
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
