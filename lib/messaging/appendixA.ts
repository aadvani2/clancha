/**
 * Clancha Appendix A – system SMS / Twilio copy (exact wording where specified).
 * SMS does not support italics; *italic* segments from the spec are sent as plain text.
 */

export function getPortalBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function portalLoginLink(): string {
  return `${getPortalBaseUrl()}/login`;
}

export function termsLink(): string {
  // Short own-domain link (Craig, M4 feedback 05/07/26 §1.3). The portal's
  // /terms route redirects to the live terms page on the marketing site, so
  // the SMS carries the short URL instead of the full clancha.co.uk one.
  return `${getShortLinkBaseUrl()}/terms`;
}

/**
 * Base URL for short links embedded in SMS. Falls back to the portal URL;
 * set SHORT_LINK_BASE_URL once a dedicated short branded domain exists so
 * every SMS link shrinks with no code change.
 */
export function getShortLinkBaseUrl(): string {
  return (process.env.SHORT_LINK_BASE_URL || getPortalBaseUrl()).replace(/\/$/, "");
}

export function subscriptionReactivateLink(): string {
  return `${getPortalBaseUrl()}/subscription`;
}

export function pictureUpgradeLink(): string {
  return `${getPortalBaseUrl()}/subscription`;
}

/** A1 – Initial system introduction (User B) */
export function a1InitialIntroductionUserB(params: {
  senderName: string;
  joinLink?: string;
}): string {
  const { senderName, joinLink } = params;
  // Per spec the second sentence link offers an online account. Once we know
  // a User._id + channel exist for B, we hand out a one-shot /join token so
  // the link drops B straight into an OTP-only claim flow (no signup form).
  // If no token was issued (e.g. recipient has no User record yet), fall
  // back to the generic /login URL so the spec wording still resolves.
  const accountLink = joinLink || portalLoginLink();
  return (
    `Clancha: You've received a message from ${senderName} via Clancha. ` +
    `Clancha helps keep communication calm, clear and focused on the children. ` +
    `You can reply as normal by text. By replying, you agree to Clancha's terms: ${termsLink()}. ` +
    `You can also create an online account to manage settings and view history: ${accountLink}.`
  );
}

/** A2 – Message queued (outside receiving hours) */
export function a2MessageQueuedOutsideHours(params: {
  resumeTimeLabel: string;
  recipientName: string;
}): string {
  const { resumeTimeLabel, recipientName } = params;
  return (
    `Clancha: This message is queued until ${resumeTimeLabel} as requested by ${recipientName}. ` +
    `Reply with "emergency" if it's an emergency and, if ${recipientName} has this enabled, they will be notified.`
  );
}

/** A3 – Emergency delivery confirmation (sender) */
export function a3EmergencyDeliveryConfirmationSender(): string {
  return "Clancha: This message was marked as an emergency and delivered outside normal hours.";
}

/** A4 – Emergency delivery denied (sender) */
export function a4EmergencyDeliveryDeniedSender(params: { recipientName: string; resumeTimeLabel: string }): string {
  return `Clancha: ${params.recipientName} doesn't have Emergency Bypass enabled. The message is queued until ${params.resumeTimeLabel}.`;
}

/** A5 – Message blocked (SMS) */
export function a5MessageBlockedSms(): string {
  return "Clancha: This message wasn't sent as it may breach Clancha's terms. No action is needed. You can continue messaging as normal.";
}

/** A6 – MMS attempt (add-on active) */
export function a6MmsPictureSharingPortalOnly(): string {
  return `Clancha: Picture Sharing is only available via your online portal: ${portalLoginLink()}`;
}

/** A7 – MMS attempt (add-on inactive) */
export function a7MmsPictureSharingUpgrade(): string {
  return `Clancha: To upload and view images, add the Picture Sharing add-on (£4.99) here: ${pictureUpgradeLink()}.`;
}

/** A8 – Picture upload approved (recipient) */
export function a8PictureUploadApprovedRecipient(params?: { imageId?: string }): string {
  const imageId = params?.imageId;
  if (imageId) {
    const viewLink = `${getPortalBaseUrl()}/api/images/view/${imageId}`;
    return `Clancha: A new picture has been added to the Clancha portal: ${viewLink} (or log in to view full history: ${portalLoginLink()}).`;
  }
  return `Clancha: A new picture has been added to the Clancha portal. Log in to view it: ${portalLoginLink()}.`;
}

/** A9 – Picture upload denied (sender) */
export function a9PictureUploadDeniedSender(): string {
  return "Clancha: Your picture wasn't shared as it may breach Clancha's terms.";
}

/** A10 – Channel view-only (payment stopped) */
export function a10ChannelViewOnlyReactivate(): string {
  return `Clancha: This channel is currently view-only. To continue messaging, reactivate your subscription here: ${subscriptionReactivateLink()}.`;
}

/** A11 – Viewer added notification */
export function a11ViewerAdded(params: { viewerName: string }): string {
  return (
    `Clancha: ${params.viewerName} has been added as a viewer to this channel. ` +
    `You can manage viewer access in your portal.`
  );
}

/** A12 – Inbound voice (recorded / Twilio Say) */
export function a12VoiceCallMessage(): string {
  return "You've reached Clancha. Clancha is a text-only service, and calls aren't currently supported. Please continue the conversation by text. Thank you.";
}

/**
 * A13 – Viewer granted full history access.
 * Sent to the inviting parent when the other parent approves the viewer
 * seeing their original messages.
 */
export function a13ViewerGrantedFullHistory(params: {
  otherParentName: string;
  viewerName: string;
}): string {
  return `Clancha: ${params.otherParentName} has granted ${params.viewerName} full history access.`;
}

/**
 * A14 – Viewer access restricted.
 * Sent to the inviting parent when the other parent revokes their consent
 * (was previously full history).
 */
export function a14ViewerAccessRestricted(params: {
  otherParentName: string;
  viewerName: string;
}): string {
  return `Clancha: ${params.otherParentName} has restricted ${params.viewerName} to rewritten messages only.`;
}

/**
 * A15 – Viewer removed.
 * Sent to the other parent when the inviting parent removes the viewer
 * from the channel entirely.
 */
export function a15ViewerRemoved(params: { viewerName: string }): string {
  return `Clancha: ${params.viewerName} is no longer a viewer on this channel.`;
}

/**
 * A16 – Viewer left.
 * Sent to both parents when the viewer leaves the channel from their own
 * portal.
 */
export function a16ViewerLeft(params: { viewerName: string }): string {
  return `Clancha: ${params.viewerName} has left this channel as a viewer.`;
}

/**
 * No Appendix A line for “held for text moderation” sender ping; keep neutral operational copy.
 * (Product may later assign an appendix ID.)
 */
export function messageHeldForModerationSender(): string {
  return "Clancha: Your message is queued for moderator review. You'll be notified when it has been reviewed.";
}
