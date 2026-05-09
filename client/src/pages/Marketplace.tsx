import { useState, useRef, useCallback, useEffect } from "react";
import { Search, SlidersHorizontal, X, MapPin, Star, Crown, Wifi, CheckCircle, Camera, Video } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import FreelancerCard from "@/components/FreelancerCard";
import type { ProfileWithUser } from "../../../server/storage";

// ── Constants ─────────────────────────────────────────────────────────────────
const SPECIALISMS = ["all", "Videographer", "Video Editor", "Photographer", "Marketer"];
const SORT_OPTIONS = ["Top rated", "Most projects", "Day rate: low → high", "Day rate: high → low", "Newest"];
const MIN_RATE = 0;
const MAX_RATE = 1500;

const EQUIPMENT_OPTIONS = [
  { id: "4k_camera", label: "4K Camera", icon: "🎥" },
  { id: "8k_camera", label: "8K Camera", icon: "🎬" },
  { id: "drone", label: "Drone", icon: "🚁" },
  { id: "gimbal", label: "Gimbal / Stabiliser", icon: "🎞️" },
  { id: "cinema_lens", label: "Cinema Lenses", icon: "🔭" },
  { id: "lighting", label: "Professional Lighting", icon: "💡" },
  { id: "audio", label: "Audio / Sound Gear", icon: "🎙️" },
  { id: "360_camera", label: "360° Camera", icon: "🌐" },
  { id: "anamorphic", label: "Anamorphic Lens", icon: "🎦" },
  { id: "teleprompter", label: "Teleprompter", icon: "📜" },
];

// ── Dual-handle range slider ──────────────────────────────────────────────────
function RangeSlider({
  min, max, valueMin, valueMax, onChange,
}: {
  min: number; max: number; valueMin: number; valueMax: number;
  onChange: (min: number, max: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"min" | "max" | null>(null);

  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const getValueFromEvent = useCallback((e: MouseEvent | TouchEvent) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round((ratio * (max - min) + min) / 50) * 50;
  }, [min, max]);

  const onMouseDown = (handle: "min" | "max") => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    dragging.current = handle;

    const move = (ev: MouseEvent | TouchEvent) => {
      const val = getValueFromEvent(ev);
      if (dragging.current === "min") onChange(Math.min(val, valueMax - 50), valueMax);
      else onChange(valueMin, Math.max(val, valueMin + 50));
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
  };

  return (
    <div className="px-2 pt-2 pb-1">
      <div ref={trackRef} className="relative h-1.5 bg-border rounded-full">
        {/* Active range */}
        <div
          className="absolute h-full bg-primary rounded-full"
          style={{ left: `${pct(valueMin)}%`, right: `${100 - pct(valueMax)}%` }}
        />
        {/* Min handle */}
        <button
          onMouseDown={onMouseDown("min")}
          onTouchStart={onMouseDown("min")}
          className="absolute w-5 h-5 bg-white border-2 border-primary rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 top-1/2 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary/40 hover:scale-110 transition-transform"
          style={{ left: `${pct(valueMin)}%` }}
          aria-label="Minimum rate"
        />
        {/* Max handle */}
        <button
          onMouseDown={onMouseDown("max")}
          onTouchStart={onMouseDown("max")}
          className="absolute w-5 h-5 bg-white border-2 border-primary rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 top-1/2 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary/40 hover:scale-110 transition-transform"
          style={{ left: `${pct(valueMax)}%` }}
          aria-label="Maximum rate"
        />
      </div>
      <div className="flex justify-between mt-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">£{valueMin}/day</span>
        <span className="font-semibold text-foreground">{valueMax >= MAX_RATE ? `£${MAX_RATE}+/day` : `£${valueMax}/day`}</span>
      </div>
    </div>
  );
}

// ── Filter drawer ─────────────────────────────────────────────────────────────
function FilterDrawer({
  open,
  onClose,
  location, setLocation,
  rateMin, rateMax, setRate,
  sort, setSort,
  minRating, setMinRating,
  proOnly, setProOnly,
  remoteOnly, setRemoteOnly,
  equipment, setEquipment,
  activeCount,
  onReset,
}: {
  open: boolean; onClose: () => void;
  location: string; setLocation: (v: string) => void;
  rateMin: number; rateMax: number; setRate: (min: number, max: number) => void;
  sort: string; setSort: (v: string) => void;
  minRating: number; setMinRating: (v: number) => void;
  proOnly: boolean; setProOnly: (v: boolean) => void;
  remoteOnly: boolean; setRemoteOnly: (v: boolean) => void;
  equipment: string[]; setEquipment: (v: string[]) => void;
  activeCount: number; onReset: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const toggleEquipment = (id: string) => {
    setEquipment(
      equipment.includes(id) ? equipment.filter(e => e !== id) : [...equipment, id]
    );
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          onClick={onClose}
          style={{ animation: "fadeIn 0.15s ease" }}
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[420px] bg-card border-l border-border z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <SlidersHorizontal size={18} className="text-primary" />
              Filters
            </h2>
            {activeCount > 0 && (
              <p className="text-xs text-primary mt-0.5">{activeCount} filter{activeCount !== 1 ? "s" : ""} active</p>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* ── Day Rate ─────────────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              Day rate
              <span className="text-xs text-muted-foreground font-normal">(drag to set range)</span>
            </h3>
            <div className="bg-secondary/50 rounded-2xl p-4 mt-2">
              <RangeSlider
                min={MIN_RATE} max={MAX_RATE}
                valueMin={rateMin} valueMax={rateMax}
                onChange={setRate}
              />
              {/* Quick presets */}
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
                {[
                  { label: "Any", min: MIN_RATE, max: MAX_RATE },
                  { label: "Under £200", min: 0, max: 200 },
                  { label: "£200–400", min: 200, max: 400 },
                  { label: "£400–700", min: 400, max: 700 },
                  { label: "£700+", min: 700, max: MAX_RATE },
                ].map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => setRate(preset.min, preset.max)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      rateMin === preset.min && rateMax === preset.max
                        ? "bg-primary text-white border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ── Location ─────────────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <MapPin size={14} className="text-primary" /> Location
            </h3>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. London, Manchester, Remote…"
                value={location}
                onChange={e => setLocation(e.target.value)}
                className="w-full pl-8 pr-9 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors placeholder:text-muted-foreground"
              />
              {location && (
                <button
                  onClick={() => setLocation("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {/* Quick-select chips */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {["London", "Manchester", "Birmingham", "Bristol", "Edinburgh", "Leeds", "Glasgow", "Remote"].map(city => (
                <button
                  key={city}
                  onClick={() => setLocation(location === city ? "" : city)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    location === city
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {city}
                </button>
              ))}
            </div>
          </section>

          {/* ── Equipment ────────────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Camera size={14} className="text-primary" /> Equipment
              <span className="text-xs text-muted-foreground font-normal">(select all that apply)</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {EQUIPMENT_OPTIONS.map(eq => {
                const active = equipment.includes(eq.id);
                return (
                  <button
                    key={eq.id}
                    onClick={() => toggleEquipment(eq.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-left ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <span className="text-base leading-none">{eq.icon}</span>
                    <span className="text-xs leading-tight">{eq.label}</span>
                    {active && <CheckCircle size={12} className="text-primary shrink-0 ml-auto" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Minimum rating ───────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Star size={14} className="text-primary" /> Minimum rating
            </h3>
            <div className="flex gap-2">
              {[0, 3, 4, 4.5].map(r => (
                <button
                  key={r}
                  onClick={() => setMinRating(r)}
                  className={`flex items-center gap-1 px-3 py-2 rounded-full text-sm font-medium border transition-all ${
                    minRating === r
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {r === 0 ? "Any" : <><Star size={11} className="fill-current" />{r}+</>}
                </button>
              ))}
            </div>
          </section>

          {/* ── Sort by ──────────────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-3">Sort by</h3>
            <div className="flex flex-col gap-2">
              {SORT_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                    sort === s
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {s}
                  {sort === s && <CheckCircle size={15} className="text-primary" />}
                </button>
              ))}
            </div>
          </section>

          {/* ── Toggles ──────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold mb-3">More options</h3>

            {/* Pro Viewrr only */}
            <button
              onClick={() => setProOnly(!proOnly)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all ${
                proOnly ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${proOnly ? "bg-primary/20" : "bg-secondary"}`}>
                  <Crown size={15} className={proOnly ? "text-primary" : "text-muted-foreground"} />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-semibold ${proOnly ? "text-primary" : ""}`}>Pro Viewrr only</p>
                  <p className="text-xs text-muted-foreground">Verified &amp; manually reviewed</p>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full transition-colors relative ${proOnly ? "bg-primary" : "bg-border"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${proOnly ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </button>

            {/* Remote / hybrid */}
            <button
              onClick={() => setRemoteOnly(!remoteOnly)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all ${
                remoteOnly ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${remoteOnly ? "bg-primary/20" : "bg-secondary"}`}>
                  <Wifi size={15} className={remoteOnly ? "text-primary" : "text-muted-foreground"} />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-semibold ${remoteOnly ? "text-primary" : ""}`}>Remote / hybrid ok</p>
                  <p className="text-xs text-muted-foreground">Available to work anywhere</p>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full transition-colors relative ${remoteOnly ? "bg-primary" : "bg-border"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${remoteOnly ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </button>
          </section>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button
            variant="outline"
            className="flex-1 rounded-full"
            onClick={onReset}
          >
            Reset all
          </Button>
          <Button
            className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-full"
            onClick={onClose}
          >
            Show results
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="h-44 skeleton" />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full skeleton" />
          <div className="flex-1 space-y-2">
            <div className="h-3 skeleton rounded w-3/4" />
            <div className="h-2.5 skeleton rounded w-1/2" />
          </div>
        </div>
        <div className="h-3 skeleton rounded w-1/3" />
        <div className="flex gap-2">
          <div className="h-5 w-16 skeleton rounded-full" />
          <div className="h-5 w-20 skeleton rounded-full" />
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Marketplace() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const [search, setSearch] = useState(params.get("search") || "");
  const [specialism, setSpecialism] = useState(params.get("specialism") || "all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filter state
  const [location, setLocation] = useState("");
  const [rateMin, setRateMin] = useState(MIN_RATE);
  const [rateMax, setRateMax] = useState(MAX_RATE);
  const [sort, setSort] = useState("Top rated");
  const [minRating, setMinRating] = useState(0);
  const [proOnly, setProOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);

  const { data: profiles = [], isLoading } = useQuery<ProfileWithUser[]>({
    queryKey: ["/api/profiles", specialism, search],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (specialism !== "all") q.set("specialism", specialism);
      if (search) q.set("search", search);
      const res = await apiRequest("GET", `/api/profiles?${q.toString()}`);
      return res.json();
    },
  });

  // Client-side filtering
  const filtered = profiles.filter(pw => {
    // Location (free-text match)
    if (location.trim()) {
      const loc = (pw.user.location || "").toLowerCase();
      if (!loc.includes(location.trim().toLowerCase())) return false;
    }
    // Rate
    const rate = pw.profile.dayRate || 0;
    if (rateMax < MAX_RATE && rate > rateMax) return false;
    if (rateMin > MIN_RATE && rate < rateMin) return false;
    // Rating
    if (minRating > 0 && (pw.profile.rating || 0) < minRating) return false;
    // Pro only
    if (proOnly && pw.profile.isPro !== 1) return false;
    // Remote only
    if (remoteOnly) {
      const loc = (pw.user.location || "").toLowerCase();
      if (!loc.includes("remote")) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "Most projects") return (b.profile.projectCount || 0) - (a.profile.projectCount || 0);
    if (sort === "Day rate: low → high") return (a.profile.dayRate || 0) - (b.profile.dayRate || 0);
    if (sort === "Day rate: high → low") return (b.profile.dayRate || 0) - (a.profile.dayRate || 0);
    if (sort === "Newest") return new Date(b.profile.createdAt || 0).getTime() - new Date(a.profile.createdAt || 0).getTime();
    return (b.profile.rating || 0) - (a.profile.rating || 0);
  });

  // Active filter count (for badge)
  const activeCount = [
    !!location.trim(),
    rateMin > MIN_RATE || rateMax < MAX_RATE,
    sort !== "Top rated",
    minRating > 0,
    proOnly,
    remoteOnly,
    equipment.length > 0,
  ].filter(Boolean).length;

  // Active filter chips (shown below search bar)
  const activeChips: string[] = [
    location.trim() && location.trim(),
    (rateMin > MIN_RATE || rateMax < MAX_RATE) && `£${rateMin}–${rateMax >= MAX_RATE ? MAX_RATE + "+" : rateMax}/day`,
    sort !== "Top rated" && sort,
    minRating > 0 && `${minRating}+ stars`,
    proOnly && "Pro Viewrr",
    remoteOnly && "Remote ok",
    ...equipment.map(id => EQUIPMENT_OPTIONS.find(e => e.id === id)?.label || ""),
  ].filter(Boolean) as string[];

  function resetFilters() {
    setLocation("");
    setRateMin(MIN_RATE); setRateMax(MAX_RATE);
    setSort("Top rated");
    setMinRating(0);
    setProOnly(false);
    setRemoteOnly(false);
    setEquipment([]);
  }

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <h1 className="text-3xl font-bold mb-1">Find your creative</h1>
          <p className="text-muted-foreground">Browse {profiles.length} verified professionals</p>

          {/* Search + filter row */}
          <div className="mt-5 flex gap-3">
            <div className="relative flex-1 max-w-lg">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, skill, or style..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 rounded-full"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setFiltersOpen(true)}
              className="gap-2 rounded-full border-border hover:border-primary/50 transition-colors"
            >
              <SlidersHorizontal size={14} />
              Filters
              {activeCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center">
                  {activeCount}
                </span>
              )}
            </Button>
          </div>

          {/* Specialism tabs */}
          <div className="flex gap-2 mt-5 overflow-x-auto pb-1">
            {SPECIALISMS.map(s => (
              <button
                key={s}
                onClick={() => setSpecialism(s)}
                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  specialism === s
                    ? "bg-primary text-white"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All creatives" : s + "s"}
              </button>
            ))}
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs text-muted-foreground">Active:</span>
              {activeChips.map(chip => (
                <Badge
                  key={chip}
                  variant="secondary"
                  className="gap-1 cursor-pointer rounded-full text-xs hover:bg-destructive/10 hover:text-destructive transition-colors"
                  onClick={resetFilters}
                >
                  {chip} <X size={9} />
                </Badge>
              ))}
              <button onClick={resetFilters} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 transition-colors">
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Search size={40} className="mx-auto mb-4 opacity-40" />
            <h3 className="font-semibold text-foreground mb-2">No results found</h3>
            <p className="text-sm">Try adjusting your filters or search terms.</p>
            <Button variant="outline" className="mt-4 rounded-full" onClick={resetFilters}>
              Clear all filters
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-5">
              {sorted.length} result{sorted.length !== 1 ? "s" : ""}
              {sort !== "Top rated" && <span className="ml-1">· sorted by {sort}</span>}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {sorted.map(pw => <FreelancerCard key={pw.profile.id} pw={pw} />)}
            </div>
          </>
        )}
      </div>

      {/* Filter drawer */}
      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        location={location} setLocation={setLocation}
        rateMin={rateMin} rateMax={rateMax} setRate={(min, max) => { setRateMin(min); setRateMax(max); }}
        sort={sort} setSort={setSort}
        minRating={minRating} setMinRating={setMinRating}
        proOnly={proOnly} setProOnly={setProOnly}
        remoteOnly={remoteOnly} setRemoteOnly={setRemoteOnly}
        equipment={equipment} setEquipment={setEquipment}
        activeCount={activeCount}
        onReset={resetFilters}
      />
    </div>
  );
}
