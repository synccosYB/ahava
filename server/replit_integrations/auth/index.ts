export { setupAuth, isAuthenticated, getSession } from "./replitAuth";
export { authStorage, type IAuthStorage } from "./storage";
export { registerAuthRoutes } from "./routes";
export { requireAuth, generateToken } from "../../middleware/auth";
export { requirePermission, requireScopedAccess, resolveUserPermissions } from "../../middleware/rbac";
