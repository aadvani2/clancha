import mongoose, { Schema, Document, Model, Types } from "mongoose";

/**
 * Singleton model holding the runtime outage-simulation flags. Toggled from
 * /admin/settings → "Outage simulation" panel so Craig can drive #57/#58
 * verification without restarting the server.
 *
 * When `twilioOutageActive` is true, sendSms throws → sendSmsWithRetry queues
 * to SmsOutbox per the normal failure path. When `openaiOutageActive` is true,
 * classifyAndRewrite throws → rewritePipeline holds the message per the normal
 * failure path. Both branches already emit service_failure_* audit logs.
 */

export interface IOutageSimulation extends Document {
  twilioOutageActive: boolean;
  openaiOutageActive: boolean;
  twilioToggledBy?: Types.ObjectId | null;
  openaiToggledBy?: Types.ObjectId | null;
  twilioToggledAt?: Date | null;
  openaiToggledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const outageSimulationSchema = new Schema<IOutageSimulation>(
  {
    twilioOutageActive: { type: Boolean, default: false },
    openaiOutageActive: { type: Boolean, default: false },
    twilioToggledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    openaiToggledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    twilioToggledAt: { type: Date, default: null },
    openaiToggledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const OutageSimulation: Model<IOutageSimulation> =
  mongoose.models.OutageSimulation ??
  mongoose.model<IOutageSimulation>("OutageSimulation", outageSimulationSchema);
