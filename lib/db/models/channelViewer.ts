import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { VIEWER_VISIBILITIES, type ViewerVisibility } from "./invite";

export const VIEWER_STATUSES = ["active", "revoked"] as const;
export type ViewerStatus = (typeof VIEWER_STATUSES)[number];

export interface IChannelViewer extends Document {
  channelId: Types.ObjectId;
  userId: Types.ObjectId;
  inviteId: Types.ObjectId;
  accessLevel: "read_only" | "read_write";
  /**
   * Legacy single-flag visibility. As of Craig 2026-05-22, visibility is
   * derived from grantedByUserId + otherParentApproved (see
   * lib/auth/viewerAuth). Kept on the model only for back-compat with rows
   * created before the consent model existed — new code should not read it.
   */
  visibility: ViewerVisibility;
  /**
   * The "other parent" (i.e. the channel member who did NOT invite this
   * viewer) has approved sharing their own originals. When false, viewer
   * sees adding-parent originals + adding-parent rewrites + other-parent
   * rewrites only. When true, viewer additionally sees other-parent
   * originals. Default false until the other parent opts in.
   */
  otherParentApproved: boolean;
  status: ViewerStatus;
  grantedByUserId: Types.ObjectId;
  revokedAt?: Date;
  revokedByUserId?: Types.ObjectId;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channelViewerSchema = new Schema<IChannelViewer>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    inviteId: {
      type: Schema.Types.ObjectId,
      ref: "Invite",
      required: true,
    },
    accessLevel: {
      type: String,
      required: true,
      enum: ["read_only", "read_write"],
      default: "read_only",
    },
    visibility: {
      type: String,
      required: true,
      enum: VIEWER_VISIBILITIES,
      default: "rewrites_only",
    },
    otherParentApproved: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      required: true,
      enum: VIEWER_STATUSES,
      default: "active",
    },
    grantedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastAccessedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

channelViewerSchema.index({ channelId: 1, userId: 1 }, { unique: true });
channelViewerSchema.index({ channelId: 1, status: 1 });

export const ChannelViewer: Model<IChannelViewer> =
  mongoose.models.ChannelViewer ??
  mongoose.model<IChannelViewer>("ChannelViewer", channelViewerSchema);
