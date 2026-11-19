import { describe, expect, it } from "vitest";
import { mailAttachment, mailView } from "@/lib/rta/inbound-archive";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const raw = Buffer.from(
  [
    "From: CAMS <donotreply@camsonline.com>",
    "To: rta-abc@crm.ainatech.in",
    "Cc: Ops <ops@firm.in>",
    "Subject: NIGO list: Applications rejected on 18-Nov-2026",
    "Date: Wed, 19 Nov 2026 17:53:00 +0530",
    "Message-ID: <x1@mx.example>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="MIX"',
    "",
    "--MIX",
    'Content-Type: multipart/related; boundary="REL"',
    "",
    "--REL",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>Dear Partner,</p><img src="cid:logo1"><img src="https://tracker.example/p.gif"><script>alert(1)</script><a href="https://camsonline.com">CAMS</a>',
    "--REL",
    "Content-Type: image/png",
    "Content-ID: <logo1>",
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: base64",
    "",
    b64(PNG),
    "--REL--",
    "--MIX",
    'Content-Type: application/zip; name="Nigo_H_ARN173086_18-Nov-2026.zip"',
    'Content-Disposition: attachment; filename="Nigo_H_ARN173086_18-Nov-2026.zip"',
    "Content-Transfer-Encoding: base64",
    "",
    b64("PK-zip-bytes"),
    "--MIX--",
    "",
  ].join("\r\n")
);

describe("inbound mail viewer", () => {
  it("reads the headers", async () => {
    const v = await mailView(raw);
    expect(v.subject).toBe("NIGO list: Applications rejected on 18-Nov-2026");
    expect(v.from).toEqual([{ name: "CAMS", address: "donotreply@camsonline.com" }]);
    expect(v.to[0].address).toBe("rta-abc@crm.ainatech.in");
    expect(v.cc[0]).toEqual({ name: "Ops", address: "ops@firm.in" });
    expect(v.date).toBe("2026-11-19T12:23:00.000Z");
  });

  it("wraps the HTML in a page that runs no script and loads nothing remote", async () => {
    const v = await mailView(raw);
    expect(v.htmlDoc).toContain("Content-Security-Policy");
    expect(v.htmlDoc).toContain("default-src 'none'; img-src data:");
    expect(v.htmlDoc).not.toContain("cid:logo1"); // inline image became a data: URI
    expect(v.htmlDoc).toContain("data:image/png;base64,");
    expect(v.blockedRemote).toBe(true); // the tracker pixel is not loaded
    expect(v.htmlDoc).toContain('<base target="_blank">');
  });

  it("lists the attachments and hands back each one's bytes", async () => {
    const v = await mailView(raw);
    const zip = v.attachments.find((a) => a.filename.endsWith(".zip"))!;
    expect(zip).toMatchObject({ filename: "Nigo_H_ARN173086_18-Nov-2026.zip", contentType: "application/zip", inline: false });
    const a = await mailAttachment(raw, zip.index);
    expect(a?.content.toString()).toBe("PK-zip-bytes");
    expect(v.attachments.find((x) => x.inline)?.contentType).toBe("image/png");
    expect(await mailAttachment(raw, 99)).toBeNull();
  });

  it("shows a text-only mail as text", async () => {
    const v = await mailView(Buffer.from("From: a@b.in\r\nSubject: Hi\r\nContent-Type: text/plain\r\n\r\nPlain body\r\n"));
    expect(v.htmlDoc).toBeNull();
    expect(v.text?.trim()).toBe("Plain body");
    expect(v.attachments).toEqual([]);
  });
});
