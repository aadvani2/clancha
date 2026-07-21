import { timeToMinutes } from "./routing";

/**
 * Human-readable “resume” hint for Appendix A2 / A4 when a message is outside receiving hours.
 * Uses the recipient's window start time label in their timezone (simplified).
 */
export function receivingHoursResumeTimeLabel(params: {
  receivingHoursStart: string | null | undefined;
  receivingHoursEnd?: string | null;
  timezone?: string | null;
}): string {
  const tz = params.timezone?.trim() || "Europe/London";
  const start = params.receivingHoursStart?.trim();
  if (!start) {
    return "the next receiving window";
  }
  try {
    const now = new Date();
    const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" });
    const timeFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentMatch = timeFmt.format(now).match(/\d{1,2}:\d{2}/);

    // Same start/end → minutes math the gate (isWithinReceivingHours) uses, so
    // the two can never disagree on what "today's window" means. Missing end
    // defaults to end-of-day, mirroring that function's default.
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(params.receivingHoursEnd?.trim() || "23:59");

    // Resolve the next delivery day in the recipient's timezone: if today's
    // window has already opened-and-closed, the next open is tomorrow;
    // otherwise it's still today (window not opened yet, or an overnight
    // window that opens later tonight).
    let opensTomorrow = false;
    if (currentMatch) {
      const currentMinutes = timeToMinutes(currentMatch[0]);
      opensTomorrow = startMinutes <= endMinutes && currentMinutes > endMinutes;
    }

    const labelDate = opensTomorrow ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
    const weekday = dayFmt.format(labelDate);
    return `${start} on ${weekday}`;
  } catch {
    return start;
  }
}
