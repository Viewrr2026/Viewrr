/**
 * PRD-011 FR-07 — Help Centre with Payments & Payouts category
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, ArrowLeft, HelpCircle, CreditCard, Shield, Clock, Building2, ReceiptText, RefreshCw } from "lucide-react";
import { Link } from "wouter";

interface Article {
  slug: string;
  title: string;
  body: React.ReactNode;
}

interface Category {
  key: string;
  label: string;
  icon: React.ReactNode;
  articles: Article[];
}

const CATEGORIES: Category[] = [
  {
    key: "payments",
    label: "Payments & Payouts",
    icon: <CreditCard size={18} />,
    articles: [
      {
        slug: "how-payments-work",
        title: "How do payments work?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              When a client is ready to pay for a project, Viewrr generates a secure invoice. The client completes
              payment through Stripe — one of the world's most trusted payment providers. Your card details are
              never stored on Viewrr.
            </p>
            <p>
              Once the payment is confirmed, Stripe allocates your earnings inside your connected account.
              After a standard availability period, Stripe automatically sends the funds to your bank account —
              no manual action is required.
            </p>
            <p className="font-semibold text-foreground">In summary:</p>
            <ol className="list-decimal list-inside space-y-1 pl-2">
              <li>Client pays securely through Viewrr</li>
              <li>Stripe processes and confirms the payment</li>
              <li>Your earnings are allocated inside your Stripe account</li>
              <li>Stripe applies a standard availability period</li>
              <li>Funds are automatically sent to your bank</li>
            </ol>
          </div>
        ),
      },
      {
        slug: "not-received-money",
        title: "Why haven't I received my money yet?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              If a payment has been confirmed but you haven't yet seen the funds in your bank, this is completely
              normal. It means your payment is inside Stripe's availability period.
            </p>
            <p>
              Your client has successfully paid, and your payment has reached Stripe. Before Stripe sends money
              to your bank, it applies a standard availability period. This is a security measure that helps
              protect both buyers and sellers from fraud and disputes.
            </p>
            <p>
              <strong className="text-foreground">You do not need to take any action.</strong> Once the
              availability period ends, Stripe will automatically initiate a payout to your bank.
            </p>
            <p>
              You can track exactly where your payment is by visiting <strong className="text-foreground">Your Work</strong>{" "}
              and checking the Earnings section.
            </p>
          </div>
        ),
      },
      {
        slug: "stripe-holding-payment",
        title: "Why is Stripe holding my payment?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              Stripe is not "holding" your payment in a negative sense. It is applying a standard availability
              window that exists to protect both the seller (you) and the buyer (your client).
            </p>
            <p>
              This window allows time for any fraud checks or payment disputes to be raised and resolved before
              funds are sent to a bank. It is a standard feature of all payment processors, not something unique
              to Viewrr.
            </p>
            <p>
              As your account builds a successful payment history, this period may reduce over time.
            </p>
          </div>
        ),
      },
      {
        slug: "availability-period",
        title: "What is the availability period?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              The availability period is the time between a payment being confirmed by Stripe and when those
              funds become available to send to your bank account.
            </p>
            <p>
              During this time, the funds sit securely inside your Stripe account. Stripe uses this window
              to run fraud checks and allow any disputes to surface before money leaves the system.
            </p>
            <p>
              The length of this period is set by Stripe based on your account history and the nature of your
              business. For new accounts, this is typically 7 days. As your account matures and builds a
              successful track record, Stripe may reduce this automatically.
            </p>
            <p>
              <strong className="text-foreground">No action is required from you.</strong> The process is
              entirely automatic.
            </p>
          </div>
        ),
      },
      {
        slug: "when-will-bank-receive",
        title: "When will my bank receive my money?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              Once Stripe initiates a payout, funds typically arrive in UK bank accounts within 1 business day.
              The exact timing depends on your bank.
            </p>
            <p>
              You can see the estimated arrival date in the Earnings section of Your Work. This date is
              provided for guidance only — actual arrival may vary slightly depending on Stripe and your bank.
            </p>
            <p>
              Your payout is set to run automatically on a daily schedule. This means as soon as funds become
              available in your Stripe account, they will be swept to your bank without you needing to do
              anything.
            </p>
          </div>
        ),
      },
      {
        slug: "how-fees-calculated",
        title: "How are Viewrr fees calculated?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              Viewrr charges an 11% platform fee on each completed payment. This fee is collected
              automatically by Stripe at the point of payment — you never need to manually transfer it.
            </p>
            <p className="font-semibold text-foreground">Example:</p>
            <div
              className="rounded-xl px-4 py-3 text-xs space-y-1"
              style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.15)" }}
            >
              <div className="flex justify-between"><span>Client pays</span><span className="font-bold">£1,000.00</span></div>
              <div className="flex justify-between"><span>Viewrr fee (11%)</span><span className="font-bold">£110.00</span></div>
              <div className="flex justify-between text-foreground font-semibold border-t border-border pt-1 mt-1">
                <span>You receive</span><span>£890.00</span>
              </div>
            </div>
            <p className="text-xs">
              Stripe's own processing fees are separate and are not charged to you — they are absorbed by the platform.
            </p>
          </div>
        ),
      },
      {
        slug: "payment-refunded",
        title: "What happens if a payment is refunded?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              If a payment is refunded, the funds are returned to the client's original payment method. Stripe
              reverses the transfer, which means the funds are reclaimed from your Stripe account.
            </p>
            <p>
              If the funds have already been paid out to your bank, Stripe will debit your Stripe account
              balance to cover the refund. This may result in a negative balance, which Stripe will recover
              from a future payout.
            </p>
            <p>
              All refund decisions are reviewed by Viewrr. If you believe a refund was issued incorrectly,
              please contact support.
            </p>
          </div>
        ),
      },
    ],
  },
  {
    key: "security",
    label: "Security & Trust",
    icon: <Shield size={18} />,
    articles: [
      {
        slug: "payment-security",
        title: "Is my payment information secure?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              Yes. Viewrr uses Stripe — one of the world's leading payment infrastructure providers — to handle
              all payment processing. Your card details are never stored on Viewrr's servers.
            </p>
            <p>
              All payments are encrypted using industry-standard TLS, and Stripe is PCI DSS Level 1 compliant —
              the highest level of certification in the payments industry.
            </p>
          </div>
        ),
      },
    ],
  },
  {
    key: "account",
    label: "Your Stripe Account",
    icon: <Building2 size={18} />,
    articles: [
      {
        slug: "connect-stripe",
        title: "How do I connect my bank account?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              To receive payments on Viewrr, you need to connect a Stripe account. Go to{" "}
              <strong className="text-foreground">Your Work → Payouts</strong> and follow the on-screen
              instructions to set up your Stripe Express account.
            </p>
            <p>
              Stripe will ask for some identity verification information. This is a legal requirement (KYC)
              that allows Stripe to send money to your bank account. Viewrr does not have access to the
              documents you submit to Stripe.
            </p>
          </div>
        ),
      },
      {
        slug: "automatic-payouts",
        title: "Are payouts automatic?",
        body: (
          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              Yes. Viewrr configures your Stripe account for automatic daily payouts from the moment you
              connect. You do not need to manually request a payout.
            </p>
            <p>
              Each day, any funds that have completed their availability period will automatically be swept to
              your bank account.
            </p>
          </div>
        ),
      },
    ],
  },
];

function ArticleAccordion({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center justify-between gap-3 px-0 py-4 text-left hover:text-primary transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-medium">{article.title}</span>
        {open ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
      </button>
      {open && <div className="pb-4">{article.body}</div>}
    </div>
  );
}

export default function HelpCentre() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = CATEGORIES.map(cat => ({
    ...cat,
    articles: cat.articles.filter(
      a =>
        !query ||
        a.title.toLowerCase().includes(query.toLowerCase()) ||
        String(a.body).toLowerCase().includes(query.toLowerCase()),
    ),
  })).filter(cat => !query || cat.articles.length > 0);

  const activeCat = activeCategory ? CATEGORIES.find(c => c.key === activeCategory) : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-10 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <HelpCircle size={22} style={{ color: "#FF5A1F" }} />
            <h1 className="text-2xl font-bold" style={{ fontFamily: "Clash Display, sans-serif" }}>
              Help Centre
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Find answers about payments, payouts, your account, and more.
          </p>
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveCategory(null); }}
              placeholder="Search for answers…"
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back button */}
        {activeCat && !query && (
          <button
            onClick={() => setActiveCategory(null)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <ArrowLeft size={13} /> All categories
          </button>
        )}

        {/* Category grid */}
        {!activeCat && !query && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-primary/40 text-left transition-all group"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all"
                  style={{ background: "rgba(255,90,31,0.1)", color: "#FF5A1F" }}
                >
                  {cat.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold">{cat.label}</p>
                  <p className="text-xs text-muted-foreground">{cat.articles.length} articles</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Articles list — single category or search results */}
        {(activeCat || query) && (
          <div className="space-y-6">
            {filtered.map(cat => (
              <div key={cat.key}>
                {query && (
                  <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                    {cat.icon}
                    {cat.label}
                  </div>
                )}
                <div className="rounded-2xl border border-border bg-card px-5">
                  {cat.articles.map(article => (
                    <ArticleAccordion key={article.slug} article={article} />
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-12">
                No articles found for "<strong>{query}</strong>". Try a different search term.
              </p>
            )}
          </div>
        )}

        {/* Single category articles */}
        {activeCat && !query && (
          <div className="rounded-2xl border border-border bg-card px-5">
            {activeCat.articles.map(article => (
              <ArticleAccordion key={article.slug} article={article} />
            ))}
          </div>
        )}

        {/* Footer links */}
        <div className="mt-10 text-center text-xs text-muted-foreground">
          <p>
            Still have questions?{" "}
            <a href="mailto:support@viewrr.co.uk" className="underline hover:text-primary transition-colors">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
