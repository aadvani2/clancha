/**
 * Number-pool allocation rule (M4 tracker #105).
 *
 * Confirms in code the rule Craig asked us to confirm in plain terms:
 *   - a user's FIRST channel lands on the first pool number, their SECOND on
 *     the next number, their THIRD on the one after — i.e. walked in pool order;
 *   - a single user NEVER gets two channels on the same number;
 *   - one number IS shared across different users (user B's first channel
 *     reuses the first number);
 *   - inactive numbers are skipped;
 *   - allocation fails (null) once a user occupies every active number.
 *
 * reserveNumber() takes a session; on the standalone in-memory Mongo we create
 * a session without a transaction (transactions need a replica set, but the
 * reads work fine with a plain session).
 */
import {
  describe, it, expect, beforeAll, afterAll, afterEach,
} from "vitest";
import mongoose from "mongoose";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { PhoneNumber, Channel, User } from "@/lib/db/models";
import { createUserData, createChannelData } from "@/tests/helpers/fixtures";
import { reserveNumber } from "@/lib/services/numberPool";

const N1 = "+447900000001";
const N2 = "+447900000002";
const N3 = "+447900000003";

/**
 * Seed the pool with explicit, strictly-increasing createdAt so allocation
 * order (oldest first) is deterministic — N1 is "number 1", N2 "number 2", etc.
 */
async function seedPool(numbers: string[]) {
  const base = Date.now() - numbers.length * 1000;
  for (let i = 0; i < numbers.length; i++) {
    const doc = await PhoneNumber.create({ number: numbers[i], isActive: true });
    await PhoneNumber.collection.updateOne(
      { _id: doc._id },
      { $set: { createdAt: new Date(base + i * 1000) } }
    );
  }
}

async function makeUser() {
  return User.create(createUserData({ role: "user" }));
}

async function giveChannel(userId: mongoose.Types.ObjectId, clanchaNumber: string) {
  return Channel.create(
    createChannelData({
      users: [userId, new mongoose.Types.ObjectId()],
      clanchaNumber,
      state: "active",
    })
  );
}

describe("numberPool.reserveNumber — allocation rule (#105)", () => {
  let session: mongoose.ClientSession;

  beforeAll(async () => {
    await setupTestDatabase();
    session = await mongoose.startSession();
  });
  afterAll(async () => {
    await session.endSession();
    await teardownTestDatabase();
  });
  afterEach(async () => {
    await clearTestDatabase();
  });

  it("allocates a user's channels in pool order: 1st→#1, 2nd→#2, 3rd→#3 (never the same number twice)", async () => {
    await seedPool([N1, N2, N3]);
    const userA = await makeUser();
    const id = userA._id as mongoose.Types.ObjectId;

    const first = await reserveNumber(session, id.toString());
    expect(first?.number).toBe(N1);
    await giveChannel(id, first!.number);

    const second = await reserveNumber(session, id.toString());
    expect(second?.number).toBe(N2);
    await giveChannel(id, second!.number);

    const third = await reserveNumber(session, id.toString());
    expect(third?.number).toBe(N3);
    await giveChannel(id, third!.number);

    // All three are distinct — no user ever has two channels on one number.
    const assigned = [first!.number, second!.number, third!.number];
    expect(new Set(assigned).size).toBe(3);
  });

  it("shares a number across different users — user B's first channel reuses #1", async () => {
    await seedPool([N1, N2, N3]);
    const userA = await makeUser();
    const userB = await makeUser();

    // User A fills all three.
    await giveChannel(userA._id as mongoose.Types.ObjectId, N1);
    await giveChannel(userA._id as mongoose.Types.ObjectId, N2);
    await giveChannel(userA._id as mongoose.Types.ObjectId, N3);

    // User B starts from the top of the same pool — first number again.
    const b1 = await reserveNumber(session, (userB._id as mongoose.Types.ObjectId).toString());
    expect(b1?.number).toBe(N1);
  });

  it("skips inactive numbers", async () => {
    await seedPool([N1, N2, N3]);
    await PhoneNumber.updateOne({ number: N2 }, { $set: { isActive: false } });
    const userA = await makeUser();
    const id = userA._id as mongoose.Types.ObjectId;

    const first = await reserveNumber(session, id.toString());
    expect(first?.number).toBe(N1);
    await giveChannel(id, first!.number);

    // N2 is inactive, so the second channel skips to N3.
    const second = await reserveNumber(session, id.toString());
    expect(second?.number).toBe(N3);
  });

  it("returns null when the user already occupies every active number", async () => {
    await seedPool([N1, N2]);
    const userA = await makeUser();
    const id = userA._id as mongoose.Types.ObjectId;

    await giveChannel(id, N1);
    await giveChannel(id, N2);

    const none = await reserveNumber(session, id.toString());
    expect(none).toBeNull();
  });
});
