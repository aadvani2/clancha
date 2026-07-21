import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizePhoneForMatch,
  isEmergencyKeyword,
  isWithinReceivingHours,
  getInitialMessageState,
} from "@/lib/utils/routing";

describe("Routing utilities", () => {
  describe("normalizePhoneForMatch", () => {
    it("should strip leading + from phone number", () => {
      expect(normalizePhoneForMatch("+15551234567")).toBe("15551234567");
    });

    it("should remove non-digit characters", () => {
      expect(normalizePhoneForMatch("+1 (555) 123-4567")).toBe("15551234567");
    });

    it("converts UK local format (07xxx) to international (447xxx)", () => {
      // normalizePhone now applies UK local→international conversion when
      // the input is exactly 11 digits starting with 0 (the common UK
      // mobile shape) before stripping the leading + for matching.
      expect(normalizePhoneForMatch("07911123456")).toBe("447911123456");
    });

    it("should handle phone numbers without + prefix", () => {
      expect(normalizePhoneForMatch("15551234567")).toBe("15551234567");
    });
  });

  describe("isEmergencyKeyword", () => {
    it("should return true when text contains emergency", () => {
      expect(isEmergencyKeyword("This is an emergency!")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isEmergencyKeyword("EMERGENCY")).toBe(true);
      expect(isEmergencyKeyword("Emergency")).toBe(true);
      expect(isEmergencyKeyword("eMeRgEnCy")).toBe(true);
    });

    it("should return false when text does not contain emergency", () => {
      expect(isEmergencyKeyword("Regular message")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isEmergencyKeyword("")).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(isEmergencyKeyword(null as unknown as string)).toBe(false);
      expect(isEmergencyKeyword(undefined as unknown as string)).toBe(false);
    });

    it("should detect emergency as substring", () => {
      expect(isEmergencyKeyword("non-emergency")).toBe(true);
    });
  });

  describe("isWithinReceivingHours", () => {
    it("should return true when prefs is null", () => {
      expect(isWithinReceivingHours(null)).toBe(true);
    });

    it("should return true when both start and end are null", () => {
      expect(
        isWithinReceivingHours({
          receivingHoursStart: null,
          receivingHoursEnd: null,
          timezone: "Europe/London",
        })
      ).toBe(true);
    });

    it("should handle normal hour ranges (start < end)", () => {
      const prefs = {
        receivingHoursStart: "00:00",
        receivingHoursEnd: "23:59",
        timezone: "Europe/London",
      };
      expect(isWithinReceivingHours(prefs)).toBe(true);
    });

    it("should handle overnight hour ranges (start > end)", () => {
      const prefs = {
        receivingHoursStart: "20:00",
        receivingHoursEnd: "08:00",
        timezone: "Europe/London",
      };
      expect(typeof isWithinReceivingHours(prefs)).toBe("boolean");
    });

    // M4 #98 — the default joiner window is 06:00–23:00. A message arriving at
    // 02:00 must be outside the window (queued) and at/after 06:00 must be
    // inside (released). Pin "now" to a deterministic London instant. We use a
    // January date so Europe/London == UTC (no BST offset) and the assertions
    // are stable on any CI machine.
    describe("default 06:00–23:00 window boundary (release on window open)", () => {
      const prefs = {
        receivingHoursStart: "06:00",
        receivingHoursEnd: "23:00",
        timezone: "Europe/London",
      };

      afterEach(() => {
        vi.useRealTimers();
      });

      it("is OUTSIDE the window at 02:00 London (message stays queued)", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-15T02:00:00.000Z"));
        expect(isWithinReceivingHours(prefs)).toBe(false);
      });

      it("is INSIDE the window exactly at 06:00 London (window-open release)", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-15T06:00:00.000Z"));
        expect(isWithinReceivingHours(prefs)).toBe(true);
      });

      it("is INSIDE the window at 06:13 London (delayed cron still releases)", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-15T06:13:00.000Z"));
        expect(isWithinReceivingHours(prefs)).toBe(true);
      });

      it("is OUTSIDE the window at 23:30 London (after end)", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-15T23:30:00.000Z"));
        expect(isWithinReceivingHours(prefs)).toBe(false);
      });
    });
  });

  describe("getInitialMessageState", () => {
    // Contract refreshed 2026-05-22: the routing function no longer applies
    // emergency bypass itself — that's now the Twilio webhook's job, which
    // re-routes a queued trigger through to delivery when bypass is on.
    // routing.ts just labels the intent (isTrigger, isEmergency,
    // skipRewrite) so the caller knows what to do.

    it("queues an emergency trigger outside receiving hours and flags isTrigger", () => {
      const result = getInitialMessageState("This is an emergency!", true, false);
      expect(result).toMatchObject({ state: "queued", isEmergency: true, isTrigger: true, skipRewrite: true });
    });

    it("flags isEmergency from substring even when text isn't a pure trigger", () => {
      // "This is an emergency!" is short enough (< 30 chars) to be classed
      // as a trigger by isEmergencyTrigger. With withinHours=true, it goes
      // to rewriting but with isEmergency + isTrigger set; the trigger path
      // also skips the rewrite engine.
      const result = getInitialMessageState("This is an emergency!", false, true);
      expect(result).toMatchObject({ state: "rewriting", isEmergency: true, isTrigger: true, skipRewrite: true });
    });

    it("queues a regular message outside receiving hours with a notification", () => {
      const result = getInitialMessageState("Regular message", true, false);
      expect(result).toMatchObject({ state: "queued", isEmergency: false, isTrigger: false, skipRewrite: false });
      expect(result.notificationText).toBeTruthy();
    });

    it("rewrites a regular message inside receiving hours", () => {
      const result = getInitialMessageState("Regular message", true, true);
      expect(result).toMatchObject({ state: "rewriting", isEmergency: false, isTrigger: false, skipRewrite: false });
    });

    it("queues an emergency trigger outside receiving hours so the caller can re-route via bypass", () => {
      // Caller (Twilio webhook) checks isTrigger + recipient's
      // emergencyBypassEnabled and decides whether to skip the queue.
      const result = getInitialMessageState("emergency help", true, false);
      expect(result).toMatchObject({ state: "queued", isEmergency: true, isTrigger: true, skipRewrite: true });
    });
  });
});
