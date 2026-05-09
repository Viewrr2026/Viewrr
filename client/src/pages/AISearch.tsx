import { useState } from "react";
import { Sparkles, Send, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import FreelancerCard from "@/components/FreelancerCard";
import type { ProfileWithUser } from "../../../server/storage";

const EXAMPLE_PROMPTS = [
  "I need a videographer in London for a luxury fashion brand film. Budget around £1,500/day.",
  "Looking for a social media marketer who specialises in TikTok for a fitness brand",
  "We need a colour grader with experience in commercial food & beverage content",
  "Find me a drone operator available this month in the UK",
  "I need a product photographer for an e-commerce skincare brand launch",
];

interface AIResult {
  summary: string;
  detectedSpecialism: string;
  budget: number | null;
  results: ProfileWithUser[];
}

export default function AISearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResult | null>(null);

  async function handleSearch(q?: string) {
    const searchQuery = q || query;
    if (!searchQuery.trim()) return;
    if (q) setQuery(q);
    setLoading(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", "/api/ai-search", { query: searchQuery });
      const data = await res.json();
      setResult(data);
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">

      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-semibold mb-5">
            <Sparkles size={14} />
            AI-powered matching
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Describe your brief.<br />
            <span className="gradient-text">Find your creative.</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            Tell us what you're looking for in plain English — specialism, style, budget, location.
            Our AI does the rest.
          </p>
        </div>

        {/* Search box */}
        <div className="bg-card border border-border rounded-2xl p-5 mb-8 shadow-sm">
          <Textarea
            placeholder="e.g. I need a videographer in London for a 2-day brand shoot. Budget around £1,200/day. We want a cinematic, high-end feel for a luxury product."
            value={query}
            onChange={e => setQuery(e.target.value)}
            rows={4}
            className="resize-none border-0 focus-visible:ring-0 bg-transparent p-0 text-base placeholder:text-muted-foreground"
            onKeyDown={e => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSearch();
            }}
            data-testid="input-ai-query"
          />
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">Ctrl/Cmd + Enter to search</p>
            <Button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="bg-primary hover:bg-primary/90 text-white gap-2"
              data-testid="btn-ai-search"
            >
              {loading ? (
                <><RefreshCw size={15} className="animate-spin" /> Matching...</>
              ) : (
                <><Sparkles size={15} /> Find matches</>
              )}
            </Button>
          </div>
        </div>

        {/* Example prompts */}
        {!result && !loading && (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3">Try an example brief:</p>
            <div className="space-y-2">
              {EXAMPLE_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => handleSearch(p)}
                  className="w-full text-left flex items-start gap-3 p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-colors text-sm"
                  data-testid={`example-prompt-${EXAMPLE_PROMPTS.indexOf(p)}`}
                >
                  <ArrowRight size={14} className="text-primary mt-0.5 flex-shrink-0" />
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-flex items-center gap-3 text-muted-foreground">
              <Sparkles size={20} className="text-primary animate-pulse" />
              <span>Analysing your brief and matching creatives...</span>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div>
            {/* AI summary */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 mb-7">
              <div className="flex items-start gap-3">
                <Sparkles size={18} className="text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-sm mb-1">AI analysis</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{result.summary}</p>
                  <div className="flex gap-3 mt-3 flex-wrap">
                    {result.detectedSpecialism && (
                      <span className="text-xs bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-medium">
                        Specialism: {result.detectedSpecialism}
                      </span>
                    )}
                    {result.budget && (
                      <span className="text-xs bg-secondary text-muted-foreground rounded-full px-2.5 py-0.5 font-medium">
                        Budget detected: £{result.budget.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Profile cards */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {result.results.map(pw => (
                <FreelancerCard key={pw.profile.id} pw={pw} />
              ))}
            </div>

            {/* New search CTA */}
            <div className="text-center mt-8">
              <Button
                variant="outline"
                onClick={() => { setResult(null); setQuery(""); }}
                className="gap-2"
              >
                <RefreshCw size={14} />
                Start a new search
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
