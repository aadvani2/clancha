"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useFormik } from "formik";
import * as Yup from "yup";

/**
 * Viewer login. Third parties (solicitors, mediators, social workers) hold a
 * persistent email + password account that can span many channels across
 * clients, so they sign in here rather than through a per-channel invite link.
 *
 * Reuses the shared /api/auth/password-login endpoint, which already admits
 * role === "viewer". The regular-user OTP login at /login is untouched.
 */
export default function ViewerLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationSchema = Yup.object().shape({
    email: Yup.string()
      .email("Invalid email address")
      .required("Email is required"),
    password: Yup.string().required("Password is required"),
  });

  const formik = useFormik({
    initialValues: {
      email: "",
      password: "",
    },
    validationSchema,
    onSubmit: async (values) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/password-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email.trim().toLowerCase(),
            password: values.password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Login failed");
          return;
        }
        router.push("/dashboard");
      } catch {
        setError("An error occurred during login");
      } finally {
        setLoading(false);
      }
    },
  });

  return (
    <AuthLayout
      title="Viewer Login"
      description="Sign in with your viewer email and password to read the channels you've been given access to."
      linkLabel="Not a viewer?"
      linkText="User Login"
      linkHref="/login"
    >
      <form onSubmit={formik.handleSubmit} className="space-y-4 w-full">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium leading-none">
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className={`flex h-12 w-full rounded-2xl border border-input bg-white/95 px-3 py-2 text-base shadow-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${
              formik.touched.email && formik.errors.email ? "border-red-500" : ""
            }`}
            {...formik.getFieldProps("email")}
          />
          {formik.touched.email && formik.errors.email && (
            <p className="text-xs text-red-500">{formik.errors.email}</p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium leading-none">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className={`flex h-12 w-full rounded-2xl border border-input bg-white/95 px-3 py-2 text-base shadow-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${
              formik.touched.password && formik.errors.password
                ? "border-red-500"
                : ""
            }`}
            {...formik.getFieldProps("password")}
          />
          {formik.touched.password && formik.errors.password && (
            <p className="text-xs text-red-500">{formik.errors.password}</p>
          )}
        </div>

        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        <Button
          type="submit"
          className="w-full h-12 rounded-2xl text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign in"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          New viewers set a password when they first accept an invitation. Once
          set, sign in here for any channel you&apos;re invited to.
        </p>
      </form>
    </AuthLayout>
  );
}
