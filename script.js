const ROUTE_STOPS = [
  {
    id: '22285', route: '40', name: '38th St & Chestnut St', direction: 'Westbound',
    destination: '50th-Parkside', previousStop: 'Chestnut St & 39th St', nextStop: 'Chestnut St & 37th St'
  },
  {
    id: '22285', route: '79', name: '38th St & Chestnut St', direction: 'Westbound',
    destination: 'Market & 41st St', previousStop: '38th St & Walnut St', nextStop: 'Market St & 38th St - FS'
  }
];

const POLL_INTERVAL_MS = 5_000;
const ALERT_STORAGE_KEY = 'busstop:shown-arrival-alerts';

const routeList = document.querySelector('#route-summary-list');
const feedStatus = document.querySelector('#route-feed-status');
const previousStopName = document.querySelector('#previous-stop-name');
const currentStopName = document.querySelector('#current-stop-name');
const nextStopName = document.querySelector('#next-stop-name');
const arrivalAlert = document.querySelector('#arrival-alert');
const alertKicker = document.querySelector('#alert-kicker');
const alertRoute = document.querySelector('#alert-route');
const alertDirection = document.querySelector('#alert-direction');
const alertMessage = document.querySelector('#alert-message');

let liveData = null;
let routeIndex = 0;
let isLoading = false;
let alertTimer = null;
const alertKeys = loadAlertKeys();
const previousRemaining = new Map();

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function loadAlertKeys() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(ALERT_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored : []);
  } catch (_error) {
    return new Set();
  }
}

function rememberAlertKey(key) {
  alertKeys.add(key);
  try {
    sessionStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify([...alertKeys].slice(-80)));
  } catch (_error) {
    // The in-memory set still prevents duplicate alerts.
  }
}

function allRoutes() {
  return ROUTE_STOPS.map((fallback) => {
    const live = liveData?.routes?.find((route) => route.route === fallback.route);
    return live ? { ...fallback, ...live } : fallback;
  });
}

function selectedRoute() {
  return allRoutes()[routeIndex];
}

function remainingSeconds(arrival) {
  return arrival ? Math.max(0, arrival.arrivalEpoch - Date.now() / 1000) : NaN;
}

function etaLabel(arrival) {
  const seconds = remainingSeconds(arrival);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds <= 60) return 'Due now';
  return `${Math.ceil(seconds / 60)} min`;
}

function destinationLabel(route) {
  const concise = ROUTE_STOPS.find((item) => item.route === route.route)?.destination;
  return concise || route.arrivals?.[0]?.destination || route.destination || `Route ${route.route} destination`;
}

function renderTimeline(route) {
  previousStopName.textContent = route.previousStop || 'Previous stop';
  currentStopName.textContent = route.name || '38th St & Chestnut St';
  nextStopName.textContent = route.nextStop || 'Next stop';
}

function renderRoutes() {
  const routes = allRoutes();
  routeList.innerHTML = routes.map((route, index) => {
    const first = route.arrivals?.[0];
    const second = route.arrivals?.[1];
    const isLive = first?.source === 'realtime';
    return `<button type="button" class="route-chip${index === routeIndex ? ' active' : ''}" data-route-index="${index}" aria-pressed="${index === routeIndex}" aria-label="Route ${escapeHtml(route.route)} to ${escapeHtml(destinationLabel(route))}, ${escapeHtml(etaLabel(first))}">
      <span class="route-chip-number">${escapeHtml(route.route)}</span>
      <span class="route-chip-details">
        <span class="route-chip-destination">to ${escapeHtml(destinationLabel(route))}</span>
        <span class="route-chip-times"><strong>${escapeHtml(etaLabel(first))}</strong><span>${second ? escapeHtml(etaLabel(second)) : ''}</span>${isLive ? '<span class="route-chip-live">Live</span>' : ''}</span>
      </span>
      <span class="route-chip-arrow" aria-hidden="true">›</span>
    </button>`;
  }).join('');

  routeList.querySelectorAll('.route-chip').forEach((button) => {
    button.addEventListener('click', () => selectRoute(Number(button.dataset.routeIndex)));
  });
  renderTimeline(routes[routeIndex]);
}

function selectRoute(index) {
  routeIndex = (index + ROUTE_STOPS.length) % ROUTE_STOPS.length;
  renderRoutes();
  broadcastInterfaceData();
}

function spokenPlaceName(value) {
  return String(value || '').replaceAll('&', 'and').replaceAll('-', ' ');
}

function showArrivalAlert(type, busNumber, route, arrival) {
  const destination = arrival.destination || `Route ${route} destination`;
  const direction = arrival.direction ? `${arrival.direction} · ` : '';
  clearTimeout(alertTimer);
  arrivalAlert.classList.toggle('critical', type === 'critical');
  alertKicker.textContent = type === 'critical' ? 'Arrival imminent' : 'Last minute alert';
  alertRoute.textContent = `Route ${route} · Bus ${busNumber}`;
  alertDirection.textContent = `${direction}To ${destination}`;
  alertMessage.textContent = type === 'critical' ? 'Arriving in 10 seconds' : 'Arriving in 1 minute';
  arrivalAlert.hidden = false;
  alertTimer = setTimeout(() => { arrivalAlert.hidden = true; }, 5000);

  const spokenTiming = type === 'critical' ? 'ten seconds' : 'one minute';
  const spokenDirection = arrival.direction ? `${arrival.direction.toLowerCase()} toward ` : 'toward ';
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('busstop:announce', {
      detail: { text: `Route ${route}, ${spokenDirection}${spokenPlaceName(destination)}, will arrive in ${spokenTiming}. Please get ready.`, interrupt: true }
    }));
  }, 0);
}

function arrivalDateKey(epoch) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(epoch * 1000));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function checkArrivalThreshold(busNumber, route, arrival, remaining) {
  const fallbackId = `${arrival.vehicleId || 'vehicle'}-${Math.round(arrival.arrivalEpoch / 900)}`;
  const arrivalId = `${arrivalDateKey(arrival.arrivalEpoch)}-${route}-${arrival.tripId || fallbackId}`;
  const prior = previousRemaining.get(arrivalId) ?? Infinity;
  [{ seconds: 60, type: 'warning' }, { seconds: 10, type: 'critical' }].forEach(({ seconds, type }) => {
    const key = `${arrivalId}-${type}`;
    if (!alertKeys.has(key) && prior > seconds && remaining <= seconds && remaining > 0) {
      rememberAlertKey(key);
      showArrivalAlert(type, busNumber, route, arrival);
    }
  });
  previousRemaining.set(arrivalId, remaining);
}

function updateArrivalAlerts() {
  const route = selectedRoute();
  (route.arrivals || []).slice(0, 2).forEach((arrival, index) => {
    const remaining = remainingSeconds(arrival);
    if (arrival.source === 'realtime' && Number.isFinite(remaining)) {
      checkArrivalThreshold(index + 1, route.route, arrival, remaining);
    }
  });
}

async function loadLiveData() {
  if (isLoading || document.hidden) return;
  isLoading = true;
  try {
    const response = await fetch('/api/septa-arrivals', { cache: 'no-store' });
    if (!response.ok) throw new Error('The live-data endpoint did not respond.');
    const nextData = await response.json();
    if (liveData) {
      nextData.routes = nextData.routes.map((route) => {
        const previous = liveData.routes.find((item) => item.route === route.route);
        if (route.arrivalDataAvailable && route.scheduleAvailable) return { ...route, stale: false };
        if (route.arrivalDataAvailable && !route.scheduleAvailable) {
          const now = Date.now() / 1000;
          const retainedSchedule = (previous?.arrivals || []).filter((arrival) => arrival.source === 'scheduled' && arrival.arrivalEpoch >= now - 30);
          const arrivals = [...route.arrivals];
          retainedSchedule.forEach((scheduled) => {
            if (!arrivals.some((arrival) => Math.abs(arrival.arrivalEpoch - scheduled.arrivalEpoch) < 480)) arrivals.push(scheduled);
          });
          arrivals.sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);
          return { ...route, arrivals: arrivals.slice(0, 2), stale: retainedSchedule.length > 0 };
        }
        return previous?.arrivals?.length ? { ...route, arrivals: previous.arrivals, stale: true } : route;
      });
    }
    liveData = nextData;
    const hasRealtime = nextData.routes.some((route) => route.arrivals?.some((arrival) => arrival.source === 'realtime'));
    feedStatus.textContent = hasRealtime ? 'Live SEPTA predictions · updated every 5 sec' : 'Scheduled arrivals · checking live data';
    renderRoutes();
    broadcastInterfaceData();
  } catch (_error) {
    feedStatus.textContent = liveData ? 'Showing the latest SEPTA update' : 'Live data is temporarily unavailable';
    renderRoutes();
  } finally {
    isLoading = false;
  }
}

function setInterfaceZoom(scale) {
  const safeScale = Math.max(0.85, Math.min(1.18, Number(scale) || 1));
  document.documentElement.style.setProperty('--interface-scale', safeScale.toFixed(3));
}

function broadcastInterfaceData() {
  window.dispatchEvent(new CustomEvent('busstop:data-updated', {
    detail: { routes: allRoutes(), selectedRoute: selectedRoute().route }
  }));
}

function createRouteAnnouncement(route) {
  const first = route.arrivals?.[0];
  if (!first) return `Route ${route.route}. No upcoming arrival information is currently available.`;
  const minutes = Math.ceil(remainingSeconds(first) / 60);
  const arrivalPhrase = minutes <= 1 ? 'in less than one minute' : `in ${minutes} minutes`;
  const timing = first.source === 'scheduled' ? 'is scheduled to arrive' : 'is expected to arrive';
  return `Route ${route.route}, toward ${first.destination}. The next bus ${timing} ${arrivalPhrase}.`;
}

window.addEventListener('busstop:route-change', (event) => selectRoute(routeIndex + (event.detail?.direction === 'previous' ? -1 : 1)));
window.addEventListener('busstop:zoom', (event) => setInterfaceZoom(event.detail?.scale));
window.addEventListener('busstop:announce-request', () => {
  window.dispatchEvent(new CustomEvent('busstop:announce', { detail: { text: createRouteAnnouncement(selectedRoute()) } }));
});
window.addEventListener('busstop:data-request', broadcastInterfaceData);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLiveData(); });

renderRoutes();
broadcastInterfaceData();
loadLiveData();
window.setInterval(loadLiveData, POLL_INTERVAL_MS);
window.setInterval(() => {
  renderRoutes();
  updateArrivalAlerts();
}, 1000);
