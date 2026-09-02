# Viewrr Cookie & Privacy Storage Inventory
*PRD-021 WS-C — Last updated: 2026-08-31*

## Server-Side Cookies

| Cookie | Purpose | HttpOnly | Secure | SameSite | MaxAge | Category |
|---|---|---|---|---|---|---|
| `viewrr_session` | Session authentication (DB-backed opaque token) | ✅ | ✅ (prod) | strict | 8h | Strictly necessary |

## Client-Side localStorage Keys

| Key | Purpose | Set by | Removable | Category |
|---|---|---|---|---|
| `viewrr_auth_v2` | User identity cache (name, email, role, avatar). Server-authoritative — cleared on 401. | AuthProvider | On logout/401 | Strictly necessary (performance cache; reduces round-trips) |
| `viewrr_session_v` | Session schema version (invalidates stale auth cache on app update) | AuthProvider | On version bump | Strictly necessary |
| `viewrr_cookie_consent` | User cookie consent preferences (`{essential, analytics, preferences}`) | CookieBanner | User action | Strictly necessary (consent record) |
| `viewrr_nudge_dismissed` | "Get Noticed" banner dismissed state | GetNoticedBanner | User action | Preference |
| `auth_prompt_dismissed` | Auth upsell popup dismissed state | AuthPromptPopup | User action | Preference |
| `your_work_visibility_${userId}` | YourWork tab public/private toggle | YourWork | User action | Preference |
| `retainer_draft_*` | RetainerBuilder draft state | RetainerBuilder | On submit | Preference |

## Analytics & Tracking

**Current status: NO analytics or tracking technologies are loaded.**

The CookieBanner UI presents an "Analytics" toggle, but no analytics SDK (Google Analytics, Mixpanel, PostHog, Plausible, Hotjar, etc.) is currently integrated. The toggle has no operational effect.

**Action required (before activating any analytics):**
1. Update CookieBanner to actually gate analytics code behind consent
2. Update Privacy Policy to name the specific analytics provider
3. Ensure consent is stored server-side for audit purposes

## Consent Architecture

The `viewrr_cookie_consent` key stores: `{ essential: true, analytics: boolean, preferences: boolean }`.

**Current gaps:**
- Analytics toggle is presented but no analytics runs — misleading but harmless
- Consent is client-side only (no server-side record)
- No mechanism to re-prompt on policy change

**Future-ready architecture:**
When analytics is introduced, gate it behind `consent.analytics === true` before loading any SDK.
The consent architecture is already in place in `CookieBanner.tsx`.

## ICO / UK GDPR Assessment

All current storage is either strictly necessary (session auth) or user-preference (UI state).
No non-essential cookies or tracking are currently set.
Cookie consent banner is present and functional (though the analytics toggle is vestigial).
This inventory must be reviewed when any analytics/marketing technology is introduced.
