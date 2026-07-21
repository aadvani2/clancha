import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const IMAGE_STATES = [
  "pending",
  "approved",
  "denied",
] as const;
export type ImageState = (typeof IMAGE_STATES)[number];

export interface IImage extends Document {
  channelId: Types.ObjectId;
  senderId: Types.ObjectId;
  storageUrl: string;
  thumbnailUrl?: string; // Made optional
  state: ImageState;
  aiScore?: number;      // Added
  aiReason?: string;     // Added
  violationTags: string[]; // Added
  classification?: string; // Added (e.g. 'unsafe', 'uncertain')
  moderatorId?: Types.ObjectId;
  moderatorNotes?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const imageSchema = new Schema<IImage>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storageUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    state: {
      type: String,
      required: true,
      enum: IMAGE_STATES,
      default: "pending",
    },
    aiScore: { type: Number, default: null },
    aiReason: { type: String, default: null },
    violationTags: { type: [String], default: [] },
    classification: { type: String, default: null },
    moderatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    moderatorNotes: { type: String, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

imageSchema.index({ channelId: 1 });
imageSchema.index({ state: 1 });
imageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Image: Model<IImage> =
  mongoose.models.Image ?? mongoose.model<IImage>("Image", imageSchema);
