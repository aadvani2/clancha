import { getOpenAIClient } from "./openai";
import { getActivePrompt } from "./promptStore";

export interface ImageModerationResult {
  decision: "approved" | "denied" | "pending";
  classification: "safe" | "unsafe" | "uncertain";
  reason: string;
  score: number;
  tags: string[];
}

export async function moderateImage(imageUrl: string): Promise<ImageModerationResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    return {
      decision: "pending",
      classification: "uncertain",
      reason: "OpenAI client not configured",
      score: 0.5,
      tags: ["Env Error"],
    };
  }

  try {
    const systemPrompt = await getActivePrompt("image_moderate_system");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Please moderate this image." },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("Empty AI response");

    const result = JSON.parse(content);
    return {
      decision: result.decision || "pending",
      classification: result.classification || "uncertain",
      reason: result.reason || "Processed by AI",
      score: typeof result.score === "number" ? result.score : 0.5,
      tags: Array.isArray(result.tags) ? result.tags : [],
    };
  } catch (error) {
    console.error("[imageModeration] Error:", error);
    return {
      decision: "pending",
      classification: "uncertain",
      reason: "AI processing failed",
      score: 0.5,
      tags: ["Processing Error"],
    };
  }
}
