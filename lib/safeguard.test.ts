import { describe, it, expect } from 'vitest';
import { safeguardMessage } from './safeguard';

describe('Safeguard Logic', () => {
    it('should block explicit physical threats', () => {
        const threats = [
            "I'm going to kill you",
            "I will smash your face",
            "I'm going to break your legs",
            "I'll stab you",
            "murder you"
        ];
        threats.forEach(threat => {
            const result = safeguardMessage(threat);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain("direct threat of harm");
        });
    });

    it('should block attachments and images', () => {
        const inputs = [
            "I will send you a photo",
            "check the attached file",
            "sending a screenshot",
            "see the image"
        ];
        inputs.forEach(input => {
            const result = safeguardMessage(input);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain("pictures or attachments");
        });
    });

    it('should allow neutral parenting messages', () => {
        const safeMessages = [
            "Please pick up the kids at 5",
            "He was happy to see me",
            "Can we swap weekends?",
            "I sent the money" // "sent" and "money" shouldn't trigger photo regex
        ];
        safeMessages.forEach(msg => {
            const result = safeguardMessage(msg);
            expect(result.safe).toBe(true);
        });
    });

    it('should NOT block innocent words resembling threats (False Positives)', () => {
        // "skill you" contains "kill you" substring but should NOT match with \b
        const safe = [
            "This assumes you have the skill you need",
            "The beet you ate",
            "Great shot you made" // "shoot you" checks? "shot" is distinct.
        ];
        safe.forEach(msg => {
            const result = safeguardMessage(msg);
            expect(result.safe).toBe(true);
        });
    });

    it('should allow mixed threats if they contain substantial parenting content', () => {
        // User Requirement: "Bring the bag or I'll smash your head" -> Should work (LLM strips threat)
        const msg = "Bring the bag or I'll smash your head";
        const result = safeguardMessage(msg);
        expect(result.safe).toBe(true);
    });

    it('should allow short mixed messages (previously blocked by length check)', () => {
        // "Pick up John or I will kill you"
        // Threat: "kill you". Residue: "Pick up John or I will".
        // Fillers removed: "Pick", "up", "John". -> 3 meaningful words -> Should Pass.
        const msg = "Pick up John or I will kill you";
        const result = safeguardMessage(msg);
        expect(result.safe).toBe(true);
    });

    it('should block pure threats using filler words', () => {
        // "I will kill you" -> Threat: "kill you". Residue: "I will". -> Fillers -> Empty -> Block.
        const msg = "I will kill you";
        const result = safeguardMessage(msg);
        expect(result.safe).toBe(false);
    });
});
