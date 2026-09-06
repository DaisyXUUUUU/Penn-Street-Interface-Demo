# Smart Bus Stop Demo

An interactive, iPad-portrait prototype for a smart bus-stop display. The visual language is inspired by SEPTA stop information, while the demo focuses on route switching, vehicle progress, contextual arrival alerts, and live-arrival storytelling.

**Live demo:** [penn-street-interface-demo.vercel.app](https://penn-street-interface-demo.vercel.app)

> This is a design-demo prototype. Route, stop, arrival, and destination data are fictional and must not be used for real travel decisions.

## Run locally

This is a dependency-free static site. Open `index.html` directly in a browser, or start a local server from the project root:

```bash
python3 -m http.server 4173
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Current interactions

- Portrait iPad layout with a SEPTA information header, route cards, and a Stop ID footer.
- The active route card presents the route number, previous stop, current stop, intermediate stops, destination, and arrivals for two buses.
- Use the bottom left and right controls to switch between fictional routes. The partial cards at each side preview adjacent routes.
- The first bus moves from left to right along its progress line toward `YOUR STOP`, synchronized to its arrival countdown.
- Demo time scale: **1 real-world second = 10 seconds in the interface**.
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
├── script.js                     # Demo route data, timers, switching, and alerts
├── assets/
│   ├── header-strip-cropped.png  # User-supplied header artwork
│   ├── footer-strip-cropped.png  # User-supplied footer artwork
│   └── bus-front.png             # User-supplied vehicle artwork
└── deliverables/                 # Storyboard exports
```

## Editing demo routes

All fictional routes are defined in the `routes` array in `script.js`. Each route controls its route number, stops, destination, and arrival times:

```js
{
  number: '124',
  previous: 'Girard Ave & 33rd St',
  current: '69th Street Transportation Center',
  stops: [['Market St & 69th St', '1 stop away']],
  final: 'Girard Ave & 5th St',
  detail: '(Temple University)',
  first: 120,
  second: 720
}
```

For a production version, replace this local demo data with a transit API response, then update the arrival values and vehicle-position logic using real predictions or GPS data.
