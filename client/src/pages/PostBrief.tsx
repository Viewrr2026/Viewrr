import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = ["Videography", "Video Editing", "Photography", "Marketing", "Other"];
const DURATIONS = ["Half day", "1 day", "2–3 days", "1 week", "2–4 weeks", "1–3 months", "Ongoing"];
const BUDGET_TYPES = [
  { value: "project", label: "Total project budget" },
  { value: "day", label: "Per day rate" },
  { value: "hour", label: "Per hour rate" },
];

export default function PostBrief() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const [form, setForm] = useState({
    title: "",
    category: "",
    description: "",
    location: "",
    remote: false,
    startDate: "",
    duration: "",
    budgetType: "project",
    budgetMin: "",
    budgetMax: "",
    requirements: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (field: string, value: any) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Please add a title";
    if (!form.category) e.category = "Please select a category";
    if (!form.description.trim()) e.description = "Please describe the brief";
    if (form.description.trim().length < 50) e.description = "Please add more detail (at least 50 characters)";
    if (!form.location.trim()) e.location = "Please enter a location";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (!user) {
      toast({ title: "Please sign in to post a brief", variant: "destructive" });
      return;
    }

    setIsPending(true);
    try {
      const payload = {
        clientId: user.id,
        clientName: user.name || "Anonymous",
        clientAvatar: user.avatar || null,
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim(),
        location: form.location.trim(),
        remote: form.remote ? 1 : 0,
        startDate: form.startDate || null,
        duration: form.duration || null,
        budgetType: form.budgetType,
        budgetMin: form.budgetMin ? parseFloat(form.budgetMin) : null,
        budgetMax: form.budgetMax ? parseFloat(form.budgetMax) : null,
        requirements: form.requirements.trim(),
        status: "open",
      };

      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to post brief");
      }

      setSubmitted(true);
    } catch (err: any) {
      toast({ title: "Couldn't post brief", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Brief posted!</h1>
          <p className="text-muted-foreground mb-6">Your brief is now live. Freelancers on Viewrr can see it and express their interest.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/briefs">
              <Button className="rounded-full bg-primary text-white hover:bg-primary/90">View all briefs</Button>
            </Link>
            <Button variant="outline" className="rounded-full" onClick={() => {
              setSubmitted(false);
              setForm({ title: "", category: "", description: "", location: "", remote: false, startDate: "", duration: "", budgetType: "project", budgetMin: "", budgetMax: "", requirements: "" });
            }}>
              Post another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/briefs" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft size={15} /> Back to briefs
        </Link>

        <h1 className="text-3xl font-bold mb-2">Post a Brief</h1>
        <p className="text-muted-foreground mb-8">Tell us what you need. Viewrr freelancers will be able to express interest in your project.</p>

        {!user && (
          <div className="mb-6 p-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
            You need to be signed in to post a brief.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Title */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">Brief title <span className="text-primary">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={e => set("title", e.target.value)}
              placeholder="e.g. Videographer needed for summer music festival"
              className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition ${errors.title ? "border-red-400" : "border-border"}`}
            />
            {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">Category <span className="text-primary">*</span></label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => set("category", cat)}
                  className={`px-4 py-1.5 rounded-full text-sm border transition-all ${
                    form.category === cat
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">Describe the brief <span className="text-primary">*</span></label>
            <textarea
              value={form.description}
              onChange={e => set("description", e.target.value)}
              rows={5}
              placeholder="Describe the project in detail — what you need, the context, the deliverables, and any style references..."
              className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none ${errors.description ? "border-red-400" : "border-border"}`}
            />
            <div className="flex justify-between mt-1">
              {errors.description ? <p className="text-xs text-red-500">{errors.description}</p> : <span />}
              <p className="text-xs text-muted-foreground">{form.description.length} chars</p>
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">Location <span className="text-primary">*</span></label>
            <input
              type="text"
              value={form.location}
              onChange={e => set("location", e.target.value)}
              placeholder="e.g. London, UK · or · Remote"
              className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition ${errors.location ? "border-red-400" : "border-border"}`}
            />
            {errors.location && <p className="text-xs text-red-500 mt-1">{errors.location}</p>}
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.remote}
                onChange={e => set("remote", e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <span className="text-sm text-muted-foreground">Remote or hybrid working accepted</span>
            </label>
          </div>

          {/* Dates & Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Start date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={e => set("startDate", e.target.value)}
                className="w-full rounded-xl border border-border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Duration</label>
              <select
                value={form.duration}
                onChange={e => set("duration", e.target.value)}
                className="w-full rounded-xl border border-border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              >
                <option value="">Select duration</option>
                {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Budget */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">Budget</label>
            <div className="flex gap-2 mb-3">
              {BUDGET_TYPES.map(bt => (
                <button
                  key={bt.value}
                  type="button"
                  onClick={() => set("budgetType", bt.value)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs border transition-all text-center ${
                    form.budgetType === bt.value
                      ? "bg-primary/10 border-primary text-primary font-semibold"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {bt.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input
                  type="number"
                  value={form.budgetMin}
                  onChange={e => set("budgetMin", e.target.value)}
                  placeholder="Min"
                  className="w-full rounded-xl border border-border pl-7 pr-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input
                  type="number"
                  value={form.budgetMax}
                  onChange={e => set("budgetMax", e.target.value)}
                  placeholder="Max"
                  className="w-full rounded-xl border border-border pl-7 pr-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                />
              </div>
            </div>
          </div>

          {/* Requirements */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">Requirements & skills needed</label>
            <textarea
              value={form.requirements}
              onChange={e => set("requirements", e.target.value)}
              rows={3}
              placeholder="e.g. Must own 4K camera, drone licence preferred, 3+ years experience..."
              className="w-full rounded-xl border border-border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none"
            />
          </div>

          <Button
            type="submit"
            disabled={isPending || !user}
            className="w-full bg-primary hover:bg-primary/90 text-white rounded-full py-5 font-semibold text-base"
          >
            {isPending ? "Posting..." : "Post Brief"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            By posting you agree to our{" "}
            <Link href="/terms" className="text-primary underline underline-offset-2">Terms & Conditions</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
