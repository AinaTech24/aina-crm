/**
 * A WhatsApp template that carries a client's name and a link is filled the way
 * the copy dispatch() will send wants it — named or positional — and the
 * sender uses the same copy dispatch() looks up.
 *
 * Nimesh C Shah, 15 Oct 2026: two copies of "document_collection" — the CRM's
 * ({{client.name}}, {{doc.link}}, locale "en") and Meta's ({{1}}, {{2}}, locale
 * "en-IN"). dispatch() sent Meta's; the sender had filled the CRM's variables,
 * so every document request failed with "Required variable '1' is missing".
 */
import { describe, expect, it } from "vitest";
import { nameAndLinkVariables, pickTemplateRow } from "@/lib/comms/template-variables";

const v = { name: "Vimalbhai Dosi", link: "https://crm.example/d/abc" };

describe("pickTemplateRow", () => {
  it("prefers the copy dispatch() looks up, whatever the order", () => {
    const crm = { id: "crm", locale: "en" };
    const meta = { id: "meta", locale: "en-IN" };
    expect(pickTemplateRow([crm, meta])?.id).toBe("meta");
    expect(pickTemplateRow([meta, crm])?.id).toBe("meta");
  });
  it("falls back to the first when none is in the default locale; none is null", () => {
    expect(pickTemplateRow([{ id: "a", locale: "hi-IN" }, { id: "b", locale: "en" }])?.id).toBe("a");
    expect(pickTemplateRow([])).toBeNull();
  });
});

describe("nameAndLinkVariables", () => {
  it("fills the CRM's named variables", () => {
    expect(nameAndLinkVariables([{ key: "client.name" }, { key: "doc.link" }], v)).toEqual({ "client.name": v.name, "doc.link": v.link });
  });

  it("fills Meta's positional variables: the first greets, the last carries the link", () => {
    expect(nameAndLinkVariables([{ key: "1" }, { key: "2" }], v)).toEqual({ "1": v.name, "2": v.link });
    expect(nameAndLinkVariables([{ key: "2" }, { key: "1" }], v)).toEqual({ "1": v.name, "2": v.link });
  });

  it("a lone positional variable is the link", () => {
    expect(nameAndLinkVariables([{ key: "1" }], v)).toEqual({ "1": v.link });
  });

  it("a link-only or name-only named template", () => {
    expect(nameAndLinkVariables([{ key: "upload_url" }], v)).toEqual({ upload_url: v.link });
    expect(nameAndLinkVariables([{ key: "investor_name" }], v)).toEqual({ investor_name: v.name });
  });

  it("an unrecognisable variable gets the link; nothing declared gets nothing", () => {
    expect(nameAndLinkVariables([{ key: "x" }], v)).toEqual({ x: v.link });
    expect(nameAndLinkVariables([], v)).toEqual({});
    expect(nameAndLinkVariables(null, v)).toEqual({});
  });
});
