import { cookies, headers } from "next/headers";

export async function getTokenFromCookie(): Promise<string | null> {
  const headersList = await headers();
  const auth = headersList.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? null;
}
