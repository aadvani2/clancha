import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Tracks webhook events we've already processed so Stripe redeliveries
 * (and any other replay) become a no-op. Stripe retries the same event id
 * for up to 3 days; the same event must not run our handler twice.
 */
export interface IProcessedWebhookEvent extends Document {
  source: "stripe" | "twilio";
  eventId: string;
  eventType?: string;
  processedAt: Date;
}

const processedWebhookEventSchema = new Schema<IProcessedWebhookEvent>({
  source: { type: String, required: true, enum: ["stripe", "twilio"] },
  eventId: { type: String, required: true },
  eventType: { type: String, default: null },
  processedAt: { type: Date, default: Date.now },
});

processedWebhookEventSchema.index({ source: 1, eventId: 1 }, { unique: true });
// Auto-clean entries older than 30 days — well past Stripe's 3-day retry window.
processedWebhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const ProcessedWebhookEvent: Model<IProcessedWebhookEvent> =
  mongoose.models.ProcessedWebhookEvent ??
  mongoose.model<IProcessedWebhookEvent>("ProcessedWebhookEvent", processedWebhookEventSchema);
