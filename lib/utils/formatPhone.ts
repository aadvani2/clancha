/**
 * Normalise a stored phone number for display in the admin / portal UI.
 *
 * Stored values may have come from a variety of input paths — some have a "+",
 * some don't, some have spaces, some have a leading "0" (UK local format). The
 * UI should always render in E.164 with a leading "+" so e.g. "447712345678",
 * "+447712345678", and "07712345678" all become "+447712345678".
 *
 * Per Craig's M4 tracker item 46: format phones as +447… across the board.
 */
export function formatPhoneForDisplay(phone?: string | null): string {
  if (!phone) return "—";
  const trimmed = String(phone).trim();
  if (!trimmed) return "—";

  // Strip everything except digits and a leading "+".
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed;

  // Already E.164-ish (starts with the original "+" and the digit count looks plausible).
  if (trimmed.startsWith("+")) return `+${digits}`;

  // UK local format "07…" (11 digits) → "+44…".
  if (digits.startsWith("0") && digits.length === 11) {
    return `+44${digits.slice(1)}`;
  }

  // Bare digits — assume the caller already stored E.164 sans plus.
  return `+${digits}`;
}
