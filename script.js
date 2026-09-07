const ROUTE_STOPS = [
  { id: '622', route: '21', name: 'Chestnut St & 38th St', previous: 'Chestnut St & 39th St' },
  { id: '22285', route: '40', name: '38th St & Chestnut St', previous: '40th St & Chestnut St' }
];
const POLL_INTERVAL_MS = 5_000;
const PROGRESS_DISTANCE_METERS = 1_600;

const routePanel = document.querySelector('.route-panel');
const routeNumber = document.querySelector('#route-number');
const previousStop = document.querySelector('#previous-stop');
const firstTime = document.querySelector('#first-time');
const secondTime = document.querySelector('#second-time');
const arrivalCard = document.querySelector('.arrival-card');
const arrivalCaption = document.querySelector('.arrival-card > p');
const journeyLabel = document.querySelector('.journey-label');
const vehicle = document.querySelector('.vehicle');
const progress = document.querySelector('.track-progress');
const stops = document.querySelector('#stops');
const previousPeek = document.querySelector('.route-peek--previous span');
const nextPeek = document.querySelector('.route-peek--next span');
const previousButton = document.querySelector('.route-switch.previous');
const nextButton = document.querySelector('.route-switch.next');
const arrivalAlert = document.querySelector('#arrival-alert');
const alertKicker = document.querySelector('#alert-kicker');
const alertRoute = document.querySelector('#alert-route');
const alertDirection = document.querySelector('#alert-direction');
const alertMessage = document.querySelector('#alert-message');

let liveData = null;
let routeIndex = 0;
let isLoading = false;
let alertTimer = null;
const alertKeys = new Set();
const previousRemaining = new Map();

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
  const final = first?.destination || `Route ${route.route} destination`;
  const vehicleDetails = first?.vehicleId
    ? `Vehicle ${first.vehicleId}${first.nextStopName ? ` · next: ${first.nextStopName}` : ''}`
    : 'Waiting for the next live vehicle update';
  stops.innerHTML = `
    <div class="stop current"><span class="dot"></span><div><h2>${route.name}</h2><label>You are here</label></div></div>
    <div class="stop"><span class="dot"></span><div><h3>Live vehicle status</h3><p>${vehicleDetails}</p></div></div>
    <div class="stop final"><span class="dot"></span><div><h3><span class="final-badge">To</span><span>${final}</span></h3><p>${first?.direction || `Route ${route.route} live service`}</p></div></div>`;
}

function renderSelectedRoute(animationClass) {
  const route = selectedRoute();
  routeNumber.textContent = route.route;
  previousStop.textContent = route.previous;
  previousPeek.textContent = ROUTE_STOPS[(routeIndex - 1 + ROUTE_STOPS.length) % ROUTE_STOPS.length].route;
  nextPeek.textContent = ROUTE_STOPS[(routeIndex + 1) % ROUTE_STOPS.length].route;
  routePanel.setAttribute('aria-label', `Live information for Route ${route.route} at ${route.name}`);
  renderStopDetails(route);
  journeyLabel.textContent = liveData ? 'Live vehicle location' : 'Waiting for live data';
  if (animationClass) {
    routePanel.classList.remove('slide-left', 'slide-right');
    void routePanel.offsetWidth;
    routePanel.classList.add(animationClass);
    window.setTimeout(() => routePanel.classList.remove(animationClass), 340);
  }
}

function showArrivalAlert(type, busNumber, route, destination) {
  clearTimeout(alertTimer);
  arrivalAlert.classList.toggle('critical', type === 'critical');
  alertKicker.textContent = type === 'critical' ? 'Arrival imminent' : 'Last minute alert';
  alertRoute.textContent = `Route ${route} · Bus ${busNumber}`;
  alertDirection.textContent = `To ${destination || `Route ${route} destination`}`;
  alertMessage.textContent = type === 'critical' ? 'Arriving in 10 seconds' : 'Arriving in 1 minute';
  arrivalAlert.hidden = false;
  alertTimer = setTimeout(() => { arrivalAlert.hidden = true; }, 5000);
}

function checkArrivalThreshold(busNumber, route, arrival, remaining) {
  const arrivalId = `${route}-${arrival.vehicleId || 'trip'}-${arrival.arrivalEpoch}`;
  const prior = previousRemaining.get(arrivalId) ?? Infinity;
  [{ seconds: 60, type: 'warning' }, { seconds: 10, type: 'critical' }].forEach(({ seconds, type }) => {
    const key = `${arrivalId}-${type}`;
    if (!alertKeys.has(key) && prior > seconds && remaining <= seconds && remaining > 0) {
      alertKeys.add(key);
      showArrivalAlert(type, busNumber, route, arrival.destination);
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

  if (first) checkArrivalThreshold(1, route.route, first, firstRemaining);
  if (second) checkArrivalThreshold(2, route.route, second, secondRemaining);

  const distance = first?.distanceMeters;
  const travelProgress = Number.isFinite(distance)
    ? Math.max(0, Math.min(1, 1 - distance / PROGRESS_DISTANCE_METERS))
    : 0;
  const position = 16 + travelProgress * 66;
  vehicle.style.left = `${position}%`;
  progress.style.width = `${position}%`;
  requestAnimationFrame(updateInterface);
}

async function loadLiveData() {
  if (isLoading || document.hidden) return;
  isLoading = true;
  try {
    const response = await fetch('/api/septa-arrivals', { cache: 'no-store' });
    if (!response.ok) throw new Error('The live-data endpoint did not respond.');
    liveData = await response.json();
    renderSelectedRoute();
    arrivalCaption.innerHTML = '<i></i> Live SEPTA arrival predictions · updated every 5 sec';
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
}

previousButton.addEventListener('click', () => switchRoute(-1));
nextButton.addEventListener('click', () => switchRoute(1));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadLiveData();
});

renderSelectedRoute();
loadLiveData();
window.setInterval(loadLiveData, POLL_INTERVAL_MS);
updateInterface();
