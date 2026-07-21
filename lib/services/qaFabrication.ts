/**
 * Detect whether a Q&A answer fabricates a quoted attribution.
 *
 * Rule: any substring inside quotation marks (straight or smart) in the
 * answer must appear verbatim in the context that was sent to the LLM. If
 * not, the model is putting words in someone's mouth — refuse and audit-log.
 *
 * Why a substring check and not strict equality: gpt-5-mini occasionally
 * lifts a phrase from a delivered rewrite and rewords the surrounding
 * sentence ("Sam said 'pickup at 6pm'"). We only block when the *quoted*
 * span isn't in the context, regardless of how the sentence is wrapped.
 *
 * Short quotes (< 5 normalised characters) are ignored — single words like
 * "school" or "Sam" routinely appear both in answer and context without
 * being fabrication.
 */

function extractQuotedSubstrings(answer: string): string[] {
  const out: string[] = [];
  // Match each quote kind on its own so an apostrophe inside a "…" span
  // (e.g. I'll) doesn't terminate the match early.
  //   "…"  straight double
  //   “…”  curly double
  //   ‘…’  curly single
  // Straight single quote is NOT used as a delimiter — it conflicts with
  // apostrophes (don't, I'll, can't) and the model rarely uses it for
  // quoting prose anyway.
  const patterns = [/"([^"]+)"/g, /“([^”]+)”/g, /‘([^’]+)’/g];
  for (const re of patterns) {
    for (const m of answer.matchAll(re)) {
      if (m[1].trim().length > 0) out.push(m[1]);
    }
  }
  return out;
}

function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasFabricatedQuote(answer: string, contextHaystack: string): boolean {
  const haystack = normaliseForCompare(contextHaystack);
  for (const raw of extractQuotedSubstrings(answer)) {
    const needle = normaliseForCompare(raw);
    if (needle.length < 5) continue;
    if (!haystack.includes(needle)) return true;
  }
  return false;
}

export const FABRICATION_REFUSAL =
  "I can't answer that based on the message history.";
