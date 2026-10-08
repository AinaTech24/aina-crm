/**
 * The OwnerDirectory (lib/rta/owner.ts) over the importer's InvestorDirectory —
 * read-only. One difference from InvestorDirectory.byFolio, on purpose: a folio
 * is the folio of ONE AMC (Decision 7: registrar + AMC + folio). The same folio
 * number under another AMC is a different folio and never identifies an owner.
 */
import type { InvestorDirectory } from "./identity";
import type { Lookup, OwnerDirectory, KnownInvestor } from "./owner";

export class InvestorOwnerDirectory implements OwnerDirectory {
  constructor(private dir: InvestorDirectory) {}

  async folioOwner(amcCode: string | null, folioNumber: string): Promise<Lookup> {
    const amc = (amcCode ?? "").trim();
    if (!amc) return toLookup(await this.dir.byFolio(folioNumber));
    const exact = (await this.dir.foliosFor(folioNumber)).filter((f) => (f.amc_code ?? "").trim() === amc);
    if (!exact.length) return { kind: "none" };
    if (exact.length > 1) return { kind: "ambiguous", reason: `folio ${folioNumber.trim()} is on record twice under one AMC — held for review` };
    if (!exact[0].investor_id) return { kind: "none" };
    const life = await this.dir.lifecycle(exact[0].investor_id);
    return life.kind === "found" ? { kind: "found", investorId: life.id, folioId: exact[0].id } : toLookup(life);
  }

  async byPan(pan: string): Promise<Lookup> {
    return toLookup(await this.dir.byPan(pan));
  }

  investor(id: string): KnownInvestor | null {
    return this.dir.info(id);
  }
}

function toLookup(r: { kind: string; id?: string; reason?: string; folioId?: string }): Lookup {
  if (r.kind === "found") return { kind: "found", investorId: r.id!, folioId: r.folioId ?? null };
  if (r.kind === "blocked" || r.kind === "ambiguous") return { kind: r.kind, reason: r.reason ?? "" };
  return { kind: "none" };
}
