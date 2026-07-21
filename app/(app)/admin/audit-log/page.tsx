import { redirect } from "next/navigation";

// Canonical admin path. The audit log is rendered by the Activity page at
// /activity (which shows the full audit trail for admins); /admin/audit-log is
// kept as a permanent alias so the /admin/* namespace resolves (M4 tracker #86).
export default function AdminAuditLogRedirect() {
  redirect("/activity");
}
