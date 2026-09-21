const ROUTE_STOPS = [
  {
    id: '22285',
    route: '40',
    name: '38th St & Chestnut St',
    direction: 'Westbound',
    destination: 'Conshohocken-Monument',
    previousStop: 'Chestnut St & 39th St',
    nextStop: 'Chestnut St & 37th St'
  },
  {
    id: '22285',
    route: '79',
    name: '38th St & Chestnut St',
    direction: 'Westbound',
    destination: 'Market & 41st ST',
    previousStop: '38th St & Walnut St',
    nextStop: 'Market St & 38th St - FS'
  }
];
const POLL_INTERVAL_MS = 5_000;
const VISUAL_APPROACH_WINDOW_SECONDS = 1_800;
const ALERT_STORAGE_KEY = 'busstop:shown-arrival-alerts';

const routePanel = document.querySelector('.route-panel');
const routeNumber = document.querySelector('#route-number');
const routeDirection = document.querySelector('#route-direction');
const routeDestination = document.querySelector('#route-destination');
const firstTime = document.querySelector('#first-time');
const secondTime = document.querySelector('#second-time');
const firstService = document.querySelector('#first-service');
const lastService = document.querySelector('#last-service');
const lastServiceNote = document.querySelector('#last-service-note');
const arrivalCard = document.querySelector('.arrival-card');
const arrivalCaption = document.querySelector('.arrival-card > p');
const arrivalStatusLabel = document.querySelector('.arrival-status-label');
const liveIndicator = document.querySelector('.live-indicator');
const journeyLabel = document.querySelector('.journey-label');
const vehicle = document.querySelector('.vehicle');
const progress = document.querySelector('.track-progress');
const stops = document.querySelector('#stops');
const previousPeek = document.querySelector('.route-peek--previous span');
const nextPeek = document.querySelector('.route-peek--next span');
const previousButton = document.querySelector('.route-switch.previous');
const nextButton = document.querySelector('.route-switch.next');
const sidePreviousButton = document.querySelector('.route-side-switch.previous');
const sideNextButton = document.querySelector('.route-side-switch.next');
const routeDots = [...document.querySelectorAll('.route-dots i')];
const arrivalAlert = document.querySelector('#arrival-alert');
const alertKicker = document.querySelector('#alert-kicker');
const alertRoute = document.querySelector('#alert-route');
const alertDirection = document.querySelector('#alert-direction');
const alertMessage = document.querySelector('#alert-message');

let liveData = null;
let routeIndex = 1;
let isLoading = false;
let alertTimer = null;
const alertKeys = loadAlertKeys();
const previousRemaining = new Map();

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
    // The in-memory set still prevents repeated alerts if storage is unavailable.
  }
}

function selectedRoute() {
  const selectedId = ROUTE_STOPS[routeIndex].route;
  return liveData?.routes?.find((item) => item.route === selectedId) || ROUTE_STOPS[routeIndex];
}

function setTime(element, seconds) {
  if (!Number.isFinite(seconds)) {
    element.textContent = '—';
    return;
  }
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  element.innerHTML = `${minutes}<small> min</small>`;
}

function updateFirstBusStatus(remaining) {
  arrivalCard.classList.remove('time-safe', 'time-soon', 'time-now');
  if (!Number.isFinite(remaining)) return;
  if (remaining > 300) arrivalCard.classList.add('time-safe');
  else if (remaining >= 60) arrivalCard.classList.add('time-soon');
  else arrivalCard.classList.add('time-now');
}

function renderStopDetails(route) {
  const first = route.arrivals?.[0];
  const final = first?.destination || route.destination || `Route ${route.route} destination`;
  const previous = route.previousStop || 'Previous stop information loading';
  const nextStop = route.nextStop || 'Loading official stop sequence…';
  const direction = first?.direction || route.direction || `Route ${route.route} service`;
  stops.innerHTML = `
    <div class="stop previous-stop-row"><span class="dot"></span><div><h3>${previous}</h3></div></div>
    <div class="stop current"><span class="dot"></span><div><h2>${route.name}</h2><label>You are here</label></div></div>
    <div class="stop"><span class="dot"></span><div><h3>${nextStop}</h3><p>Next stop</p></div></div>
    <div class="stop final"><span class="dot"></span><div><h3><span class="final-badge">To</span><span>${final}</span></h3><p>${direction}</p></div></div>`;
}

function renderServiceWindow(route) {
  const window = route.serviceWindow;
  firstService.textContent = window?.first || '—';
  lastService.textContent = window?.last || '—';
  lastServiceNote.textContent = window?.lastDayOffset ? 'next day' : '';
}

function renderSelectedRoute(animationClass) {
  const route = selectedRoute();
  const first = route.arrivals?.[0];
  routeNumber.textContent = route.route;
  routeDirection.textContent = first?.direction || route.direction || `Route ${route.route}`;
  routeDestination.textContent = first?.destination || route.destination || 'Destination loading';
  previousPeek.textContent = ROUTE_STOPS[(routeIndex - 1 + ROUTE_STOPS.length) % ROUTE_STOPS.length].route;
  nextPeek.textContent = ROUTE_STOPS[(routeIndex + 1) % ROUTE_STOPS.length].route;
  routeDots.forEach((dot, index) => dot.classList.toggle('active', index === routeIndex));
  routePanel.setAttribute('aria-label', `Live information for Route ${route.route} at ${route.name}`);
  renderServiceWindow(route);
  renderStopDetails(route);
  const sourceLabel = first?.source === 'realtime'
    ? 'Live arrival estimate'
    : first?.source === 'scheduled' ? 'Scheduled arrival' : 'Arrival information';
  arrivalStatusLabel.textContent = sourceLabel;
  journeyLabel.hidden = true;
  liveIndicator.hidden = first?.source !== 'realtime';
  journeyLabel.textContent = '';
  updateArrivalCaption(route);
  if (animationClass) {
    routePanel.classList.remove('slide-left', 'slide-right');
    void routePanel.offsetWidth;
    routePanel.classList.add(animationClass);
    window.setTimeout(() => routePanel.classList.remove(animationClass), 340);
  }
}

function updateArrivalCaption(route) {
  if (!liveData) return;
  if (route.stale) {
    arrivalCaption.innerHTML = '<i></i> Showing the most recent SEPTA update';
    return;
  }
  if (route.arrivalDataAvailable === false) {
    arrivalCaption.textContent = 'SEPTA arrival feed unavailable · retrying every 5 sec';
    return;
  }
  const sources = new Set(route.arrivals?.map((arrival) => arrival.source));
  const status = sources.has('realtime')
    ? (sources.has('scheduled') ? 'Live + scheduled SEPTA arrivals' : 'Live SEPTA predictions')
    : 'Scheduled arrivals · checking live data';
  arrivalCaption.innerHTML = `<i></i> ${status} · updated every 5 sec`;
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
  const text = `Route ${route}, ${spokenDirection}${spokenPlaceName(destination)}, will arrive in ${spokenTiming}. Please get ready.`;
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('busstop:announce', { detail: { text, interrupt: true } }));
  }, 0);
}

function arrivalDateKey(epoch) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
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

function updateInterface() {
  const route = selectedRoute();
  const arrivals = route.arrivals || [];
  const first = arrivals[0];
  const second = arrivals[1];
  const now = Date.now() / 1000;
  const firstRemaining = first ? Math.max(0, first.arrivalEpoch - now) : NaN;
  const secondRemaining = second ? Math.max(0, second.arrivalEpoch - now) : NaN;

  setTime(firstTime, firstRemaining);
  setTime(secondTime, secondRemaining);
  updateFirstBusStatus(firstRemaining);

  if (first?.source === 'realtime') checkArrivalThreshold(1, route.route, first, firstRemaining);
  if (second?.source === 'realtime') checkArrivalThreshold(2, route.route, second, secondRemaining);

  const hasLivePrediction = first?.source === 'realtime' && Number.isFinite(firstRemaining);
  const etaProgress = Number.isFinite(firstRemaining)
    ? Math.max(0, Math.min(1, 1 - firstRemaining / VISUAL_APPROACH_WINDOW_SECONDS))
    : 0;
  const position = 16 + etaProgress * 66;
  vehicle.hidden = !hasLivePrediction;
  vehicle.classList.toggle('estimated', hasLivePrediction);
  vehicle.style.left = `${position}%`;
  progress.style.width = hasLivePrediction ? `${position}%` : '0%';
  requestAnimationFrame(updateInterface);
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
          const retainedSchedule = (previous?.arrivals || []).filter((arrival) =>
            arrival.source === 'scheduled' && arrival.arrivalEpoch >= now - 30);
          const arrivals = [...route.arrivals];
          retainedSchedule.forEach((scheduled) => {
            const duplicatesLive = arrivals.some((arrival) =>
              Math.abs(arrival.arrivalEpoch - scheduled.arrivalEpoch) < 480);
            if (!duplicatesLive) arrivals.push(scheduled);
          });
          arrivals.sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);
          return { ...route, arrivals: arrivals.slice(0, 2), stale: retainedSchedule.length > 0 };
        }
        return previous?.arrivals?.length
          ? { ...route, arrivals: previous.arrivals, stale: true }
          : route;
      });
    }
    liveData = nextData;
    renderSelectedRoute();
    broadcastInterfaceData();
  } catch (error) {
    if (!liveData) {
      renderSelectedRoute();
      arrivalCaption.textContent = 'Live data is available in the deployed site.';
    } else {
      arrivalCaption.innerHTML = '<i></i> Showing the most recent SEPTA update';
    }
  } finally {
    isLoading = false;
  }
}

function switchRoute(step) {
  routeIndex = (routeIndex + step + ROUTE_STOPS.length) % ROUTE_STOPS.length;
  renderSelectedRoute(step > 0 ? 'slide-left' : 'slide-right');
  broadcastInterfaceData();
}

function setInterfaceZoom(scale) {
  const safeScale = Math.max(0.85, Math.min(1.18, Number(scale) || 1));
  document.documentElement.style.setProperty('--interface-scale', safeScale.toFixed(3));
}

function broadcastInterfaceData() {
  if (!liveData) return;
  window.dispatchEvent(new CustomEvent('busstop:data-updated', {
    detail: { routes: liveData.routes, selectedRoute: selectedRoute().route }
  }));
}

function createRouteAnnouncement(route) {
  const first = route.arrivals?.[0];
  if (!first) {
    return `Route ${route.route}. No upcoming arrival information is currently available.`;
  }
  const remainingSeconds = Math.max(0, first.arrivalEpoch - Date.now() / 1000);
  const minutes = Math.ceil(remainingSeconds / 60);
  const arrivalPhrase = minutes <= 1 ? 'in less than one minute' : `in ${minutes} minutes`;
  const timing = first.source === 'scheduled' ? 'is scheduled to arrive' : 'is expected to arrive';
  return `Route ${route.route}, toward ${first.destination}. The next bus ${timing} ${arrivalPhrase}.`;
}

previousButton.addEventListener('click', () => switchRoute(-1));
nextButton.addEventListener('click', () => switchRoute(1));
sidePreviousButton.addEventListener('click', () => switchRoute(-1));
sideNextButton.addEventListener('click', () => switchRoute(1));
window.addEventListener('busstop:route-change', (event) => {
  switchRoute(event.detail?.direction === 'previous' ? -1 : 1);
});
window.addEventListener('busstop:zoom', (event) => {
  setInterfaceZoom(event.detail?.scale);
});
window.addEventListener('busstop:announce-request', () => {
  const route = selectedRoute();
  window.dispatchEvent(new CustomEvent('busstop:announce', {
    detail: { text: createRouteAnnouncement(route) }
  }));
});
window.addEventListener('busstop:data-request', broadcastInterfaceData);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadLiveData();
});

renderSelectedRoute();
loadLiveData();
window.setInterval(loadLiveData, POLL_INTERVAL_MS);
updateInterface();
