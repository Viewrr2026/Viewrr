import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Sparkles, Star, Shield, Zap, Users, CheckCircle, Video, Camera, Megaphone, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import FreelancerCard from "@/components/FreelancerCard";
import type { ProfileWithUser } from "../../../server/storage";

const STATS = [
  { value: "UK-based", label: "Local talent, real results" },
  { value: "Vetted", label: "Every profile reviewed" },
  { value: "Secure", label: "Payments via Stripe" },
  { value: "Fast", label: "Hear back within 24h" },
  { value: "UK-based", label: "Local talent, real results" },
  { value: "Vetted", label: "Every profile reviewed" },
  { value: "Secure", label: "Payments via Stripe" },
  { value: "Fast", label: "Hear back within 24h" },
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
  const [posterVisible, setPosterVisible] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.removeAttribute("controls");
    v.controls = false;

    // Hide the poster once the video has enough data to play smoothly.
    // We listen to multiple events so whichever fires first wins.
    const hidePoster = () => setPosterVisible(false);
    v.addEventListener("playing", hidePoster);
    v.addEventListener("canplaythrough", hidePoster);
    v.play().catch(() => {});
    return () => {
      v.removeEventListener("playing", hidePoster);
      v.removeEventListener("canplaythrough", hidePoster);
    };
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
      <section className="relative overflow-hidden min-h-[92vh] flex items-center">
        {/* Background video */}
        <div
          className="absolute inset-0 z-0"
          style={{
            overflow: "hidden",
            userSelect: "none",
            backgroundImage: "url('data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAALgAtAAD//gAQTGF2YzYxLjE5LjEwMQD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xAB0AAACAwEBAAAAAAAAAAAAAAAEAwYHAgEFAQEAAwEAAAAAAAAAAAAAAAACBAABBRAAAQMCBAUDBQEAAAAAAAAAAQIAEQQDMSEUEoFRBUGxYXFCgqHhEzIiEQADAAIDAQEAAAAAAAAAAAAAARESAlGBIUIx/8AAEQgAFwAoAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8Aniqiwj5Dhn4Yx6hbH8pJ4AOO6S8oZG2fr/EMO5SViBP6irKf8EKMc4Bn7OZVyc27L5nRKjXqOCQPctetWfkB7B1oaogxnPJ51R5seCzZZZqScVFr1Hq681Tzqmi5nlioXbMpUUn0MeHO6PrFk24vnZdTBSvaopJBxhOaVRiRj3daqaO4cRs3Vxnb9Sqov3bsQFrJDwFMFLeHQ7foTvfN7QXl7Qw//9k=')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <video
            ref={videoRef}
            src="/videos/hero_showreel_web.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            className="absolute inset-0 w-full h-full object-cover"
            style={{ zIndex: 0, pointerEvents: "none" } as React.CSSProperties}
            onContextMenu={e => e.preventDefault()}
          />
          <img
            src="/videos/hero_showreel_poster.jpg"
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              zIndex: 1,
              pointerEvents: "none",
              opacity: posterVisible ? 1 : 0,
              transition: "opacity 1s ease",
            }}
          />
          {/* Deep gradient — strong on left for legibility, opens up on right to show video */}
          <div
            className="absolute inset-0"
            style={{
              zIndex: 2,
              background: "linear-gradient(105deg, hsl(var(--background)) 30%, hsl(var(--background) / 0.75) 55%, hsl(var(--background) / 0.15) 100%)",
            }}
          />
          {/* Bottom fade so it blends into the stats bar below */}
          <div
            className="absolute bottom-0 left-0 right-0 h-32"
            style={{ zIndex: 3, background: "linear-gradient(to top, hsl(var(--background)), transparent)" }}
          />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-6 w-full py-24 md:py-0">
          <div className="max-w-xl">

            {/* Launch badge */}
            <div className="inline-flex items-center gap-2 mb-7 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Now open — UK creative talent
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-[4.5rem] font-bold leading-[1.04] mb-6 tracking-tight">
              The home of
              <br />
              <span className="gradient-text">UK creative</span>
              <br />
              freelancers.
            </h1>

            <p className="text-base md:text-lg text-muted-foreground mb-8 max-w-sm leading-relaxed">
              Videographers, photographers, editors and marketers — all vetted, all based in the UK. Post a brief and hear back today.
            </p>

            <div className="flex flex-wrap gap-3 mb-8">
              <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white rounded-full px-7 gap-2 shadow-lg shadow-primary/25">
                <Link href="/briefs/new">
                  Post a brief
                  <ArrowRight size={16} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-7 gap-2 bg-background/60 backdrop-blur-sm">
                <Link href="/marketplace">
                  <Sparkles size={15} />
                  Browse talent
                </Link>
              </Button>
            </div>

            {/* Social proof strip */}
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {["https://i.pravatar.cc/40?img=11","https://i.pravatar.cc/40?img=17","https://i.pravatar.cc/40?img=28","https://i.pravatar.cc/40?img=33"].map((src, i) => (
                  <img key={i} src={src} alt="" className="w-8 h-8 rounded-full border-2 border-background object-cover" />
                ))}
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Launching June 2026</span> — join the waitlist
              </div>
            </div>

          </div>
        </div>

        {/* Specialism pills — bottom-right of hero, visible on md+ */}
        <div className="absolute bottom-10 right-6 z-10 hidden md:flex flex-col gap-2 items-end">
          {["Videography", "Photography", "Video Editing", "Marketing"].map((s, i) => (
            <Link
              key={s}
              href={`/marketplace?specialism=${s}`}
              className="text-xs font-medium px-4 py-1.5 rounded-full border border-white/20 bg-background/40 backdrop-blur-md text-white/80 hover:bg-primary hover:border-primary hover:text-white transition-all"
              style={{ opacity: 1 - i * 0.15 }}
            >
              {s}
            </Link>
          ))}
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card overflow-hidden py-5 select-none">
        <style>{`
          @keyframes marquee {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .marquee-track {
            display: flex;
            width: max-content;
            animation: marquee 18s linear infinite;
          }
          .marquee-track:hover { animation-play-state: paused; }
        `}</style>
        <div className="marquee-track">
          {STATS.map((s, i) => (
            <div key={i} className="flex items-center gap-6 px-10">
              <div>
                <span className="text-lg font-bold gradient-text">{s.value}</span>
                <span className="text-sm text-muted-foreground ml-2">{s.label}</span>
              </div>
              <span className="text-primary/40 text-lg font-light">/</span>
            </div>
          ))}
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
      <footer className="border-t border-border pt-10 pb-6">
        <div className="mx-auto max-w-7xl px-6">
          {/* Top row */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
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
          {/* Legal disclosure row — required by Companies Act 2006 */}
          <div className="border-t border-border pt-4">
            <p className="text-[11px] text-muted-foreground/70 text-center leading-relaxed">
              Viewrr Ltd &mdash; Registered in England &amp; Wales &mdash; Company No. 17196781 &mdash; Registered office: 2 The Mill, Stane Street, Maudlin, Chichester, England, PO18 0FF
              &nbsp;&middot;&nbsp; Payments are processed securely by Stripe. Viewrr Ltd is not a payment institution and does not hold client funds.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
