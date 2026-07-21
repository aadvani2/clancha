import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "@/styles/globals.css";
import StoreProvider from "@/components/StoreProvider";
import { Toaster } from "@/components/ui/toaster";

const poppins = Poppins({
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clancha - Clarity, Not Chaos",
  description: "Family-focused simplified communication.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${poppins.variable} antialiased bg-background text-foreground`}
      >
        <StoreProvider>
          {children}
          <Toaster />
        </StoreProvider>
      </body>
    </html>
  );
}
