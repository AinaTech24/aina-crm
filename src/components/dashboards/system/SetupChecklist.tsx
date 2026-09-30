/**
 * "Get set up" — shown above an owner's dashboard until the firm has done the
 * four things that make the CRM work day to day. Each step is verified from
 * real data, never ticked by hand, and the card disappears on its own once
 * everything is done (so an established firm never sees it). Dismissable per
 * device before that.
 *
 * It used to sit inside the old firm cockpit; it came back here when that
 * cockpit was replaced by named dashboards, because it is the only first-run
 * guidance a new firm gets. A failure renders nothing, never an error.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { SetupChecklistCard, type SetupStep } from "./SetupChecklistCard";

export async function SetupChecklist({ tenantId }: { tenantId: string }) {
  let steps: SetupStep[];
  try {
    const r = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          EXISTS (SELECT 1 FROM investors WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL) AS has_clients,
          (SELECT count(*) FROM users WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL) > 1 AS has_team,
          EXISTS (SELECT 1 FROM whatsapp_numbers WHERE tenant_id = ${tenantId}::uuid) AS has_wa,
          EXISTS (SELECT 1 FROM workflow_rules WHERE tenant_id = ${tenantId}::uuid AND enabled = true) AS has_rules
      `);
      return (res.rows[0] ?? {}) as Record<string, boolean>;
    });
    steps = [
      { key: "clients", label: "Bring in your clients", hint: "Import from an RTA file or Excel, or add one by hand.", href: "/dashboard/investors/import", done: !!r.has_clients },
      { key: "team", label: "Invite your team", hint: "RMs and back office get their own logins and task lists.", href: "/dashboard/employees", done: !!r.has_team },
      { key: "whatsapp", label: "Connect WhatsApp", hint: "Send birthday wishes, reminders and updates from your own number.", href: "/dashboard/settings/whatsapp", done: !!r.has_wa },
      { key: "automation", label: "Switch on your first automation", hint: "SIP-bounce recovery and review reminders run on their own.", href: "/dashboard/automations", done: !!r.has_rules },
    ];
  } catch {
    return null;
  }
  if (steps.every((s) => s.done)) return null;
  return <SetupChecklistCard steps={steps} />;
}
