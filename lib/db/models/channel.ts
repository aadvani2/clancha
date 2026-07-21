import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const CHANNEL_STATES = [
  "trial",
  "active",
  "view_only",
  "closed",
] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

export interface ILinkedChild {
  name: string;
  dob?: string | null;
}

export interface IChannel extends Document {
  users: Types.ObjectId[];
  clanchaNumber: string;
  name?: string;
  state: ChannelState;
  pictureShareEnabled: boolean;
  // Which user enabled and is billed for the Picture Sharing add-on (User A
  // the creator, or User B the joiner). Whoever toggles, pays (#81) — this
  // records who, so disable acts on the right customer/subscription and the
  // UI can show who's paying. Null when the add-on is off.
  pictureAddonPurchasedBy?: Types.ObjectId | null;
  // When set, Picture Sharing is scheduled to switch off at this date — the
  // user toggled it off mid-cycle but keeps access until the period end they
  // already paid for (#82). Reconciled by the cron sweep, which flips
  // pictureShareEnabled to false once the date passes. Cleared on re-enable.
  pictureShareRemoveAt?: Date | null;
  emergencyBypassEnabled: boolean;
  subscriptionId?: Types.ObjectId | null;
  linkedChildren: ILinkedChild[];
  // Recipients who have already received the A1 first-contact intro on this
  // channel. Persistent once-per-recipient guard (Craig, M4 feedback
  // 05/07/26 §1.5) — claimed atomically via $addToSet before sending, so a
  // concurrent pair of "first" messages can never double-send A1.
  a1SentTo: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const channelSchema = new Schema<IChannel>(
  {
    users: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: {
        validator: (v: Types.ObjectId[]) => v.length === 2,
        message: "Channel must have exactly 2 users",
      },
    },
    clanchaNumber: { type: String, required: true },
    name: { type: String, default: null },
    state: {
      type: String,
      required: true,
      enum: CHANNEL_STATES,
      default: "trial",
    },
    pictureShareEnabled: { type: Boolean, default: false },
    pictureAddonPurchasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    pictureShareRemoveAt: { type: Date, default: null },
    emergencyBypassEnabled: { type: Boolean, default: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription", default: null },
    linkedChildren: {
      type: [{ name: { type: String, required: true }, dob: { type: String, default: null } }],
      default: [],
    },
    a1SentTo: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { timestamps: true }
);

channelSchema.index({ clanchaNumber: 1 });
channelSchema.index({ users: 1 });
channelSchema.index({ subscriptionId: 1 });

export const Channel: Model<IChannel> =
  mongoose.models.Channel ?? mongoose.model<IChannel>("Channel", channelSchema);
