import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IPhoneNumber extends Document {
  number: string;
  channelId: Types.ObjectId | null;
  isActive: boolean;
  createdAt: Date;
}

const phoneNumberSchema = new Schema<IPhoneNumber>(
  {
    number: { type: String, required: true, unique: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

phoneNumberSchema.index({ channelId: 1 });
phoneNumberSchema.index({ number: 1, channelId: 1 });

export const PhoneNumber: Model<IPhoneNumber> =
  mongoose.models.PhoneNumber ??
  mongoose.model<IPhoneNumber>("PhoneNumber", phoneNumberSchema);
