"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppDispatch } from "@/hooks/redux";
import { loginSuccess } from "@/store/authSlice";
import { setUser } from "@/store/userSlice";

function VerifyOtpContent() {
  const router = useRouter();
  const dispatch = useAppDispatch();

  // The mobile number and mode are carried in sessionStorage (set when the OTP
  // is sent) rather than the URL, so they never appear in browser history,
  // server logs, analytics or referrer headers.
  const [phoneNumber, setPhoneNumber] = useState("");
  const [mode, setMode] = useState("login");
  const [ready, setReady] = useState(false);

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedPhone = sessionStorage.getItem("otpPhone") || "";
    const storedMode = sessionStorage.getItem("otpMode") || "login";
    // Edge case: someone lands here directly with nothing in storage (e.g. a
    // refresh that cleared state, a bookmarked URL, or a shared link). Send
    // them back to the start of the flow with a friendly note.
    if (!storedPhone) {
      sessionStorage.setItem(
        "authNotice",
        "Please enter your mobile number to receive a new code."
      );
      router.replace(storedMode === "signup" ? "/signup" : "/login");
      return;
    }
    setPhoneNumber(storedPhone);
    setMode(storedMode);
    setReady(true);
  }, [router]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length < 4) {
      return;
    }
    setLoading(true);
    try {
      const email = mode === "signup" ? sessionStorage.getItem("pendingSignupEmail") : undefined;
      const name = mode === "signup" ? sessionStorage.getItem("pendingSignupName") : undefined;
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneNumber,
          code: otp.trim(),
          mode,
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        setLoading(false);
        return;
      }
      if (mode === "signup") {
        sessionStorage.removeItem("pendingSignupEmail");
        sessionStorage.removeItem("pendingSignupName");
      }
      sessionStorage.removeItem("otpPhone");
      sessionStorage.removeItem("otpMode");

      // PERSIST DATA FOR REFRESH
      localStorage.setItem("token", data.token);
      if (data.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
      }

      dispatch(loginSuccess({ token: data.token }));
      if (data.user)
        dispatch(
          setUser({
            id: data.user.id,
            email: data.user.email ?? "",
            role: data.user.role ?? "user",
            name: data.user.name ?? "",
            phone: data.user.phone,
            maxChannels: 5,
            isSubscribed: data.user.isSubscribed ?? false,
            isPictureAddonEnabled: data.user.isPictureAddonEnabled ?? false,
            subscriptionQuantity: data.user.subscriptionQuantity ?? 0,
          })
        );
      if (mode === "signup") router.push("/setup");
      else router.push("/dashboard");
    } catch {
      setError("Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
      if (mode === 'signup') {
          return "Verify Phone Number";
      }
      return "Verify OTP";
  }

  const getDescription = () => {
      if (mode === 'signup') {
          return `Enter the OTP sent to ${phoneNumber}`;
      }
      return `Enter the code we sent to ${phoneNumber}`;
  }

  // Until we've read the phone number from sessionStorage (or redirected away),
  // show a brief loading state rather than a form referencing a blank number.
  if (!ready) {
    return (
      <AuthLayout
        title="Verify OTP"
        description="One moment…"
        linkLabel="Wrong details?"
        linkText="Back"
        linkHref="/login"
      >
        <div className="space-y-4 w-full">
          <div className="space-y-2 flex flex-col items-center my-4">
            <Skeleton className="h-16 w-full max-w-[300px] rounded-2xl" />
            <Skeleton className="h-4 w-32 mt-2" />
          </div>
          <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={getTitle()}
      description={getDescription()}
      linkLabel="Wrong details?"
      linkText="Back"
      linkHref={mode === 'signup' ? '/signup' : '/login'}
    >
      {loading ? (
        <div className="space-y-4 w-full">
            <div className="space-y-2 flex flex-col items-center my-4">
                <Skeleton className="h-16 w-full max-w-[300px] rounded-2xl" />
                <Skeleton className="h-4 w-32 mt-2" />
            </div>
            <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
      ) : (
      <form onSubmit={handleVerify} className="space-y-4 w-full">
        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center">
            {error}
          </p>
        )}
        <div className="space-y-2">
           <div className="flex justify-center my-4">
              <Input 
                id="otp" 
                type="text" 
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                placeholder="123456" 
                value={otp}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                maxLength={6}
                className="h-16 w-full max-w-[300px] rounded-2xl border-[#4f7a61]/20 bg-white/95 text-center text-2xl tracking-[0.35em] font-mono shadow-sm focus-visible:ring-2 sm:text-3xl sm:tracking-[0.55em]"
              />
           </div>
           <p className="text-xs text-center text-muted-foreground">Code expires in 10 minutes</p>
        </div>
        <Button type="submit" className="w-full h-12 rounded-2xl text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]" disabled={loading || otp.length < 4}>
          {loading ? "Verifying..." : "Verify"}
        </Button>
      </form>
      )}
    </AuthLayout>
  );
}

export default function VerifyOtpPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <VerifyOtpContent />
        </Suspense>
    )
}
