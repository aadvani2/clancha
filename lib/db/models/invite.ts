import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const INVITE_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const ACCESS_LEVELS = ["read_only", "read_write"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

// Per spec Doc 1 + M4 tracker item 38: viewers get one of two visibility
// scopes. Neither ever exposes the OTHER channel member's original text
// (that's a separate fail-safe gate at the messages route).
//
//   rewrites_only — viewer sees only `state:"delivered"` messages and
//                   the rewritten body. Cleanest, minimum-exposure default.
//   full_history  — viewer additionally sees system messages and held /
//                   blocked entries (with originals still suppressed), so
//                   they can see the lifecycle, not just the outcomes.
export const VIEWER_VISIBILITIES = ["rewrites_only", "full_history"] as const;
export type ViewerVisibility = (typeof VIEWER_VISIBILITIES)[number];

export interface IInvite extends Document {
  channelId: Types.ObjectId;
  invitedByUserId: Types.ObjectId;
  email: string;
  /** Display name the inviting parent typed for this viewer. Used to address
   * them in invitation emails and in the A11/A13–A16 system messages
   * instead of the bare email address. */
  viewerName?: string | null;
  tokenHash: string;
  accessLevel: AccessLevel;
  visibility: ViewerVisibility;
  status: InviteStatus;
  expiresAt: Date;
  acceptedAt?: Date;
  acceptedByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const inviteSchema = new Schema<IInvite>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    invitedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    viewerName: {
      type: String,
      default: null,
      trim: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    accessLevel: {
      type: String,
      required: true,
      enum: ACCESS_LEVELS,
      default: "read_only",
    },
    visibility: {
      type: String,
      required: true,
      enum: VIEWER_VISIBILITIES,
      default: "rewrites_only",
    },
    status: {
      type: String,
      required: true,
      enum: INVITE_STATUSES,
      default: "pending",
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    acceptedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

inviteSchema.index({ channelId: 1, status: 1 });
inviteSchema.index({ email: 1, status: 1 });
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invite: Model<IInvite> =
  mongoose.models.Invite ?? mongoose.model<IInvite>("Invite", inviteSchema);
