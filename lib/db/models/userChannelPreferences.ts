import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const REWRITE_TONES = ["calm_clear", "firm_fair"] as const;
export type RewriteTone = (typeof REWRITE_TONES)[number];

export interface IUserChannelPreferences extends Document {
  userId: Types.ObjectId;
  channelId: Types.ObjectId;
  rewriteTone: RewriteTone;
  createdAt: Date;
  updatedAt: Date;
}

const userChannelPreferencesSchema = new Schema<IUserChannelPreferences>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    rewriteTone: {
      type: String,
      enum: REWRITE_TONES,
      default: "calm_clear",
    },
  },
  { timestamps: true }
);

userChannelPreferencesSchema.index({ userId: 1, channelId: 1 }, { unique: true });

export const UserChannelPreferences: Model<IUserChannelPreferences> =
  mongoose.models.UserChannelPreferences ??
  mongoose.model<IUserChannelPreferences>(
    "UserChannelPreferences",
    userChannelPreferencesSchema
  );
