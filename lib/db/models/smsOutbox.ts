import mongoose, { Schema, Document, Model } from "mongoose";

export const SMS_OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type SmsOutboxStatus = (typeof SMS_OUTBOX_STATUSES)[number];

export interface ISmsOutbox extends Document {
  to: string;
  body: string;
  fromNumberOverride?: string | null;
  imageUrl?: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  status: SmsOutboxStatus;
  lastError?: string | null;
  sid?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsOutboxSchema = new Schema<ISmsOutbox>(
  {
    to: { type: String, required: true },
    body: { type: String, required: true },
    fromNumberOverride: { type: String, default: null },
    imageUrl: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextAttemptAt: { type: Date, required: true, default: () => new Date() },
    status: { type: String, enum: SMS_OUTBOX_STATUSES, default: "pending" },
    lastError: { type: String, default: null },
    sid: { type: String, default: null },
  },
  { timestamps: true }
);

smsOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

export const SmsOutbox: Model<ISmsOutbox> =
  mongoose.models.SmsOutbox ?? mongoose.model<ISmsOutbox>("SmsOutbox", smsOutboxSchema);
