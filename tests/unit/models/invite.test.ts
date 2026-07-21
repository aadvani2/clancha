import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mongoose from "mongoose";
import { Invite, INVITE_STATUSES, ACCESS_LEVELS } from "@/lib/db/models/invite";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearTestDatabase,
} from "@/tests/helpers/db";
import { generateObjectId } from "@/tests/helpers/fixtures";

describe("Invite model", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabase();
  });

  const createValidInvite = () => ({
    channelId: generateObjectId(),
    invitedByUserId: generateObjectId(),
    email: "test@example.com",
    tokenHash: "abc123hash",
    accessLevel: "read_only" as const,
    status: "pending" as const,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  });

  describe("schema validation", () => {
    it("should create an invite with valid data", async () => {
      const invite = new Invite(createValidInvite());
      const saved = await invite.save();
      expect(saved._id).toBeDefined();
      expect(saved.email).toBe("test@example.com");
      expect(saved.status).toBe("pending");
    });

    it("should require channelId", async () => {
      const data = createValidInvite();
      delete (data as any).channelId;
      const invite = new Invite(data);
      await expect(invite.save()).rejects.toThrow();
    });

    it("should require invitedByUserId", async () => {
      const data = createValidInvite();
      delete (data as any).invitedByUserId;
      const invite = new Invite(data);
      await expect(invite.save()).rejects.toThrow();
    });

    it("should require email", async () => {
      const data = createValidInvite();
      delete (data as any).email;
      const invite = new Invite(data);
      await expect(invite.save()).rejects.toThrow();
    });

    it("should require tokenHash", async () => {
      const data = createValidInvite();
      delete (data as any).tokenHash;
      const invite = new Invite(data);
      await expect(invite.save()).rejects.toThrow();
    });

    it("should require expiresAt", async () => {
      const data = createValidInvite();
      delete (data as any).expiresAt;
      const invite = new Invite(data);
      await expect(invite.save()).rejects.toThrow();
    });

    it("should validate status enum values", async () => {
      const invite = new Invite({
        ...createValidInvite(),
        status: "invalid_status" as any,
      });
      await expect(invite.save()).rejects.toThrow();
    });

    it("should accept all valid statuses", async () => {
      for (const status of INVITE_STATUSES) {
        const invite = new Invite({
          ...createValidInvite(),
          tokenHash: `hash-${status}`,
          status,
        });
        const saved = await invite.save();
        expect(saved.status).toBe(status);
      }
    });

    it("should validate accessLevel enum values", async () => {
      const invite = new Invite({
        ...createValidInvite(),
        accessLevel: "invalid_level" as any,
      });
      await expect(invite.save()).rejects.toThrow();
    });

    it("should accept all valid access levels", async () => {
      for (const level of ACCESS_LEVELS) {
        const invite = new Invite({
          ...createValidInvite(),
          tokenHash: `hash-${level}`,
          accessLevel: level,
        });
        const saved = await invite.save();
        expect(saved.accessLevel).toBe(level);
      }
    });

    it("should lowercase email", async () => {
      const invite = new Invite({
        ...createValidInvite(),
        email: "TEST@EXAMPLE.COM",
      });
      const saved = await invite.save();
      expect(saved.email).toBe("test@example.com");
    });
  });

  describe("defaults", () => {
    it("should default accessLevel to read_only", async () => {
      const data = createValidInvite();
      delete (data as any).accessLevel;
      const invite = await new Invite(data).save();
      expect(invite.accessLevel).toBe("read_only");
    });

    it("should default status to pending", async () => {
      const data = createValidInvite();
      delete (data as any).status;
      const invite = await new Invite(data).save();
      expect(invite.status).toBe("pending");
    });
  });

  describe("timestamps", () => {
    it("should auto-populate createdAt and updatedAt", async () => {
      const invite = await new Invite(createValidInvite()).save();
      expect(invite.createdAt).toBeInstanceOf(Date);
      expect(invite.updatedAt).toBeInstanceOf(Date);
    });
  });
});
