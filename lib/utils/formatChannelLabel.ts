import { PLACEHOLDER_PHONE } from "@/lib/services/createFirstChannelForUser";

/**
 * Compose a display label showing both parties on a channel, creator first
 * (the user order in channel.users is [creator, recipient] by convention —
 * see createSubsequentChannelForUser / channels POST). Placeholder users
 * (legacy auto-created first channels with no real contact) are filtered out
 * so the label shows just the creator.
 */
export function formatBothPartiesLabel(
  users: Array<{ name?: string | null; phone?: string | null }> | undefined,
  fallback: string | null | undefined
): string {
  const real = (users ?? []).filter((u) => u && u.phone !== PLACEHOLDER_PHONE);
  const nameOf = (u: { name?: string | null; phone?: string | null }) =>
    (u.name && u.name.trim()) || (u.phone ? u.phone : "Unnamed");
  if (real.length >= 2) return `${nameOf(real[0])} ↔ ${nameOf(real[1])}`;
  if (real.length === 1) return nameOf(real[0]);
  return (fallback && fallback.trim()) || "Unnamed";
}
