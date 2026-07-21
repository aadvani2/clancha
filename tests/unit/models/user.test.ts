import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mongoose from "mongoose";
import { User, USER_ROLES } from "@/lib/db/models/user";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearTestDatabase,
} from "@/tests/helpers/db";
import { createUserData, generatePhone, generateEmail } from "@/tests/helpers/fixtures";

describe("User model", () => {
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
    it("should create a user with valid data", async () => {
      const userData = createUserData();
      const user = new User(userData);
      const savedUser = await user.save();
      expect(savedUser._id).toBeDefined();
      expect(savedUser.phone).toBe(userData.phone);
      expect(savedUser.email).toBe(userData.email);
      expect(savedUser.role).toBe("user");
    });

    it("should require phone field", async () => {
      const user = new User({ email: generateEmail() });
      await expect(user.save()).rejects.toThrow();
    });

    it("should allow creating a user without email (email is optional)", async () => {
      const user = new User({ phone: generatePhone() });
      const saved = await user.save();
      expect(saved._id).toBeDefined();
      expect(saved.email).toBeUndefined();
    });

    it("should enforce unique phone", async () => {
      const phone = generatePhone();
      await new User({ phone, email: generateEmail() }).save();
      const duplicate = new User({ phone, email: generateEmail() });
      await expect(duplicate.save()).rejects.toThrow();
    });

    it("should enforce unique email", async () => {
      const email = generateEmail();
      const first = await new User({ phone: generatePhone(), email }).save();
      // Ensure index is created
      await User.createIndexes();
      const duplicate = new User({ phone: generatePhone(), email });
      await expect(duplicate.save()).rejects.toThrow();
    });

    it("should validate role enum values", async () => {
      const user = new User({
        phone: generatePhone(),
        email: generateEmail(),
        role: "invalid_role" as any,
      });
      await expect(user.save()).rejects.toThrow();
    });

    it("should accept all valid roles", async () => {
      for (const role of USER_ROLES) {
        const user = new User({
          phone: generatePhone(),
          email: generateEmail(),
          role,
        });
        const saved = await user.save();
        expect(saved.role).toBe(role);
      }
    });

    it("should default role to user", async () => {
      const user = new User({
        phone: generatePhone(),
        email: generateEmail(),
      });
      const saved = await user.save();
      expect(saved.role).toBe("user");
    });
  });

  describe("timestamps", () => {
    it("should auto-populate createdAt and updatedAt", async () => {
      const user = await new User(createUserData()).save();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it("should update updatedAt on modification", async () => {
      const user = await new User(createUserData()).save();
      const originalUpdatedAt = user.updatedAt;
      await new Promise((r) => setTimeout(r, 10));
      user.email = generateEmail();
      await user.save();
      expect(user.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
});
