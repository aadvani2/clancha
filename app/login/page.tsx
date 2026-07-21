"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useFormik } from "formik";
import * as Yup from "yup";
import PhoneInput, {
  getCountryCallingCode,
  Country,
  isValidPhoneNumber,
} from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserCountry } from "@/lib/get-country";


// Custom component to render country code (+XX) instead of flag image
const CountryFlag = ({ country }: { country: Country }) => {
  return (
    <span className="flex h-full items-center justify-center text-sm font-medium text-foreground">
      {country ? `+${getCountryCallingCode(country)}` : "🌐"}
    </span>
  )
}

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [defaultCountry, setDefaultCountry] = useState<Country | undefined>("US");
  const [notice, setNotice] = useState("");

  // Surface a friendly note if we were redirected here from the OTP step
  // (e.g. the verify page was opened without a number in session).
  useEffect(() => {
    const msg = sessionStorage.getItem("authNotice");
    if (msg) {
      setNotice(msg);
      sessionStorage.removeItem("authNotice");
    }
  }, []);

  useEffect(() => {
    const detectLocation = async () => {
      try {
        // 1. Precise IP-based detection (Client-side)
        const response = await fetch("https://ipapi.co/json/");
        const data = await response.json();
        if (data.country_code && data.country_code.length === 2) {
          console.log("Auto-detected Country:", data.country_code);
          setDefaultCountry(data.country_code as Country);
          return;
        }
      } catch (error) {
        console.warn("IP detection failed, trying fallback...");
      }

      // 2. Fallback to Timezone/Language (Instant)
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz.includes("Calcutta") || tz.includes("Kolkata") || tz.includes("Delhi")) {
        setDefaultCountry("IN");
      } else {
        const lang = navigator.language;
        if (lang.includes("-")) {
          const region = lang.split("-")[1].toUpperCase();
          if (region.length === 2) setDefaultCountry(region as Country);
        }
      }
    };

    detectLocation();
  }, []);


  const validationSchema = Yup.object().shape({
    phoneNumber: Yup.string()
      .required("Mobile Number is required")
      .test("is-valid-phone", "Invalid phone number", (value) =>
        value ? isValidPhoneNumber(value) : false
      ),
  });

  const formik = useFormik({
    initialValues: {
      phoneNumber: "",
    },
    validationSchema,
    onSubmit: async (values) => {
      setLoading(true);
      try {
        const res = await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: values.phoneNumber, mode: "login" }),
        });
        const data = await res.json();
        if (!res.ok) {
          formik.setFieldError("phoneNumber", data.error ?? "Failed to send OTP");
          return;
        }
        // Keep the mobile number out of the URL (browser history, logs,
        // analytics, referrer headers). Carry it in sessionStorage instead.
        sessionStorage.setItem("otpPhone", values.phoneNumber || "");
        sessionStorage.setItem("otpMode", "login");
        router.push("/verify-otp");
      } catch {
        formik.setFieldError("phoneNumber", "Failed to send OTP");
      } finally {
        setLoading(false);
      }
    }
  });

  return (
    <AuthLayout
      title="Welcome Back"
      description="Access your secure communication channels."
      linkLabel="Don't have an account?"
      linkText="Sign Up"
      linkHref="/signup"
    >
      {loading ? (
          <div className="space-y-4 w-full">
               <div className="space-y-2">
                   <Skeleton className="h-4 w-20" />
                   <Skeleton className="h-12 w-full rounded-2xl" />
               </div>
               <div className="space-y-3">
                   <Skeleton className="h-4 w-24" />
                   <div className="flex gap-4">
                        <Skeleton className="h-6 w-16" />
                        <Skeleton className="h-6 w-16" />
                   </div>
               </div>
               <div className="space-y-2">
                   <Skeleton className="h-4 w-24" />
                   <Skeleton className="h-12 w-full rounded-2xl" />
               </div>
               <Skeleton className="h-12 w-full rounded-2xl mt-6" />
          </div>
      ) : (
        <form onSubmit={formik.handleSubmit} className="space-y-4 w-full">
            {notice && (
              <p className="rounded-2xl border border-[#4f7a61]/20 bg-[#4f7a61]/10 px-4 py-3 text-sm text-[#2f4a44] text-center">
                {notice}
              </p>
            )}
            <div className="space-y-2">
              <label htmlFor="phoneNumber" className="text-sm font-medium leading-none">Mobile Number</label>
              <div className={formik.touched.phoneNumber && formik.errors.phoneNumber ? "rounded-2xl border border-red-500" : ""}>
                <PhoneInput
                    key={defaultCountry}
                    placeholder="Enter phone number"
                    value={formik.values.phoneNumber}
                    onChange={(value) => formik.setFieldValue("phoneNumber", value)}
                    onBlur={() => formik.setFieldTouched("phoneNumber", true)}
                    defaultCountry={defaultCountry}
                    international={false}
                    className="w-full"
                    flagComponent={CountryFlag}
                    numberInputProps={{ autoComplete: "tel", inputMode: "tel" }}
                />
              </div>
              {formik.touched.phoneNumber && formik.errors.phoneNumber && (
                <p className="text-xs text-red-500">{formik.errors.phoneNumber}</p>
              )}
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
                <p className="text-xs text-muted-foreground">
                  We&apos;ll send a one-time password to this number.
                </p>
                <span className="flex items-center gap-3 self-start sm:self-auto">
                  <Link
                    href="/viewer/login"
                    className="text-sm sm:text-xs text-primary hover:underline font-medium py-1 -my-1"
                  >
                    Login as Viewer
                  </Link>
                  <Link
                    href="/admin/login"
                    className="text-sm sm:text-xs text-primary hover:underline font-medium py-1 -my-1"
                  >
                    Login as Admin
                  </Link>
                </span>
              </div>
            </div>
    
            <Button type="submit" className="w-full h-12 rounded-2xl text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]" disabled={loading}>
              {loading ? "Sending OTP..." : "Login"}
            </Button>
          </form>
      )}
    </AuthLayout>
  );
}
