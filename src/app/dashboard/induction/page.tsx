import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Induction. Everyone sees their own track: ordered lessons, progress, lock
 * state (a lesson unlocks once every previous REQUIRED lesson is complete, so
 * the track is walked in order). People who manage induction also see every
 * training track with how many are enrolled and passed, and "+ New training
 * track" — building tracks lives at /dashboard/settings/induction.
 */

import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { CheckCircle2, GraduationCap, Lock, PlayCircle, FileText, ExternalLink, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { inductionEnrolments, inductionTracks } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadTrackState } from "@/lib/induction/engine";
import { can } from "@/lib/auth/rbac";
import { buttonClass } from "@/components/ui/button-class";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<string, any> = {
  video: PlayCircle,
  document: FileText,
  kb_article: FileText,
  link: ExternalLink,
  checklist: CheckCircle2,
};

type TrackRow = { id: string; name: string; status: string; lessons: number; enrolled: number; passed: number };

export default async function InductionPage() {
  const session = await requireSession();
  const isAdmin = can(session.roles, "induction.manage", session.permissions);

  // Every track with its lesson / enrolment / pass counts — for admins only.
  const tracks: TrackRow[] = isAdmin
    ? await withTenant(session.tenantId, async (tx) =>
        (await tx.execute(sql`
          SELECT t.id, t.name, t.status,
                 (SELECT count(*)::int FROM induction_lessons l WHERE l.track_id = t.id) AS lessons,
                 (SELECT count(*)::int FROM induction_enrolments e WHERE e.track_id = t.id) AS enrolled,
                 (SELECT count(*)::int FROM induction_enrolments e WHERE e.track_id = t.id AND e.status = 'passed') AS passed
            FROM induction_tracks t
           WHERE t.tenant_id = ${session.tenantId}::uuid
           ORDER BY t.name ASC
        `)).rows as TrackRow[]
      )
    : [];

  const header = (
    <PageHeaderCard
      title={<><GraduationCap className="size-6 text-muted-foreground" /> Induction</>}
      actions={
        isAdmin ? (
          <Link href="/dashboard/settings/induction" className={buttonClass("primary")}>
            <Plus className="size-4" /> New training track
          </Link>
        ) : undefined
      }
    />
  );

  const trackList = isAdmin ? (
    <section aria-labelledby="tracks" className="card-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 id="tracks" className="text-sm font-semibold">Training tracks</h2>
        <Link href="/dashboard/settings/induction" className="text-xs font-medium text-foreground hover:underline">Manage tracks →</Link>
      </div>
      {tracks.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No training tracks yet. Build one with “New training track”, then enrol new joiners on it.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Track</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Lessons</th>
                <th className="text-right py-2 font-medium">Enrolled</th>
                <th className="text-right py-2 pr-4 font-medium">Passed</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium">{t.name}</td>
                  <td className="py-2.5"><span className="chip text-2xs bg-secondary text-foreground capitalize">{t.status}</span></td>
                  <td className="py-2.5 text-right tabular-nums">{t.lessons}</td>
                  <td className="py-2.5 text-right tabular-nums">{t.enrolled}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{t.passed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  ) : null;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(inductionEnrolments)
      .where(eq(inductionEnrolments.userId, session.userId))
      .limit(1);
    if (!enrolment) return null;

    const [track] = await tx
      .select()
      .from(inductionTracks)
      .where(eq(inductionTracks.id, enrolment.trackId))
      .limit(1);
    if (!track) return null;

    const state = await loadTrackState(tx, enrolment.id, enrolment.trackId);
    return { enrolment, track, state };
  });

  if (!data) {
    if (isAdmin) {
      return (
        <div className="max-w-5xl space-y-5">
          {header}
          {trackList}
        </div>
      );
    }
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        {header}
        <div className="card-surface p-12 text-center">
          <div className="mx-auto size-12 rounded-full bg-brand-cyan-light/40 flex items-center justify-center mb-3">
            <GraduationCap className="size-6 text-muted-foreground" />
          </div>
          <div className="text-sm font-semibold text-foreground">No induction assigned</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            You haven't been enrolled on a training track. If you've just joined, ask your manager to
            assign one.
          </p>
        </div>
      </div>
    );
  }

  const { track, state, enrolment } = data;
  const passed = enrolment.status === "passed";

  return (
    <div className={`${isAdmin ? "max-w-5xl" : "max-w-3xl mx-auto"} space-y-5`}>
      {header}
      {trackList}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-foreground">Your track: {track.name}</h2>
        {track.description && (
          <p className="text-muted-foreground text-sm mt-2">{track.description}</p>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">
              {state.requiredDone} of {state.requiredTotal} steps complete
            </span>
            <span className="font-semibold tabular-nums">{state.percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-brand-cyan transition-all"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        </div>
</div>

      <ul className="card-surface divide-y overflow-hidden">
        {state.lessons.map((s: any, i: number) => {
          const Icon = KIND_ICON[s.lesson.kind] ?? PlayCircle;
          const body = (
            <div className="px-4 py-3 flex items-center gap-3">
              <span
                className={`shrink-0 grid place-items-center size-8 rounded-full text-xs font-semibold ${
                  s.completed
                    ? "bg-emerald-500 text-white"
                    : s.locked
                      ? "bg-secondary text-muted-foreground"
                      : "bg-brand-cyan-light/60 text-brand-cyan-deep"
                }`}
              >
                {s.completed ? <CheckCircle2 className="size-4" /> : s.locked ? <Lock className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${s.locked ? "text-muted-foreground" : ""}`}>
                  {s.lesson.title}
                </div>
                {s.lesson.summary && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{s.lesson.summary}</div>
                )}
              </div>
              <Icon className={`size-4 shrink-0 ${s.locked ? "text-muted-foreground" : "text-muted-foreground"}`} />
            </div>
          );

          return (
            <li key={s.lesson.id} className={s.locked ? "opacity-70" : "hover:bg-secondary/70"}>
              {s.locked ? (
                <div title="Complete the previous step first">{body}</div>
              ) : (
                <Link href={`/dashboard/induction/${s.lesson.id}`}>{body}</Link>
              )}
            </li>
          );
        })}
        {state.lessons.length === 0 && (
          <li className="p-8 text-center text-sm text-muted-foreground">
            This track has no lessons yet.
          </li>
        )}
      </ul>

      {/* Exam gate */}
      <div className="card-surface p-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Final assessment</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {passed
              ? "You've passed. Your confirmation letter is ready."
              : state.allRequiredDone
                ? `Pass mark ${track.passMark}%.`
                : "Unlocks when every step above is complete."}
          </p>
        </div>
        {passed ? (
          <Link href="/dashboard/induction/result" className="btn-primary shrink-0">
            View result
          </Link>
        ) : (
          <Link
            href="/dashboard/induction/exam"
            aria-disabled={!state.allRequiredDone}
            className={`btn-primary shrink-0 ${
              state.allRequiredDone ? "" : "pointer-events-none opacity-40"
            }`}
          >
            Start exam
          </Link>
        )}
      </div>
    </div>
  );
}
