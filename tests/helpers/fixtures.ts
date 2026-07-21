import mongoose from "mongoose";
import type { IUser, UserRole } from "@/lib/db/models/user";
import type { IChannel, ChannelState } from "@/lib/db/models/channel";
import type { IMessage, MessageState } from "@/lib/db/models/message";
import type { ISubscription, SubscriptionPlan, SubscriptionStatus } from "@/lib/db/models/subscription";

export interface CreateUserOptions {
  phone?: string;
  email?: string;
  role?: UserRole;
  name?: string;
  stripeCustomerId?: string;
}

export function createUserData(options: CreateUserOptions = {}): Omit<IUser, keyof mongoose.Document> {
  const rand = Math.random().toString(36).slice(2, 10);
  return {
    phone: options.phone ?? `+1555${Math.random().toString().slice(2, 9)}`,
    email: options.email ?? `user-${rand}@test.com`,
    role: options.role ?? "user",
    name: options.name,
    stripeCustomerId: options.stripeCustomerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Omit<IUser, keyof mongoose.Document>;
}

export interface CreateChannelOptions {
  users?: mongoose.Types.ObjectId[];
  clanchaNumber?: string;
  state?: ChannelState;
  pictureShareEnabled?: boolean;
  emergencyBypassEnabled?: boolean;
}

export function createChannelData(options: CreateChannelOptions = {}): Omit<IChannel, keyof mongoose.Document> {
  return {
    users: options.users ?? [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
    clanchaNumber: options.clanchaNumber ?? `+1555${Math.random().toString().slice(2, 9)}`,
    state: options.state ?? "trial",
    pictureShareEnabled: options.pictureShareEnabled ?? false,
    emergencyBypassEnabled: options.emergencyBypassEnabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Omit<IChannel, keyof mongoose.Document>;
}

export interface CreateMessageOptions {
  channelId?: mongoose.Types.ObjectId;
  senderId?: mongoose.Types.ObjectId;
  originalText?: string;
  rewrittenText?: string;
  state?: MessageState;
  isEmergency?: boolean;
  deliveredAt?: Date | null;
}

export function createMessageData(options: CreateMessageOptions = {}): Omit<IMessage, keyof mongoose.Document> {
  const state = options.state ?? "delivered";
  const defaultDeliveredAt =
    options.deliveredAt !== undefined
      ? options.deliveredAt
      : state === "delivered"
        ? new Date()
        : null;
  return {
    channelId: options.channelId ?? new mongoose.Types.ObjectId(),
    senderId: options.senderId ?? new mongoose.Types.ObjectId(),
    originalText: options.originalText ?? "Original test message",
    rewrittenText: options.rewrittenText ?? "Rewritten test message",
    state,
    isEmergency: options.isEmergency ?? false,
    deliveredAt: defaultDeliveredAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Omit<IMessage, keyof mongoose.Document>;
}

export interface CreateSubscriptionOptions {
  userId?: mongoose.Types.ObjectId;
  channelId?: mongoose.Types.ObjectId | null;
  stripeSubscriptionId?: string | null;
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
  currentPeriodEnd?: Date;
}

export function createSubscriptionData(
  options: CreateSubscriptionOptions = {}
): Omit<ISubscription, keyof mongoose.Document> {
  const end = new Date();
  end.setMonth(end.getMonth() + 1);
  return {
    userId: options.userId ?? new mongoose.Types.ObjectId(),
    channelId: options.channelId !== undefined ? options.channelId : null,
    stripeSubscriptionId: options.stripeSubscriptionId !== undefined
      ? options.stripeSubscriptionId
      : `sub_test_${Math.random().toString(36).slice(2, 10)}`,
    plan: options.plan ?? "core",
    status: options.status ?? "active",
    currentPeriodEnd: options.currentPeriodEnd ?? end,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Omit<ISubscription, keyof mongoose.Document>;
}

export function generateObjectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

export function generatePhone(): string {
  return `+1555${Math.random().toString().slice(2, 9)}`;
}

export function generateEmail(): string {
  return `user-${Math.random().toString(36).slice(2, 10)}@test.com`;
}

export function generateStripeSubId(): string {
  return `sub_test_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateStripeCustomerId(): string {
  return `cus_test_${Math.random().toString(36).slice(2, 10)}`;
}
