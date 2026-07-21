import connectDB from "@/lib/db/connect";
import { OutageSimulation } from "@/lib/db/models";

/**
 * Runtime check for the outage-simulation flags backing M4 tracker #57/#58.
 * Toggled from /admin/failures; injected at sendSms + classifyAndRewrite so
 * the existing failure paths (SmsOutbox retry / hold-for-moderation) light
 * up exactly as they would during a real outage.
 *
 * The flag is cached for 5s to avoid hitting Mongo on every outbound SMS or
 * rewrite call. 5s is short enough that Craig sees the toggle take effect
 * within a moderator-test cadence but long enough to keep the hot path off
 * the DB. Toggling via the admin API calls invalidateOutageCache() to make
 * the change visible immediately.
 */

interface CachedFlags {
  twilio: boolean;
  openai: boolean;
  cachedAt: number;
}

const CACHE_TTL_MS = 5_000;
let cache: CachedFlags | null = null;

export function invalidateOutageCache(): void {
  cache = null;
}

async function readFlags(): Promise<CachedFlags> {
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return cache;
  }
  try {
    await connectDB();
    const row = await OutageSimulation.findOne({}).lean();
    cache = {
      twilio: !!row?.twilioOutageActive,
      openai: !!row?.openaiOutageActive,
      cachedAt: Date.now(),
    };
  } catch {
    // If the flag read fails, behave as if no simulation is active rather
    // than blocking real traffic. Returning false here is the safe default.
    cache = { twilio: false, openai: false, cachedAt: Date.now() };
  }
  return cache;
}

export class SimulatedOutageError extends Error {
  readonly isSimulated = true;
  constructor(service: "twilio" | "openai") {
    super(`Simulated ${service} outage (admin toggle).`);
    this.name = "SimulatedOutageError";
  }
}

export async function isTwilioSimulatedOut(): Promise<boolean> {
  return (await readFlags()).twilio;
}

export async function isOpenAISimulatedOut(): Promise<boolean> {
  return (await readFlags()).openai;
}

export async function assertTwilioOperational(): Promise<void> {
  if (await isTwilioSimulatedOut()) {
    throw new SimulatedOutageError("twilio");
  }
}

export async function assertOpenAIOperational(): Promise<void> {
  if (await isOpenAISimulatedOut()) {
    throw new SimulatedOutageError("openai");
  }
}
