import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IJoinToken extends Document {
  tokenHash: string;
  userId: Types.ObjectId;
  channelId: Types.ObjectId;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const joinTokenSchema = new Schema<IJoinToken>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const JoinToken: Model<IJoinToken> =
  mongoose.models.JoinToken ??
  mongoose.model<IJoinToken>("JoinToken", joinTokenSchema);
