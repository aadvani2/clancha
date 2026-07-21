import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  a5MessageBlockedSms,
  a8PictureUploadApprovedRecipient,
  a9PictureUploadDeniedSender,
  a12VoiceCallMessage,
  getPortalBaseUrl,
} from "@/lib/messaging/appendixA";

describe("appendixA", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://portal.test";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it("prefixes system lines with 'Clancha:' where required", () => {
    // GSM-7-safe colon prefix (Craig, M4 feedback 05/07/26 §1.1) — the old
    // en dash forced every system SMS into the expensive UCS-2 encoding.
    expect(a5MessageBlockedSms()).toMatch(/^Clancha: /);
    expect(a8PictureUploadApprovedRecipient()).toMatch(/^Clancha: /);
    expect(a9PictureUploadDeniedSender()).toMatch(/^Clancha: /);
  });

  it("system SMS bodies contain only GSM-7-safe punctuation", () => {
    for (const body of [
      a5MessageBlockedSms(),
      a8PictureUploadApprovedRecipient(),
      a9PictureUploadDeniedSender(),
    ]) {
      expect(body).not.toMatch(/[–—‘’“”…]/);
    }
  });

  it("A8 includes portal login link", () => {
    expect(a8PictureUploadApprovedRecipient()).toContain(`${getPortalBaseUrl()}/login`);
  });

  it("A12 matches voice script", () => {
    expect(a12VoiceCallMessage()).toContain("text-only service");
    expect(a12VoiceCallMessage()).toContain("Thank you.");
  });
});
