import sgMail from "@sendgrid/mail";

/**
 * Email transport for outbound transactional mail. Currently used only for
 * the viewer invitation link (per Craig 2026-05-26 — solicitors/mediators
 * shouldn't have to be SMS'd a link by the inviting parent; the link goes
 * straight to their inbox).
 *
 * Graceful when SENDGRID_API_KEY is missing: getSendGridClient() returns
 * null, sendInviteEmail() resolves to { success: false, error: "no_api_key" }
 * and the caller still surfaces the copy-link UI as a fallback.
 */

let configuredKey: string | null = null;

function getSendGridClient(): typeof sgMail | null {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return null;
  if (configuredKey !== key) {
    sgMail.setApiKey(key);
    configuredKey = key;
  }
  return sgMail;
}

export function isEmailConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY && !!process.env.SENDGRID_FROM_EMAIL;
}

export interface EmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

interface InviteEmailParams {
  to: string;
  inviteLink: string;
  viewerName: string;
  inviterName: string;
  channelName: string;
  expiresAt: Date;
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<EmailResult> {
  const client = getSendGridClient();
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!client) return { success: false, error: "no_api_key" };
  if (!from) return { success: false, error: "no_from_address" };

  const { to, inviteLink, viewerName, inviterName, channelName, expiresAt } = params;
  const expiresStr = expiresAt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const channelLabel = channelName?.trim() || "a Clancha channel";

  const text = `Hi ${viewerName},\n\n${inviterName} has invited you to view ${channelLabel} on Clancha as a third-party viewer.\n\nAccept the invitation here:\n${inviteLink}\n\nThis link expires on ${expiresStr}.\n\nClancha — Clarity, Not Chaos.`;

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f2e8d9;margin:0;padding:24px;color:#2F4A44;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid rgba(79,122,97,0.15);padding:32px;">
    <tr><td>
      <h1 style="margin:0 0 4px 0;font-size:22px;color:#4f7a61;font-style:italic;font-weight:900;letter-spacing:-0.3px;">Clancha</h1>
      <p style="margin:0 0 24px 0;font-size:10px;letter-spacing:2px;color:#6b8c79;font-weight:700;text-transform:uppercase;">Clarity, Not Chaos</p>
      <h2 style="margin:0 0 12px 0;font-size:18px;color:#2F4A44;font-weight:700;">You've been invited as a viewer</h2>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">Hi ${escapeHtml(viewerName)},</p>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">${escapeHtml(inviterName)} has invited you to view <strong>${escapeHtml(channelLabel)}</strong> on Clancha as a third-party viewer. You'll be able to read the rewritten messages on this channel; you cannot send messages or change settings.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr><td style="background:#4f7a61;border-radius:12px;padding:14px 28px;">
          <a href="${escapeAttr(inviteLink)}" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Accept invitation</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px 0;font-size:12px;color:#6b8c79;">Or copy this link:</p>
      <p style="margin:0 0 24px 0;font-size:12px;word-break:break-all;color:#4f7a61;font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(inviteLink)}</p>
      <p style="margin:0;font-size:12px;color:#6b8c79;border-top:1px solid rgba(79,122,97,0.15);padding-top:16px;">This link expires on <strong>${escapeHtml(expiresStr)}</strong>. If you weren't expecting this invitation you can ignore this email.</p>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const [response] = await client.send({
      to,
      from,
      subject: `${inviterName} invited you to view ${channelLabel} on Clancha`,
      text,
      html,
    });
    const messageId = response?.headers?.["x-message-id"] as string | undefined;
    return { success: true, messageId };
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string; response?: { body?: unknown } };
    console.error("[email] sendInviteEmail failed", {
      to: maskEmail(to),
      code: e.code,
      message: e.message,
      body: e.response?.body,
    });
    return { success: false, error: e.message ?? "send_failed" };
  }
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const safeUser = user.length <= 2 ? "**" : `${user[0]}***${user[user.length - 1]}`;
  return `${safeUser}@${domain}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
