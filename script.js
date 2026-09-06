const routes = [
  { number: '124', previous: 'Girard Ave & 33rd St', current: '69th Street Transportation Center', stops: [['Market St & 69th St', '1 stop away'], ['Market St & 63rd St', '2 stops away']], final: 'Girard Ave & 5th St', detail: '(Temple University)', first: 120, second: 720 },
  { number: '21', previous: 'Walnut St & 34th St', current: 'Penn Medicine Station', stops: [['30th Street Station', '1 stop away'], ['Market St & 22nd St', '3 stops away']], final: 'Navy Yard Terminal', detail: '(South Philadelphia)', first: 420, second: 1020 },
  { number: '33', previous: 'Frankford Ave & Girard Ave', current: 'Frankford Transportation Center', stops: [['Aramingo Ave & York St', '2 stops away'], ['Richmond St & Allegheny Ave', '4 stops away']], final: 'Penn’s Landing', detail: '(Columbus Boulevard)', first: 300, second: 900 }
];

const routePanel = document.querySelector('.route-panel');
const routeNumber = document.querySelector('#route-number');
const previousStop = document.querySelector('#previous-stop');
const firstTime = document.querySelector('#first-time');
const secondTime = document.querySelector('#second-time');
const arrivalCard = document.querySelector('.arrival-card');
const stops = document.querySelector('#stops');
const previousPeek = document.querySelector('.route-peek--previous span');
const nextPeek = document.querySelector('.route-peek--next span');
const vehicle = document.querySelector('.vehicle');
const progress = document.querySelector('.track-progress');
const arrivalAlert = document.querySelector('#arrival-alert');
const alertKicker = document.querySelector('#alert-kicker');
const alertRoute = document.querySelector('#alert-route');
const alertDirection = document.querySelector('#alert-direction');
const alertMessage = document.querySelector('#alert-message');
let routeIndex = 0;
let routeStartedAt = Date.now();
let pointerStartX = null;
const demoSecondsPerSecond = 10;
let alertTimer = null;
let alertKeys = new Set();
let previousRemaining = { first: Infinity, second: Infinity };

function setTime(element, seconds) {
  element.innerHTML = `${Math.max(0, Math.ceil(seconds / 60))}<small> min</small>`;
}

function updateFirstBusStatus(remaining) {
  arrivalCard.classList.remove('time-safe', 'time-soon', 'time-now');
  if (remaining > 300) arrivalCard.classList.add('time-safe');
  else if (remaining >= 60) arrivalCard.classList.add('time-soon');
  else arrivalCard.classList.add('time-now');
}

function renderStops(route) {
  const middle = route.stops.map(([name, distance]) => `<div class="stop"><span class="dot"></span><div><h3>${name}</h3><p>${distance}</p></div></div>`).join('');
  stops.innerHTML = `<div class="stop current"><span class="dot"></span><div><h2>${route.current}</h2><label>You are here</label></div></div>${middle}<div class="stop final"><span class="dot"></span><div><h3><span class="final-badge">Final stop</span><span>${route.final}</span></h3><p>${route.detail}</p></div></div>`;
}

function renderRoute() {
  const route = routes[routeIndex];
  const previous = routes[(routeIndex - 1 + routes.length) % routes.length];
  const next = routes[(routeIndex + 1) % routes.length];
  routeNumber.textContent = route.number;
  previousStop.textContent = route.previous;
  previousPeek.textContent = previous.number;
  nextPeek.textContent = next.number;
  routePanel.setAttribute('aria-label', `Route ${route.number} information`);
  renderStops(route);
  routeStartedAt = Date.now();
  alertKeys = new Set();
  previousRemaining = { first: Infinity, second: Infinity };
}

function showArrivalAlert(type, busNumber, route) {
  clearTimeout(alertTimer);
  arrivalAlert.classList.toggle('critical', type === 'critical');
  alertKicker.textContent = type === 'critical' ? 'Arrival imminent' : 'Last minute alert';
  alertRoute.textContent = `Route ${route.number} · Bus ${busNumber}`;
  alertDirection.textContent = `To ${route.final}`;
  alertMessage.textContent = type === 'critical' ? 'Arriving in 10 seconds' : 'Arriving in 1 minute';
  arrivalAlert.hidden = false;
  alertTimer = setTimeout(() => { arrivalAlert.hidden = true; }, 5000);
}

function checkArrivalThreshold(busNumber, remaining, route) {
  const prior = previousRemaining[busNumber];
  const thresholds = [
    { seconds: 60, type: 'warning' },
    { seconds: 10, type: 'critical' }
  ];
  thresholds.forEach(({ seconds, type }) => {
    const key = `${busNumber}-${type}`;
    if (!alertKeys.has(key) && prior > seconds && remaining <= seconds && remaining > 0) {
      alertKeys.add(key);
      showArrivalAlert(type, busNumber === 'first' ? 1 : 2, route);
    }
  });
  previousRemaining[busNumber] = remaining;
}

function updatePredictions() {
  const route = routes[routeIndex];
  // Demo time: one real-world second represents one minute of arrival time.
  const elapsed = ((Date.now() - routeStartedAt) / 1000) * demoSecondsPerSecond;
  const journey = Math.min(1, elapsed / route.first);
  const firstRemaining = Math.max(0, route.first - elapsed);
  const secondRemaining = Math.max(0, route.second - elapsed);
  setTime(firstTime, firstRemaining);
  setTime(secondTime, secondRemaining);
  updateFirstBusStatus(firstRemaining);
  checkArrivalThreshold('first', firstRemaining, route);
  checkArrivalThreshold('second', secondRemaining, route);
  vehicle.style.left = `${16 + journey * 66}%`;
  progress.style.width = `${16 + journey * 66}%`;
  requestAnimationFrame(updatePredictions);
}

function switchRoute(step) {
  routeIndex = (routeIndex + step + routes.length) % routes.length;
  renderRoute();
  routePanel.classList.remove('slide-left', 'slide-right');
  routePanel.classList.add(step > 0 ? 'slide-left' : 'slide-right');
}

document.querySelector('.previous').addEventListener('click', () => switchRoute(-1));
document.querySelector('.next').addEventListener('click', () => switchRoute(1));
routePanel.addEventListener('animationend', () => routePanel.classList.remove('slide-left', 'slide-right'));

renderRoute();
updatePredictions();
