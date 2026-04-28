import { useState, useCallback, useRef, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
  Handle,
  Position,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Zap, GitBranch, UserCheck, Play, Bell, GripVertical,
  Save, ArrowLeft, Eye, Pencil, Trash2,
  CalendarPlus, Clock, AlertTriangle, LogOut, Timer,
  User, Users, Briefcase, Shield,
  CheckCircle2, XCircle, AlertCircle, FileWarning, RefreshCw,
  Mail, BellRing, Sparkles, Info,
  type LucideIcon,
} from "lucide-react";
import type { Workflow } from "@shared/schema";

interface TriggerOption {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const TRIGGER_OPTIONS: TriggerOption[] = [
  { value: "pto_request_submitted", label: "PTO request submitted", description: "An employee submits a time-off request", icon: CalendarPlus },
  { value: "late_arrival_detected", label: "Late arrival detected", description: "Someone clocks in after their scheduled start", icon: Clock },
  { value: "attendance_exception", label: "Attendance exception filed", description: "A correction is requested on an attendance record", icon: AlertTriangle },
  { value: "clock_out_missed", label: "Missed clock-out", description: "An employee forgot to clock out", icon: LogOut },
  { value: "overtime_threshold", label: "Overtime threshold reached", description: "An employee crosses the overtime limit", icon: Timer },
  { value: "bonus", label: "Bonus", description: "A bonus event needs to be handled", icon: Sparkles },
];

interface ConditionField {
  value: string;
  label: string;
  description: string;
  unit: string;
  placeholder: string;
  quickPicks: number[];
  numeric: boolean;
}

const CONDITION_FIELDS: ConditionField[] = [
  { value: "hours_requested", label: "Hours requested", description: "Number of hours the employee asked for", unit: "hours", placeholder: "e.g. 40", quickPicks: [8, 24, 40], numeric: true },
  { value: "employee_department", label: "Employee department", description: "The department the employee belongs to", unit: "", placeholder: "e.g. Engineering", quickPicks: [], numeric: false },
  { value: "employee_location", label: "Employee location", description: "The location the employee works from", unit: "", placeholder: "e.g. Remote", quickPicks: [], numeric: false },
  { value: "late_count_month", label: "Late arrivals this month", description: "How many times the employee was late this month", unit: "times", placeholder: "e.g. 3", quickPicks: [1, 3, 5], numeric: true },
  { value: "pto_balance", label: "PTO balance", description: "Remaining PTO hours the employee has", unit: "hours", placeholder: "e.g. 80", quickPicks: [0, 40, 80], numeric: true },
  { value: "overtime_hours", label: "Overtime hours", description: "Number of overtime hours worked", unit: "hours", placeholder: "e.g. 8", quickPicks: [1, 4, 8], numeric: true },
];

interface ConditionOperator {
  value: string;
  symbol: string;
  label: string;
  short: string;
}

const CONDITION_OPERATORS: ConditionOperator[] = [
  { value: "gt", symbol: ">", label: "is more than", short: "more than" },
  { value: "gte", symbol: "≥", label: "is at least", short: "at least" },
  { value: "lt", symbol: "<", label: "is less than", short: "less than" },
  { value: "lte", symbol: "≤", label: "is at most", short: "at most" },
  { value: "eq", symbol: "=", label: "equals", short: "equals" },
  { value: "neq", symbol: "≠", label: "is not", short: "is not" },
];

interface ApproverRole {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const APPROVER_ROLES: ApproverRole[] = [
  { value: "direct_manager", label: "Direct manager", description: "The employee's direct manager signs off", icon: User },
  { value: "hr", label: "HR", description: "The HR team reviews and approves", icon: Users },
  { value: "department_head", label: "Department head", description: "The head of the employee's department approves", icon: Briefcase },
  { value: "admin", label: "Admin", description: "An admin user approves", icon: Shield },
];

interface ActionType {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const ACTION_TYPES: ActionType[] = [
  { value: "approve_request", label: "Approve the request", description: "Mark the request as approved", icon: CheckCircle2 },
  { value: "deny_request", label: "Deny the request", description: "Mark the request as denied", icon: XCircle },
  { value: "generate_alert", label: "Create an alert", description: "Show an alert to the right people", icon: AlertCircle },
  { value: "generate_warning", label: "Issue a written warning", description: "Add a written warning to the employee record", icon: FileWarning },
  { value: "update_balance", label: "Update PTO balance", description: "Adjust the employee's remaining PTO hours", icon: RefreshCw },
];

interface NotificationType {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const NOTIFICATION_TYPES: NotificationType[] = [
  { value: "email_manager", label: "Email the manager", description: "Send an email to the employee's manager", icon: Mail },
  { value: "email_hr", label: "Email HR", description: "Send an email to the HR team", icon: Mail },
  { value: "email_employee", label: "Email the employee", description: "Send an email to the affected employee", icon: Mail },
  { value: "system_alert", label: "Show a system alert", description: "Show an in-app alert to the right people", icon: BellRing },
  { value: "email_payroll", label: "Email payroll", description: "Send an email to the payroll team", icon: Mail },
];

const NODE_PALETTE = [
  { type: "trigger", label: "Trigger", icon: Zap, color: "bg-amber-500", description: "What kicks it off" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "bg-blue-500", description: "Branch yes / no" },
  { type: "approval", label: "Approval", icon: UserCheck, color: "bg-purple-500", description: "Wait for sign-off" },
  { type: "action", label: "Action", icon: Play, color: "bg-green-500", description: "Do something" },
  { type: "notification", label: "Notification", icon: Bell, color: "bg-orange-500", description: "Send a message" },
];

function getNodeColor(type: string) {
  switch (type) {
    case "trigger": return { bg: "bg-amber-50 dark:bg-amber-950", border: "border-amber-400", text: "text-amber-700 dark:text-amber-300" };
    case "condition": return { bg: "bg-blue-50 dark:bg-blue-950", border: "border-blue-400", text: "text-blue-700 dark:text-blue-300" };
    case "approval": return { bg: "bg-purple-50 dark:bg-purple-950", border: "border-purple-400", text: "text-purple-700 dark:text-purple-300" };
    case "action": return { bg: "bg-green-50 dark:bg-green-950", border: "border-green-400", text: "text-green-700 dark:text-green-300" };
    case "notification": return { bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-400", text: "text-orange-700 dark:text-orange-300" };
    default: return { bg: "bg-gray-50", border: "border-gray-400", text: "text-gray-700" };
  }
}

function getNodeSubtitle(data: Record<string, any>): string {
  const type = data.nodeType;
  if (type === "trigger") {
    const opt = TRIGGER_OPTIONS.find(t => t.value === data.triggerEvent);
    return opt?.label || "Pick a trigger…";
  }
  if (type === "condition") {
    const field = CONDITION_FIELDS.find(f => f.value === data.field);
    const op = CONDITION_OPERATORS.find(o => o.value === data.operator);
    if (field && op && data.value !== undefined && data.value !== "") {
      const unit = field.unit ? ` ${field.unit}` : "";
      return `${field.label} ${op.short} ${data.value}${unit}`;
    }
    return "Configure condition…";
  }
  if (type === "approval") {
    const role = APPROVER_ROLES.find(r => r.value === data.approverRole);
    return role?.label || "Pick an approver…";
  }
  if (type === "action") {
    const act = ACTION_TYPES.find(a => a.value === data.actionType);
    return act?.label || "Pick an action…";
  }
  if (type === "notification") {
    const notif = NOTIFICATION_TYPES.find(n => n.value === data.notificationType);
    return notif?.label || "Pick a notification…";
  }
  return "Configure…";
}

function generateNodeLabel(data: Record<string, any>): string {
  const t = data.nodeType;
  if (t === "trigger") {
    const opt = TRIGGER_OPTIONS.find(o => o.value === data.triggerEvent);
    return opt ? `On ${opt.label.toLowerCase()}` : "New trigger";
  }
  if (t === "condition") {
    const f = CONDITION_FIELDS.find(o => o.value === data.field);
    const op = CONDITION_OPERATORS.find(o => o.value === data.operator);
    if (f && op && data.value !== undefined && data.value !== "") {
      const unitShort = f.unit ? f.unit[0] : "";
      return `If ${f.label} ${op.symbol} ${data.value}${unitShort}`;
    }
    return "New condition";
  }
  if (t === "approval") {
    const r = APPROVER_ROLES.find(o => o.value === data.approverRole);
    return r ? `${r.label} approval` : "New approval";
  }
  if (t === "action") {
    const a = ACTION_TYPES.find(o => o.value === data.actionType);
    return a?.label || "New action";
  }
  if (t === "notification") {
    const n = NOTIFICATION_TYPES.find(o => o.value === data.notificationType);
    return n?.label || "New notification";
  }
  return "Node";
}

function generatePlainSummary(data: Record<string, any>): string {
  const t = data.nodeType;
  if (t === "trigger") {
    const opt = TRIGGER_OPTIONS.find(o => o.value === data.triggerEvent);
    if (!opt) return "Pick what should kick off this workflow.";
    return `Start when ${opt.label.toLowerCase()}.`;
  }
  if (t === "condition") {
    const f = CONDITION_FIELDS.find(o => o.value === data.field);
    const op = CONDITION_OPERATORS.find(o => o.value === data.operator);
    if (!f) return "Pick the value this rule should look at.";
    if (!op) return `Pick how ${f.label.toLowerCase()} should be compared.`;
    if (data.value === undefined || data.value === "") {
      return `Set the value ${f.label.toLowerCase()} should be compared to.`;
    }
    const unitSuffix = f.unit ? ` ${f.unit}` : "";
    return `When ${f.label.toLowerCase()} ${op.label} ${data.value}${unitSuffix}, branch Yes / No.`;
  }
  if (t === "approval") {
    const r = APPROVER_ROLES.find(o => o.value === data.approverRole);
    if (!r) return "Pick who needs to sign off here.";
    const required = data.required !== false;
    const timeout = data.timeoutHours || 48;
    return `Wait for ${r.label.toLowerCase()} to ${required ? "approve" : "review"} (auto-decide after ${timeout}h).`;
  }
  if (t === "action") {
    const a = ACTION_TYPES.find(o => o.value === data.actionType);
    if (!a) return "Pick what should happen at this step.";
    return `${a.label} when this runs.`;
  }
  if (t === "notification") {
    const n = NOTIFICATION_TYPES.find(o => o.value === data.notificationType);
    if (!n) return "Pick who should be notified.";
    if (data.customMessage) return `${n.label} with: "${data.customMessage}".`;
    return `${n.label} when this runs.`;
  }
  return "";
}

function isNodeIncomplete(data: Record<string, any>): boolean {
  const t = data.nodeType;
  if (t === "trigger") return !data.triggerEvent;
  if (t === "condition") {
    return !data.field || !data.operator || data.value === undefined || data.value === "";
  }
  if (t === "approval") return !data.approverRole;
  if (t === "action") return !data.actionType;
  if (t === "notification") return !data.notificationType;
  return false;
}

function defaultLabelForType(type: string): string {
  switch (type) {
    case "trigger": return "New trigger";
    case "condition": return "New condition";
    case "approval": return "New approval";
    case "action": return "New action";
    case "notification": return "New notification";
    default: return "New node";
  }
}

function WorkflowNode({ data, selected }: { data: any; selected: boolean }) {
  const colors = getNodeColor(data.nodeType);
  const Icon = NODE_PALETTE.find(n => n.type === data.nodeType)?.icon || Zap;
  const isCondition = data.nodeType === "condition";
  const incomplete = isNodeIncomplete(data);

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px] max-w-[220px] ${colors.bg} ${colors.border} ${selected ? "ring-2 ring-primary" : ""}`}
      data-testid={`node-${data.nodeType}-${data.label}`}
    >
      {data.nodeType !== "trigger" && (
        <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />
      )}
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${colors.text}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{data.nodeType}</span>
        {incomplete && (
          <span
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
            data-testid={`badge-needs-setup-${data.label}`}
          >
            Needs setup
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-foreground truncate">{data.label}</p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{getNodeSubtitle(data)}</p>
      {isCondition ? (
        <>
          <Handle type="source" position={Position.Bottom} id="yes" style={{ left: "30%" }} className="!bg-green-500 !w-3 !h-3" />
          <Handle type="source" position={Position.Bottom} id="no" style={{ left: "70%" }} className="!bg-red-500 !w-3 !h-3" />
          <div className="flex justify-between text-[10px] mt-1 px-1">
            <span className="text-green-600">Yes</span>
            <span className="text-red-600">No</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3" />
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNode,
};

interface WorkflowBuilderProps {
  workflow?: Workflow | null;
  onClose: () => void;
  readOnly?: boolean;
}

const DRAG_MIME = "application/x-workflow-node-type";

export function WorkflowBuilder({ workflow, onClose, readOnly = false }: WorkflowBuilderProps) {
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [workflowName, setWorkflowName] = useState(workflow?.name || "");
  const [triggerType, setTriggerType] = useState(workflow?.triggerType || "");
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [previewMode, setPreviewMode] = useState(readOnly);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const initialGraph = workflow?.nodeGraph as { nodes: Node[]; edges: Edge[] } | undefined;
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph?.edges || []);

  const onConnect = useCallback((params: Connection) => {
    if (previewMode) return;
    setEdges((eds) =>
      addEdge(
        {
          ...params,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 2 },
          label: params.sourceHandle === "yes" ? "Yes" : params.sourceHandle === "no" ? "No" : undefined,
        },
        eds
      )
    );
  }, [setEdges, previewMode]);

  const nodeCounter = useRef(
    initialGraph?.nodes ? Math.max(...initialGraph.nodes.map(n => parseInt(n.id.split("-")[1] || "0")), 0) + 1 : 1
  );

  const addNode = useCallback((type: string, position?: { x: number; y: number }) => {
    if (previewMode) return;
    const id = `node-${nodeCounter.current++}`;
    const pos = position || { x: 250, y: 100 + nodes.length * 120 };
    const newNode: Node = {
      id,
      type: "workflowNode",
      position: pos,
      data: {
        label: defaultLabelForType(type),
        labelAutoFilled: true,
        nodeType: type,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes, nodes.length, previewMode]);

  const onNodeClick = useCallback((_event: any, node: Node) => {
    if (!previewMode) setSelectedNode(node);
  }, [previewMode]);

  const updateNodeData = useCallback((nodeId: string, newData: Record<string, any>) => {
    const applyMerge = (existing: Record<string, any>) => {
      const merged = { ...existing, ...newData };
      // Auto-update label when the node was created via the palette and the
      // admin hasn't manually edited the label. Existing saved nodes have no
      // labelAutoFilled flag, so we leave their labels alone.
      if (merged.labelAutoFilled === true && !("label" in newData)) {
        merged.label = generateNodeLabel(merged);
      }
      return merged;
    };

    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: applyMerge(n.data as Record<string, any>) } : n))
    );
    if (selectedNode?.id === nodeId) {
      setSelectedNode((prev) => prev ? { ...prev, data: applyMerge(prev.data as Record<string, any>) } : prev);
    }
  }, [setNodes, selectedNode]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

  const onPaletteDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, nodeType: string) => {
    event.dataTransfer.setData(DRAG_MIME, nodeType);
    event.dataTransfer.effectAllowed = "move";
  }, []);

  const onCanvasDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (previewMode) return;
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, [previewMode]);

  const onCanvasDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (previewMode) return;
    const type = event.dataTransfer.getData(DRAG_MIME);
    if (!type) return;
    event.preventDefault();
    let position: { x: number; y: number } | undefined;
    if (rfInstance) {
      position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    }
    addNode(type, position);
  }, [previewMode, rfInstance, addNode]);

  const saveMutation = useMutation({
    mutationFn: async (status: string) => {
      const nodeGraph = { nodes, edges };
      if (workflow) {
        await apiRequest("PATCH", `/api/workflows/${workflow.id}`, {
          name: workflowName,
          triggerType,
          status,
          nodeGraph,
        });
      } else {
        await apiRequest("POST", "/api/workflows", {
          name: workflowName,
          triggerType,
          status,
          nodeGraph,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: workflow ? "Workflow updated" : "Workflow created" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const defaultEdgeOptions = useMemo(() => ({
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2 },
  }), []);

  const selectedIncomplete = selectedNode ? isNodeIncomplete(selectedNode.data as Record<string, any>) : false;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]" data-testid="workflow-builder">
      <div className="flex items-center justify-between p-4 border-b bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-back-workflow">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {previewMode ? (
            <h2 className="text-lg font-semibold" data-testid="text-workflow-title">{workflowName || "Untitled Workflow"}</h2>
          ) : (
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Workflow name..."
              className="w-64"
              data-testid="input-workflow-name"
            />
          )}
          {!previewMode && (
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger className="w-56" data-testid="select-workflow-trigger">
                <SelectValue placeholder="Select trigger..." />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewMode(!previewMode)}
              data-testid="button-toggle-preview"
            >
              {previewMode ? <><Pencil className="h-4 w-4 mr-1" /> Edit</> : <><Eye className="h-4 w-4 mr-1" /> Preview</>}
            </Button>
          )}
          {!previewMode && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveMutation.mutate("draft")}
                disabled={!workflowName || !triggerType || saveMutation.isPending}
                data-testid="button-save-draft"
              >
                <Save className="h-4 w-4 mr-1" /> Save Draft
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate("active")}
                disabled={!workflowName || !triggerType || saveMutation.isPending}
                data-testid="button-activate-workflow"
              >
                {saveMutation.isPending ? "Saving..." : "Save & Activate"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {!previewMode && (
          <div className="w-52 border-r bg-muted/30 p-3 space-y-2 overflow-y-auto" data-testid="node-palette">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Node Palette
            </p>
            <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
              Click to add, or drag onto the canvas.
            </p>
            {NODE_PALETTE.map((item) => (
              <button
                key={item.type}
                draggable
                onDragStart={(e) => onPaletteDragStart(e, item.type)}
                onClick={() => addNode(item.type)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md border bg-background hover:bg-muted active:bg-muted/80 transition-colors text-left cursor-grab active:cursor-grabbing"
                data-testid={`button-add-node-${item.type}`}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className={`p-1.5 rounded ${item.color}`}>
                  <item.icon className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        <div
          className="flex-1"
          ref={reactFlowWrapper}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
          data-testid="workflow-canvas-dropzone"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={previewMode ? undefined : onNodesChange}
            onEdgesChange={previewMode ? undefined : onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onInit={setRfInstance}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            nodesDraggable={!previewMode}
            nodesConnectable={!previewMode}
            elementsSelectable={!previewMode}
            panOnDrag
            zoomOnScroll
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            {previewMode && (
              <Panel position="top-center">
                <Badge variant="secondary" className="text-xs">
                  <Eye className="h-3 w-3 mr-1" /> Preview Mode
                </Badge>
              </Panel>
            )}
          </ReactFlow>
        </div>

        <Sheet open={!!selectedNode && !previewMode} onOpenChange={(open) => { if (!open) setSelectedNode(null); }}>
          <SheetContent side="right" className="w-80 sm:w-96 overflow-y-auto" data-testid="node-config-panel">
            <SheetHeader>
              <SheetTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  Configure Node
                  {selectedIncomplete && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-medium border-amber-400 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950"
                      data-testid="badge-panel-needs-setup"
                    >
                      <Info className="h-3 w-3 mr-1" /> Needs setup
                    </Badge>
                  )}
                </span>
                <Button variant="ghost" size="sm" onClick={deleteSelectedNode} className="text-destructive" data-testid="button-delete-node">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </SheetTitle>
            </SheetHeader>
            {selectedNode && (
              <NodeConfigPanel
                node={selectedNode}
                onUpdate={(data) => updateNodeData(selectedNode.id, data)}
              />
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

function SectionHeader({ title, helper }: { title: string; helper: string }) {
  return (
    <div>
      <Label className="text-sm font-medium">{title}</Label>
      <p className="text-xs text-muted-foreground mt-0.5">{helper}</p>
    </div>
  );
}

interface OptionWithIcon {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

function IconSelect({
  value,
  onChange,
  options,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: OptionWithIcon[];
  placeholder: string;
  testId: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <div className="flex items-start gap-2">
              <opt.icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm leading-tight">{opt.label}</div>
                <div className="text-[11px] text-muted-foreground leading-snug">{opt.description}</div>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NodeConfigPanel({ node, onUpdate }: { node: Node; onUpdate: (data: Record<string, any>) => void }) {
  const data = node.data as Record<string, any>;
  const nodeType = data.nodeType;
  const summary = generatePlainSummary(data);

  const fieldMeta = nodeType === "condition"
    ? CONDITION_FIELDS.find(f => f.value === data.field)
    : undefined;

  const onLabelChange = (label: string) => {
    onUpdate({ label, labelAutoFilled: false });
  };

  return (
    <div className="space-y-5 mt-4">
      <div
        className="rounded-md border bg-muted/40 p-3 flex gap-2"
        data-testid="text-node-summary"
      >
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-foreground leading-snug">{summary}</p>
      </div>

      <div className="space-y-1">
        <SectionHeader
          title="Label"
          helper="Shown on the node. Leave it alone and we'll keep it in sync."
        />
        <Input
          value={data.label || ""}
          onChange={(e) => onLabelChange(e.target.value)}
          data-testid="input-node-label"
        />
      </div>

      {nodeType === "trigger" && (
        <div className="space-y-1">
          <SectionHeader title="Trigger event" helper="Pick the event that should kick off this workflow." />
          <IconSelect
            value={data.triggerEvent || ""}
            onChange={(v) => onUpdate({ triggerEvent: v })}
            options={TRIGGER_OPTIONS}
            placeholder="Pick a trigger…"
            testId="select-trigger-event"
          />
        </div>
      )}

      {nodeType === "condition" && (
        <>
          <div className="space-y-1">
            <SectionHeader title="Field" helper="Pick the value this rule should look at." />
            <Select value={data.field || ""} onValueChange={(v) => onUpdate({ field: v })}>
              <SelectTrigger data-testid="select-condition-field">
                <SelectValue placeholder="Pick a field…" />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    <div className="min-w-0">
                      <div className="text-sm leading-tight">{f.label}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{f.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <SectionHeader title="How to compare" helper="Tap how the value should match." />
            <div className="flex flex-wrap gap-1.5" data-testid="chips-condition-operator">
              {CONDITION_OPERATORS.map((op) => {
                const active = data.operator === op.value;
                return (
                  <button
                    key={op.value}
                    type="button"
                    onClick={() => onUpdate({ operator: op.value })}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-background border-border text-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                    data-testid={`chip-operator-${op.value}`}
                    aria-pressed={active}
                  >
                    <span>{op.label}</span>
                    <span className={cn("text-[10px] font-mono", active ? "opacity-80" : "opacity-50")}>
                      {op.symbol}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <SectionHeader
              title="Value"
              helper={fieldMeta
                ? `What ${fieldMeta.label.toLowerCase()} should be compared to.`
                : "Pick a field first to see helpful suggestions."}
            />
            <div className="relative">
              <Input
                value={data.value ?? ""}
                onChange={(e) => onUpdate({ value: e.target.value })}
                placeholder={fieldMeta?.placeholder || "e.g. 3"}
                inputMode={fieldMeta?.numeric ? "decimal" : undefined}
                className={fieldMeta?.unit ? "pr-16" : undefined}
                data-testid="input-condition-value"
              />
              {fieldMeta?.unit && (
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none"
                  data-testid="text-value-unit"
                >
                  {fieldMeta.unit}
                </span>
              )}
            </div>
            {fieldMeta && fieldMeta.quickPicks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1" data-testid="quickpicks-condition-value">
                <span className="text-[11px] text-muted-foreground self-center mr-0.5">Quick pick:</span>
                {fieldMeta.quickPicks.map((qp) => (
                  <button
                    key={qp}
                    type="button"
                    onClick={() => onUpdate({ value: String(qp) })}
                    className={cn(
                      "px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors",
                      String(data.value) === String(qp)
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-background border-border text-foreground hover:bg-accent"
                    )}
                    data-testid={`quickpick-value-${qp}`}
                  >
                    {qp}{fieldMeta.unit ? ` ${fieldMeta.unit}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {nodeType === "approval" && (
        <>
          <div className="space-y-1">
            <SectionHeader title="Approver" helper="Who needs to sign off before things move on." />
            <IconSelect
              value={data.approverRole || ""}
              onChange={(v) => onUpdate({ approverRole: v })}
              options={APPROVER_ROLES}
              placeholder="Pick an approver…"
              testId="select-approver-role"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Required</Label>
              <Switch
                checked={data.required !== false}
                onCheckedChange={(v) => onUpdate({ required: v })}
                data-testid="switch-approval-required"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              On: someone must approve. Off: it's a heads-up only.
            </p>
          </div>
          <div className="space-y-1">
            <SectionHeader
              title="Auto-decide after"
              helper="If no one responds in this many hours, the workflow moves on."
            />
            <div className="relative">
              <Input
                type="number"
                value={data.timeoutHours || "48"}
                onChange={(e) => onUpdate({ timeoutHours: parseInt(e.target.value) || 48 })}
                className="pr-16"
                data-testid="input-approval-timeout"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                hours
              </span>
            </div>
          </div>
        </>
      )}

      {nodeType === "action" && (
        <div className="space-y-1">
          <SectionHeader title="Action" helper="What should happen when this step runs." />
          <IconSelect
            value={data.actionType || ""}
            onChange={(v) => onUpdate({ actionType: v })}
            options={ACTION_TYPES}
            placeholder="Pick an action…"
            testId="select-action-type"
          />
        </div>
      )}

      {nodeType === "notification" && (
        <>
          <div className="space-y-1">
            <SectionHeader title="Notification" helper="Who should be told when this step runs." />
            <IconSelect
              value={data.notificationType || ""}
              onChange={(v) => onUpdate({ notificationType: v })}
              options={NOTIFICATION_TYPES}
              placeholder="Pick a notification…"
              testId="select-notification-type"
            />
          </div>
          <div className="space-y-1">
            <SectionHeader title="Custom message (optional)" helper="A short note to include with the notification." />
            <Input
              value={data.customMessage || ""}
              onChange={(e) => onUpdate({ customMessage: e.target.value })}
              placeholder="Optional message..."
              data-testid="input-notification-message"
            />
          </div>
        </>
      )}
    </div>
  );
}
