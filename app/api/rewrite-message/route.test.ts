import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock OpenAI
const mockCreate = vi.fn();
vi.mock('@/lib/openai', () => ({
    default: {
        chat: {
            completions: {
                create: (...args: any[]) => mockCreate(...args),
            },
        },
    },
}));

// Mock Rate Limiter to always pass
vi.mock('@/lib/rate-limit', () => ({
    default: {
        check: () => true,
    },
}));

describe('Rewrite API Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 for empty content', async () => {
        const req = new NextRequest("http://localhost/api/rewrite", {
            method: "POST",
            body: JSON.stringify({ text: "", style: "Calm & Clear" }),
        });
        const res = await POST(req);
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.error).toBeTruthy();
    });

    it('should return 400 for emoji-only content', async () => {
        const req = new NextRequest("http://localhost/api/rewrite", {
            method: "POST",
            body: JSON.stringify({ text: "😃😊", style: "Calm & Clear" }),
        });
        const res = await POST(req);
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.error).toContain("no meaningful content");
    });

    it('should return 400 for threats (blocked before OpenAI)', async () => {
        const req = new NextRequest("http://localhost/api/rewrite", {
            method: "POST",
            body: JSON.stringify({ text: "I will kill you", style: "Calm & Clear" }),
        });
        const res = await POST(req);
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.error).toContain("direct threat");
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should call OpenAI with functionality for valid input', async () => {
        mockCreate.mockResolvedValueOnce({
            choices: [{ message: { content: "Rewritten text" } }]
        });

        const req = new NextRequest("http://localhost/api/rewrite", {
            method: "POST",
            body: JSON.stringify({ text: "He was happy", style: "Calm & Clear" }),
        });
        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.rewrittenText).toBe("Rewritten text");

        // Verify OpenAI call args
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.model).toBe("gpt-4o-mini");
        expect(callArgs.temperature).toBe(0); // Deterministic check
        // Check system prompt contains key instructions
        const systemPrompt = callArgs.messages[0].content;
        expect(systemPrompt).toContain("YOU ARE THE SENDER");
        expect(systemPrompt).toContain("DO NOT REPLY");
        expect(systemPrompt).toContain("MAINTAIN PERSPECTIVE");
    });
});
