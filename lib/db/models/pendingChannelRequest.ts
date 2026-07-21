import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IPendingChild {
  name: string;
  dob?: string | null;
}

/**
 * Stores a request for a channel (first or subsequent). Created at the moment
 * the user fills the channel-setup form; materialised into a real Channel by
 * the invoice.paid webhook once Stripe confirms payment. Carries the full
 * prefilled-details payload so the resulting channel is fully configured —
 * not an "Unnamed" placeholder the user has to flesh out via settings later.
 */
export interface IPendingChannelRequest extends Document {
  userId: Types.ObjectId;
  otherUserPhone: string;
  pictureShareEnabled: boolean;
  recipientName?: string | null;
  recipientEmail?: string | null;
  emergencyBypassEnabled?: boolean;
  rewriteTone?: "calm_clear" | "firm_fair";
  receivingHoursStart?: string | null;
  receivingHoursEnd?: string | null;
  timezone?: string | null;
  children?: IPendingChild[];
  createdAt: Date;
  updatedAt: Date;
}

const pendingChannelRequestSchema = new Schema<IPendingChannelRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    otherUserPhone: { type: String, required: true },
    pictureShareEnabled: { type: Boolean, default: false },
    recipientName: { type: String, default: null },
    recipientEmail: { type: String, default: null },
    emergencyBypassEnabled: { type: Boolean, default: true },
    rewriteTone: { type: String, enum: ["calm_clear", "firm_fair"], default: "calm_clear" },
    receivingHoursStart: { type: String, default: null },
    receivingHoursEnd: { type: String, default: null },
    timezone: { type: String, default: null },
    children: {
      type: [{ name: { type: String, required: true }, dob: { type: String, default: null } }],
      default: [],
    },
  },
  { timestamps: true }
);

pendingChannelRequestSchema.index({ userId: 1, createdAt: 1 });

export const PendingChannelRequest: Model<IPendingChannelRequest> =
  mongoose.models.PendingChannelRequest ??
  mongoose.model<IPendingChannelRequest>("PendingChannelRequest", pendingChannelRequestSchema);
