import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IModeratorAssignment extends Document {
  userId: Types.ObjectId;
  channelId: Types.ObjectId;
  unsafeMessageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const moderatorAssignmentSchema = new Schema<IModeratorAssignment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    unsafeMessageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

moderatorAssignmentSchema.index({ userId: 1, channelId: 1 }, { unique: true });
moderatorAssignmentSchema.index({ channelId: 1 });

if (mongoose.models.ModeratorAssignment) {
  delete (mongoose.models as Record<string, Model<IModeratorAssignment>>).ModeratorAssignment;
}
export const ModeratorAssignment: Model<IModeratorAssignment> = mongoose.model<IModeratorAssignment>(
  "ModeratorAssignment",
  moderatorAssignmentSchema
);
