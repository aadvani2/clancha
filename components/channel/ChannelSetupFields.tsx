"use client";

import { useState } from "react";
import { Phone, ImagePlus, Info, Plus, X, Sparkles, AlarmClock } from "lucide-react";
import PhoneInput, {
  isValidPhoneNumber,
  getCountryCallingCode,
  Country,
} from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { Input } from "@/components/ui/input";
import { DateOfBirthInput } from "@/components/ui/date-of-birth-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type ChannelSetupValue = {
  otherUserPhone: string;
  recipientName: string;
  recipientEmail: string;
  children: Array<{ name: string; dob: string }>;
  receivingHoursStart: string;
  receivingHoursEnd: string;
  timezone: string;
  emergencyBypassEnabled: boolean;
  rewriteTone: "calm_clear" | "firm_fair";
  pictureShareEnabled: boolean;
};

export const emptyChannelSetup = (defaults?: Partial<ChannelSetupValue>): ChannelSetupValue => ({
  otherUserPhone: "",
  recipientName: "",
  recipientEmail: "",
  children: [],
  receivingHoursStart: "06:00",
  receivingHoursEnd: "23:00",
  timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Europe/London",
  emergencyBypassEnabled: true,
  rewriteTone: "calm_clear",
  pictureShareEnabled: false,
  ...defaults,
});

export type ChannelSetupErrors = {
  otherUserPhone?: string;
  recipientName?: string;
  recipientEmail?: string;
  receivingHours?: string;
  children?: string;
};

export function validateChannelSetup(v: ChannelSetupValue): ChannelSetupErrors {
  const errs: ChannelSetupErrors = {};
  if (!v.otherUserPhone) errs.otherUserPhone = "Recipient phone number is required.";
  else if (!isValidPhoneNumber(v.otherUserPhone))
    errs.otherUserPhone = "Please enter a valid international phone number.";
  if (!v.recipientName.trim()) errs.recipientName = "Recipient name is required.";
  if (v.recipientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.recipientEmail))
    errs.recipientEmail = "Enter a valid email or leave blank.";
  if (!v.receivingHoursStart || !v.receivingHoursEnd)
    errs.receivingHours = "Set both start and end times.";
  else if (v.receivingHoursStart === v.receivingHoursEnd)
    errs.receivingHours = "Start and end times must differ.";
  for (const c of v.children) {
    if (!c.name.trim()) {
      errs.children = "Each child must have a name (remove the row if not adding).";
      break;
    }
  }
  return errs;
}

const CountryFlag = ({ country }: { country: Country }) => (
  <span className="flex h-full items-center justify-center text-sm font-medium text-foreground px-1">
    {country ? `+${getCountryCallingCode(country)}` : "🌐"}
  </span>
);

interface Props {
  value: ChannelSetupValue;
  onChange: (next: ChannelSetupValue) => void;
  errors?: ChannelSetupErrors;
  touched?: Partial<Record<keyof ChannelSetupErrors, boolean>>;
  onBlur?: (field: keyof ChannelSetupErrors) => void;
  /** When true, the picture-share toggle is hidden (user already has it enabled on a previous channel). */
  hidePictureShareToggle?: boolean;
  /** Country code for the phone input default. */
  defaultCountry?: Country;
}

export function ChannelSetupFields({
  value,
  onChange,
  errors = {},
  touched = {},
  onBlur,
  hidePictureShareToggle = false,
  defaultCountry = "GB",
}: Props) {
  const [_phoneCountry, setPhoneCountry] = useState<Country>(defaultCountry);

  const update = <K extends keyof ChannelSetupValue>(key: K, v: ChannelSetupValue[K]) =>
    onChange({ ...value, [key]: v });

  const addChild = () =>
    update("children", [...value.children, { name: "", dob: "" }]);
  const removeChild = (i: number) =>
    update("children", value.children.filter((_, idx) => idx !== i));
  const updateChild = (i: number, field: "name" | "dob", v: string) =>
    update("children", value.children.map((c, idx) => (idx === i ? { ...c, [field]: v } : c)));

  return (
    <div className="space-y-6">
      {/* Plain-words channel explanation — both testers were unsure what a
          "channel" was (Craig, M4 feedback 05/07/26 §2.5). Renders in /setup
          and in the Create Channel modal. */}
      <div className="rounded-xl bg-primary/5 border border-primary/15 p-3 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground/80">What is a channel?</span>{" "}
          A channel is your private text line with the other parent. It has its own
          unique Clancha number — you each text that number from your phone&apos;s normal
          messaging app, and Clancha passes your messages between you. Nothing is sent
          through an app or portal.
        </p>
      </div>

      {/* Recipient details */}
      <div className="space-y-4">
        {/* A tester entered their own details here by mistake (Craig, M4
            feedback 05/07/26 §2.4) — help text wording is Craig's. */}
        <p className="text-xs font-semibold text-[#4f7a61] bg-[#4f7a61]/5 border border-[#4f7a61]/15 rounded-lg px-3 py-2">
          Enter the other parent&apos;s details here, not your own.
        </p>
        <div className="space-y-2">
          <Label htmlFor="recipientName" className="text-xs font-black uppercase tracking-widest text-muted-foreground/70">
            Recipient name
          </Label>
          <Input
            id="recipientName"
            placeholder="e.g. Sam Brown"
            value={value.recipientName}
            onChange={(e) => update("recipientName", e.target.value)}
            onBlur={() => onBlur?.("recipientName")}
            className={`h-11 ${touched.recipientName && errors.recipientName ? "border-red-500" : ""}`}
          />
          {touched.recipientName && errors.recipientName && (
            <p className="text-[10px] text-red-500 font-bold">{errors.recipientName}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="otherUserPhone" className="text-xs font-black uppercase tracking-widest text-muted-foreground/70">
            Recipient phone number
          </Label>
          <div className={touched.otherUserPhone && errors.otherUserPhone ? "ring-2 ring-red-500 rounded-md" : ""}>
            <PhoneInput
              id="otherUserPhone"
              defaultCountry={defaultCountry}
              value={value.otherUserPhone}
              onChange={(v) => update("otherUserPhone", v ?? "")}
              onBlur={() => onBlur?.("otherUserPhone")}
              onCountryChange={(c) => c && setPhoneCountry(c)}
              flagComponent={CountryFlag}
              className="w-full"
            />
          </div>
          {touched.otherUserPhone && errors.otherUserPhone && (
            <p className="text-[10px] text-red-500 font-bold">{errors.otherUserPhone}</p>
          )}
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Phone className="w-3 h-3" /> They&apos;ll receive an introduction SMS when the channel goes live.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="recipientEmail" className="text-xs font-black uppercase tracking-widest text-muted-foreground/70">
            Recipient email <span className="text-muted-foreground/50 font-medium normal-case tracking-normal">(optional)</span>
          </Label>
          <Input
            id="recipientEmail"
            type="email"
            inputMode="email"
            placeholder="sam@example.com"
            value={value.recipientEmail}
            onChange={(e) => update("recipientEmail", e.target.value)}
            onBlur={() => onBlur?.("recipientEmail")}
            className={`h-11 ${touched.recipientEmail && errors.recipientEmail ? "border-red-500" : ""}`}
          />
          {touched.recipientEmail && errors.recipientEmail && (
            <p className="text-[10px] text-red-500 font-bold">{errors.recipientEmail}</p>
          )}
        </div>
      </div>

      {/* Linked children */}
      <div className="space-y-3 border-t border-primary/10 pt-5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground/70">
            Linked children <span className="text-muted-foreground/50 font-medium normal-case tracking-normal">(optional, up to 12)</span>
          </Label>
          {value.children.length < 12 && (
            <button
              type="button"
              onClick={addChild}
              className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        {value.children.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Add a child to help moderators understand the family context. You can add or edit children any time from channel settings.
          </p>
        )}
        {value.children.map((c, i) => (
          <div key={i} className="flex gap-2 items-start">
            <Input
              placeholder="Child's name"
              value={c.name}
              onChange={(e) => updateChild(i, "name", e.target.value)}
              className="h-10 flex-1"
            />
            <DateOfBirthInput
              value={c.dob}
              onChange={(iso) => updateChild(i, "dob", iso)}
              aria-label="Child's date of birth"
              className="h-10 w-[130px]"
            />
            <button
              type="button"
              onClick={() => removeChild(i)}
              aria-label="Remove child"
              className="h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-red-600 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        {touched.children && errors.children && (
          <p className="text-[10px] text-red-500 font-bold">{errors.children}</p>
        )}
      </div>

      {/* Receiving hours */}
      <div className="space-y-3 border-t border-primary/10 pt-5">
        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground/70 flex items-center gap-1.5">
          <AlarmClock className="w-3.5 h-3.5" />
          Your receiving hours
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="hoursStart" className="text-[10px] text-muted-foreground">From</Label>
            <Input
              id="hoursStart"
              type="time"
              value={value.receivingHoursStart}
              onChange={(e) => update("receivingHoursStart", e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hoursEnd" className="text-[10px] text-muted-foreground">Until</Label>
            <Input
              id="hoursEnd"
              type="time"
              value={value.receivingHoursEnd}
              onChange={(e) => update("receivingHoursEnd", e.target.value)}
              className="h-10"
            />
          </div>
        </div>
        {touched.receivingHours && errors.receivingHours && (
          <p className="text-[10px] text-red-500 font-bold">{errors.receivingHours}</p>
        )}
        <p className="text-[10px] text-muted-foreground">
          Messages sent outside these hours are queued and delivered when you&apos;re available.
        </p>
      </div>

      {/* Emergency bypass */}
      <div className="space-y-3 border-t border-primary/10 pt-5">
        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground/70">
          Emergency bypass
        </Label>
        <button
          type="button"
          onClick={() => update("emergencyBypassEnabled", !value.emergencyBypassEnabled)}
          className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${
            value.emergencyBypassEnabled
              ? "bg-primary/5 border-primary/30"
              : "bg-white border-gray-100"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-bold">
                Allow emergency override
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                When on, the recipient can reply with the word &ldquo;emergency&rdquo; to bypass your receiving hours.
              </p>
            </div>
            <div
              className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                value.emergencyBypassEnabled ? "bg-primary" : "bg-gray-300"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${
                  value.emergencyBypassEnabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </div>
          </div>
        </button>
      </div>

      {/* Rewrite tone */}
      <div className="space-y-3 border-t border-primary/10 pt-5">
        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground/70">
          Your rewrite tone
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "calm_clear", name: "Calm & Clear", desc: "Softens edges, keeps it constructive." },
              { id: "firm_fair", name: "Firm & Fair", desc: "Direct, no softening — facts only." },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => update("rewriteTone", t.id)}
              className={`rounded-2xl border-2 p-3 text-left transition-all ${
                value.rewriteTone === t.id
                  ? "bg-primary/5 border-primary"
                  : "bg-white border-gray-100 hover:border-gray-200"
              }`}
            >
              <p className="text-sm font-bold">{t.name}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{t.desc}</p>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Applies to messages YOU send. The recipient can pick their own tone for messages they send.
        </p>
      </div>

      {/* Picture sharing */}
      {!hidePictureShareToggle && (
        <div className="space-y-3 border-t border-primary/10 pt-5">
          <button
            type="button"
            onClick={() => update("pictureShareEnabled", !value.pictureShareEnabled)}
            className={`w-full relative overflow-hidden cursor-pointer group rounded-2xl border-2 p-4 text-left transition-all ${
              value.pictureShareEnabled
                ? "bg-primary/5 border-primary/30"
                : "bg-white border-gray-100 hover:border-gray-200"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex gap-3 items-start">
                <div className={`p-2.5 rounded-xl ${value.pictureShareEnabled ? "bg-primary text-white" : "bg-gray-100 text-gray-400"}`}>
                  <ImagePlus className="w-4 h-4" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-bold flex items-center gap-2">
                    Picture Sharing add-on
                    {value.pictureShareEnabled && <Sparkles className="w-3 h-3 text-primary animate-pulse" />}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Send approved photos via the portal. Every image is checked and approved before it appears. Either parent can turn this on or off for this channel later from channel settings.
                  </p>
                </div>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
                value.pictureShareEnabled ? "bg-primary border-primary" : "bg-white border-gray-200"
              }`}>
                {value.pictureShareEnabled && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-wider ${value.pictureShareEnabled ? "text-primary" : "text-muted-foreground"}`}>
                +£4.99 / month
              </span>
              {value.pictureShareEnabled && (
                <Badge className="bg-primary/10 text-primary border-none text-[10px] font-bold">Recommended</Badge>
              )}
            </div>
          </button>
        </div>
      )}

      <div className="rounded-xl bg-primary/5 border border-primary/15 p-3 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          You can change any of these later from channel settings. The recipient sets their own receiving hours, tone, and bypass when they accept the channel.
        </p>
      </div>
    </div>
  );
}
