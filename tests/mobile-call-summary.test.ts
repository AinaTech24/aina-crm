import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), tenant: vi.fn(), config: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/db/client", () => ({ withTenant: mocks.tenant }));
vi.mock("@/lib/ai/provider", () => ({ loadAiConfig: mocks.config }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit }));
vi.mock("@/lib/api/error-handler", () => ({ handleApiError: () => new Response(null, { status: 500 }) }));
vi.mock("@/lib/rate-limit", () => ({ enforceKeyed: () => null }));
import { GET, POST } from "@/app/api/mobile/call-summary/route";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ tenantId: id, userId: id, roles: ["rm"] }); });
describe("consented call audio", () => {
  it("reports missing audio configuration before asking for a recording", async () => {
    vi.stubEnv("GEMINI_AUDIO_API_KEY", ""); vi.stubEnv("GEMINI_AUDIO_MODEL", "");
    mocks.config.mockResolvedValue({ provider: "anthropic", apiKey: "private-test-key", fastModel: "text-only" });
    try {
      const response = await GET(); const body = await response.json();
      expect(body.ready).toBe(false); expect(JSON.stringify(body)).not.toContain("private-test-key");
      expect(mocks.tenant).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("reports configured audio without disclosing provider credentials", async () => {
    vi.stubEnv("GEMINI_AUDIO_API_KEY", "private-test-key"); vi.stubEnv("GEMINI_AUDIO_MODEL", "audio-test-model");
    mocks.config.mockResolvedValue({ provider: "anthropic" });
    try {
      const body = await (await GET()).json(); expect(body.ready).toBe(true);
      expect(JSON.stringify(body)).not.toContain("private-test-key");
    } finally { vi.unstubAllEnvs(); }
  });
  it("does not read client data or call AI without participant confirmation", async () => {
    const form = new FormData(); form.set("activityId", id);
    const response = await POST(new Request("https://crm.test/api/mobile/call-summary", { method: "POST", body: form }));
    expect(response.status).toBe(400); expect(mocks.tenant).not.toHaveBeenCalled(); expect(mocks.config).not.toHaveBeenCalled();
  });
  it("denies roles outside the staff app", async () => {
    mocks.session.mockResolvedValue({ tenantId: id, userId: id, roles: ["investor"] });
    expect((await POST(new Request("https://crm.test/api/mobile/call-summary", { method: "POST" }))).status).toBe(403);
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it("does not process audio for an inaccessible call", async () => {
    mocks.tenant.mockResolvedValue(null);
    const form = new FormData(); form.set("activityId", id); form.set("participantConsent", "confirmed");
    form.set("audio", new Blob([new Uint8Array(20)], { type: "audio/wav" }), "call.wav");
    expect((await POST(new Request("https://crm.test/api/mobile/call-summary", { method: "POST", body: form }))).status).toBe(404);
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
