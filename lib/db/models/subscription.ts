import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const SUBSCRIPTION_PLANS = ["core", "picture_addon"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "trialing",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface ISubscription extends Document {
  userId: Types.ObjectId;
  channelId?: Types.ObjectId | null;
  stripeSubscriptionId?: string | null;
  name?: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  // True while Stripe has cancel_at_period_end set. Channel stays Active
  // until current_period_end; webhook customer.subscription.deleted then
  // transitions it to view_only. Reset to false on Undo. Per Craig
  // 2026-05-26 cancellation clarification.
  cancelAtPeriodEnd: boolean;
  // True for a standalone Picture Sharing add-on subscription that lives on
  // its OWN Stripe subscription (separate from the channel's core sub),
  // billed to whoever enabled the add-on. Used when the joining user — who
  // has no core subscription — turns Picture Sharing on (#81). Core subs are
  // always isAddon=false.
  isAddon: boolean;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: false, default: null },
    stripeSubscriptionId: { type: String, required: false, default: null },
    name: { type: String, default: null },
    plan: { type: String, required: true, enum: SUBSCRIPTION_PLANS },
    status: {
      type: String,
      required: true,
      enum: SUBSCRIPTION_STATUSES,
      default: "trialing",
    },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    isAddon: { type: Boolean, default: false },
    currentPeriodEnd: { type: Date, required: true },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, channelId: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });
subscriptionSchema.index({ channelId: 1 }, { sparse: true });

export const Subscription: Model<ISubscription> =
  mongoose.models.Subscription ??
  mongoose.model<ISubscription>("Subscription", subscriptionSchema);
