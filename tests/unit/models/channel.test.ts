import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mongoose from "mongoose";
import { Channel, CHANNEL_STATES } from "@/lib/db/models/channel";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearTestDatabase,
} from "@/tests/helpers/db";
import { createChannelData, generateObjectId } from "@/tests/helpers/fixtures";

describe("Channel model", () => {
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
    it("should create a channel with valid data", async () => {
      const channelData = createChannelData();
      const channel = new Channel(channelData);
      const saved = await channel.save();
      expect(saved._id).toBeDefined();
      expect(saved.users.length).toBe(2);
      expect(saved.state).toBe("trial");
    });

    it("should require exactly 2 users", async () => {
      const channelWith1User = new Channel({
        users: [generateObjectId()],
        clanchaNumber: "+15551234567",
      });
      await expect(channelWith1User.save()).rejects.toThrow();

      const channelWith3Users = new Channel({
        users: [generateObjectId(), generateObjectId(), generateObjectId()],
        clanchaNumber: "+15551234567",
      });
      await expect(channelWith3Users.save()).rejects.toThrow();
    });

    it("should require clanchaNumber", async () => {
      const channel = new Channel({
        users: [generateObjectId(), generateObjectId()],
      });
      await expect(channel.save()).rejects.toThrow();
    });

    it("should validate state enum values", async () => {
      const channel = new Channel({
        users: [generateObjectId(), generateObjectId()],
        clanchaNumber: "+15551234567",
        state: "invalid_state" as any,
      });
      await expect(channel.save()).rejects.toThrow();
    });

    it("should accept all valid states", async () => {
      for (const state of CHANNEL_STATES) {
        const channel = new Channel({
          users: [generateObjectId(), generateObjectId()],
          clanchaNumber: `+1555${Math.random().toString().slice(2, 9)}`,
          state,
        });
        const saved = await channel.save();
        expect(saved.state).toBe(state);
      }
    });
  });

  describe("defaults", () => {
    it("should default state to trial", async () => {
      const channel = await new Channel(createChannelData({ state: undefined })).save();
      expect(channel.state).toBe("trial");
    });

    it("should default pictureShareEnabled to false", async () => {
      const channel = await new Channel(createChannelData()).save();
      expect(channel.pictureShareEnabled).toBe(false);
    });

    it("should default emergencyBypassEnabled to true", async () => {
      const channel = await new Channel(createChannelData()).save();
      expect(channel.emergencyBypassEnabled).toBe(true);
    });
  });

  describe("timestamps", () => {
    it("should auto-populate createdAt and updatedAt", async () => {
      const channel = await new Channel(createChannelData()).save();
      expect(channel.createdAt).toBeInstanceOf(Date);
      expect(channel.updatedAt).toBeInstanceOf(Date);
    });
  });
});
