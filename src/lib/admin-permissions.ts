export type AdminRole =
  | "owner" | "administrator" | "catalog_manager" | "purchasing_manager"
  | "logistics_manager" | "support_agent" | "accountant" | "auditor";

export type AdminPermission =
  | "dashboard:read" | "catalog:read" | "catalog:write"
  | "suppliers:read" | "suppliers:write" | "purchases:read" | "purchases:write"
  | "orders:read" | "orders:write" | "logistics:read" | "logistics:write"
  | "returns:read" | "returns:write" | "refunds:request"
  | "finance:read" | "finance:write" | "ai:read" | "ai:write"
  | "digital:read" | "digital:write" | "services:write"
  | "workflows:read" | "workflows:write" | "support:read" | "support:write"
  | "settings:read" | "settings:write" | "team:manage" | "audit:read";

const ROLE_PERMISSIONS: Record<Exclude<AdminRole,"owner">, readonly AdminPermission[]> = {
  administrator: [
    "dashboard:read","catalog:read","catalog:write","suppliers:read","suppliers:write",
    "purchases:read","purchases:write","orders:read","orders:write","logistics:read",
    "logistics:write","returns:read","returns:write","refunds:request","finance:read",
    "ai:read","ai:write","digital:read","digital:write","services:write","workflows:read",
    "workflows:write","support:read","support:write","settings:read",
  ],
  catalog_manager: ["dashboard:read","catalog:read","catalog:write","suppliers:read"],
  purchasing_manager: ["dashboard:read","suppliers:read","suppliers:write","purchases:read","purchases:write","orders:read"],
  logistics_manager: ["dashboard:read","orders:read","logistics:read","logistics:write","purchases:read"],
  support_agent: ["dashboard:read","orders:read","returns:read","returns:write","support:read","support:write"],
  accountant: ["dashboard:read","orders:read","finance:read","finance:write","refunds:request","returns:read"],
  auditor: [
    "dashboard:read","catalog:read","suppliers:read","purchases:read","orders:read",
    "logistics:read","returns:read","finance:read","ai:read","digital:read",
    "workflows:read","support:read","settings:read","audit:read",
  ],
};

export function hasPermission(role:AdminRole,permission:AdminPermission):boolean {
  return role==="owner" || ROLE_PERMISSIONS[role]?.includes(permission)===true;
}
export function permissionsForRole(role:AdminRole):readonly AdminPermission[] {
  return role==="owner"
    ? ["dashboard:read","catalog:read","catalog:write","suppliers:read","suppliers:write",
      "purchases:read","purchases:write","orders:read","orders:write","logistics:read",
      "logistics:write","returns:read","returns:write","refunds:request","finance:read",
      "finance:write","ai:read","ai:write","digital:read","digital:write","services:write",
      "workflows:read","workflows:write","support:read","support:write","settings:read",
      "settings:write","team:manage","audit:read"]
    : ROLE_PERMISSIONS[role];
}
