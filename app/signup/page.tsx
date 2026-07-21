"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateOfBirthInput } from "@/components/ui/date-of-birth-input";
import { AuthLayout } from "@/components/auth/AuthLayout";
import PhoneInput, {
  getCountryCallingCode,
  Country,
  isValidPhoneNumber,
} from "react-phone-number-input";
import { useFormik } from "formik";
import * as Yup from "yup";
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

export default function SignupPage() {
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
    name: Yup.string().required("Full Name is required"),
    email: Yup.string().email("Invalid email").required("Email is required"),
    gender: Yup.string().required("Gender is required"),
    dob: Yup.date().required("Date of Birth is required").max(new Date(), "Date of birth must be in the past"),
    phoneNumber: Yup.string()
      .required("Mobile Number is required")
      .test("is-valid-phone", "Invalid phone number", (value) => value ? isValidPhoneNumber(value) : false),
  });

  const formik = useFormik({
    initialValues: {
      name: "",
      email: "",
      gender: "",
      dob: "",
      phoneNumber: "",
    },
    validationSchema,
    onSubmit: async (values) => {
      setLoading(true);
      try {
        const res = await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: values.phoneNumber, mode: "signup" }),
        });
        const data = await res.json();
        if (!res.ok) {
          formik.setFieldError("phoneNumber", data.error ?? "Failed to send OTP");
          return;
        }
        sessionStorage.setItem("pendingSignupEmail", values.email.trim());
        sessionStorage.setItem("pendingSignupName", values.name.trim());
        // Keep the mobile number out of the URL (browser history, logs,
        // analytics, referrer headers). Carry it in sessionStorage instead.
        sessionStorage.setItem("otpPhone", values.phoneNumber || "");
        sessionStorage.setItem("otpMode", "signup");
        router.push("/verify-otp");
      } catch {
        formik.setFieldError("phoneNumber", "Failed to send OTP");
      } finally {
        setLoading(false);
      }
    },
  });

  return (
    <AuthLayout
      title="Create Account"
      description="Start your journey with clarity."
      linkLabel="Already have an account?"
      linkText="Login"
      linkHref="/login"
    >
      {loading ? (
        <div className="space-y-4 w-full">
            <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-12 w-full rounded-2xl" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-12 w-full rounded-2xl" />
                 </div>
                 <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-12 w-full rounded-2xl" />
                 </div>
            </div>
            <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-12 w-full rounded-2xl" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
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
           <label htmlFor="name" className="text-sm font-medium leading-none">Full Name</label>
           <Input
             id="name"
             placeholder="John Doe"
             name="name"
             autoComplete="name"
             value={formik.values.name}
             onChange={formik.handleChange}
             onBlur={formik.handleBlur}
             className={`h-12 rounded-2xl bg-white/95 shadow-sm ${formik.touched.name && formik.errors.name ? "border-red-500" : ""}`}
           />
           {formik.touched.name && formik.errors.name && (
             <p className="text-xs text-red-500">{formik.errors.name}</p>
           )}
         </div>

         <div className="space-y-2">
           <label htmlFor="email" className="text-sm font-medium leading-none">Email</label>
           <Input
             id="email"
             type="email"
             inputMode="email"
             placeholder="you@example.com"
             name="email"
             autoComplete="email"
             value={formik.values.email}
             onChange={formik.handleChange}
             onBlur={formik.handleBlur}
             className={`h-12 rounded-2xl bg-white/95 shadow-sm ${formik.touched.email && formik.errors.email ? "border-red-500" : ""}`}
           />
           {formik.touched.email && formik.errors.email && (
             <p className="text-xs text-red-500">{formik.errors.email}</p>
           )}
           <p className="text-xs text-muted-foreground">Used for service communications and account recovery.</p>
         </div>

         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <div className="space-y-2">
                 <label htmlFor="gender" className="text-sm font-medium leading-none">Gender</label>
                 <select
                     id="gender"
                     name="gender"
                     autoComplete="sex"
                    className={`flex h-12 w-full rounded-2xl border bg-white/95 px-3 py-2 text-base shadow-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${formik.touched.gender && formik.errors.gender ? "border-red-500" : "border-input"}`}
                     value={formik.values.gender}
                     onChange={formik.handleChange}
                     onBlur={formik.handleBlur}
                 >
                     <option value="" disabled>Select</option>
                     <option value="male">Male</option>
                     <option value="female">Female</option>
                     <option value="other">Other</option>
                     <option value="prefer_not_to_say">Prefer not to say</option>
                 </select>
                 {formik.touched.gender && formik.errors.gender && (
                     <p className="text-xs text-red-500">{formik.errors.gender}</p>
                 )}
             </div>
             <div className="space-y-2">
                 <label htmlFor="dob" className="text-sm font-medium leading-none">Date of Birth</label>
                 {/* Manual text entry — the native Android date wheel is
                     awkward for a DOB (Craig, M4 feedback 05/07/26 §2.6). */}
                 <DateOfBirthInput
                     id="dob"
                     name="dob"
                     autoComplete="bday"
                     value={formik.values.dob}
                     onChange={(iso) => formik.setFieldValue("dob", iso)}
                     onBlur={formik.handleBlur}
                    className={`h-12 rounded-2xl bg-white/95 shadow-sm ${formik.touched.dob && formik.errors.dob ? "border-red-500" : ""}`}
                 />
                 {formik.touched.dob && formik.errors.dob && (
                     <p className="text-xs text-red-500">{formik.errors.dob}</p>
                 )}
             </div>
         </div>
 
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
         </div>
 
         <Button type="submit" className="w-full h-12 rounded-2xl text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]" disabled={loading}>
           {loading ? "Sending OTP..." : "Sign Up"}
         </Button>
       </form>
      )}
    </AuthLayout>
  );
}
