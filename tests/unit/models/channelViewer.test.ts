import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mongoose from "mongoose";
import {
  ChannelViewer,
  VIEWER_STATUSES,
} from "@/lib/db/models/channelViewer";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearTestDatabase,
} from "@/tests/helpers/db";
import { generateObjectId } from "@/tests/helpers/fixtures";

describe("ChannelViewer model", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabase();
  });

  const createValidViewer = () => ({
    channelId: generateObjectId(),
    userId: generateObjectId(),
    inviteId: generateObjectId(),
    accessLevel: "read_only" as const,
    status: "active" as const,
    grantedByUserId: generateObjectId(),
  });

  describe("schema validation", () => {
    it("should create a viewer with valid data", async () => {
      const viewer = new ChannelViewer(createValidViewer());
      const saved = await viewer.save();
      expect(saved._id).toBeDefined();
      expect(saved.status).toBe("active");
    });

    it("should require channelId", async () => {
      const data = createValidViewer();
      delete (data as any).channelId;
      const viewer = new ChannelViewer(data);
      await expect(viewer.save()).rejects.toThrow();
    });

    it("should require userId", async () => {
      const data = createValidViewer();
      delete (data as any).userId;
      const viewer = new ChannelViewer(data);
      await expect(viewer.save()).rejects.toThrow();
    });

    it("should require inviteId", async () => {
      const data = createValidViewer();
      delete (data as any).inviteId;
      const viewer = new ChannelViewer(data);
      await expect(viewer.save()).rejects.toThrow();
    });

    it("should require grantedByUserId", async () => {
      const data = createValidViewer();
      delete (data as any).grantedByUserId;
      const viewer = new ChannelViewer(data);
      await expect(viewer.save()).rejects.toThrow();
    });

    it("should validate status enum values", async () => {
      const viewer = new ChannelViewer({
        ...createValidViewer(),
        status: "invalid_status" as any,
      });
      await expect(viewer.save()).rejects.toThrow();
    });

    it("should accept all valid statuses", async () => {
      for (const status of VIEWER_STATUSES) {
        const viewer = new ChannelViewer({
          ...createValidViewer(),
          userId: generateObjectId(),
          channelId: generateObjectId(),
          status,
        });
        const saved = await viewer.save();
        expect(saved.status).toBe(status);
      }
    });

    it("should validate accessLevel values", async () => {
      const viewer = new ChannelViewer({
        ...createValidViewer(),
        accessLevel: "invalid_level" as any,
      });
      await expect(viewer.save()).rejects.toThrow();
    });
  });

  describe("defaults", () => {
    it("should default accessLevel to read_only", async () => {
      const data = createValidViewer();
      delete (data as any).accessLevel;
      const viewer = await new ChannelViewer(data).save();
      expect(viewer.accessLevel).toBe("read_only");
    });

    it("should default status to active", async () => {
      const data = createValidViewer();
      delete (data as any).status;
      const viewer = await new ChannelViewer(data).save();
      expect(viewer.status).toBe("active");
    });
  });

  describe("unique constraints", () => {
    it("should enforce unique channelId + userId combination", async () => {
      const channelId = generateObjectId();
      const userId = generateObjectId();

      await new ChannelViewer({
        ...createValidViewer(),
        channelId,
        userId,
      }).save();

      await ChannelViewer.createIndexes();

      const duplicate = new ChannelViewer({
        ...createValidViewer(),
        channelId,
        userId,
      });
      await expect(duplicate.save()).rejects.toThrow();
    });
  });

  describe("timestamps", () => {
    it("should auto-populate createdAt and updatedAt", async () => {
      const viewer = await new ChannelViewer(createValidViewer()).save();
      expect(viewer.createdAt).toBeInstanceOf(Date);
      expect(viewer.updatedAt).toBeInstanceOf(Date);
    });
  });
});
