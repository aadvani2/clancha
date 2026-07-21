import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const PENDING_CHANNEL_INVITE_STATUSES = ["pending", "accepted", "expired"] as const;
export type PendingChannelInviteStatus = (typeof PENDING_CHANNEL_INVITE_STATUSES)[number];

export interface IPendingChannelInvite extends Document {
  inviterUserId: Types.ObjectId;
  inviteePhone: string;
  status: PendingChannelInviteStatus;
  expiresAt: Date;
  acceptedAt?: Date;
  channelId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const pendingChannelInviteSchema = new Schema<IPendingChannelInvite>(
  {
    inviterUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    inviteePhone: { type: String, required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: PENDING_CHANNEL_INVITE_STATUSES,
      default: "pending",
    },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date, default: null },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", default: null },
  },
  { timestamps: true }
);

pendingChannelInviteSchema.index({ inviteePhone: 1, status: 1 });

export const PendingChannelInvite: Model<IPendingChannelInvite> =
  mongoose.models.PendingChannelInvite ??
  mongoose.model<IPendingChannelInvite>("PendingChannelInvite", pendingChannelInviteSchema);
