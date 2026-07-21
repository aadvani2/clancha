"use server";

import { headers } from "next/headers";

/**
 * Detects the user's country based on request headers.
 * Avoids heavy local databases like geoip-lite which often break in Next.js.
 */
export async function getUserCountry() {
  const headerList = await headers();
  
  // 1. Vercel Geo-location Header (Production)
  const vercelCountry = headerList.get("x-vercel-ip-country");
  if (vercelCountry && vercelCountry !== "IP") {
    return vercelCountry;
  }

  // 2. Cloudflare Geo-location Header
  const cfCountry = headerList.get("cf-ipcountry");
  if (cfCountry && cfCountry !== "XX") {
    return cfCountry;
  }

  // 3. Accept-Language Header Hint (Best for Localhost/Dev)
  // Usually looks like "en-US,en;q=0.9" or "hi-IN,hi;q=0.8"
  const languages = headerList.get("accept-language");
  if (languages) {
    const primaryLang = languages.split(",")[0]; 
    const countryMatch = primaryLang.split("-")[1];
    if (countryMatch && countryMatch.length === 2) {
      return countryMatch.toUpperCase();
    }
  }

  // 4. Final Fallback
  return "US"; 
}
