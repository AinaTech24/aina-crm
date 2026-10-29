import { describe, expect, it } from "vitest";
import { leadSubject } from "@/lib/comms/lead-subject";

describe("a lead as the subject of a send", () => {
  const abs = (u: string) => `https://crm.example.in${u}`;

  it("fills the lead's own fields and signs off as its owner", () => {
    const s = leadSubject(
      { name: "Anita  Desai", phone: "9800000000", referredByName: "Rajesh Sharma" },
      { name: "Priya Mehta", email: "priya@firm.in", phone: "9811111111", signatureUrl: "/api/upload-local/sig.png" },
      "AMFI Registered Mutual Fund Distributor",
      abs
    );
    expect(s).toMatchObject({
      name: "Anita  Desai",
      first_name: "Anita",
      phone: "9800000000",
      referredByName: "Rajesh Sharma",
      owner_name: "Priya Mehta",
      rm_name: "Priya Mehta",
      rm_email: "priya@firm.in",
      rm_signature_url: "https://crm.example.in/api/upload-local/sig.png",
    });
  });

  it("leaves the sign-off blank for a lead nobody owns", () => {
    const s = leadSubject({ name: "Anita" }, null, "AMFI Registered Mutual Fund Distributor", abs);
    expect(s).toMatchObject({ rm_name: "", rm_email: "", rm_phone: "", rm_signature_url: "", owner_name: "" });
  });
});
