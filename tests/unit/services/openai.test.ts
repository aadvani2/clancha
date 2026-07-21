import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the OpenAI module – must be a proper constructor (class/function, not arrow fn)
vi.mock("openai", () => {
  const MockOpenAI = vi.fn(function (this: any, { apiKey }: { apiKey: string }) {
    this._apiKey = apiKey;
    this.chat = { completions: { create: vi.fn() } };
  });
  return { default: MockOpenAI };
});

describe("OpenAI service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("getOpenAIClient", () => {
    it("should return null when no API key is configured", async () => {
      const originalDemo = process.env.OPENAI_API_KEY_DEMO;
      const originalLive = process.env.OPENAI_API_KEY_LIVE;
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY_DEMO;
      delete process.env.OPENAI_API_KEY_LIVE;
      delete process.env.OPENAI_API_KEY;

      vi.resetModules();
      const { getOpenAIClient } = await import("@/lib/services/openai");
      const client = getOpenAIClient();
      expect(client).toBeNull();

      process.env.OPENAI_API_KEY_DEMO = originalDemo;
      process.env.OPENAI_API_KEY_LIVE = originalLive;
      process.env.OPENAI_API_KEY = originalKey;
    });

    it("should return a client when OPENAI_API_KEY_DEMO is set", async () => {
      delete process.env.OPENAI_API_KEY_LIVE;
      process.env.OPENAI_API_KEY_DEMO = "test-demo-key";

      vi.resetModules();
      const { getOpenAIClient } = await import("@/lib/services/openai");
      const client = getOpenAIClient();
      expect(client).not.toBeNull();

      delete process.env.OPENAI_API_KEY_DEMO;
    });

    it("should prefer OPENAI_API_KEY_LIVE over OPENAI_API_KEY_DEMO", async () => {
      process.env.OPENAI_API_KEY_LIVE = "live-key";
      process.env.OPENAI_API_KEY_DEMO = "demo-key";

      vi.resetModules();
      const { default: MockOpenAI } = await import("openai");
      const { getOpenAIClient } = await import("@/lib/services/openai");
      getOpenAIClient();

      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: "live-key" });

      delete process.env.OPENAI_API_KEY_LIVE;
      delete process.env.OPENAI_API_KEY_DEMO;
    });

    it("should reuse the same client instance when key has not changed", async () => {
      process.env.OPENAI_API_KEY_DEMO = "stable-key";
      vi.resetModules();
      const { getOpenAIClient } = await import("@/lib/services/openai");

      const client1 = getOpenAIClient();
      const client2 = getOpenAIClient();
      expect(client1).toBe(client2);

      delete process.env.OPENAI_API_KEY_DEMO;
    });

    it("should create a new client when the API key changes", async () => {
      process.env.OPENAI_API_KEY_DEMO = "key-v1";
      vi.resetModules();
      const { getOpenAIClient } = await import("@/lib/services/openai");

      const client1 = getOpenAIClient();
      process.env.OPENAI_API_KEY_DEMO = "key-v2";
      const client2 = getOpenAIClient();
      expect(client1).not.toBe(client2);

      delete process.env.OPENAI_API_KEY_DEMO;
    });
  });
});
