/** Roles that may access moderation queue, review, and image moderator APIs. */
export function canAccessModeration(role: string | undefined): boolean {
  return role === "moderator" || role === "admin" || role === "super_admin";
}
