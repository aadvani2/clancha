import { redirect } from "next/navigation";

// Canonical admin path. The AI prompt management UI lives at /admin/prompts;
// /admin/ai-prompts is kept as a permanent alias so the /admin/* namespace
// resolves consistently (M4 tracker #86).
export default function AdminAiPromptsRedirect() {
  redirect("/admin/prompts");
}
