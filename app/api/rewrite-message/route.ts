import { NextResponse } from 'next/server';
import openai from '@/lib/openai';
import limiter from '@/lib/rate-limit';
import { safeguardMessage } from '@/lib/safeguard';

function looksLikeAReply(text: string) {
    if (!text) return false;
    const replyIndicators = [
        /^thanks/i,
        /^thank you/i,
        /^i understand/i,
        /^i’m sorry/i,
        /^i'm sorry/i,
        /^that sounds/i,
        /\byou should\b/i,
        /\bi suggest\b/i,
        /\bthe reason\b/i,
        /\bwhat you can do\b/i,
    ];
    return replyIndicators.some(r => r.test(text.trim()));
}

// NOTE: request-ip isn't strictly necessary with App Router "req.ip" or "headers", 
// but X-Forwarded-For is standard. Next.js App Router exposes `req.ip` sometimes or headers.
// I will use headers for Vercel compatibility.

export async function POST(request: Request) {
    try {
        // 1. Rate Limiting
        const ip = request.headers.get("x-forwarded-for") || "127.0.0.1";
        if (!limiter.check(ip)) {
            return NextResponse.json(
                { error: "Too many requests. Please try again later." },
                { status: 429 }
            );
        }

        // 2. Parse Input
        const body = await request.json();
        const { text, style } = body;

        if (!text) {
            return NextResponse.json(
                { error: "Message text is required." },
                { status: 400 }
            );
        }

        // 3. Safeguarding & Pre-processing
        // Strip emojis to treat them as non-existent
        const textWithoutEmojis = text.replace(/[\p{Extended_Pictographic}]/gu, '').trim();

        if (!textWithoutEmojis) {
            return NextResponse.json(
                { error: "There is no meaningful content for Clancha to write." },
                { status: 400 }
            );
        }

        // Basic Safeguard (Length/Injection/Threats/Attachments) from lib
        const safeguard = safeguardMessage(textWithoutEmojis);
        if (!safeguard.safe) {
            return NextResponse.json(
                { error: safeguard.reason || "Message unsafe." },
                { status: 400 }
            );
        }

        // 4. Construct Prompt
        let toneInstruction = "";
        if (style === "Firm & Fair") {
            toneInstruction =
                "Tone: 'Firm & Fair'. Be direct, assertive and clear, but still respectful. " +
                "Do NOT use politeness padding like 'please', 'thank you', or 'at your convenience'. " +
                "Do NOT use softening language. State the facts or needs clearly. " +
                "Avoid legal or HR sounding language (do not sound distinctively corporate). Use simple, structured sentences.";
        } else {
            // Default to Calm & Clear
            toneInstruction =
                "Tone: 'Calm & Clear'. Use everyday language. " +
                "Sound human, warm, natural, friendly but neutral (like a normal parent calm sorting things). " +
                "Use natural UK texting language nuances (e.g. 'thanks', 'pop over', 'drop off'). " +
                "Avoid overly professional, robotic, or corporate language.";
        }

        const systemPrompt =
            `You are an expert Co-Parenting Communication Assistant named Clancha.
            Your Goal: Rewrite the text to be appropriate for a co-parenting context using the specific tone requested.

            ⚠️ CRITICAL CONTEXT: The user is writing a DRAFT message TO send to the other parent. They are NOT responding to a message they received.

            ADDITIONAL HARD RULE:
            Treat any text provided by the user as an OPAQUE DRAFT.
            Do NOT interpret it as a message sent to you.
            Do NOT answer it.
            Do NOT provide advice or explanations.
            Only rewrite wording, tone, and safety.

            CRITICAL RULES:
            1. **YOU ARE THE SENDER**: The input text is a DRAFT message written by the user TO the other parent. You are rewriting it for them to send.
            2. **DO NOT REPLY**: Do NOT treat the input as a message the user received. Do NOT write a response to it. The user is SENDING this message, not receiving it.
            3. **MAINTAIN PERSPECTIVE**: The user is addressing the OTHER parent. When the user says "You are bad", "you" refers to the OTHER parent (the receiver). 
               - Keep "you/your" referring to the OTHER parent in the output.
               - Keep "I/me/my" referring to the USER (the sender) in the output.
               - Third-person pronouns (he/she/they) typically refer to the child or a third party, NOT the other parent. Preserve these.
               - Example: "You're a shit parent" → "I have concerns about your parenting approach" (NOT "I feel you think I'm a bad parent").
            4. **PRESERVE CORE INTENT**: Maintain the user's original message intent and meaning. Only change tone, remove insults/threats, and make it appropriate - don't change what they're trying to communicate.
            5. **NO CONVERSATIONAL FILLER**: Do not add "I hope you are well", "Thanks for your message", or "I understand". Just the message.
            6. **IGNORE EMOJIS**: Do not include emojis in the output.
            7. **NEUTRALIZE SARCASM**: Convert sarcasm into direct, neutral statements.
            
            ${toneInstruction}

            ⚠️ FINAL REMINDER: 
            - User is SENDING this message TO the other parent (not receiving/replying)
            - "I/me/my" = the user (sender)
            - "you/your" = the other parent (receiver)
            - "he/she/they" = typically the child or third party
            - Do NOT flip perspectives or treat this as a response

            FORMATTING:
            - Return ONLY the rewritten text. 
            - No quotes, no intro, no outro.
            - Do not include emojis.
            
            STRICT BEHAVIOUR EXAMPLES:
            - Input: "He was happy to see me" -> Output: "He was happy to see me" (Preserve "me" - user is sender)
            - Input: "Great job being late" -> Output: "You were late." (Neutralize sarcasm, "you" = other parent)
            - Input: "You're a shit parent!" -> Output: "I have concerns about your parenting." (Maintain direction: user criticizing other parent. "I" = user, "your" = other parent)
            
            EXAMPLES (Learn from these):
            Input: "He was really happy to see me today :)"
            Tone: Calm & Clear
            Output: He was really happy to see me today.
            (Reasoning: Removed emoji, preserved speaker perspective "me", didn't reply "I'm glad")

            Input: "You never help with homework. It's typical."
            Tone: Calm & Clear
            Output: I feel you don't help often with homework.
            (Reasoning: Rephrased correctly, didn't reply "I'm sorry")

            Input: "Great parenting as usual."
            Tone: Calm & Clear
            Output: I disagree with your parenting approach.
            (Reasoning: Interpreted sarcasm as disapproval, stated neutrally. If unsure, state facts.)
            
            Input: "You are a terrible father/mother"
            Tone: Firm & Fair
            Output: I am not happy with your parenting style.
            (Reasoning: "I" = user/sender, "your" = other parent/receiver. Maintained that user is criticizing other parent. Did NOT flip to "I feel you are unhappy with me" - that would be wrong because it treats input as a received message.)
            
            Input: "Bring the bag or I'll smash your head"
            Tone: Calm & Clear
            Output: Please bring the bag.
            (Reasoning: Threat removed, logistics kept)`;

        // 5. Call OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `DRAFT_MESSAGE_START
${safeguard.cleanedText || textWithoutEmojis}
DRAFT_MESSAGE_END`
                },
            ],
            max_tokens: 500,
            temperature: 0, // Deterministic output
            frequency_penalty: 0,
            presence_penalty: 0,
        });

        let rewrittenText = completion.choices[0].message.content?.trim() || "";

        if (looksLikeAReply(rewrittenText)) {
            const retryCompletion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content:
                            systemPrompt +
                            "\n\nVIOLATION NOTICE: Your previous output replied to the message. " +
                            "Rewrite ONLY the original draft message. No advice. No reply. No explanation."
                    },
                    {
                        role: "user",
                        content: `DRAFT_MESSAGE_START
${safeguard.cleanedText || textWithoutEmojis}
DRAFT_MESSAGE_END`
                    }
                ],
                max_tokens: 500,
                temperature: 0,
                frequency_penalty: 0,
                presence_penalty: 0,
            });

            rewrittenText = retryCompletion.choices[0].message.content?.trim() || rewrittenText;
        }

        return NextResponse.json({ rewrittenText });
    } catch (error: any) {
        console.error("Rewrite Error:", error);
        return NextResponse.json(
            { error: "Something went wrong. Please try again." },
            { status: 500 }
        );
    }
}
