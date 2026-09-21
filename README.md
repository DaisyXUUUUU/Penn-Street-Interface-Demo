# Smart Bus Stop Demo

An interactive, iPad-portrait prototype for a smart bus-stop display. The visual language is inspired by SEPTA stop information. The current demo uses SEPTA data for **Routes 40 and 79 at 38th St & Chestnut St** (stop ID `22285`). It also includes **Today's Kindness Tree**, an AI-assisted "small acts of kindness" flow riders can complete while they wait.

**Live demo:** [penn-street-interface-demo.vercel.app](https://penn-street-interface-demo.vercel.app)

> This remains a design-demo prototype. Although the arrival and vehicle information is live, it is not a replacement for official travel information.

## Run locally

The visual interface is dependency-free (no npm install needed). To run the full local demo with live SEPTA data and the Kindness Tree API, start the small Node relay server from the project root:

```bash
node local-server.js
```

Then open [http://127.0.0.1:4180](http://127.0.0.1:4180). This server proxies every file under `api/` (SEPTA arrivals and the Kindness Tree's `kindness-act` endpoint) and, if present, loads `.env` for the Kindness Tree's LLM credentials (see below).

To view the layout only, open `index.html` directly in a browser, or start a static-only local server:

```bash
python3 -m http.server 4173
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

In static-only mode, neither `/api/septa-arrivals` nor `/api/kindness-act` will run — live arrival times are unavailable, and the Kindness Tree flow silently falls back to its local suggestion bank instead of calling an LLM.

### Running the tests

```bash
node --test
```

Runs the unit tests in `test/` for the Kindness Tree's pure logic (time/tag rules, JSON schema validation, the safety-word filter, and the fallback-bank selection). No dependencies required — uses Node's built-in test runner.

## Live data

- No API key is required.
- `api/septa-arrivals.js` reads SEPTA's public GTFS-realtime Trip Updates feed for the next two predictions on each route, and SEPTA TransitView for Route 40 and Route 79 vehicle locations.
- The service-hours panel shows today's first and last scheduled bus at this stop. These times are derived from SEPTA's official GTFS schedule feed `v202609061`, valid through February 20, 2027. Times after midnight are marked `next day`.
- When a future trip has not entered the realtime feed yet, SEPTA BusSchedules fills the remaining arrival slots. The interface labels these times as scheduled and hides the vehicle icon until GPS-backed data is available.
- Previous and next stops come from SEPTA's static GTFS route sequence for the matching route, direction, and stop ID. TransitView's vehicle-level `next_stop_name` is kept separate because it describes the vehicle's current next stop, not necessarily the stop after this display.
- The browser calls the same-site endpoint `/api/septa-arrivals` every 5 seconds. This server-side relay avoids the browser cross-origin restriction on SEPTA's public feeds.
- Arrival countdowns use real time. The vehicle icon moves toward `YOUR STOP` according to the latest reported vehicle distance.
- If no reliable prediction is present, the interface shows `—` instead of invented arrival data.

## Today's Kindness Tree

A secondary flow, reached from the "Find my kind act" button on the home screen, that suggests a small, concrete act of kindness a rider can do while they wait, then lets them "plant" a flower on a shared tree for the stop as a record of the promise (not proof it was completed).

- Flow: pick 1–3 interest tags and how much time you have → AI (or, if unavailable, a local fallback bank) suggests 3 acts → pick one → drag (or tap-to-place) a flower onto the tree.
- The arrival info bar at the top of every Kindness Tree screen is always visible and always live — it is never covered by any panel in this flow.
- 45 seconds of inactivity on any Kindness Tree screen returns to the home screen; an already-chosen but unplanted flower is auto-planted at a random spot so the promise is never lost.
- Tree data is stored per stop + local date (key `010101-YYYY-MM-DD`) in `localStorage` only — no names, no login, and the specific act a rider chose is never saved, only its category (for the flower's color).
- Demo query params: `?demo=1` seeds the tree with sample flowers; `?wait=`, `?weather=`, `?time=`, `?lang=zh` override what's sent to the AI without waiting for real conditions.

### Enabling real AI generation

Without any setup, the Kindness Tree flow works out of the box using a local bank of ≥28 pre-written suggestions (7 tags × 4 each) — this is what ships by default and what `?demo=1` uses. To have `api/kindness-act.js` call a real LLM instead:

1. Copy `.env.example` to `.env`.
2. Get an API key — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) (Anthropic) or [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (OpenAI; note new OpenAI accounts usually need a payment method added under Billing before requests succeed).
3. Fill in `.env`: `LLM_PROVIDER` (`anthropic` or `openai`), `LLM_API_KEY`, `LLM_MODEL`.
4. `.env` is gitignored and is only read locally by `local-server.js` — **never commit it**.

If the LLM call fails, times out, returns invalid JSON, or the request has no key at all, the endpoint transparently serves a suggestion from the local fallback bank instead (`source: "fallback"` in the response, vs. `source: "ai"`) — the flow never breaks.

Weather context sent to the AI comes from [Open-Meteo](https://open-meteo.com) (free, keyless) for this stop's coordinates, refreshed every 10 minutes, unless overridden by `?weather=`.

### Deploying to Vercel

`api/*.js` files deploy as Vercel Serverless Functions automatically — no config needed. For the Kindness Tree's AI path to work on the deployed site, add the same variables from `.env` under the Vercel project's **Settings → Environment Variables** (this is separate from your local `.env`, since `.env` never leaves your machine). Redeploy after adding them.

## Current interactions

- Portrait iPad layout with a SEPTA information header, route cards, and a Stop ID footer.
- The live route card presents the route number, stop, vehicle status, destination, and the next two predicted arrivals.
- Use the bottom left and right controls to switch between Routes 40 and 79. The partial cards preview the adjacent route.
- Tap **Enable gestures** on the deployed HTTPS page to start optional, on-device camera controls. Move the thumb and index finger apart or together to zoom. Point the index finger left for the next route or right for the previous route.
- Show a V sign to speak the selected route, destination, and next arrival once. Hold a fist to pause gesture controls; release it to resume. Show an open palm to toggle the two-route overview.
- Camera frames are processed locally in the browser by MediaPipe Gesture Recognizer and are not uploaded by this project. Mouse/touch route buttons remain available as a fallback.
- The first bus moves from left to right along its progress line toward `YOUR STOP`, synchronized to its live vehicle location.
- The full arrival/progress card changes colour based on the first bus's remaining time:
  - More than 5 minutes: pale green
  - 1–5 minutes: pale orange
  - Less than 1 minute: pale red
- When either bus reaches its final minute, an orange alert overlays the route area for five seconds. At ten seconds, a red critical alert replaces it for five seconds. The header and footer remain visible.
- Each one-minute and ten-second alert is shown only once per trip in the current browser session. The alert also speaks an English message with the route, direction, destination, and remaining time.

## Project structure

```text
.
├── index.html                    # Page structure
├── styles.css                    # Responsive visual styles and animations
├── script.js                     # Live-data UI, countdowns, vehicle progress, and alerts
├── gesture-controls.js           # Isolated camera, landmark, and gesture logic
├── gesture-controls.css          # Camera-control panel and feedback styles
├── voice-announcer.js            # One-shot browser speech synthesis
├── route-overview.js             # Event-driven two-route overview
├── route-overview.css            # Overview presentation styles
├── kindness-tree.js              # Kindness Tree state machine, rendering, drag-to-plant
├── kindness-tree.css             # Kindness Tree screens (select/generating/pick/plant/done)
├── kindness-data.js              # Tag definitions, local fallback suggestion bank, i18n copy
├── kindness-logic.js             # Pure logic shared by browser + server: validation, safety
│                                  #   filter, fallback selection, weather mapping, tree storage
├── local-server.js               # Local dev server: serves static files + every api/*.js route
├── api/
│   ├── septa-arrivals.js         # Vercel endpoint that reads SEPTA live feeds
│   └── kindness-act.js           # Vercel endpoint that calls the LLM (or falls back locally)
├── test/
│   └── kindness-logic.test.js    # `node --test` unit tests for kindness-logic.js
├── assets/
│   ├── header-strip-cropped.png  # User-supplied header artwork
│   ├── footer-strip-cropped.png  # User-supplied footer artwork
│   ├── bus-front.png             # User-supplied vehicle artwork
│   └── tree.png                  # Kindness Tree artwork (blossoms are drawn on top of it)
├── .env.example                  # Template for local LLM credentials — copy to .env
└── deliverables/                 # Storyboard exports
```

## Changing the live stop

In `api/septa-arrivals.js`, update `ROUTE_STOPS` with the SEPTA stop IDs, coordinates, and route numbers. Keep `ROUTE_STOPS` in `script.js` synchronized with the same routes and stop names.
