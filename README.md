# Smart Bus Stop Demo

An interactive, iPad-portrait prototype for a smart bus-stop display. The visual language is inspired by SEPTA stop information. Prototype 1 now uses live SEPTA data for **Routes 21 and 40 at 38th St & Chestnut St** (stop IDs `622` and `22285`).

**Live demo:** [penn-street-interface-demo.vercel.app](https://penn-street-interface-demo.vercel.app)

> This remains a design-demo prototype. Although the arrival and vehicle information is live, it is not a replacement for official travel information.

## Run locally

The visual interface is dependency-free. The live-data endpoint is a Vercel Serverless Function, so it is available on the deployed site (or when running through Vercel's local development environment).

To view the layout only, open `index.html` directly in a browser, or start a local server from the project root:

```bash
python3 -m http.server 4173
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Live data

- No API key is required.
- `api/septa-arrivals.js` reads SEPTA's public GTFS-realtime Trip Updates feed for the next two predictions on each route, and SEPTA TransitView for Route 21 and Route 40 vehicle locations.
- When a future trip has not entered the realtime feed yet, SEPTA BusSchedules fills the remaining arrival slots. The interface labels these times as scheduled and hides the vehicle icon until GPS-backed data is available.
- Previous and next stops come from SEPTA's static GTFS route sequence for the matching route, direction, and stop ID. TransitView's vehicle-level `next_stop_name` is kept separate because it describes the vehicle's current next stop, not necessarily the stop after this display.
- The browser calls the same-site endpoint `/api/septa-arrivals` every 5 seconds. This server-side relay avoids the browser cross-origin restriction on SEPTA's public feeds.
- Arrival countdowns use real time. The vehicle icon moves toward `YOUR STOP` according to the latest reported vehicle distance.
- If no reliable prediction is present, the interface shows `—` instead of invented arrival data.

## Current interactions

- Portrait iPad layout with a SEPTA information header, route cards, and a Stop ID footer.
- The live route card presents the route number, stop, vehicle status, destination, and the next two predicted arrivals.
- Use the bottom left and right controls to switch between Routes 21 and 40. The partial cards preview the adjacent route.
- Tap **Enable gestures** on the deployed HTTPS page to start optional, on-device camera controls. Move the thumb and index finger apart or together to zoom. Use thumbs up for the next route and thumbs down for the previous route.
- Show a V sign to speak the selected route, destination, and next arrival once. Hold a fist to pause gesture controls; release it to resume. Show an open palm to toggle the two-route overview.
- Camera frames are processed locally in the browser by MediaPipe Gesture Recognizer and are not uploaded by this project. Mouse/touch route buttons remain available as a fallback.
- The first bus moves from left to right along its progress line toward `YOUR STOP`, synchronized to its live vehicle location.
- The full arrival/progress card changes colour based on the first bus's remaining time:
  - More than 5 minutes: pale green
  - 1–5 minutes: pale orange
  - Less than 1 minute: pale red
- When either bus reaches its final minute, an orange alert overlays the route area for five seconds. At ten seconds, a red critical alert replaces it for five seconds. The header and footer remain visible.

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
├── api/
│   └── septa-arrivals.js         # Vercel endpoint that reads SEPTA live feeds
├── assets/
│   ├── header-strip-cropped.png  # User-supplied header artwork
│   ├── footer-strip-cropped.png  # User-supplied footer artwork
│   └── bus-front.png             # User-supplied vehicle artwork
└── deliverables/                 # Storyboard exports
```

## Changing the live stop

In `api/septa-arrivals.js`, update `ROUTE_STOPS` with the SEPTA stop IDs, coordinates, and route numbers. Keep `ROUTE_STOPS` in `script.js` synchronized with the same routes and stop names.
