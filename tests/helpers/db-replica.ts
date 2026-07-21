/**
 * Test DB helper using a replica set to support MongoDB transactions.
 * Use this for tests that involve mongoose sessions/transactions.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let replSet: MongoMemoryReplSet | null = null;

// Collections used by transaction-heavy tests. Pre-creating them avoids
// "catalog changes" TransientTransactionErrors when collections are first
// created just before a transaction tries to write to them.
const COLLECTIONS_TO_PRECREATE = [
  "users",
  "channels",
  "subscriptions",
  "phonenumbers",
  "pendingchannelrequests",
  "userchannelpreferences",
];

export async function setupReplicaDatabase(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  // Pre-create all collections so their catalog entries exist before any
  // transaction runs. Transactions in MongoDB fail with "catalog changes" if
  // they write to a collection that was created during the transaction.
  for (const name of COLLECTIONS_TO_PRECREATE) {
    try {
      await mongoose.connection.createCollection(name);
    } catch {
      // Collection already exists – that's fine.
    }
  }
}

export async function teardownReplicaDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

export async function clearReplicaDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}
