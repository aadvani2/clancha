import { ChannelViewer, Channel } from "@/lib/db/models";
import type { ViewerVisibility } from "@/lib/db/models";
import type { Types } from "mongoose";

export interface ViewerAccessResult {
  canAccess: boolean;
  isViewer: boolean;
  isMember: boolean;
  accessLevel?: "read_only" | "read_write";
  visibility?: ViewerVisibility;
  viewerId?: string;
  /** The channel member who invited this viewer. Used by the messages route
   * to decide which parent's originals are visible to the viewer. */
  invitingParentUserId?: string;
  /** When true, the non-inviting parent has opted in to share their own
   * originals with the viewer. When false (default), only the inviting
   * parent's originals are visible. */
  otherParentApproved?: boolean;
}

export async function canAccessChannel(
  userId: string,
  channelId: string
): Promise<ViewerAccessResult> {
  const channel = await Channel.findById(channelId).lean();
  if (!channel) {
    return { canAccess: false, isViewer: false, isMember: false };
  }

  const isMember = (channel.users as Types.ObjectId[]).some(
    (id) => id.toString() === userId
  );

  if (isMember) {
    return { canAccess: true, isViewer: false, isMember: true };
  }

  const viewer = await ChannelViewer.findOne({
    channelId,
    userId,
    status: "active",
  }).lean();

  if (viewer) {
    return {
      canAccess: true,
      isViewer: true,
      isMember: false,
      accessLevel: viewer.accessLevel,
      visibility: viewer.visibility ?? "rewrites_only",
      viewerId: viewer._id.toString(),
      invitingParentUserId: viewer.grantedByUserId?.toString(),
      otherParentApproved: !!viewer.otherParentApproved,
    };
  }

  return { canAccess: false, isViewer: false, isMember: false };
}

export async function updateViewerLastAccess(viewerId: string): Promise<void> {
  await ChannelViewer.findByIdAndUpdate(viewerId, {
    lastAccessedAt: new Date(),
  });
}

export async function getActiveViewersForChannel(
  channelId: string
): Promise<
  Array<{
    id: string;
    userId: string;
    email: string;
    name: string | null;
    accessLevel: string;
    visibility: ViewerVisibility;
    invitingParentUserId: string;
    otherParentApproved: boolean;
    grantedAt: Date;
    lastAccessedAt: Date | null;
  }>
> {
  const viewers = await ChannelViewer.find({
    channelId,
    status: "active",
  })
    .populate("userId", "email name")
    .lean();

  return viewers.map((v) => {
    const populatedUser = v.userId as unknown as { email?: string; name?: string };
    return {
      id: v._id.toString(),
      userId: (v.userId as unknown as { _id?: Types.ObjectId })._id?.toString() ?? v.userId.toString(),
      email: populatedUser.email ?? "",
      name: populatedUser.name ?? null,
      accessLevel: v.accessLevel,
      visibility: (v.visibility ?? "rewrites_only") as ViewerVisibility,
      invitingParentUserId: v.grantedByUserId.toString(),
      otherParentApproved: !!v.otherParentApproved,
      grantedAt: v.createdAt,
      lastAccessedAt: v.lastAccessedAt ?? null,
    };
  });
}

export async function revokeViewerAccess(
  viewerId: string,
  revokedByUserId: string
): Promise<boolean> {
  const result = await ChannelViewer.findByIdAndUpdate(viewerId, {
    status: "revoked",
    revokedAt: new Date(),
    revokedByUserId,
  });
  return !!result;
}
