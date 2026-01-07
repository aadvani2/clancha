export interface SafeguardResult {
    safe: boolean;
    cleanedText?: string;
    reason?: string;
}

const MAX_LENGTH = 1000;

// Regex for direct threats of physical harm
// e.g. "I'm going to kill you", "smash your face", "break your legs"
// We want to avoid blocking general anger or non-physical threats if possible, but for a demo, a list of explicit violence keywords is safer.
// Regex for direct threats of physical harm
// Use word boundaries (\b) to avoid matching "skill" as "kill" or "beet" as "beat".
// Added specific body parts for "smash/break" to ensure the full threat object is captured (e.g. "smash your face") so it doesn't count as "meaningful residue".
const PHYSICAL_THREAT_REGEX = /\b(kill\s+you|beat\s+you|hurt\s+you|punch\s+you|slap\s+you|shoot\s+you|stab\s+you|murder|stab|smash\s+your\s+(head|face|teeth|skull|nose)|break\s+your\s+(legs|arms|neck|bones|nose|jaw|back))\b/i;

// Regex for attachments / photos
const ATTACHMENT_REGEX = /\b(send(ing|s)?\s+(you\s+)?a\s+(photo|picture|screenshot|file|image)|attached|attachment|see\s+the\s+(photo|picture|screenshot|image))\b/i;

export function safeguardMessage(text: string): SafeguardResult {
    if (!text || typeof text !== "string") {
        return { safe: false, reason: "Invalid input" };
    }

    if (text.length > MAX_LENGTH) {
        return { safe: false, reason: "Message too long. Max 1000 characters." };
    }

    // 1. Check for Attachments/Images (Demo Restriction)
    if (ATTACHMENT_REGEX.test(text)) {
        return {
            safe: false,
            reason: "Clancha does not allow pictures or attachments in the demo for safeguarding reasons, so this message won’t be sent."
        };
    }

    // 2. Check for Direct Physical Threats
    // "Only block if threat is the entire or primary content"
    // New Heuristic: Remove the threat match. Then remove common "filler" words.
    // If meaningful words remain, it's a mixed message -> Pass to LLM.
    // If only filler remains, it's a pure threat -> Block.
    if (PHYSICAL_THREAT_REGEX.test(text)) {
        // 1. Remove the threat phrase(s)
        const residue = text.replace(PHYSICAL_THREAT_REGEX, " ").toLowerCase();

        // 2. Remove common filler words that might surround a threat.
        const fillers = new Set(["i", "will", "am", "going", "to", "or", "and", "you", "your", "the", "a", "is", "are", "im", "ill", "be", "gonna", "in"]);

        const words = residue.split(/\s+/).filter(w => {
            const cleanW = w.replace(/[^a-z0-9]/g, ""); // Remove punctuation
            return cleanW.length > 0 && !fillers.has(cleanW);
        });

        // 3. If NO meaningful words remain, it's a pure threat.
        if (words.length === 0) {
            return {
                safe: false,
                reason: "This message cannot be rewritten because it contains a direct threat of harm, so it won’t be sent to the other parent."
            };
        }
        // If meaningful words exist (e.g. "Pick", "up", "John"), we allow it.
    }

    // 3. Basic prompt injection stripping
    let cleaned = text.replace(/Ignore previous instructions/gi, "");
    cleaned = cleaned.replace(/System override/gi, "");

    return { safe: true, cleanedText: cleaned };
}
