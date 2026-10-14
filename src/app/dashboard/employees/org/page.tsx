import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { ChevronLeft, Network } from "lucide-react";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { Avatar } from "@/components/ui/Avatar";
import { loadPositions, type PositionView } from "@/lib/practice/positions";

export const dynamic = "force-dynamic";

type Node = {
  id: string;
  name: string;
  department: string | null;
  roles: string[];
  avatarUrl: string | null;
  managerId: string | null;
  children: Node[];
};

export default async function OrgChartPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  const view = (await searchParams).view === "positions" ? "positions" : "people";

  if (view === "positions") {
    const positions = await withTenant(session.tenantId, (tx) => loadPositions(tx, session.tenantId),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    return (
      <div className="space-y-6 max-w-5xl">
        <Link href="/dashboard/employees" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ChevronLeft className="size-3" /> Back to employees
        </Link>
        <PageHeaderCard title={<><Network className="size-6 text-muted-foreground" /> Org chart</>} actions={<ViewToggle view={view} />} />
        {positions.length === 0 ? (
          <div className="card-surface p-12 text-center text-sm text-muted-foreground">
            No positions yet. <Link href="/dashboard/practice/positions" className="text-primary hover:underline">Set up the firm&apos;s positions</Link>.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {positions.map((p) => <PositionNode key={p.id} position={p} />)}
          </div>
        )}
      </div>
    );
  }

  const rows = await withTenant(session.tenantId, async (tx) =>
    tx
      .select({
        id: users.id,
        name: users.name,
        department: users.department,
        roles: users.roles,
        avatarUrl: users.avatarUrl,
        managerId: users.reportingManagerId,
      })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), ne(users.status, "offboarded")))
      .orderBy(users.name)
  );

  // Build the tree. Roots = no manager, or a manager that isn't in the set
  // (defensive against a dangling/cross-tenant pointer).
  const byId = new Map<string, Node>();
  for (const r of rows) byId.set(r.id, { ...r, roles: (r.roles as string[]) ?? [], children: [] });
  const roots: Node[] = [];
  for (const n of byId.values()) {
    if (n.managerId && byId.has(n.managerId) && n.managerId !== n.id) {
      byId.get(n.managerId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  // Sort children by name for stable rendering.
  const sortRec = (n: Node) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortRec);

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/employees" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="size-3" /> Back to employees
      </Link>
      <PageHeaderCard title={<><Network className="size-6 text-muted-foreground" /> Org chart</>} actions={<ViewToggle view={view} />} />

      {roots.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">No employees yet.</div>
      ) : (
        <div className="space-y-4">
          {roots.map((n) => (
            <OrgNode key={n.id} node={n} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <div className={depth > 0 ? "ml-6 border-l border-border pl-4" : ""}>
      <Link
        href={`/dashboard/employees/${node.id}`}
        className="inline-flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 hover:border-brand-cyan/50 hover:bg-secondary/30 transition-colors"
      >
        <Avatar src={node.avatarUrl && /^https?:\/\//.test(node.avatarUrl) ? node.avatarUrl : null} name={node.name} size={32} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{node.name}</div>
          <div className="text-2xs text-muted-foreground truncate">
            {node.roles.slice(0, 2).map((r) => ROLE_LABELS[r] ?? r).join(", ")}
            {node.department ? ` · ${node.department.replace(/_/g, " ")}` : ""}
            {node.children.length > 0 ? ` · ${node.children.length} report${node.children.length > 1 ? "s" : ""}` : ""}
          </div>
        </div>
      </Link>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((c) => (
            <OrgNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** People (reporting lines) or positions (the jobs and who fills them). */
function ViewToggle({ view }: { view: "people" | "positions" }) {
  const item = (key: "people" | "positions", label: string, href: string) => (
    <Link
      href={href}
      aria-current={view === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Org chart view" className="inline-flex rounded-lg bg-secondary p-1">
      {item("people", "People", "/dashboard/employees/org")}
      {item("positions", "Positions", "/dashboard/employees/org?view=positions")}
    </nav>
  );
}

function PositionNode({ position }: { position: PositionView }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-sm font-semibold">{position.title}</div>
      {position.purpose && <div className="mt-0.5 text-xs text-muted-foreground">{position.purpose}</div>}
      {position.holders.length ? (
        <ul className="mt-2 space-y-1.5">
          {position.holders.map((h) => (
            <li key={h.userId}>
              <Link href={`/dashboard/employees/${h.userId}`} className="inline-flex items-center gap-2 text-sm hover:underline">
                <Avatar src={h.avatarUrl && /^https?:\/\//.test(h.avatarUrl) ? h.avatarUrl : null} name={h.name} size={24} />
                {h.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-xs font-medium text-warning-foreground">Vacant</div>
      )}
    </div>
  );
}
