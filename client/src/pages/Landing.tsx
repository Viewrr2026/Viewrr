import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { ArrowRight, Sparkles, Play, Star, Shield, Zap, Users, CheckCircle, Video, Camera, Megaphone, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import FreelancerCard from "@/components/FreelancerCard";
import type { ProfileWithUser } from "../../../server/storage";

const STATS = [
  { value: "2,400+", label: "Creative professionals" },
  { value: "98%", label: "Client satisfaction" },
  { value: "£0", label: "Commission on first hire" },
  { value: "24h", label: "Average response time" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Describe your project",
    desc: "Tell our AI what you need — in plain English. A 30-second brand video for Instagram? A full documentary? Just say it.",
    icon: Sparkles,
  },
  {
    step: "02",
    title: "Get matched instantly",
    desc: "Our AI reads your brief and surfaces the right creatives based on specialism, style, rate, and availability.",
    icon: Zap,
  },
  {
    step: "03",
    title: "Review portfolios & hire",
    desc: "Browse real work, read reviews, message directly, and book your creative — all in one place.",
    icon: CheckCircle,
  },
];

const SPECS = [
  { label: "Videographers", icon: Video, count: "680+" },
  { label: "Video Editors", icon: Scissors, count: "520+" },
  { label: "Photographers", icon: Camera, count: "710+" },
  { label: "Marketers", icon: Megaphone, count: "490+" },
];

const TESTIMONIALS = [
  {
    quote: "We hired a brand videographer through Viewrr in under an hour. The film got 1.2M views. Game changer.",
    author: "Sarah Mitchell",
    role: "Marketing Director, Volt Coffee",
    avatar: "https://i.pravatar.cc/60?img=20",
  },
  {
    quote: "The AI search actually understands briefs. I said 'dark, cinematic, fashion vibes' and it found exactly who I needed.",
    author: "Dom Parekh",
    role: "Creative Lead, LNDN Studios",
    avatar: "https://i.pravatar.cc/60?img=25",
  },
  {
    quote: "Better portfolios, better communication, faster turnaround than any other platform I've used.",
    author: "Jess Crowther",
    role: "Founder, Peak Brands",
    avatar: "https://i.pravatar.cc/60?img=35",
  },
];

export default function Landing() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Force-remove controls after mount via DOM — belt-and-braces for all browsers
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.removeAttribute("controls");
    v.controls = false;
    // Some mobile browsers re-add controls when the video pauses — keep it playing
    const keepPlaying = () => { try { v.play(); } catch {} };
    v.addEventListener("pause", keepPlaying);
    return () => v.removeEventListener("pause", keepPlaying);
  }, []);

  const { data: featured = [] } = useQuery<ProfileWithUser[]>({
    queryKey: ["/api/profiles/featured"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/profiles/featured");
      return res.json();
    },
  });

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background video — controls suppressed at every level */}
        <div
          className="absolute inset-0 z-0 bg-neutral-900"
          style={{ overflow: "hidden", userSelect: "none" }}
        >
          {/* Video sits at z-index 0, pointer-events disabled */}
          <video
            ref={videoRef}
            src="/videos/hero_showreel_web.mp4"
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            poster="/videos/hero_showreel_poster.jpg"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ zIndex: 0, pointerEvents: "none", userSelect: "none" } as React.CSSProperties}
            onContextMenu={e => e.preventDefault()}
          />
          {/* Full-cover sibling at z-index 1 — absorbs every mouse/touch event above the video.
              No browser overlay can show through this because it occupies the exact same pixels
              at a higher stacking order. Background must be set to block the video controls layer. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute", inset: 0, zIndex: 1,
              pointerEvents: "all", cursor: "default",
              // Tiny opacity so it's invisible but still forms a real painted layer the browser won't skip
              background: "rgba(0,0,0,0.001)",
            }}
          />
          {/* Gradient overlay at z-index 2 */}
          <div
            className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/30"
            style={{ zIndex: 2 }}
          />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="max-w-2xl">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.05] mb-6 mt-[-8px]">
              Hire the creative Freelancer<br />
              <span className="gradient-text">You deserve.</span>
            </h1>

            <p className="text-lg text-muted-foreground mb-8 max-w-xl leading-relaxed">
              You bring the brief<span style={{color: '#FF5A1F'}}>.</span><br />
              We'll show you the talent<span style={{color: '#FF5A1F'}}>.</span>
            </p>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white rounded-full px-6 gap-2">
                <Link href="/ai-search">
                  <Sparkles size={16} />
                  Try AI Match
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-6 gap-2">
                <Link href="/marketplace">
                  Browse all talent <ArrowRight size={16} />
                </Link>
              </Button>
            </div>

            {/* Quick search tags */}
            <div className="flex flex-wrap gap-2 mt-6">
              {["Brand film", "Product photography", "Social content", "Video editing", "Drone footage"].map(tag => (
                <Link
                  key={tag}
                  href={`/marketplace?search=${encodeURIComponent(tag)}`}
                  className="text-xs text-muted-foreground bg-secondary rounded-full px-3 py-1 hover:text-foreground hover:bg-secondary/80 transition-colors"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-bold gradient-text">{s.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Specialisms ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold">Every creative skill,<br />one platform.</h2>
            <p className="text-muted-foreground mt-3 max-w-md">Specialised talent in the four disciplines brands need most.</p>
          </div>
          <Button asChild variant="outline" className="hidden md:flex rounded-full">
            <Link href="/marketplace">See all talent <ArrowRight size={14} className="ml-1" /></Link>
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {SPECS.map(({ label, icon: Icon, count }) => (
            <Link key={label} href={`/marketplace?specialism=${label}`}>
              <div className="group bg-card border border-border rounded-2xl p-6 card-lift cursor-pointer text-left">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Icon size={22} className="text-primary" />
                </div>
                <h3 className="font-semibold mb-1">{label}</h3>
                <p className="text-sm text-muted-foreground">{count} professionals</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── AI Search callout ─────────────────────────────────────────────── */}
      <section className="bg-foreground dark:bg-card text-background dark:text-foreground mx-6 rounded-3xl mb-20 overflow-hidden relative">
        <div className="absolute inset-0 opacity-20">
          <img src="https://images.unsplash.com/photo-1535016120720-40c646be5580?w=1400&q=80" alt="" className="w-full h-full object-cover" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-8 py-16 md:flex items-center justify-between gap-12">
          <div className="mb-8 md:mb-0">
            <div className="inline-flex items-center gap-2 bg-primary/20 text-primary rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
              <Sparkles size={14} /> Powered by AI
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-background dark:text-foreground">
              Describe your brief.<br />We'll find your creative.
            </h2>
            <p className="text-background/70 dark:text-muted-foreground max-w-md">
              No more scrolling through hundreds of profiles. Just tell us what you need and our AI matches you with the right creative — in seconds.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white rounded-full px-8 gap-2">
              <Link href="/ai-search">
                <Sparkles size={16} />
                Try AI Match free
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Featured talent ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold">Top rated creatives</h2>
            <p className="text-muted-foreground mt-3">Hand-picked professionals with verified track records.</p>
          </div>
          <Button asChild variant="outline" className="hidden md:flex rounded-full">
            <Link href="/marketplace">View all <ArrowRight size={14} className="ml-1" /></Link>
          </Button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {featured.slice(0, 4).map(pw => (
            <FreelancerCard key={pw.profile.id} pw={pw} />
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="bg-secondary/40 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">How Viewrr works</h2>
            <p className="text-muted-foreground max-w-md mx-auto">From brief to booked creative in under 10 minutes.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map(({ step, title, desc, icon: Icon }) => (
              <div key={step} className="bg-card border border-border rounded-2xl p-7">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-4xl font-bold gradient-text leading-none">{step}</span>
                  <Icon size={20} className="text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-3xl md:text-4xl font-bold mb-10 text-center">Brands that found their creative</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {TESTIMONIALS.map(t => (
            <div key={t.author} className="bg-card border border-border rounded-2xl p-7">
              <div className="flex gap-0.5 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} className="star-filled fill-current" />
                ))}
              </div>
              <p className="text-sm leading-relaxed mb-5 text-muted-foreground">"{t.quote}"</p>
              <div className="flex items-center gap-3">
                <img src={t.avatar} alt={t.author} className="w-9 h-9 rounded-full" />
                <div>
                  <p className="font-semibold text-sm">{t.author}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust ────────────────────────────────────────────────────────── */}
      <section className="bg-secondary/40 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid sm:grid-cols-3 gap-6 text-center">
            {[
              { icon: Shield, title: "Verified professionals", desc: "Every profile is reviewed and approved by our team." },
              { icon: Users, title: "Talent-first community", desc: "Built to give creatives the platform they deserve." },
              { icon: Zap, title: "Instant messaging", desc: "Direct comms. No back-and-forth through middlemen." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon size={18} className="text-primary" />
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground max-w-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
              <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
            </svg>
            <span className="gradient-text">Viewrr</span>
          </Link>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm text-muted-foreground">© 2026 Viewrr. The creative talent marketplace.</p>
            <a href="mailto:support@viewrr.co.uk" className="text-sm text-primary hover:underline transition-colors">support@viewrr.co.uk</a>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms &amp; Conditions</Link>
            <a href="mailto:support@viewrr.co.uk" className="hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
