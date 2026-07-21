"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useFormik } from "formik";
import * as Yup from "yup";

export default function AdminLoginPage() {
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
          body: JSON.stringify(values),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Login failed");
          return;
        }
        // Redirect to admin dashboard or home
        router.push("/dashboard");
      } catch (err) {
        setError("An error occurred during login");
      } finally {
        setLoading(false);
      }
    },
  });

  return (
    <AuthLayout
      title="Admin Login"
      description="Enter your credentials to access the super admin panel."
      linkLabel="Not an admin?"
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
            placeholder="admin@clancha.com"
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
          {loading ? "Logging in..." : "Login as Admin"}
        </Button>
      </form>
    </AuthLayout>
  );
}
