"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/**
 * Text-entry date field, DD/MM/YYYY with auto-inserted slashes.
 *
 * Replaces native `<input type="date">` where a date of birth is captured —
 * the Android date-wheel makes picking a decades-old date painful (Craig,
 * M4 feedback 05/07/26 §2.6). The component keeps the parent's value
 * contract identical to the native input: an ISO `yyyy-mm-dd` string, or ""
 * while the typed text is incomplete/invalid.
 */

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function formatTyping(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  let out = dd;
  if (mm) out += `/${mm}`;
  if (yyyy) out += `/${yyyy}`;
  return out;
}

function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const valid =
    d.getFullYear() === Number(yyyy) &&
    d.getMonth() === Number(mm) - 1 &&
    d.getDate() === Number(dd);
  return valid ? `${yyyy}-${mm}-${dd}` : "";
}

export interface DateOfBirthInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  /** ISO yyyy-mm-dd, or "" when unset/incomplete. */
  value: string;
  /** Fires with an ISO yyyy-mm-dd string, or "" while incomplete/invalid. */
  onChange: (iso: string) => void;
}

export const DateOfBirthInput = React.forwardRef<HTMLInputElement, DateOfBirthInputProps>(
  function DateOfBirthInput({ value, onChange, placeholder, ...rest }, ref) {
    const [display, setDisplay] = React.useState(() => isoToDisplay(value));

    // Resync only when the parent value diverges from what's being typed
    // (e.g. a form reset) — never clobber partial input mid-keystroke.
    React.useEffect(() => {
      if (displayToIso(display) !== value) {
        setDisplay(isoToDisplay(value));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder={placeholder ?? "DD/MM/YYYY"}
        maxLength={10}
        value={display}
        onChange={(e) => {
          const next = formatTyping(e.target.value);
          setDisplay(next);
          onChange(displayToIso(next));
        }}
      />
    );
  }
);
