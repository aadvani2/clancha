import { NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/services/openai";

/**
 * GET /api/debug/openai-status
 * Returns whether OpenAI is configured (for debugging rewrite issues).
 * Safe to call - does not expose the API key.
 */
export async function GET() {
  const client = getOpenAIClient();
  return NextResponse.json({
    openaiConfigured: client !== null,
    hint: client
      ? null
      : "Set OPENAI_API_KEY, OPENAI_API_KEY_LIVE, or OPENAI_API_KEY_DEMO in .env",
  });
}
