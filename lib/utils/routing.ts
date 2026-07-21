/**
 * Message routing: identify channel, receiving hours, emergency keyword.
 * Used by Twilio webhook and (later) rewrite pipeline.
 */

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").trim();
  // UK local format: 07xxx → strip leading 0, prepend +44
  if (digits.startsWith("0") && digits.length === 11) {
    return `+44${digits.slice(1)}`;
  }
  return `+${digits}`;
}

export function normalizePhoneForMatch(phone: string): string {
  return normalizePhone(phone).replace(/^\+/, "");
}

/**
 * Check if text is an emergency trigger command (not a real message).
 * Examples: "emergency", "its emergency message", etc.
 */
export function isEmergencyTrigger(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const lower = text.trim().toLowerCase();
  
  // Direct matches
  const triggers = ["emergency", "its emergency message", "it's an emergency message", "its an emergency message", "it's emergency message", "its emergency message", "urgent", "alert"];
  if (triggers.includes(lower)) return true;

  // Flexible match: if it's short and contains "emergency"
  if (lower.length < 30 && lower.includes("emergency")) return true;

  return false;
}

/**
 * Check if text contains the emergency bypass keyword (case-insensitive).
 * Kept for backward compatibility or cases where keyword is part of a real message.
 */
export function isEmergencyKeyword(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const lower = text.trim().toLowerCase();
  const EMERGENCY_KEYWORDS = ["emergency", "urgent", "alert"];
  return EMERGENCY_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Check if current time is within recipient's receiving hours.
 * prefs.receivingHoursStart/End are HH:mm or null (always open).
 * Uses prefs.timezone for "now".
 */
export function timeToMinutes(time: string): number {
  if (!time) return 0;
  // Use a very strict regex to extract only digits, ignoring any hidden characters
  const match = time.match(/(\d{1,2})[^\d](\d{2})\s*(AM|PM)?/i);
  if (!match) return 0;

  let [_, hours, minutes, period] = match;
  let h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);

  if (period) {
    const p = period.toUpperCase();
    if (p === "PM" && h < 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
  }

  return h * 60 + m;
}

export function isWithinReceivingHours(
  params: {
    receivingHoursStart?: string | null;
    receivingHoursEnd?: string | null;
    timezone?: string;
  } | null
): boolean {
  if (!params) return true;

  const hStart = params.receivingHoursStart?.trim() || null;
  const hEnd = params.receivingHoursEnd?.trim() || null;

  // If no hours are set at all, it's open
  if (!hStart && !hEnd) return true;

  const now = new Date();
  const tz = params.timezone || "Europe/London";

  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    
    // Some environments (Vercel) return invisible characters or non-standard separators.
    // We explicitly extract digits and colon to ensure a clean time string like "08:30".
    const rawFormated = formatter.format(now);
    const timeParts = rawFormated.match(/\d{1,2}:\d{2}/);
    if (!timeParts) {
      throw new Error(`Failed to extract time from format: ${rawFormated}`);
    }
    const currentStr = timeParts[0];
    const current = timeToMinutes(currentStr);
    const start = timeToMinutes(hStart ?? "00:00");
    const end = timeToMinutes(hEnd ?? "23:59");

    let result: boolean;
    if (start <= end) {
      result = current >= start && current <= end;
    } else {
      // Overnight case (e.g. 22:00 to 06:00)
      result = current >= start || current <= end;
    }

    console.log("[routing] isWithinReceivingHours check", {
      timezone: tz,
      currentLocalTime: currentStr,
      start,
      end,
      result,
      nowUTC: now.toISOString(),
    });

    return result;
  } catch (e) {
    console.error("[routing] isWithinReceivingHours logic error:", e);
    return true; // Fail-safe: deliver message if logic fails
  }
}

export interface RoutingDecision {
  state: "queued" | "rewriting";
  isEmergency: boolean;
  isTrigger: boolean;
  skipRewrite: boolean;
  notificationText?: string;
}

/**
 * Decide initial message state: queued (outside hours) or rewriting (within hours).
 * 
 * Logic:
 * 1. Identify if it's an emergency trigger.
 * 2. If outside receiving hours -> Queue and return appropriate notification.
 * 3. Else -> Deliver (rewriting).
 */
export function getInitialMessageState(
  originalText: string,
  emergencyBypassEnabled: boolean,
  withinReceivingHours: boolean
): RoutingDecision {
  const isTrigger = isEmergencyTrigger(originalText);
  const isEmergency = isTrigger || isEmergencyKeyword(originalText);

  // If outside receiving hours
  if (!withinReceivingHours) {
    // If it's an emergency trigger, we handle it specially in the caller (Twilio webhook)
    // but here we mark it as a trigger.
    if (isTrigger) {
      return { 
        state: "queued", 
        isEmergency: true,
        isTrigger: true,
        skipRewrite: true
      };
    }

    let msg = "Your message will be delivered when the receiving hours begin.";
    if (emergencyBypassEnabled) {
      msg += " For urgent matters, message again with 'emergency' (e.g. its emergency message)";
    }
    return { state: "queued", isEmergency: false, isTrigger: false, skipRewrite: false, notificationText: msg };
  }

  // Within hours: deliver normally, but still mark if it was a trigger
  return { 
    state: "rewriting", 
    isEmergency: isEmergency, 
    isTrigger: isTrigger,
    skipRewrite: isTrigger 
  };
}

