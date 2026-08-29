# Viewrr Mobile — Alpha 0.1

React Native (Expo, TypeScript, Expo Router) client for the Viewrr marketplace.

`/mobile` is an **isolated npm package**. It has its own `package.json`,
`package-lock.json`, `tsconfig.json` and Expo config. There are no npm
workspaces, no imports from the web client, and no runtime imports from
`shared/schema.ts`. Nothing outside this directory is modified by mobile work.

## Scope of Alpha 0.1

Shipped: routing shell, theme tokens, environment/API-base configuration, an
absolute-URL API client, a backend reachability probe, UI primitives, Splash,
Welcome, Sign-in (non-functional) and a tabbed authenticated shell.

Deliberately **not** here yet: real authentication, `/api/auth/login/native`,
Stripe, messaging, projects, payments, push notifications.

## Requirements

- Node 20+
- Xcode (iOS simulator) and/or Android Studio for native runs
- Expo Go or a development build on device

## Install and run

```bash
cd mobile
npm install

npm start              # development  → API base http://localhost:5000
npm run start:staging  # staging      → https://staging.viewrr.co.uk
npm run start:production
npm run ios            # simulator
npm run android
npm run web            # browser preview
```

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run doctor      # npx expo-doctor
```

## Environment configuration

Copy `.env.example` to `.env` and fill it in. `.env*` is git-ignored.

| Variable                   | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `APP_ENV`                  | `development` \| `staging` \| `production`                |
| `EXPO_PUBLIC_API_BASE_URL` | Overrides the per-environment API base URL               |

Only environment configuration lives in `.env`. The Expo project identity is
**not** env-driven — see below.

The API base URL must be **absolute**. `src/config/env.ts` throws at startup on
a relative value — a native binary has no origin to resolve against.

## Authentication status

The web app authenticates with an HttpOnly `vr_sess` cookie and that model is
unchanged. Native sign-in will use a separate, reviewed native-auth endpoint and
a Bearer credential. The single seam for that is `attachCredential()` in
`src/api/client.ts`, which currently returns no headers. The sign-in screen
validates input and sends nothing.

## EAS project linkage

The Expo dashboard project already exists and is linked declaratively in
`app.config.ts`:

| Field | Value |
| --- | --- |
| `owner` | `viewrr-limited` |
| `slug` | `viewrr-app` |
| `extra.eas.projectId` | `1d650340-9486-46f3-894f-86b4f4d9eb5e` |

These are hardcoded on purpose. They are public identifiers that ship in every
bundle, they are identical across all three `APP_ENV` values, and EAS needs to
read them where no `.env` exists — including on EAS build servers. They were
previously env-driven, which made `eas project:info` report *EAS project not
configured* whenever the env wasn't loaded.

**Never run bare `eas init`** — it would create a second Expo project. `eas init
--id <id>` also fails here, because EAS cannot write into a dynamic
`app.config.ts`; that is expected and needs no fix, since the ID is already in
the config.

To verify the link (read-only, creates and changes nothing):

```
eas login          # as a member of the viewrr-limited organisation
npx eas-cli@latest project:info
```

Expect `@viewrr-limited/viewrr-app` and the ID above. Any prompt offering to
create or relink a project means something is wrong — decline and investigate.
`eas.json` does not exist yet and is only needed once builds begin.

## Render / deployment isolation

`render.yaml` currently has `autoDeploy: true` and no build filter, so any push
— including a mobile-only one — rebuilds the web service. Before the first
mobile commit lands on `main`, add `buildFilter.ignoredPaths: ["mobile/**"]`
(or the equivalent Ignored Paths setting in the Render dashboard).

## Layout

```
mobile/
  app.config.ts          dynamic Expo config (env-driven)
  src/app/               Expo Router routes
    (auth)/              welcome, sign-in
    (app)/               tabbed shell: home, work, profile
  src/api/               client, errors, connectivity probe
  src/components/        Screen, Button, Card, Pill, TextField, states, Logo, TabIcon
  src/config/env.ts      environment + API base resolution
  src/session/           placeholder session context
  src/theme/             tokens (light + dark palettes), ThemeProvider, font map
  scripts/               generate-icons.py — renders launcher/splash art
  assets/fonts/          Satoshi + Clash Display (brand faces)
  assets/images/         icons and splash art
```

## Brand

Visual identity is ported from the production website by value — no separate
mobile palette, no redrawn logo.

| Source of truth | What mobile takes from it |
| --- | --- |
| `client/src/index.css` | every `:root` / `.dark` CSS variable, converted to hex in `src/theme/tokens.ts` |
| `tailwind.config.ts` | border-radius overrides and status colours |
| `client/index.html` | the two brand families, Satoshi + Clash Display |
| `client/public/icon-192.png` | the "V" mark geometry, traced and re-rendered by `scripts/generate-icons.py` |
| `client/src/components/Navbar.tsx` | the `Viewrr` wordmark and its `.gradient-text` treatment |

Key values: primary `#FF5A1F` (light) / `#FF6933` (dark); CTA gradient
`#FF5A1F → #FF8C42` at 135°; wordmark gradient `#FF5A1F → #F59E0B`; surfaces
`#F8F7F6` light / `#171412` dark. The theme follows the OS colour scheme, the
same default as the web `ThemeProvider`.

Icons come from `lucide-react-native` — the native build of the `lucide-react`
set the website already uses, so shapes match exactly.

### Font licence — ACTION REQUIRED BEFORE PUBLIC STORE SUBMISSION

`assets/fonts/` bundles the Satoshi and Clash Display weights the website loads
from Fontshare. Both are published by Indian Type Foundry under the **ITF Free
Font Licence**; the files are bundled rather than fetched at runtime so the app
has no webfont CDN dependency.

Status: **approved for development and Alpha 0.1 only.**

> **Commercial embedding/licensing for these two families must be re-confirmed
> with Fontshare / Indian Type Foundry before any public App Store or Google
> Play submission.** The current ITF Free Font Licence reading has not been
> legally verified for distributed binaries. If the terms do not cover store
> distribution, swap the files and the keys in `src/theme/fonts.ts` for licensed
> alternatives — no other file in the codebase references the font assets, and
> `src/theme/tokens.ts` reads family names from that one map.
