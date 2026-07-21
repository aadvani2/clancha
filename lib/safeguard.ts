export interface SafeguardResult {
  safe: boolean;
  cleanedText?: string;
  reason?: string;
}

const MAX_LENGTH = 1000;

const PHYSICAL_THREAT_REGEX =
  /\b(kill\s+you|beat\s+you|hurt\s+you|punch\s+you|slap\s+you|shoot\s+you|stab\s+you|murder|stab|smash\s+your\s+(head|face|teeth|skull|nose)|break\s+your\s+(legs|arms|neck|bones|nose|jaw|back))\b/i;

const SLUR_REGEX =
  /\b(slag|bitch|bastard|asshole|arsehole|prick|twat|cunt|whore|slut|skank|fag|faggot|tranny|retard|spastic|wanker|wankstain|dickhead|scumbag|piece\s+of\s+shit|sack\s+of\s+shit|son\s+of\s+a\s+bitch)\b/i;

// Telling the recipient to leave / get lost in profane terms.
// Catches "fuck off", "fuck you", "piss off", "get fucked", "go fuck yourself", etc.
// These are directed at the recipient and carry no rewritable proposition.
const DIRECTED_DISMISSAL_REGEX =
  /\b(fuck\s*(off|you|yourself)|f\*+ck\s*(off|you)|piss\s+off|sod\s+off|get\s+(fucked|stuffed)|go\s+(fuck|screw)\s+yourself)\b/i;

// "you're [worthless/pathetic/useless] (excuse of a ...)" — directed personal attacks
// where stripping the attack leaves nothing meaningful to rewrite. Distinct from
// "you're being unreasonable" which has a rewritable proposition.
const DIRECTED_PERSONAL_ATTACK_REGEX =
  /\b(you(['']?re|\s+are)\s+(a\s+|an\s+)?(worthless|pathetic|useless|disgusting|vile|repulsive|pitiful|sorry)\b(\s+excuse(\s+of\s+a)?\s+\w+)?|you(['']?re|\s+are)\s+nothing(\s+but\s+a\s+\w+)?)/i;

const ATTACHMENT_REGEX =
  /\b(send(ing|s)?\s+(you\s+)?a\s+(photo|picture|screenshot|file|image)|attached|attachment|see\s+the\s+(photo|picture|screenshot|image))\b/i;

// Fillers and grammatical scaffolding that don't constitute "real content".
// Used to decide whether a message has any rewritable proposition left once
// the attack/dismissal phrase is removed. Includes reporting verbs (told,
// said, etc.) so reported third-party actions like "he told a teacher to
// fuck off" still register the surrounding subject/object as meaningful.
const FILLERS = new Set([
  "i", "you", "your", "yours", "im", "ill", "you're", "youre",
  "a", "an", "the", "and", "or", "but", "so",
  "is", "are", "am", "be", "been", "being", "was", "were",
  "will", "would", "could", "should", "can", "may", "might",
  "going", "to", "of", "with", "for", "in", "on", "at", "by",
  "gonna", "wanna", "got", "get", "have", "has", "had", "do", "does", "did",
  "now", "really", "just", "very", "too", "so",
  "not", "no", "yes",
]);

function hasMeaningfulResidue(text: string, pattern: RegExp): boolean {
  const residue = text.replace(pattern, " ").toLowerCase();
  const words = residue.split(/\s+/).filter((w) => {
    const clean = w.replace(/[^a-z0-9]/g, "");
    return clean.length > 0 && !FILLERS.has(clean);
  });
  return words.length > 0;
}

export function safeguardMessage(text: string): SafeguardResult {
  if (!text || typeof text !== "string") {
    return { safe: false, reason: "Invalid input" };
  }

  if (text.length > MAX_LENGTH) {
    return { safe: false, reason: "Message too long. Max 1000 characters." };
  }

  if (ATTACHMENT_REGEX.test(text)) {
    return {
      safe: false,
      reason:
        "Clancha does not allow pictures or attachments in the demo for safeguarding reasons, so this message won't be sent.",
    };
  }

  // Any direct threat blocks unconditionally. The previous "zero non-filler
  // words remaining" heuristic let threats slip through when the message also
  // contained slurs or other context, e.g. "you're a fucking slag, I'm going to
  // kill you" → rewritten and delivered as a calm message.
  if (PHYSICAL_THREAT_REGEX.test(text)) {
    return {
      safe: false,
      reason:
        "This message cannot be rewritten because it contains a direct threat of harm, so it won't be sent to the other parent.",
    };
  }

  if (SLUR_REGEX.test(text)) {
    return {
      safe: false,
      reason:
        "This message cannot be rewritten because it contains a slur or dehumanising language, so it won't be sent to the other parent.",
    };
  }

  // Directed dismissal / personal attack: block ONLY when the attack is the
  // entire content. If meaningful words remain after stripping the attack
  // phrase, the rewriter can soften the abuse and preserve the proposition.
  // Critical: reported actions like "He told a teacher to fuck off" must pass
  // through — the user is reporting what a third party did, not directing
  // language at the recipient.
  for (const pattern of [DIRECTED_DISMISSAL_REGEX, DIRECTED_PERSONAL_ATTACK_REGEX]) {
    if (pattern.test(text) && !hasMeaningfulResidue(text, pattern)) {
      return {
        safe: false,
        reason:
          "This message cannot be rewritten because it is a directed personal attack, so it won't be sent to the other parent.",
      };
    }
  }

  let cleaned = text.replace(/Ignore previous instructions/gi, "");
  cleaned = cleaned.replace(/System override/gi, "");

  return { safe: true, cleanedText: cleaned };
}
