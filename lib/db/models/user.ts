import mongoose, { Schema, Document, Model } from "mongoose";

export const USER_ROLES = [
  "user",
  "moderator",
  "admin",
  "super_admin",
  "viewer",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IUser extends Document {
  phone: string;
  email?: string;
  password?: string;
  role: UserRole;
  name?: string;
  profileImageUrl?: string;
  stripeCustomerId?: string;
  activeStripeSubscriptionId?: string;
  isPictureAddonEnabled: boolean;
  receivingHoursStart?: string;
  receivingHoursEnd?: string;
  timezone?: string;
  /** When true, user cannot sign in or use the service. */
  suspended?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    phone: { type: String, required: true, unique: true, index: true },
    // Sparse unique index: only documents that have the email field are indexed (omit field when not set).
    // https://www.mongodb.com/docs/manual/core/index-sparse/
    email: { type: String, required: false, sparse: true, unique: true },
    password: { type: String, required: false, select: false },
    role: {
      type: String,
      required: true,
      enum: USER_ROLES,
      default: "user",
    },
    name: { type: String, default: null },
    profileImageUrl: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },
    activeStripeSubscriptionId: { type: String, default: null },
    isPictureAddonEnabled: { type: Boolean, default: false },
    receivingHoursStart: { type: String, default: null },
    receivingHoursEnd: { type: String, default: null },
    timezone: { type: String, default: null },
    suspended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// In dev, Next.js may cache the model with an old schema; ensure we use the current schema
if (mongoose.models.User) {
  delete (mongoose.models as Record<string, Model<IUser>>).User;
}
export const User: Model<IUser> = mongoose.model<IUser>("User", userSchema);
