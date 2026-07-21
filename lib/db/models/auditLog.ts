import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const AUDIT_ACTIONS = [
  "invite_created",
  "invite_accepted",
  "invite_expired",
  "invite_revoked",
  "viewer_access_granted",
  "viewer_access_revoked",
  "viewer_accessed_channel",
  "viewer_viewed_messages",
  "message_channel_blocked",
  "message_queued",
  "message_queued_notification_sent",
  "message_delivered",
  "message_blocked",
  "message_moderator_approved",
  "message_moderator_denied",
  "message_moderator_retry_rewrite",
  "message_held",
  "image_uploaded",
  "image_ai_scan_pending",
  "image_ai_approved",
  "image_ai_scan_rejected",
  "image_moderator_approved",
  "image_moderator_denied",
  "image_retention_purge",
  "message_emergency_delivered",
  "message_emergency_trigger_ignored",
  "channel_state_change",
  "channel_admin_suspend",
  "channel_admin_cancel",
  "channel_admin_uncancel",
  "channel_admin_reactivate",
  "channel_admin_close",
  "channel_payment_failed_view_only",
  "channel_creation_payment_failed",
  "channel_trial_expired",
  // System-wide (not channel-scoped). Added 2026-05-20 per M4 tracker #52.
  "admin_password_login",
  "admin_password_login_failed",
  "prompt_edited",
  "prompt_rolled_back",
  "moderator_created",
  "moderator_removed",
  "moderator_updated",
  // Service failures — surface infra outages alongside business events so the
  // activity page is a single pane of glass (M4 tracker #59). channelId
  // optional because some failures happen outside any specific message
  // context (e.g. outbox dead-letter scheduling).
  "service_failure_twilio",
  "service_failure_openai",
  // Viewer consent state machine (M4 tracker #37, Doc 3 Appendix A13–A16).
  "viewer_other_parent_approved",
  "viewer_other_parent_restricted",
  "viewer_left_channel",
  "invite_password_failed",
  // Stripe Checkout setup-mode completion that attaches a default PM and
  // then bumps the existing subscription (M4 tracker #68).
  "payment_method_attached_via_checkout",
  // Q&A engine outcomes (M4 tracker #32/#33). qa_answered = clean response
  // returned. qa_fabrication_blocked = answer contained a quoted span not in
  // history; we refused on the user's behalf.
  "qa_answered",
  "qa_fabrication_blocked",
  // Picture Sharing add-on scheduled removal reached its period end (#82) —
  // written by the subscription.deleted webhook (standalone add-on sub) and
  // the cron reconciliation (creator's bundled line item).
  "picture_sharing_removed",
  // Test-environment data reset (M4 tracker #95, Craig's request). Only ever
  // runs against a Stripe test account; never live. test_user_deleted = a
  // single test user hard-deleted; test_data_reset = full wipe of test data.
  "test_user_deleted",
  "test_data_reset",
  // Super admin opened the full, read-only channel message history (both
  // parents' originals + rewrites) from the admin channel detail page
  // (M4 tracker #88). Logged on every successful fetch for the audit trail.
  "admin_viewed_channel_messages",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface IAuditLog extends Document {
  action: AuditAction;
  // Optional: system-wide events (login, prompt edit, moderator CRUD) are
  // not channel-scoped. Channel-scoped events still set this.
  channelId?: Types.ObjectId | null;
  actorUserId?: Types.ObjectId;
  targetUserId?: Types.ObjectId;
  inviteId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      required: true,
      enum: AUDIT_ACTIONS,
      index: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      // System-wide events (login, prompt edit, moderator CRUD) have no
      // channel. Channel-scoped events still set this. The index still helps
      // for the (channelId, createdAt) compound query.
      required: false,
      default: null,
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    inviteId: {
      type: Schema.Types.ObjectId,
      ref: "Invite",
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

auditLogSchema.index({ channelId: 1, createdAt: -1 });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ targetUserId: 1, createdAt: -1 });

if (mongoose.models.AuditLog) {
  delete (mongoose.models as any).AuditLog;
}
export const AuditLog: Model<IAuditLog> =
  mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
