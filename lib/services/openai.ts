import OpenAI from "openai";
import { safeguardMessage } from "@/lib/safeguard";
import { getActivePrompt } from "./promptStore";
import { assertOpenAIOperational } from "./outageSimulation";
import { toGsm7Safe } from "@/lib/messaging/gsm7";

// Central model constants — change here to upgrade.
// Both classifier and rewriter on gpt-5.4-mini: newest mini-tier model
// (confirmed live via the OpenAI /v1/models endpoint — there is no
// gpt-5.5-mini yet, only gpt-5.5/gpt-5.5-pro), strong instruction adherence,
// low latency (the safety path runs on every inbound SMS, so speed matters).
// Previously gpt-5-mini, upgraded from gpt-4o-mini, which would treat "Fuck
// off" as safe profanity and confabulate third-party-narrator output rather
// than holding. If classifier needs more capacity later, bump to "gpt-5.5".
const CLASSIFIER_MODEL = "gpt-5.4-mini";
const REWRITER_MODEL = "gpt-5.4-mini";

export const HOLD_SENTINEL = "__HOLD_FOR_MODERATION__";

// Lazy resolution: Next.js may load env at runtime; reading at call time ensures key is available
function getApiKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY_LIVE ??
    process.env.OPENAI_API_KEY_DEMO ??
    process.env.OPENAI_API_KEY
  );
}

let client: OpenAI | null = null;
let clientApiKey: string | undefined;

export function getOpenAIClient(): OpenAI | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!client || clientApiKey !== apiKey) {
    client = new OpenAI({ apiKey });
    clientApiKey = apiKey;
  }
  return client;
}

export type Classification = "safe" | "unsafe" | "uncertain";

export interface ClassifyResult {
  classification: Classification;
  rewrittenText: string | null;
  flags: string[];
  violationTags: string[]; // Added: Specific tags like 'Sarcasm', 'Hostility'
}

// Patterns that indicate the model is REPLYING to the draft instead of rewriting it.
function looksLikeAReply(text: string): boolean {
  if (!text) return false;
  const replyIndicators = [
    /^thanks/i,
    /^thank you/i,
    /^i understand/i,
    /^i['']m sorry/i,
    /^that sounds/i,
    /\byou should\b/i,
    /\bi suggest\b/i,
    /\bthe reason\b/i,
    /\bwhat you can do\b/i,
  ];
  return replyIndicators.some((r) => r.test(text.trim()));
}

// Patterns that indicate the model is AUTHORING third-party-narrator content
// (system-voice chastisement, behavioural analysis) rather than rewriting the
// draft. Observed real failures: "Please refrain from using that language",
// "I have serious concerns about your behaviour". When detected we route to
// HOLD rather than retrying — invention is a routing signal, not a prompt bug.
function looksLikeInventedContent(text: string): boolean {
  if (!text) return false;
  const invented = [
    /^please refrain\b/i,
    /^please stop\b/i,
    /^i have (serious )?concerns about your (behaviour|behavior|language|tone)\b/i,
    /^i('m| am) concerned about your (behaviour|behavior|language|tone)\b/i,
    /^let['']s keep (this|things|it) (civil|respectful|polite)\b/i,
    /^let['']s try to (be|stay|keep things) (civil|respectful|polite|calm)\b/i,
    /\bthat['']s not appropriate\b/i,
    /\bthat kind of language\b/i,
  ];
  return invented.some((r) => r.test(text.trim()));
}

async function getRewriteSystemPrompt(toneInstruction: string): Promise<string> {
  const template = await getActivePrompt("rewrite_system");
  return template.replace("{{TONE_INSTRUCTION}}", toneInstruction);
}

async function rewriteForCoParenting(
  text: string,
  tone: "calm_clear" | "firm_fair"
): Promise<string> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error(
      "OpenAI client not configured. Set OPENAI_API_KEY (or OPENAI_API_KEY_LIVE / OPENAI_API_KEY_DEMO) in .env"
    );
  }

  const toneInstruction = await getActivePrompt(
    tone === "firm_fair" ? "tone_firm_fair" : "tone_calm_clear"
  );

  const systemPrompt = await getRewriteSystemPrompt(toneInstruction);

  // User content is wrapped in DRAFT_MESSAGE_START/END delimiters AND literal
  // quotes — belt-and-braces signal that this is third-person material the
  // model is rewriting, not a message addressed to it.
  const userContent = `DRAFT_MESSAGE_START
"${text}"
DRAFT_MESSAGE_END`;

  const completion = await openai.chat.completions.create({
    model: REWRITER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    // gpt-5 family constraints:
    //  - max_completion_tokens replaces max_tokens
    //  - reasoning_effort:"none" zeroes reasoning tokens so the whole budget goes
    //    to actual output (without it, output is empty + finish_reason="length").
    //    gpt-5.4-mini rejects "minimal" (gpt-5-mini's value) — only accepts
    //    none/low/medium/high/xhigh.
    //  - temperature is not configurable (only default of 1 is supported) — omit it
    max_completion_tokens: 500,
    reasoning_effort: "none",
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  let rewrittenText = completion.choices[0].message.content?.trim() || "";

  if (!rewrittenText) {
    console.warn("[openai] Empty rewrite response for input length:", text.length);
  }

  // Authored third-party-narrator content (e.g. "Please refrain...", "I have
  // serious concerns about your behaviour") means the rewriter tried to fill a
  // void with system voice. Hold for moderation — never deliver invention.
  if (looksLikeInventedContent(rewrittenText)) {
    console.warn("[openai] Rewriter authored third-party content — holding for moderation", {
      originalLength: text.length,
      outputPreview: rewrittenText.slice(0, 80),
    });
    return HOLD_SENTINEL;
  }

  if (looksLikeAReply(rewrittenText)) {
    const retryCompletion = await openai.chat.completions.create({
      model: REWRITER_MODEL,
      messages: [
        {
          role: "system",
          content:
            systemPrompt +
            "\n\nVIOLATION NOTICE: Your previous output replied to the message. " +
            "Rewrite ONLY the original draft message. No advice. No reply. No explanation.",
        },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 500,
      reasoning_effort: "none",
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    rewrittenText = retryCompletion.choices[0].message.content?.trim() || rewrittenText;
    // Re-check after retry: if it still looks like invented content or a reply,
    // hold rather than deliver.
    if (looksLikeInventedContent(rewrittenText) || looksLikeAReply(rewrittenText)) {
      return HOLD_SENTINEL;
    }
  }

  return rewrittenText;
}

async function classifyMessage(text: string): Promise<{ classification: Classification; tags: string[] }> {
  const openai = getOpenAIClient();
  if (!openai) return { classification: "uncertain", tags: ["Env Error"] };
  const classifySystem = await getActivePrompt("classify_system");
  const res = await openai.chat.completions.create({
    model: CLASSIFIER_MODEL,
    messages: [
      { role: "system", content: classifySystem },
      { role: "user", content: `Message: "${text}"` },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 100,
    reasoning_effort: "none",
  });
  const content = res.choices[0]?.message?.content;
  if (!content) return { classification: "uncertain", tags: ["API Error"] };
  try {
    const parsed = JSON.parse(content) as { classification?: string; tags?: string[] };
    const c = (parsed.classification?.toLowerCase() || "uncertain") as Classification;
    const tags = parsed.tags || [];
    return { classification: c, tags };
  } catch {
    return { classification: "uncertain", tags: ["Parse Error"] };
  }
}

/**
 * Classify and rewrite using co-parenting logic:
 * 1. Safeguard pre-validation (blocks threats, slurs, attachments at the regex layer)
 * 2. Classify: safe/unsafe/uncertain (catches semantic threats safeguard misses)
 * 3. Co-parenting rewrite (handles tone — sarcasm, blame, passive-aggressive)
 */
export async function classifyAndRewrite(
  originalText: string,
  tone: "calm_clear" | "firm_fair",
  skipClassification: boolean = false
): Promise<ClassifyResult> {
  const textWithoutEmojis = originalText.replace(
    /[\p{Extended_Pictographic}]/gu,
    ""
  ).trim();

  if (!textWithoutEmojis) {
    return {
      classification: "unsafe",
      rewrittenText: null,
      flags: ["No meaningful content"],
      violationTags: [],
    };
  }

  const safeguard = safeguardMessage(textWithoutEmojis);
  if (!safeguard.safe) {
    return {
      classification: "unsafe",
      rewrittenText: null,
      flags: [safeguard.reason ?? "Message unsafe"],
      violationTags: [],
    };
  }

  const inputText = safeguard.cleanedText ?? textWithoutEmojis;

  // Admin-toggleable outage simulation (M4 tracker #58). When the flag is on
  // this throws and the rewritePipeline catch holds the message and emits a
  // service_failure_openai audit log — exactly what a real outage produces.
  // Place AFTER the safeguard so unsafe messages still block normally even
  // during a simulated outage (safeguard is regex-only, no OpenAI call).
  await assertOpenAIOperational();

  try {
    const { classification, tags } = skipClassification
      ? ({ classification: "safe", tags: [] } as { classification: Classification; tags: string[] })
      : await classifyMessage(inputText);

    // If the classifier already says block/hold, skip the rewrite call entirely
    // (saves cost; rewrite output is not used in those branches).
    if (classification === "unsafe") {
      return {
        classification,
        rewrittenText: null,
        violationTags: tags,
        flags: skipClassification ? [] : ["AI flagging active", ...tags],
      };
    }

    const rewrittenText = await rewriteForCoParenting(inputText, tone);

    // Sentinel from rewriter: input was pure abuse with no rewritable proposition,
    // or model produced authored content. Override to uncertain → routes to held.
    if (rewrittenText?.trim() === HOLD_SENTINEL) {
      return {
        classification: "uncertain",
        rewrittenText: null,
        violationTags: ["RewriterInventedContent", ...tags],
        flags: ["AI flagging active", "RewriterInventedContent", ...tags],
      };
    }

    // GSM-7 normalisation (Craig, M4 feedback 05/07/26 §1.2): straighten
    // curly quotes/dashes so the stored + delivered text stays in the cheap
    // SMS encoding. Rendering only — wording is untouched. Applied to the
    // fallback path too, since iPhone smart punctuation lands in originals.
    const finalText = toGsm7Safe(rewrittenText?.trim() || inputText);

    // At this point classification is "safe" or "uncertain" (unsafe early-returned above).
    return {
      classification,
      rewrittenText: finalText,
      violationTags: tags,
      flags:
        !skipClassification && classification === "uncertain"
          ? ["AI flagging active", ...tags]
          : [],
    };
  } catch (error) {
    throw error;
  }
}
