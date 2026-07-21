"use client";

import * as React from "react";
import * as RPNI from "react-phone-number-input";
import { getCountryCallingCode, type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value?: string;
  onChange?: (value: string) => void;
  defaultCountry?: Country;
}

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, value, onChange, defaultCountry, ...props }, ref) => {
    return (
      <div className={cn("relative flex items-center", className)}>
        <RPNI.default
          ref={ref as any}
          value={value}
          onChange={(val) => onChange?.(val || "")}
          defaultCountry={defaultCountry}
          className="flex w-full"
          inputComponent={Input as any}
          {...props}
          // Custom styling for the library wrapper
          numberInputProps={{
             className: "h-11 w-full rounded-md border-input bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          }}
        />
      </div>
    );
  }
);
PhoneInput.displayName = "PhoneInput";

export { PhoneInput };
