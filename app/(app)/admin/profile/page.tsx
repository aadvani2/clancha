import { redirect } from "next/navigation";

// Canonical admin path. The admin's own profile/settings live on the shared
// Settings page at /settings; /admin/profile is kept as a permanent alias so
// the /admin/* namespace resolves consistently (M4 tracker #86).
export default function AdminProfileRedirect() {
  redirect("/settings");
}
