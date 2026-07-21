/**
 * GSM-7 normalisation for outbound SMS (Craig, M4 feedback 05/07/26, section 1).
 *
 * A single character outside the GSM-7 basic alphabet forces the whole
 * message into UCS-2, dropping the per-segment budget from 160 to 70
 * characters - roughly doubling the Twilio cost of the message. The usual
 * culprits are typographic punctuation: curly quotes (iPhone smart
 * punctuation on user drafts, and occasionally LLM output), en/em dashes
 * and ellipses.
 *
 * This is a RENDERING change only: each replacement is the plain-ASCII
 * equivalent of the same character. Wording and meaning are never altered.
 */

const GSM7_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  // curly / low-9 single quotes, prime -> straight apostrophe
  [/[‘’‚‛′]/g, "'"],
  // curly / low-9 double quotes, double prime -> straight double quote
  [/[“”„‟″]/g, '"'],
  // en dash, em dash, horizontal bar, minus sign -> hyphen
  [/[–—―−]/g, "-"],
  // horizontal ellipsis -> three dots
  [/…/g, "..."],
  // no-break space, typographic spaces, narrow no-break, ideographic space -> space
  [/[  -   　]/g, " "],
  // zero-width characters -> removed
  [/[​-‍⁠﻿]/g, ""],
  // bullet -> hyphen
  [/•/g, "-"],
];

export function toGsm7Safe(text: string): string {
  let out = text;
  for (const [pattern, replacement] of GSM7_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
