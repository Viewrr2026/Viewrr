/**
 * PRD-008 — Granular Finance Permission Service
 * Replaces broad isAdmin checks with explicit role-based permission checks.
 * All checks are server-side; UI visibility never replaces server auth.
 */

import { neon } from "@neondatabase/serverless";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

export type FinanceRole = "founder" | "admin" | "payments_manager" | "support";

export type FinancePermission =
  | "finance.dashboard.view"
  | "finance.payment.view"
  | "finance.audit.view"
  | "finance.export"
  | "finance.reconcile.run"
  | "finance.webhook.replay"
  | "finance.refund.request"
  | "finance.refund.approve.standard"
  | "finance.refund.approve.high_value"
  | "finance.dispute.manage"
  | "finance.settings.payout"
  | "finance.connected_account.view";

// Refund thresholds in pence
export const REFUND_THRESHOLD_STANDARD = 100_00;   // £100.00
export const REFUND_THRESHOLD_HIGH_VALUE = 1_000_00; // £1,000.00

// High-value refund review delay (ms) during single-founder phase
export const HIGH_VALUE_REVIEW_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Derive a user's finance role from their DB role field.
 * Founder = isAdmin + role "admin" with userId 22 (the known founder account).
 * Fall back: any isAdmin user → "admin".
 */
export function deriveFinanceRole(user: {
  id: number;
  role?: string | null;
  isAdmin?: number | null;
}): FinanceRole | null {
  if (!user.isAdmin && user.role !== "admin") return null;
  // Founder = the registered founder account (userId 22, support@viewrr.co.uk)
  if (user.id === 22) return "founder";
  if (user.role === "payments_manager") return "payments_manager";
  if (user.role === "support") return "support";
  return "admin";
}

/**
 * Check if a role has a specific permission.
 * Uses the finance_permissions table (seeded by migration).
 * Falls back to an in-memory matrix if DB is unavailable.
 */
const PERMISSION_CACHE: Map<string, Set<string>> = new Map();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadPermissions(): Promise<void> {
  if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;
  try {
    const db = getDb();
    const rows = await db`SELECT role, permission FROM finance_permissions`;
    const fresh: Map<string, Set<string>> = new Map();
    for (const row of rows) {
      if (!fresh.has(row.role)) fresh.set(row.role, new Set());
      fresh.get(row.role)!.add(row.permission);
    }
    for (const [k, v] of fresh) PERMISSION_CACHE.set(k, v);
    cacheLoadedAt = Date.now();
  } catch {
    // Use hardcoded fallback matrix
    const matrix: Record<FinanceRole, FinancePermission[]> = {
      founder: [
        "finance.dashboard.view","finance.payment.view","finance.audit.view",
        "finance.export","finance.reconcile.run","finance.webhook.replay",
        "finance.refund.request","finance.refund.approve.standard",
        "finance.refund.approve.high_value","finance.dispute.manage",
        "finance.settings.payout","finance.connected_account.view",
      ],
      admin: [
        "finance.dashboard.view","finance.payment.view","finance.audit.view",
        "finance.export","finance.reconcile.run","finance.webhook.replay",
        "finance.refund.request","finance.refund.approve.standard",
        "finance.dispute.manage","finance.connected_account.view",
      ],
      payments_manager: [
        "finance.dashboard.view","finance.payment.view","finance.audit.view",
        "finance.export","finance.reconcile.run","finance.webhook.replay",
        "finance.refund.request","finance.refund.approve.standard",
        "finance.dispute.manage","finance.connected_account.view",
      ],
      support: [
        "finance.dashboard.view","finance.payment.view",
        "finance.refund.request","finance.dispute.manage",
      ],
    };
    for (const [role, perms] of Object.entries(matrix)) {
      PERMISSION_CACHE.set(role, new Set(perms));
    }
    cacheLoadedAt = Date.now();
  }
}

export async function hasPermission(
  role: FinanceRole,
  permission: FinancePermission
): Promise<boolean> {
  await loadPermissions();
  return PERMISSION_CACHE.get(role)?.has(permission) ?? false;
}

/**
 * Express middleware: assert the requesting user has a finance permission.
 * User must be identified by `userId` query param or request body.
 * Returns 401/403 with plain error on failure.
 */
export function requireFinancePermission(permission: FinancePermission) {
  return async (req: any, res: any, next: any) => {
    try {
      const rawUserId = req.body?.userId ?? req.query?.userId;
      if (!rawUserId) return res.status(401).json({ error: "userId required" });

      const db = getDb();
      const rows = await db`SELECT id, role, is_admin FROM users WHERE id = ${Number(rawUserId)} LIMIT 1`;
      if (!rows.length) return res.status(401).json({ error: "User not found" });

      const u = rows[0];
      const financeRole = deriveFinanceRole({ id: u.id, role: u.role, isAdmin: u.is_admin });
      if (!financeRole) return res.status(403).json({ error: "Finance access denied" });

      const allowed = await hasPermission(financeRole, permission);
      if (!allowed) return res.status(403).json({ error: `Permission denied: ${permission}` });

      req.financeRole = financeRole;
      req.financeUserId = u.id;
      next();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  };
}

/**
 * Check refund approval authority for a given amount.
 * Returns which permission is required and whether the role has it.
 */
export async function canApproveRefund(
  role: FinanceRole,
  amountPence: number
): Promise<{ permitted: boolean; requiredPermission: FinancePermission; requiresStepUp: boolean }> {
  if (amountPence <= REFUND_THRESHOLD_STANDARD) {
    const permitted = await hasPermission(role, "finance.refund.approve.standard");
    return { permitted, requiredPermission: "finance.refund.approve.standard", requiresStepUp: false };
  }
  if (amountPence <= REFUND_THRESHOLD_HIGH_VALUE) {
    const permitted = await hasPermission(role, "finance.refund.approve.standard");
    return { permitted, requiredPermission: "finance.refund.approve.standard", requiresStepUp: false };
  }
  // Above £1,000 — founder only with step-up
  const permitted = await hasPermission(role, "finance.refund.approve.high_value");
  return { permitted, requiredPermission: "finance.refund.approve.high_value", requiresStepUp: true };
}
