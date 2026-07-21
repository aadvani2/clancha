import { describe, it, expect } from "vitest";
import { toGsm7Safe } from "@/lib/messaging/gsm7";

describe("toGsm7Safe", () => {
  it("straightens curly quotes and apostrophes", () => {
    expect(toGsm7Safe("It’s “fine”, isn‘t it")).toBe(
      "It's \"fine\", isn't it"
    );
  });

  it("replaces en/em dashes with hyphens", () => {
    expect(toGsm7Safe("Clancha – hello — world")).toBe("Clancha - hello - world");
  });

  it("expands ellipsis and normalises exotic spaces", () => {
    expect(toGsm7Safe("wait… ok then")).toBe("wait... ok then");
  });

  it("leaves GSM-7-native characters alone (including £ and accents)", () => {
    const s = "£4.99 café naïve ok? (A-Z) 'quotes' \"double\"";
    expect(toGsm7Safe(s)).toBe(s);
  });

  it("is a no-op on plain ASCII", () => {
    const s = "Clancha: This message wasn't sent as it may breach Clancha's terms.";
    expect(toGsm7Safe(s)).toBe(s);
  });
});
