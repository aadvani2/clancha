import mongoose, { Schema, Document, Model } from "mongoose";

export interface IOTP extends Document {
  phone: string;
  code: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

const otpSchema = new Schema<IOTP>(
  {
    phone: { type: String, required: true, index: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, required: true, default: 0, max: 3 },
  },
  { timestamps: true }
);

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OTP: Model<IOTP> =
  mongoose.models.OTP ?? mongoose.model<IOTP>("OTP", otpSchema);
