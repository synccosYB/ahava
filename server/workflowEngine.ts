import { storage } from "./storage";
import type { Workflow, User } from "@shared/schema";
import { writeAuditLog } from "./services/audit";

interface WorkflowContext {
  userId: string;
  user?: User;
  triggerType: string;
  data: Record<string, any>;
}

interface WorkflowNode {
  id: string;
  type: string;
  data: Record<string, any>;
  position: { x: number; y: number };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

interface ExecutionResult {
  workflowId: string;
  workflowName: string;
  executed: boolean;
  actions: string[];
  notifications: string[];
  approvals: string[];
  logs: string[];
}

function evaluateCondition(node: WorkflowNode, context: WorkflowContext): boolean {
  const { field, operator, value } = node.data;
  const contextValue = getContextValue(field, context);

  if (contextValue === undefined || value === undefined) return false;

  const numContext = parseFloat(contextValue);
  const numValue = parseFloat(value);

  if (!isNaN(numContext) && !isNaN(numValue)) {
    switch (operator) {
      case "gt": return numContext > numValue;
      case "gte": return numContext >= numValue;
      case "lt": return numContext < numValue;
      case "lte": return numContext <= numValue;
      case "eq": return numContext === numValue;
      case "neq": return numContext !== numValue;
      default: return false;
    }
  }

  switch (operator) {
    case "eq": return String(contextValue) === String(value);
    case "neq": return String(contextValue) !== String(value);
    default: return false;
  }
}

function getContextValue(field: string, context: WorkflowContext): any {
  switch (field) {
    case "days_requested": return context.data.daysRequested;
    case "employee_department": return context.user?.departmentId || context.data.departmentId;
    case "employee_location": return context.user?.locationId || context.data.locationId;
    case "late_count_month": return context.data.lateCountMonth;
    case "pto_balance": return context.data.ptoBalance;
    case "overtime_hours": return context.data.overtimeHours;
    default: return context.data[field];
  }
}

async function executeNode(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  context: WorkflowContext,
  result: ExecutionResult,
  visited: Set<string>
): Promise<void> {
  if (visited.has(node.id)) return;
  visited.add(node.id);

  const nodeType = node.data.nodeType;
  result.logs.push(`Executing node: ${node.data.label} (${nodeType})`);

  if (nodeType === "trigger") {
    const outEdges = edges.filter(e => e.source === node.id);
    for (const edge of outEdges) {
      const nextNode = nodes.find(n => n.id === edge.target);
      if (nextNode) await executeNode(nextNode, nodes, edges, context, result, visited);
    }
  } else if (nodeType === "condition") {
    const conditionMet = evaluateCondition(node, context);
    result.logs.push(`Condition "${node.data.label}": ${conditionMet ? "YES" : "NO"}`);

    const handleId = conditionMet ? "yes" : "no";
    const outEdges = edges.filter(e => e.source === node.id && e.sourceHandle === handleId);
    for (const edge of outEdges) {
      const nextNode = nodes.find(n => n.id === edge.target);
      if (nextNode) await executeNode(nextNode, nodes, edges, context, result, visited);
    }
  } else if (nodeType === "approval") {
    result.approvals.push(node.data.approverRole || "unknown");
    result.logs.push(`Approval required: ${node.data.approverRole}`);

    const outEdges = edges.filter(e => e.source === node.id);
    for (const edge of outEdges) {
      const nextNode = nodes.find(n => n.id === edge.target);
      if (nextNode) await executeNode(nextNode, nodes, edges, context, result, visited);
    }
  } else if (nodeType === "action") {
    result.actions.push(node.data.actionType || "unknown");
    result.logs.push(`Action triggered: ${node.data.actionType}`);

    if (node.data.actionType === "generate_alert" && context.userId) {
      try {
        await storage.createSystemAlert({
          type: "workflow_action",
          severity: "medium",
          title: `Workflow Action: ${node.data.label}`,
          message: `Automated action from workflow "${result.workflowName}"`,
          employeeId: context.userId,
          status: "active",
        });
      } catch (err) {
        result.logs.push(`Failed to create alert: ${err}`);
      }
    }

    const outEdges = edges.filter(e => e.source === node.id);
    for (const edge of outEdges) {
      const nextNode = nodes.find(n => n.id === edge.target);
      if (nextNode) await executeNode(nextNode, nodes, edges, context, result, visited);
    }
  } else if (nodeType === "notification") {
    result.notifications.push(node.data.notificationType || "unknown");
    result.logs.push(`Notification sent: ${node.data.notificationType}`);

    if (context.userId) {
      try {
        await storage.createSystemAlert({
          type: "workflow_notification",
          severity: "low",
          title: `Workflow Notification: ${node.data.label}`,
          message: node.data.customMessage || `Notification from workflow "${result.workflowName}"`,
          employeeId: context.userId,
          status: "active",
        });
      } catch (err) {
        result.logs.push(`Failed to create notification alert: ${err}`);
      }
    }

    const outEdges = edges.filter(e => e.source === node.id);
    for (const edge of outEdges) {
      const nextNode = nodes.find(n => n.id === edge.target);
      if (nextNode) await executeNode(nextNode, nodes, edges, context, result, visited);
    }
  }
}

export async function runWorkflowsForTrigger(context: WorkflowContext): Promise<ExecutionResult[]> {
  const workflows = await storage.getWorkflowsByTriggerType(context.triggerType);
  const results: ExecutionResult[] = [];

  for (const workflow of workflows) {
    const result: ExecutionResult = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      executed: false,
      actions: [],
      notifications: [],
      approvals: [],
      logs: [],
    };

    try {
      const graph = workflow.nodeGraph as { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
      if (!graph?.nodes || !graph?.edges) {
        result.logs.push("Invalid workflow graph structure");
        results.push(result);
        continue;
      }

      const triggerNodes = graph.nodes.filter(n => n.data.nodeType === "trigger");
      if (triggerNodes.length === 0) {
        result.logs.push("No trigger nodes found");
        results.push(result);
        continue;
      }

      const visited = new Set<string>();
      for (const triggerNode of triggerNodes) {
        await executeNode(triggerNode, graph.nodes, graph.edges, context, result, visited);
      }

      result.executed = true;
      result.logs.push("Workflow execution completed");

      await writeAuditLog({
        actorUserId: context.userId,
        action: "workflow.executed",
        targetId: workflow.id,
        targetType: "workflow",
        newValue: {
          triggerType: context.triggerType,
          actions: result.actions,
          approvals: result.approvals,
          notifications: result.notifications,
        },
      });
    } catch (err) {
      result.logs.push(`Workflow execution error: ${err}`);
    }

    results.push(result);
  }

  return results;
}
