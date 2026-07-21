import { describe, it, expect } from "vitest";
import { hasFabricatedQuote } from "@/lib/services/qaFabrication";

// Regression test for Craig M4 tracker #32/#33 — Q&A returned a quoted
// utterance ("I'll be at Link Club around 6pm. I'll pop by yours first to
// pick up his trainers.") that didn't appear anywhere in the rendered
// message history. The fabrication detector is the load-bearing defence.

describe("hasFabricatedQuote", () => {
  const context = [
    "[2026-05-19T10:00:00.000Z] Sam: Pickup confirmed for 6pm Friday.",
    "[2026-05-19T11:00:00.000Z] Alex: I'll bring the football kit too.",
    "[2026-05-19T12:00:00.000Z] Sam: Great, see you then.",
  ].join("\n");

  it("returns true when an answer attributes a quote that isn't in context", () => {
    const answer = "Sam said \"I'll be at Link Club around 6pm and pop by yours first\".";
    expect(hasFabricatedQuote(answer, context)).toBe(true);
  });

  it("returns false when the answer has no quotation marks at all", () => {
    const answer = "Sam confirmed pickup at 6pm on Friday.";
    expect(hasFabricatedQuote(answer, context)).toBe(false);
  });

  it("returns false when a quoted phrase appears verbatim in context", () => {
    const answer = "Yes, Sam wrote \"Pickup confirmed for 6pm Friday\".";
    expect(hasFabricatedQuote(answer, context)).toBe(false);
  });

  it("ignores short quoted spans (single words like names)", () => {
    const answer = "The handover was confirmed by \"Sam\".";
    expect(hasFabricatedQuote(answer, context)).toBe(false);
  });

  it("catches smart-quote fabrication (curly quotes)", () => {
    const answer = "Sam said “I'll meet you at the cafe at 7”.";
    expect(hasFabricatedQuote(answer, context)).toBe(true);
  });

  it("normalises whitespace and case before comparing", () => {
    const answer = "Quote: \"pickup confirmed for   6PM friday\".";
    expect(hasFabricatedQuote(answer, context)).toBe(false);
  });

  it("blocks fabricated quotes even when wrapped in a refusal-style sentence", () => {
    const answer = "It looks like Alex said \"I will not be there at all\".";
    expect(hasFabricatedQuote(answer, context)).toBe(true);
  });
});
