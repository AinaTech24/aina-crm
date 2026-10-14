"use client";

/**
 * The Practice Systems Map's process list. Each core process with its four
 * pillars (documented · owned · measured · automated), its measure, its owner
 * position and the next step. A practice manager can, in place: choose the
 * owner position, link / unlink an SOP (through /api/sop-links), install a
 * recipe (POST /api/workflows/[recipeKey]/install-recipe — it lands disabled)
 * and turn an installed one on: a never-published draft through
 * POST /api/workflows/[id]/publish (which enables it and materialises its
 * triggers), a published one through PATCH /api/workflows/[id] { enabled }.
 *
 * The page computes everything (figures, next steps); this component only
 * renders it and sends the changes, then refreshes the server render.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Circle, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

export type MapPillarKey = "documented" | "owned" | "measured" | "automated";

export type SystemsMapViewRow = {
  key: string;
  /** Id of the row's SOPs-and-automations panel; a link to #anchor opens it. */
  anchor: string;
  name: string;
  outcome: string;
  pillars: Record<MapPillarKey, boolean>;
  met: number;
  measure: { figure: string; label: string; detail?: string; hasData: boolean };
  owner: { positionId: string; title: string; holders: string[] } | null;
  sops: Array<{ sopId: string; title: string; linkId: string; direct: boolean; via: string }>;
  recipes: Array<{ key: string; name: string; workflowId: string | null; enabled: boolean; published: boolean }>;
  /** Enabled rules from the Automations page that act on this process. */
  rules: Array<{ id: string; name: string }>;
  next: { text: string; href: string } | null;
};

export type SystemsMapTableProps = {
  rows: SystemsMapViewRow[];
  positions: Array<{ id: string; title: string; holders: number }>;
  sops: Array<{ id: string; title: string }>;
  canManage: boolean;
  pillars: ReadonlyArray<{ key: MapPillarKey; label: string; hint: string }>;
};

const VIA_LABEL: Record<string, string> = {
  process: "this process",
  task_type: "a task type",
  sr_type: "a request type",
  blueprint_stage: "a journey stage",
};

async function send(url: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (res.ok) return true;
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    notify.error(j.error ?? "That change could not be saved.");
    return false;
  } catch {
    notify.error("That change could not be saved. Check your connection.");
    return false;
  }
}

export function SystemsMapTable({ rows, positions, sops, canManage, pillars }: SystemsMapTableProps) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <ProcessRow key={r.key} row={r} positions={positions} sops={sops} canManage={canManage} pillars={pillars} />
      ))}
    </ul>
  );
}

function ProcessRow({
  row, positions, sops, canManage, pillars,
}: {
  row: SystemsMapViewRow;
  positions: SystemsMapTableProps["positions"];
  sops: SystemsMapTableProps["sops"];
  canManage: boolean;
  pillars: SystemsMapTableProps["pillars"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [pickSop, setPickSop] = useState("");
  const panel = useRef<HTMLDetailsElement>(null);

  // A "Next step" link to #anchor opens this row's panel and brings it into view.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${row.anchor}` && panel.current) {
        panel.current.open = true;
        panel.current.scrollIntoView({ block: "center" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [row.anchor]);

  const refresh = () => startTransition(() => router.refresh());

  async function setOwner(positionId: string) {
    setBusy("owner");
    const ok = await send(`/api/practice/processes/${encodeURIComponent(row.key)}`, {
      method: "PATCH",
      body: JSON.stringify({ ownerPositionId: positionId || null }),
    });
    setBusy(null);
    if (ok) {
      notify.success(positionId ? "Owner position saved." : "Owner position cleared.");
      refresh();
    }
  }

  async function linkSop() {
    if (!pickSop) return;
    setBusy("link");
    const ok = await send("/api/sop-links", {
      method: "POST",
      body: JSON.stringify({ sopId: pickSop, targetKind: "process", targetKey: row.key }),
    });
    setBusy(null);
    if (ok) {
      setPickSop("");
      notify.success("SOP linked.");
      refresh();
    }
  }

  async function unlinkSop(linkId: string, title: string) {
    const yes = await confirmDialog({
      title: "Unlink this SOP?",
      message: `"${title}" stays in the operations manual; it will no longer document ${row.name}.`,
      confirmLabel: "Unlink",
    });
    if (!yes) return;
    setBusy(`unlink:${linkId}`);
    const ok = await send(`/api/sop-links?id=${encodeURIComponent(linkId)}`, { method: "DELETE" });
    setBusy(null);
    if (ok) {
      notify.success("SOP unlinked.");
      refresh();
    }
  }

  async function install(recipeKey: string, name: string) {
    setBusy(`rc:${recipeKey}`);
    const ok = await send(`/api/workflows/${encodeURIComponent(recipeKey)}/install-recipe`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setBusy(null);
    if (ok) {
      notify.success(`"${name}" is installed and off. Turn it on when you are ready.`);
      refresh();
    }
  }

  async function turnOn(workflowId: string, name: string, published: boolean) {
    const yes = await confirmDialog({
      title: `Turn on "${name}"?`,
      message: "It starts running for every client it applies to, and any message it sends goes through your approved templates and the compliance check.",
      confirmLabel: "Turn on",
    });
    if (!yes) return;
    setBusy(`wf:${workflowId}`);
    const id = encodeURIComponent(workflowId);
    const ok = published
      ? await send(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })
      : await send(`/api/workflows/${id}/publish`, { method: "POST", body: JSON.stringify({}) });
    setBusy(null);
    if (ok) {
      notify.success(`"${name}" is on.`);
      refresh();
    }
  }

  const linkedIds = new Set(row.sops.map((s) => s.sopId));
  const linkable = sops.filter((s) => !linkedIds.has(s.id));
  const headingId = `process-${row.key}`;

  return (
    <li id={headingId} className={`px-5 py-4 ${pending ? "opacity-60" : ""}`} aria-busy={pending || undefined}>
      <div className="grid gap-4 lg:grid-cols-12">
        {/* What the process is, and the four pillars */}
        <div className="min-w-0 lg:col-span-5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold text-foreground">{row.name}</h3>
            <span className="text-xs text-muted-foreground tabular-nums">{row.met} of 4</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.outcome}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Pillars">
            {pillars.map((p) => {
              const met = row.pillars[p.key];
              return (
                <li key={p.key} title={p.hint}>
                  <Badge tone={met ? "success" : "neutral"} raw className="gap-1">
                    {met ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5 opacity-50" aria-hidden />}
                    {p.label}
                    <span className="sr-only">{met ? ": yes" : ": not yet"}</span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The measure */}
        <div className="min-w-0 lg:col-span-3">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Measure</div>
          <div
            className={`mt-0.5 text-lg font-semibold tabular-nums ${row.measure.hasData ? "text-foreground" : "text-muted-foreground"}`}
            title={row.measure.detail}
          >
            {row.measure.figure}
          </div>
          <div className="text-xs text-muted-foreground">{row.measure.label}</div>
          {!row.measure.hasData && row.measure.detail && (
            <div className="mt-0.5 text-xs text-muted-foreground">{row.measure.detail}</div>
          )}
        </div>

        {/* Owner and next step */}
        <div className="min-w-0 space-y-2 lg:col-span-4">
          <div>
            <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Owner position</div>
            {canManage && positions.length > 0 ? (
              <select
                aria-label={`Owner position for ${row.name}`}
                className="input-base text-sm w-full mt-1"
                value={row.owner?.positionId ?? ""}
                disabled={busy === "owner"}
                onChange={(e) => setOwner(e.target.value)}
              >
                <option value="">No owner yet</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}{p.holders === 0 ? " (no holder)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-0.5 text-sm">{row.owner ? row.owner.title : <span className="text-muted-foreground">No owner yet</span>}</div>
            )}
            {canManage && positions.length === 0 && (
              <Link href="/dashboard/practice/positions" className="text-xs text-primary hover:underline">
                Set up your positions first
              </Link>
            )}
            {row.owner && (
              <div className="mt-1 text-xs text-muted-foreground">
                {row.owner.holders.length ? `Held by ${row.owner.holders.join(", ")}` : "Nobody holds this position yet"}
              </div>
            )}
          </div>
          {row.next ? (
            <div className="rounded-md bg-secondary/70 px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">Next step: </span>
              <Link href={row.next.href} className="text-primary hover:underline">{row.next.text}</Link>
            </div>
          ) : (
            <div className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">Runs as a system.</div>
          )}
        </div>
      </div>

      {/* SOPs and automations */}
      <details ref={panel} id={row.anchor} className="mt-3 scroll-mt-24">
        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
          SOPs ({row.sops.length}) and automations ({row.recipes.filter((x) => x.enabled).length + row.rules.length} on)
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-foreground">How it is done</div>
            {row.sops.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No SOP documents this process yet.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {row.sops.map((s) => (
                  <li key={s.linkId} className="flex items-center gap-2 text-sm">
                    <Link href={`/dashboard/sops/${s.sopId}`} className="min-w-0 truncate hover:underline">{s.title}</Link>
                    {!s.direct && <span className="shrink-0 text-2xs text-muted-foreground">via {VIA_LABEL[s.via] ?? s.via}</span>}
                    {canManage && s.direct && (
                      <button
                        type="button"
                        className="btn-icon shrink-0"
                        aria-label={`Unlink ${s.title}`}
                        title="Unlink"
                        disabled={busy === `unlink:${s.linkId}`}
                        onClick={() => unlinkSop(s.linkId, s.title)}
                      >
                        <Unlink className="size-4" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {linkable.length > 0 && (
                  <>
                    <select
                      aria-label={`Link an SOP to ${row.name}`}
                      className="input-base text-sm min-w-0 flex-1"
                      value={pickSop}
                      onChange={(e) => setPickSop(e.target.value)}
                    >
                      <option value="">Choose an SOP…</option>
                      {linkable.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                    <Button size="sm" onClick={linkSop} disabled={!pickSop} loading={busy === "link"}>Link</Button>
                  </>
                )}
                <Link href="/dashboard/sops/new" className={buttonClass("ghost", "sm")}>Write an SOP</Link>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-foreground">Automations</div>
            <ul className="mt-1 space-y-1.5">
              {row.recipes.map((rc) => (
                <li key={rc.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 truncate">{rc.name}</span>
                  {rc.enabled ? (
                    <Badge tone="success" dot raw>On</Badge>
                  ) : rc.workflowId ? (
                    <>
                      <Badge tone="neutral" raw>Off</Badge>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy === `wf:${rc.workflowId}`}
                          onClick={() => turnOn(rc.workflowId!, rc.name, rc.published)}
                        >
                          Turn on
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Badge tone="neutral" raw>Not installed</Badge>
                      {canManage && (
                        <Button size="sm" variant="ghost" loading={busy === `rc:${rc.key}`} onClick={() => install(rc.key, rc.name)}>
                          Install
                        </Button>
                      )}
                    </>
                  )}
                </li>
              ))}
              {row.rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/dashboard/workflows/rules/${r.id}`} className="min-w-0 truncate hover:underline">{r.name}</Link>
                  <Badge tone="success" dot raw>On</Badge>
                  <span className="text-2xs text-muted-foreground">rule</span>
                </li>
              ))}
            </ul>
            <Link href="/dashboard/automations" className="mt-2 inline-block text-xs text-primary hover:underline">
              Build a rule on the Automations page
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}
