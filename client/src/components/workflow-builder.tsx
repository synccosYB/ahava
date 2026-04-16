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
  Handle,
  Position,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Zap, GitBranch, UserCheck, Play, Bell, GripVertical,
  Save, ArrowLeft, Eye, Pencil, Trash2, X,
} from "lucide-react";
import type { Workflow } from "@shared/schema";

const TRIGGER_OPTIONS = [
  { value: "pto_request_submitted", label: "PTO Request Submitted" },
  { value: "late_arrival_detected", label: "Late Arrival Detected" },
  { value: "attendance_exception", label: "Attendance Exception Filed" },
  { value: "clock_out_missed", label: "Missed Clock-Out" },
  { value: "overtime_threshold", label: "Overtime Threshold Reached" },
];

const CONDITION_FIELDS = [
  { value: "days_requested", label: "Days Requested" },
  { value: "employee_department", label: "Employee Department" },
  { value: "employee_location", label: "Employee Location" },
  { value: "late_count_month", label: "Late Arrivals This Month" },
  { value: "pto_balance", label: "PTO Balance (days)" },
  { value: "overtime_hours", label: "Overtime Hours" },
];

const CONDITION_OPERATORS = [
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
];

const APPROVER_ROLES = [
  { value: "direct_manager", label: "Direct Manager" },
  { value: "hr", label: "HR" },
  { value: "department_head", label: "Department Head" },
  { value: "admin", label: "Admin" },
];

const ACTION_TYPES = [
  { value: "approve_request", label: "Approve Request" },
  { value: "deny_request", label: "Deny Request" },
  { value: "generate_alert", label: "Generate Alert" },
  { value: "generate_warning", label: "Generate Written Warning" },
  { value: "update_balance", label: "Update PTO Balance" },
];

const NOTIFICATION_TYPES = [
  { value: "email_manager", label: "Email Manager" },
  { value: "email_hr", label: "Email HR" },
  { value: "email_employee", label: "Email Employee" },
  { value: "system_alert", label: "System Alert" },
  { value: "email_payroll", label: "Email Payroll" },
];

const NODE_PALETTE = [
  { type: "trigger", label: "Trigger", icon: Zap, color: "bg-amber-500", description: "Start event" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "bg-blue-500", description: "Branch logic" },
  { type: "approval", label: "Approval", icon: UserCheck, color: "bg-purple-500", description: "Require sign-off" },
  { type: "action", label: "Action", icon: Play, color: "bg-green-500", description: "Execute step" },
  { type: "notification", label: "Notification", icon: Bell, color: "bg-orange-500", description: "Send notice" },
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

function getNodeSummary(data: any) {
  const type = data.nodeType;
  if (type === "trigger") {
    const opt = TRIGGER_OPTIONS.find(t => t.value === data.triggerEvent);
    return opt?.label || "Select trigger...";
  }
  if (type === "condition") {
    const field = CONDITION_FIELDS.find(f => f.value === data.field);
    const op = CONDITION_OPERATORS.find(o => o.value === data.operator);
    if (field && op && data.value !== undefined) return `${field.label} ${op.label} ${data.value}`;
    return "Configure condition...";
  }
  if (type === "approval") {
    const role = APPROVER_ROLES.find(r => r.value === data.approverRole);
    return role?.label || "Select approver...";
  }
  if (type === "action") {
    const act = ACTION_TYPES.find(a => a.value === data.actionType);
    return act?.label || "Select action...";
  }
  if (type === "notification") {
    const notif = NOTIFICATION_TYPES.find(n => n.value === data.notificationType);
    return notif?.label || "Select notification...";
  }
  return "Configure...";
}

function WorkflowNode({ data, selected }: { data: any; selected: boolean }) {
  const colors = getNodeColor(data.nodeType);
  const Icon = NODE_PALETTE.find(n => n.type === data.nodeType)?.icon || Zap;
  const isCondition = data.nodeType === "condition";

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
      </div>
      <p className="text-sm font-medium text-foreground truncate">{data.label}</p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{getNodeSummary(data)}</p>
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

export function WorkflowBuilder({ workflow, onClose, readOnly = false }: WorkflowBuilderProps) {
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [workflowName, setWorkflowName] = useState(workflow?.name || "");
  const [triggerType, setTriggerType] = useState(workflow?.triggerType || "");
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [previewMode, setPreviewMode] = useState(readOnly);

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

  const addNode = useCallback((type: string) => {
    if (previewMode) return;
    const id = `node-${nodeCounter.current++}`;
    const newNode: Node = {
      id,
      type: "workflowNode",
      position: { x: 250, y: 100 + nodes.length * 120 },
      data: {
        label: `${type.charAt(0).toUpperCase() + type.slice(1)} ${nodeCounter.current - 1}`,
        nodeType: type,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes, nodes.length, previewMode]);

  const onNodeClick = useCallback((_event: any, node: Node) => {
    if (!previewMode) setSelectedNode(node);
  }, [previewMode]);

  const updateNodeData = useCallback((nodeId: string, newData: Record<string, any>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n))
    );
    if (selectedNode?.id === nodeId) {
      setSelectedNode((prev) => prev ? { ...prev, data: { ...prev.data, ...newData } } : prev);
    }
  }, [setNodes, selectedNode]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Node Palette</p>
            {NODE_PALETTE.map((item) => (
              <button
                key={item.type}
                onClick={() => addNode(item.type)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md border bg-background hover:bg-muted transition-colors text-left"
                data-testid={`button-add-node-${item.type}`}
              >
                <div className={`p-1.5 rounded ${item.color}`}>
                  <item.icon className="h-3.5 w-3.5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={previewMode ? undefined : onNodesChange}
            onEdgesChange={previewMode ? undefined : onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
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
          <SheetContent side="right" className="w-80 sm:w-96" data-testid="node-config-panel">
            <SheetHeader>
              <SheetTitle className="flex items-center justify-between">
                Configure Node
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

function NodeConfigPanel({ node, onUpdate }: { node: Node; onUpdate: (data: Record<string, any>) => void }) {
  const data = node.data as Record<string, any>;
  const nodeType = data.nodeType;

  return (
    <div className="space-y-4 mt-4">
      <div>
        <Label>Label</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          data-testid="input-node-label"
        />
      </div>

      {nodeType === "trigger" && (
        <div>
          <Label>Trigger Event</Label>
          <Select value={data.triggerEvent || ""} onValueChange={(v) => onUpdate({ triggerEvent: v })}>
            <SelectTrigger data-testid="select-trigger-event">
              <SelectValue placeholder="Select event..." />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {nodeType === "condition" && (
        <>
          <div>
            <Label>Field</Label>
            <Select value={data.field || ""} onValueChange={(v) => onUpdate({ field: v })}>
              <SelectTrigger data-testid="select-condition-field">
                <SelectValue placeholder="Select field..." />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Operator</Label>
            <Select value={data.operator || ""} onValueChange={(v) => onUpdate({ operator: v })}>
              <SelectTrigger data-testid="select-condition-operator">
                <SelectValue placeholder="Select operator..." />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPERATORS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Value</Label>
            <Input
              value={data.value || ""}
              onChange={(e) => onUpdate({ value: e.target.value })}
              placeholder="e.g. 3"
              data-testid="input-condition-value"
            />
          </div>
        </>
      )}

      {nodeType === "approval" && (
        <>
          <div>
            <Label>Approver Role</Label>
            <Select value={data.approverRole || ""} onValueChange={(v) => onUpdate({ approverRole: v })}>
              <SelectTrigger data-testid="select-approver-role">
                <SelectValue placeholder="Select approver..." />
              </SelectTrigger>
              <SelectContent>
                {APPROVER_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Required</Label>
            <Switch
              checked={data.required !== false}
              onCheckedChange={(v) => onUpdate({ required: v })}
              data-testid="switch-approval-required"
            />
          </div>
          <div>
            <Label>Timeout (hours)</Label>
            <Input
              type="number"
              value={data.timeoutHours || "48"}
              onChange={(e) => onUpdate({ timeoutHours: parseInt(e.target.value) || 48 })}
              data-testid="input-approval-timeout"
            />
          </div>
        </>
      )}

      {nodeType === "action" && (
        <div>
          <Label>Action Type</Label>
          <Select value={data.actionType || ""} onValueChange={(v) => onUpdate({ actionType: v })}>
            <SelectTrigger data-testid="select-action-type">
              <SelectValue placeholder="Select action..." />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {nodeType === "notification" && (
        <>
          <div>
            <Label>Notification Type</Label>
            <Select value={data.notificationType || ""} onValueChange={(v) => onUpdate({ notificationType: v })}>
              <SelectTrigger data-testid="select-notification-type">
                <SelectValue placeholder="Select notification..." />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_TYPES.map((n) => (
                  <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Custom Message (optional)</Label>
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
