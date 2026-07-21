"use client";

import Link from "next/link";
interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
  linkText: string;
  linkHref: string;
  linkLabel: string;
}

export function AuthLayout({
  children,
  title,
  description,
  linkText,
  linkHref,
  linkLabel,
}: AuthLayoutProps) {
  return (
    <div className="relative w-full h-[100dvh] min-h-[100svh] flex flex-col lg:flex-row overflow-x-hidden overflow-y-auto lg:overflow-hidden bg-[#f2e8d9]">
      <div className="lg:hidden pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 -left-24 h-56 w-56 rounded-full bg-[#4f7a61]/20 blur-2xl" />
        <div className="absolute top-20 -right-24 h-64 w-64 rounded-full bg-[#e8a675]/25 blur-3xl" />
        <div className="absolute bottom-[-6rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-white/40 blur-3xl" />
      </div>

      {/* Right "Side Design" side - Mimicking the brand aesthetic */}
      <div className="hidden lg:block lg:w-[55%] relative bg-[#f2e8d9] border-r border-[#4f7a61]/20">
        
        {/* Top Left Decoration */}
        <div className="absolute top-0 left-0">
           {/* Peach Circle - Underneath */}
           <div className="absolute -top-16 -left-16 w-64 h-64 bg-[#e8a675] rounded-full opacity-90" />
           {/* Green Circle - Overlapping */}
           <div className="absolute -top-24 -left-24 w-64 h-64 bg-[#4f7a61] rounded-full opacity-90 mix-blend-multiply" />
        </div>

        {/* Content Center */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
            <div className="text-center space-y-4 max-w-lg px-8">
                <h2 className="text-5xl font-bold text-[#2f4a44] font-poppins tracking-tight">Clancha</h2>
                <p className="text-[#33383b] tracking-[0.2em] uppercase text-xs font-bold opacity-80">
                    Clarity, Not Chaos
                </p>
                <div className="w-20 h-1 bg-[#e8a675] mx-auto my-6 rounded-full" />
                <p className="text-[#2f4a44] italic font-medium max-w-xs mx-auto leading-relaxed">
                    &quot;Family-focused simplified communication designed for clarity.&quot;
                </p>
            </div>
        </div>

        {/* Bottom Right Decoration */}
        <div className="absolute bottom-0 right-0 rotate-180">
           {/* Peach Circle */}
           <div className="absolute -top-16 -left-16 w-72 h-72 bg-[#e8a675] rounded-full opacity-90" />
           {/* Green Circle */}
           <div className="absolute -top-24 -left-24 w-72 h-72 bg-[#2f4a44] rounded-full opacity-90" />
        </div>

        {/* Subtle texture overlay */}
        <div className="absolute inset-0 opacity-[0.05] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none" />
      </div>

      {/* Left functionality side */}
      <div className="w-full lg:w-[45%] min-h-full lg:min-h-0 flex flex-col items-center justify-start lg:justify-center px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 lg:p-8 bg-transparent lg:bg-background relative z-10 lg:overflow-y-auto">
        <div className="w-full max-w-[430px] lg:max-w-[400px] space-y-5 sm:space-y-6">
          <div className="lg:hidden flex flex-col items-center text-center pt-3">
            <h2 className="text-[2.65rem] leading-none font-bold text-[#2f4a44] font-poppins tracking-tight">
              Clancha
            </h2>
            <p className="text-[#33383b] tracking-[0.2em] uppercase text-[10px] font-bold opacity-80">
              Clarity, Not Chaos
            </p>
            <div className="mt-4 h-1 w-16 rounded-full bg-[#e8a675]" />
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_24px_70px_rgba(47,74,68,0.16)] backdrop-blur-md sm:p-6 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-0">
            <div className="space-y-2 text-center">
              <h1 className="text-2xl sm:text-3xl font-bold text-primary tracking-tight font-poppins">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                {description}
              </p>
            </div>
            
            <div className="mt-6">
              {children}
            </div>

            <div className="text-center text-sm text-muted-foreground mt-5">
              {linkLabel}{" "}
              <Link
                href={linkHref}
                className="inline-flex min-h-10 items-center text-primary font-semibold hover:underline"
              >
                {linkText}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
