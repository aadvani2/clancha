/**
 * Synthetic placeholder emails (clancha_<phone>@invited.com,
 * clancha_*@clancha.system) are created for an invited parent before they
 * register, purely so a unique User doc can exist. They are not real
 * mailboxes and must never be shown as if they were a user's address
 * (Craig, M4 feedback 05/07/26 §2.10).
 */
export function isPlaceholderEmail(email?: string | null): boolean {
  if (!email) return false;
  return /^clancha_[^@]*@(invited\.com|clancha\.system)$/i.test(email.trim());
}
