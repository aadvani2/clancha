import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const PROMPT_KEYS = [
  "rewrite_system",
  "tone_calm_clear",
  "tone_firm_fair",
  "classify_system",
  "image_moderate_system",
  "qa_system",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export interface IPromptVersion extends Document {
  key: PromptKey;
  body: string;
  version: number;
  createdBy: Types.ObjectId;
  changeNote?: string;
  rolledBackFromVersion?: number | null;
  // Snapshot of the code-side DEFAULT_REVISIONS[key] at save time. When the
  // code default for a key is rev-bumped (e.g. for a safety fix), any record
  // below the new minimum is ignored at read time and the code default is
  // served instead — preventing stale admin overrides from masking the fix.
  defaultRevision?: number;
  createdAt: Date;
}

const promptVersionSchema = new Schema<IPromptVersion>(
  {
    key: { type: String, required: true, enum: PROMPT_KEYS, index: true },
    body: { type: String, required: true },
    version: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    changeNote: { type: String, default: null },
    rolledBackFromVersion: { type: Number, default: null },
    defaultRevision: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

promptVersionSchema.index({ key: 1, version: -1 }, { unique: true });

if (mongoose.models.PromptVersion) {
  delete (mongoose.models as Record<string, Model<IPromptVersion>>).PromptVersion;
}
export const PromptVersion: Model<IPromptVersion> = mongoose.model<IPromptVersion>(
  "PromptVersion",
  promptVersionSchema
);
