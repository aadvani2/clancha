import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => {
  const MockOpenAI = vi.fn(function (this: any) {
    this.chat = { completions: { create: createMock } };
  });
  return { default: MockOpenAI };
});

vi.mock("@/lib/services/promptStore", () => ({
  getActivePrompt: vi.fn(async (key: string) => {
    if (key === "rewrite_system") return "REWRITE_SYSTEM {{TONE_INSTRUCTION}}";
    if (key === "classify_system") return "CLASSIFY_SYSTEM";
    if (key === "tone_calm_clear") return "TONE_CALM_CLEAR";
    if (key === "tone_firm_fair") return "TONE_FIRM_FAIR";
    return "";
  }),
}));

beforeEach(() => {
  createMock.mockReset();
  process.env.OPENAI_API_KEY_DEMO = "test-key";
  vi.resetModules();
});

function mockClassifyResponse(classification: string, tags: string[] = []) {
  createMock.mockResolvedValueOnce({
    choices: [
      {
        message: { content: JSON.stringify({ classification, tags }) },
      },
    ],
  });
}

function mockRewriteResponse(content: string) {
  createMock.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

describe("classifyAndRewrite — routing behaviour (client feedback 2026-05-19)", () => {
  it("classifier 'unsafe' returns immediately without calling the rewriter (no invention risk)", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("unsafe", ["DirectedAttack"]);

    const result = await classifyAndRewrite(
      "You're a [hypothetical insult that passes safeguard].",
      "calm_clear",
      false
    );

    expect(result.classification).toBe("unsafe");
    expect(result.rewrittenText).toBeNull();
    expect(result.violationTags).toEqual(["DirectedAttack"]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("safeguard catches pure dismissal before the LLM ever runs", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");

    const result = await classifyAndRewrite("Fuck off.", "calm_clear", false);

    expect(result.classification).toBe("unsafe");
    expect(result.rewrittenText).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rewriter sentinel converts to classification='uncertain' so pipeline routes to held", async () => {
    const { classifyAndRewrite, HOLD_SENTINEL } = await import("@/lib/services/openai");
    mockClassifyResponse("safe", []);
    mockRewriteResponse(HOLD_SENTINEL);

    const result = await classifyAndRewrite(
      "edge-case input that passes safeguard but rewriter cannot soften",
      "calm_clear",
      false
    );

    expect(result.classification).toBe("uncertain");
    expect(result.rewrittenText).toBeNull();
    expect(result.violationTags).toContain("RewriterInventedContent");
    expect(result.flags).toContain("RewriterInventedContent");
  });

  it("invented-content output ('Please refrain...') is intercepted and routed to held", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("safe", []);
    mockRewriteResponse("Please refrain from using that language.");

    const result = await classifyAndRewrite(
      "edge-case input that triggers system-voice output",
      "calm_clear",
      false
    );

    expect(result.classification).toBe("uncertain");
    expect(result.rewrittenText).toBeNull();
    expect(result.violationTags).toContain("RewriterInventedContent");
  });

  it("invented-content output ('I have serious concerns about your behaviour') is intercepted", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("safe", []);
    mockRewriteResponse("I have serious concerns about your behaviour.");

    const result = await classifyAndRewrite(
      "edge-case input that triggers system-voice output",
      "calm_clear",
      false
    );

    expect(result.classification).toBe("uncertain");
    expect(result.rewrittenText).toBeNull();
  });

  it("normal rewrite of a real proposition is delivered as 'safe'", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("safe", []);
    mockRewriteResponse("I disagree with your parenting approach.");

    const result = await classifyAndRewrite(
      "You never help with homework. It's typical.",
      "calm_clear",
      false
    );

    expect(result.classification).toBe("safe");
    expect(result.rewrittenText).toBe("I disagree with your parenting approach.");
    expect(result.violationTags).toEqual([]);
  });

  it("classifier 'uncertain' still triggers rewrite (rewrite is discarded by pipeline anyway)", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("uncertain", ["CodedThreat"]);
    mockRewriteResponse("Watch your step.");

    const result = await classifyAndRewrite(
      "you'll regret this",
      "calm_clear",
      false
    );

    expect(result.classification).toBe("uncertain");
    expect(result.rewrittenText).toBe("Watch your step.");
    expect(result.violationTags).toEqual(["CodedThreat"]);
  });

  it("uses gpt-5.4-mini for both classifier and rewriter", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("safe", []);
    mockRewriteResponse("Rewritten.");

    await classifyAndRewrite("a calm message about logistics", "calm_clear", false);

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].model).toBe("gpt-5.4-mini");
    expect(createMock.mock.calls[1][0].model).toBe("gpt-5.4-mini");
  });

  it("wraps rewriter input in DRAFT_MESSAGE_START/END plus literal quotes", async () => {
    const { classifyAndRewrite } = await import("@/lib/services/openai");
    mockClassifyResponse("safe", []);
    mockRewriteResponse("Rewritten.");

    await classifyAndRewrite("hello there", "calm_clear", false);

    const rewriteCallContent = createMock.mock.calls[1][0].messages[1].content;
    expect(rewriteCallContent).toContain("DRAFT_MESSAGE_START");
    expect(rewriteCallContent).toContain("DRAFT_MESSAGE_END");
    expect(rewriteCallContent).toContain('"hello there"');
  });
});
