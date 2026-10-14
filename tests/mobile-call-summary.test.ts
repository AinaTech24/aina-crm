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
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.session.mockResolvedValue({ tenantId: id, userId: id, roles: ["rm"] }); });
describe("consented call audio", () => {
  const audioRequest = (language = "auto") => {
    const bytes = new Uint8Array(40); bytes.set(new TextEncoder().encode("RIFF"), 0); bytes.set(new TextEncoder().encode("WAVE"), 8);
    const form = new FormData(); form.set("activityId", id); form.set("participantConsent", "confirmed"); form.set("speechLanguage", language);
    form.set("audio", new Blob([bytes], { type: "audio/wav" }), "call.wav");
    return new Request("https://crm.test/api/mobile/call-summary", { method: "POST", body: form });
  };
  const configuredAudio = () => {
    vi.stubEnv("GEMINI_AUDIO_API_KEY", "private-test-key"); vi.stubEnv("GEMINI_AUDIO_MODEL", "audio-test-model");
    mocks.tenant.mockResolvedValue({ id });
  };
  it("does not mix a partially configured audio key with a global model", async () => {
    vi.stubEnv("GEMINI_AUDIO_API_KEY", "dedicated-key"); vi.stubEnv("GEMINI_AUDIO_MODEL", "");
    mocks.config.mockResolvedValue({ provider: "google", apiKey: "global-key", fastModel: "global-model" });
    expect((await (await GET()).json()).ready).toBe(false);
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it("rejects an unsupported language before reading client data or audio", async () => {
    expect((await POST(audioRequest("bad-input"))).status).toBe(400);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it("uses Gujarati as a bounded language hint and returns an English review draft", async () => {
    configuredAudio();
    const summary = { discussion: "SIP review", requirements: "Not discussed", products: "Mutual funds", objections: "Not discussed", nextSteps: "Employee to review" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(summary) }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(audioRequest("gu"));
    expect(response.status).toBe(200); expect((await response.json()).draft).toBe(true);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.systemInstruction.parts[0].text).toContain("Gujarati");
    expect(sent.systemInstruction.parts[0].text).toContain("in English");
    expect(sent.systemInstruction.parts[0].text).toContain("untrusted");
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("private-test-key");
  });
  it("returns a safe retryable error for malformed model output", async () => {
    configuredAudio();
    const malformedResponse = { candidates: [{ content: { parts: [{ text: "not JSON" }] } }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(malformedResponse))));
    const response = await POST(audioRequest()); expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private-test-key");
  });
  it("rejects an overlong summary instead of truncating amounts or proposed steps", async () => {
    configuredAudio();
    const summary = { discussion: "d".repeat(1100), requirements: "r".repeat(500), products: "p".repeat(400), objections: "o".repeat(500), nextSteps: "n".repeat(700) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(summary) }] } }] }))));
    expect((await POST(audioRequest())).status).toBe(502);
  });
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
