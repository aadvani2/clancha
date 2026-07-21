/**
 * Date / time formatters standardised on DD/MM/YYYY (en-GB).
 *
 * Craig's M4 tracker #54: the admin Activity log already used DD/MM/YYYY
 * but AI Prompts, channel detail, billing renewal and viewer cards all
 * rendered "DD MMM YYYY" via `{ dateStyle: "medium" }`. Pick one format
 * for the whole app — DD/MM/YYYY — so dates are immediately recognisable
 * everywhere.
 *
 * All helpers accept a `Date | string | number | null | undefined` so they
 * can swallow API payloads (ISO strings) and DB rows (Date objects)
 * without each call site having to pre-parse.
 */

type DateLike = Date | string | number | null | undefined;

function toDate(v: DateLike): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "21/05/2026" — display format used everywhere a calendar date appears.
 * Returns the supplied `fallback` when the input is null/undefined/invalid.
 */
export function formatDate(value: DateLike, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * "21/05/2026, 14:32" — date + time, used for last-active / created-at
 * timestamps where the time matters (audit log, viewer last access,
 * moderator queue, etc).
 */
export function formatDateTime(value: DateLike, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
