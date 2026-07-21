import { getOpenAIClient } from "./openai";

export type ImageScanResult = "safe" | "unsafe";

const SCAN_SYSTEM = `You are an image content moderator for a co-parenting communication app.
Classify the image into exactly one category:
- safe: Appropriate for co-parenting context. Photos of children, family activities, documents, screenshots, benign content. Nothing inappropriate.
- unsafe: Inappropriate content: nudity, violence, illegal content, harassment, threatening imagery, or content that could harm a co-parenting relationship.

Respond with valid JSON only: { "classification": "safe"|"unsafe" }`;

/**
 * AI safety scan for uploaded images using OpenAI Vision.
 * Returns "safe" -> pending_moderation, "unsafe" -> rejected.
 */
export async function scanImageForSafety(imageUrl: string): Promise<ImageScanResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    console.warn("[imageScan] No OpenAI client; defaulting to unsafe");
    return "unsafe";
  }

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SCAN_SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Classify this image for safety in a co-parenting communication context.",
            },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 50,
      temperature: 0,
    });

    const content = res.choices[0]?.message?.content;
    if (!content) return "unsafe";

    const parsed = JSON.parse(content) as { classification?: string };
    const c = parsed.classification?.toLowerCase();
    return c === "safe" ? "safe" : "unsafe";
  } catch (err) {
    console.error("[imageScan] Error:", err);
    return "unsafe";
  }
}
