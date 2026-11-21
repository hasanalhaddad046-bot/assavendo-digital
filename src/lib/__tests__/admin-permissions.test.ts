import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, permissionsForRole, type AdminPermission } from "../admin-permissions.ts";

test("owner peut accéder à toutes les permissions",()=>{
  const perms:AdminPermission[]=[
    "dashboard:read","catalog:read","catalog:write","suppliers:read","suppliers:write",
    "purchases:read","purchases:write","orders:read","orders:write","logistics:read",
    "logistics:write","returns:read","returns:write","refunds:request","finance:read",
    "finance:write","ai:read","ai:write","digital:read","digital:write","services:write",
    "workflows:read","workflows:write","support:read","support:write","settings:read",
    "settings:write","team:manage","audit:read",
  ];
  for(const permission of perms) assert.equal(hasPermission("owner",permission),true);
});

test("catalogue ne peut pas accéder aux finances ou aux remboursements",()=>{
  assert.equal(hasPermission("catalog_manager","catalog:write"),true);
  assert.equal(hasPermission("catalog_manager","finance:read"),false);
  assert.equal(hasPermission("catalog_manager","refunds:request"),false);
});

test("support gère les retours mais ne touche pas aux encaissements ni aux achats",()=>{
  assert.equal(hasPermission("support_agent","returns:write"),true);
  assert.equal(hasPermission("support_agent","orders:read"),true);
  assert.equal(hasPermission("support_agent","finance:write"),false);
  assert.equal(hasPermission("support_agent","purchases:write"),false);
});

test("comptabilité traite la trésorerie sans modifier le catalogue ou l'équipe",()=>{
  assert.equal(hasPermission("accountant","finance:write"),true);
  assert.equal(hasPermission("accountant","refunds:request"),true);
  assert.equal(hasPermission("accountant","catalog:write"),false);
  assert.equal(hasPermission("accountant","team:manage"),false);
});

test("auditeur est en lecture seule",()=>{
  for(const permission of permissionsForRole("auditor")) {
    assert.match(permission,/:read$/);
  }
  assert.equal(hasPermission("auditor","finance:write"),false);
  assert.equal(hasPermission("auditor","settings:write"),false);
});

test("aucun rôle d'opérations ne peut gérer l'équipe",()=>{
  for(const role of ["administrator","catalog_manager","purchasing_manager","logistics_manager","support_agent","accountant","auditor"] as const) {
    assert.equal(hasPermission(role,"team:manage"),false);
  }
});
