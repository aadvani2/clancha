"use client";

/**
 * "How Clancha works" — full plain-English guide to the service and portal
 * (Craig, M4 feedback 05/07/26 §2.3). Copy rules: UK English, no "AI"
 * anywhere a customer can see it, and the core message repeated throughout:
 * you message by normal text, never through the portal.
 */

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageCircle,
  Phone,
  Clock,
  Search,
  ShieldCheck,
  Ban,
  Image as ImageIcon,
  Eye,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-white/70 bg-white/85 p-5 sm:p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <h2 className="text-base sm:text-lg font-bold text-[#2f4a44] tracking-tight">{title}</h2>
      </div>
      <div className="text-sm leading-relaxed text-muted-foreground space-y-2 [&_strong]:text-foreground/80">
        {children}
      </div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl px-4 pt-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-5">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60">Guide</p>
          <h1 className="text-3xl sm:text-2xl font-bold text-[#2f4a44] tracking-tight">
            How Clancha works
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Everything you need to know about messaging, receiving hours, moderation and
            the portal — in plain words.
          </p>
        </div>

        <Section icon={<MessageCircle className="w-5 h-5" />} title="The one thing to remember">
          <p>
            <strong>Clancha works through normal text messages.</strong> You message the
            other parent from your phone&apos;s usual texting app, using the unique Clancha
            number we gave you. Nothing is sent through an app or portal. This website is
            where you read your history, change settings and share photos — it is not
            where you send messages.
          </p>
        </Section>

        <Section icon={<Phone className="w-5 h-5" />} title="What is a channel?">
          <p>
            A channel is your private text line with one other parent. Each channel has its
            own <strong>unique Clancha number</strong> — you both text that number, and
            Clancha passes the messages between you. Neither of you ever sees the other&apos;s
            real mobile number.
          </p>
          <p>
            You can always find your Clancha number on the dashboard under the channel
            name, and at the top of the channel&apos;s message history. Save it in your
            contacts — for example as <strong>&quot;Alex (Clancha)&quot;</strong> — and use it for
            every message.
          </p>
        </Section>

        <Section icon={<MessageCircle className="w-5 h-5" />} title="How to message the other parent">
          <p>
            1. Open your phone&apos;s normal messaging app (the one you use for texts).
            <br />
            2. Start a message to your saved Clancha number.
            <br />
            3. Write and send as you normally would.
          </p>
          <p>
            The other parent receives it as a normal text from the same Clancha number,
            and their replies come back to you the same way. The whole conversation also
            appears here in the portal under your channel.
          </p>
        </Section>

        <Section icon={<ShieldCheck className="w-5 h-5" />} title="What moderation means">
          <p>
            Every message is checked before it is delivered, to keep communication calm,
            clear and focused on the children. One of four things happens:
          </p>
          <p>
            <strong>Delivered as written.</strong> Most messages pass straight through
            unchanged.
            <br />
            <strong>Rewritten.</strong> If a message reads as hostile or escalating, it is
            reworded to keep your meaning but remove the escalation, then delivered. Your
            genuine feelings and the facts are kept — only the heat is taken out.
            <br />
            <strong>Held for review.</strong> If the checks aren&apos;t sure, a trained
            moderator looks at the message and decides. You&apos;ll get a text telling you
            it&apos;s queued for review.
            <br />
            <strong>Blocked.</strong> See below.
          </p>
          <p>
            Your original wording is never shown to the other parent when a message is
            rewritten, and your message history in the portal is private to you.
          </p>
        </Section>

        <Section icon={<Ban className="w-5 h-5" />} title="Why a message might be blocked">
          <p>
            A message is blocked when it may breach Clancha&apos;s terms — for example
            threats, abuse or insults with nothing else in them that could safely be
            reworded. If that happens you get a short text saying the message wasn&apos;t
            sent. No action is needed and nothing appears on your record — you can simply
            carry on messaging as normal.
          </p>
        </Section>

        <Section icon={<Clock className="w-5 h-5" />} title="Receiving hours">
          <p>
            Receiving hours are the times of day you&apos;re willing to receive messages —
            for example 06:00 to 23:00. Messages sent to you outside those hours are held
            and delivered when your hours start again. The sender is told their message is
            queued, so nothing is lost.
          </p>
          <p>
            <strong>To change yours:</strong> open the channel, tap the settings icon, and
            edit the Start and End times under &quot;Receiving hours&quot;. Each parent sets their
            own hours.
          </p>
          <p className="flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              <strong>Emergencies:</strong> if something is urgent outside the other
              parent&apos;s hours, reply with the word <strong>&quot;emergency&quot;</strong> when
              prompted. If they have Emergency Bypass switched on, the message is
              delivered straight away; if not, it stays queued and you&apos;re told.
            </span>
          </p>
        </Section>

        <Section icon={<Search className="w-5 h-5" />} title="Searching your message history">
          <p>
            On any channel, tap <strong>&quot;Ask about your history&quot;</strong> (or the
            magnifying glass at the top) and type a factual question — for example
            &quot;What time is pickup on Friday?&quot; or &quot;When did we agree the holiday
            dates?&quot;. Clancha looks through that channel&apos;s delivered messages and
            answers from what was actually said.
          </p>
          <p>
            Searching is private — the other parent is never told, and nothing you type
            there is sent to them. It answers factual questions only; it won&apos;t give
            advice or opinions.
          </p>
        </Section>

        <Section icon={<ImageIcon className="w-5 h-5" />} title="Sharing photos">
          <p>
            Photos are never sent by text. With the <strong>Picture Sharing add-on
            (£4.99/month per channel)</strong>, either parent can upload photos here in
            the portal. Every image is checked and approved before the other parent can
            see it, and they get a text letting them know a new picture is waiting.
          </p>
          <p>
            You can switch Picture Sharing on or off any time from the channel&apos;s
            settings.
          </p>
        </Section>

        <Section icon={<Eye className="w-5 h-5" />} title="Viewers">
          <p>
            A viewer is someone you invite — for example a solicitor or family member —
            who can read a channel but never send anything. By default a viewer sees only
            the messages as they were delivered; your original wording stays private
            unless you choose to share it. You can add, restrict or remove viewers from
            the channel&apos;s settings, and both parents are notified by text when viewer
            access changes.
          </p>
        </Section>

        <Section icon={<HelpCircle className="w-5 h-5" />} title="Anything else?">
          <p>
            Everything above can be changed later — nothing is locked in. If you&apos;re ever
            unsure, start at your dashboard: every channel shows its unique Clancha
            number, its status, and a settings icon for hours, children, photos and
            viewers.
          </p>
        </Section>
      </div>
    </ScrollArea>
  );
}
