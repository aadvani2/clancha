import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const MESSAGE_STATES = [
  "received",
  "queued",
  "rewriting",
  "processing", // Added for atomic claim visibility
  "held",
  "blocked",
  "delivered",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export interface IMessage extends Document {
  channelId: Types.ObjectId;
  senderId?: Types.ObjectId | null;
  originalText: string;
  rewrittenText: string;
  state: MessageState;
  isEmergency: boolean;
  isSystem: boolean;
  /**
   * Intended audience of a SYSTEM message. When set, ONLY that user sees the
   * system message in their channel history (privacy/security scoping — e.g. an
   * A1 intro with B's one-shot join token must never surface in A's portal).
   * When null, the system message is treated as visible to all channel members
   * (use only for genuinely shared notices, e.g. "viewer left"). Has no effect
   * on non-system messages.
   */
  systemRecipientUserId?: Types.ObjectId | null;
  providerSid?: string;
  classification?: string | null;
  violationTags: string[];
  imageId?: Types.ObjectId | null;
  moderatorId?: Types.ObjectId | null;
  moderatorNotes?: string | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    originalText: { type: String, required: true },
    rewrittenText: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: MESSAGE_STATES,
      default: "received",
    },
    isEmergency: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    systemRecipientUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    providerSid: { type: String },
    classification: { type: String, default: null },
    violationTags: { type: [String], default: [] },
    imageId: { type: Schema.Types.ObjectId, ref: "Image", default: null },
    moderatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    moderatorNotes: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ channelId: 1 });
messageSchema.index({ channelId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ providerSid: 1 }, { unique: true, sparse: true });

export const Message: Model<IMessage> =
  mongoose.models.Message ?? mongoose.model<IMessage>("Message", messageSchema);
