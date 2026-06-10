import { storage } from "./storage";
import type { Workflow, User } from "@shared/schema";
import { isBalanceTrackedTimeOffType, userDepartmentIds, userLocationIds } from "@shared/schema";
import { writeAuditLog } from "./services/audit";

/**
 * Shared guard: a balance-tracked PTO request that exceeds the employee's
 * available balance must never be auto-approved by any code path
 * (POST /api/time-off, workflow auto-approve actions, future auto-approve
 * threshold jobs, etc.). Over-balance requests must route to manager
 * approval instead. Returns `true` when auto-approve is allowed.
 */
export function canAutoApprovePtoRequest(args: {
  type: string;
  hoursRequested: number;
  availableBalance: number | null;
}): { allowed: boolean; reason?: string } {
  const isBalanceTracked = isBalanceTrackedTimeOffType(args.type);
  if (
    isBalanceTracked &&
    args.availableBalance !== null &&
    args.hoursRequested > args.availableBalance
  ) {
    return {
      allowed: false,
      reason: "over_balance",
    };
  }
  return { allowed: true };
}

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

  // Membership fields resolve to an array; match if ANY assignment matches.
  if (Array.isArray(contextValue)) {
    const members = contextValue.map((m) => String(m));
    switch (operator) {
      case "eq": return members.includes(String(value));
      case "neq": return !members.includes(String(value));
      default: return false;
    }
  }

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
    case "hours_requested":
    case "days_requested":
      return context.data.hoursRequested;
    // Membership-aware: return all assignments so eq/neq match if ANY matches.
    case "employee_department":
      return context.user ? userDepartmentIds(context.user) : (context.data.departmentId ? [context.data.departmentId] : []);
    case "employee_location":
      return context.user ? userLocationIds(context.user) : (context.data.locationId ? [context.data.locationId] : []);
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
          message: `Workflow Action: ${node.data.label} — Automated action from workflow "${result.workflowName}"`,
          employeeId: context.userId,
          status: "active",
          details: { workflowName: result.workflowName, label: node.data.label },
        });
      } catch (err) {
        result.logs.push(`Failed to create alert: ${err}`);
      }
    }

    if (node.data.actionType === "auto_approve_pto" && context.userId) {
      // Over-balance guard: never auto-approve a balance-tracked PTO request
      // that exceeds the employee's available balance. Route to manager
      // approval instead.
      const ptoRequestType = String(context.data.requestType ?? "");
      const hoursRequested = Number(context.data.hoursRequested);
      const availableBalance =
        context.data.ptoBalance == null ? null : Number(context.data.ptoBalance);
      const guard = canAutoApprovePtoRequest({
        type: ptoRequestType,
        hoursRequested: Number.isFinite(hoursRequested) ? hoursRequested : 0,
        availableBalance:
          availableBalance !== null && Number.isFinite(availableBalance)
            ? availableBalance
            : null,
      });
      if (!guard.allowed) {
        result.logs.push(
          `Auto-approve PTO blocked: ${guard.reason ?? "guard"} (request stays pending for manager review)`,
        );
        if (context.data.requestId) {
          try {
            await writeAuditLog({
              actorUserId: context.userId,
              targetType: "time_off_request",
              targetId: String(context.data.requestId),
              action: "time_off.over_balance_forced_approval",
              newValue: {
                type: ptoRequestType,
                hoursRequested,
                availableBalance,
                source: "workflow",
                workflowName: result.workflowName,
                reason:
                  "Workflow auto-approve action blocked because the request exceeds the employee's available balance",
              },
            });
          } catch (err) {
            result.logs.push(`Failed to write over-balance audit log: ${err}`);
          }
        }
      } else if (context.data.requestId) {
        try {
          await storage.updateTimeOffRequest(String(context.data.requestId), {
            status: "approved",
            reviewedBy: context.userId,
            reviewedAt: new Date(),
            hoursApproved: Number.isFinite(hoursRequested) ? hoursRequested : undefined,
          });
        } catch (err) {
          result.logs.push(`Failed to auto-approve PTO request: ${err}`);
        }
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
          message: node.data.customMessage || `Workflow Notification: ${node.data.label} — Notification from workflow "${result.workflowName}"`,
          employeeId: context.userId,
          details: { workflowName: result.workflowName, label: node.data.label },
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
