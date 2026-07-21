import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mongoose from "mongoose";
import { Message, MESSAGE_STATES } from "@/lib/db/models/message";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearTestDatabase,
} from "@/tests/helpers/db";
import { createMessageData, generateObjectId } from "@/tests/helpers/fixtures";

describe("Message model", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabase();
  });

  describe("schema validation", () => {
    it("should create a message with valid data", async () => {
      const messageData = createMessageData();
      const message = new Message(messageData);
      const saved = await message.save();
      expect(saved._id).toBeDefined();
      expect(saved.originalText).toBe(messageData.originalText);
      expect(saved.rewrittenText).toBe(messageData.rewrittenText);
    });

    it("should require channelId", async () => {
      const data = createMessageData();
      delete (data as any).channelId;
      const message = new Message(data);
      await expect(message.save()).rejects.toThrow();
    });

    it("allows a message with no senderId (system message)", async () => {
      // Schema relaxed for system messages (A1–A16) which have no human
      // sender — `senderId` defaults to null and is rendered as a neutral
      // "Clancha" row in the timeline.
      const data = createMessageData();
      delete (data as any).senderId;
      const message = new Message(data);
      const saved = await message.save();
      expect(saved.senderId).toBeNull();
    });

    it("should require originalText", async () => {
      const data = createMessageData();
      delete (data as any).originalText;
      const message = new Message(data);
      await expect(message.save()).rejects.toThrow();
    });

    it("should require rewrittenText", async () => {
      const data = createMessageData();
      delete (data as any).rewrittenText;
      const message = new Message(data);
      await expect(message.save()).rejects.toThrow();
    });

    it("should validate state enum values", async () => {
      const message = new Message({
        ...createMessageData(),
        state: "invalid_state" as any,
      });
      await expect(message.save()).rejects.toThrow();
    });

    it("should accept all valid states", async () => {
      for (const state of MESSAGE_STATES) {
        const message = new Message({
          ...createMessageData(),
          state,
        });
        const saved = await message.save();
        expect(saved.state).toBe(state);
      }
    });
  });

  describe("defaults", () => {
    it("should default state to received", async () => {
      const data = createMessageData();
      delete (data as any).state;
      const message = await new Message(data).save();
      expect(message.state).toBe("received");
    });

    it("should default isEmergency to false", async () => {
      const data = createMessageData();
      delete (data as any).isEmergency;
      const message = await new Message(data).save();
      expect(message.isEmergency).toBe(false);
    });

    it("should default deliveredAt to null", async () => {
      const data = createMessageData();
      data.deliveredAt = undefined;
      const message = await new Message(data).save();
      expect(message.deliveredAt).toBeNull();
    });
  });

  describe("timestamps", () => {
    it("should auto-populate createdAt and updatedAt", async () => {
      const message = await new Message(createMessageData()).save();
      expect(message.createdAt).toBeInstanceOf(Date);
      expect(message.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("optional fields", () => {
    it("should allow moderatorId to be set", async () => {
      const moderatorId = generateObjectId();
      const message = await new Message({
        ...createMessageData(),
        moderatorId,
      }).save();
      expect(message.moderatorId?.toString()).toBe(moderatorId.toString());
    });

    it("should allow moderatorNotes to be set", async () => {
      const message = await new Message({
        ...createMessageData(),
        moderatorNotes: "Test notes",
      }).save();
      expect(message.moderatorNotes).toBe("Test notes");
    });
  });
});
