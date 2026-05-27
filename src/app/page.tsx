import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <div className="size-7 rounded bg-primary text-primary-foreground grid place-items-center">M</div>
            <span>MFD Practice Platform</span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <Link href="/dashboard/workflows" className="hover:underline">Workflows</Link>
            <Link href="/dashboard/templates" className="hover:underline">Templates</Link>
            <Link
              href="/dashboard"
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 font-medium"
            >
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <section className="container py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-xs font-medium">
            SEBI May 2026 ready · DPDP compliant · AMFI-checked sends
          </span>
          <h1 className="mt-6 text-5xl font-bold tracking-tight">
            The practice operating system for MFD firms.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground leading-relaxed">
            Workflow rules. Filters. Criteria-based actions. WhatsApp + email automation. Compliance baked
            into every send. Built for ARN-holding firms with 2–50 employees.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              href="/dashboard"
              className="rounded-md bg-primary text-primary-foreground px-5 py-2.5 font-medium"
            >
              Try the demo
            </Link>
            <Link
              href="/dashboard/workflows"
              className="rounded-md border px-5 py-2.5 font-medium"
            >
              See workflows
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-4 text-sm">
            <Stat label="Pre-built automation recipes" value="24+" />
            <Stat label="Channels supported" value="WA · Email · SMS" />
            <Stat label="Compliance rules enforced" value="11" />
            <Stat label="Pricing from" value="₹14,999/yr" />
          </div>
        </div>

        <div className="bg-muted rounded-2xl p-8 border">
          <div className="space-y-3">
            <PillarCard title="Workflow engine" desc="Trigger → Filter → Branch → Action graph builder with versioning, retries, and pause/resume." />
            <PillarCard title="Filters & segments" desc="One AST powers saved views, dynamic segments, and AI assistant queries." />
            <PillarCard title="WhatsApp automation" desc="AiSensy-powered. Template-gated. 24h session aware. Marketing opt-in tracked." />
            <PillarCard title="Email designer" desc="Block-based composer. ARN/EUIN footer auto-injected. Live compliance linter." />
            <PillarCard title="Compliance Guard" desc="Non-bypassable gate on every send. Audit trail feeds DDQ pack." />
          </div>
        </div>
      </section>

      <footer className="border-t mt-auto py-6">
        <div className="container flex justify-between text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} MFD Practice Platform</span>
          <span>Mutual fund investments are subject to market risks. Read all scheme related documents carefully.</span>
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function PillarCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-background rounded-lg p-4 border">
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground mt-1">{desc}</div>
    </div>
  );
}
