(() => {
  let latestRoutes = [];
  let visible = false;

  const overview = document.createElement('section');
  overview.className = 'route-overview';
  overview.hidden = true;
  overview.setAttribute('aria-label', 'All routes overview');
  overview.innerHTML = `
    <div class="overview-header">
      <h2>Routes at this stop</h2>
      <button class="overview-close" type="button" aria-label="Close route overview">×</button>
    </div>
    <div class="overview-routes"></div>
    <p class="overview-hint">Open your palm again or tap × to close</p>`;
  document.querySelector('.screen-body')?.append(overview);

  const routeList = overview.querySelector('.overview-routes');
  const closeButton = overview.querySelector('.overview-close');

  function timeLabel(arrival) {
    if (!arrival) return { value: '—', source: 'Waiting' };
    const seconds = Math.max(0, arrival.arrivalEpoch - Date.now() / 1000);
    return {
      value: `${Math.ceil(seconds / 60)} min`,
      source: arrival.source === 'realtime' ? 'Live' : 'Scheduled'
    };
  }

  function render() {
    routeList.innerHTML = latestRoutes.map((route) => {
      const first = timeLabel(route.arrivals?.[0]);
      const second = timeLabel(route.arrivals?.[1]);
      const destination = route.arrivals?.[0]?.destination || `Route ${route.route} destination`;
      return `
        <article class="overview-card">
          <div class="overview-route-number">${route.route}</div>
          <div class="overview-destination">To ${destination}</div>
          <div class="overview-times">
            <div class="overview-time"><span>1st Bus</span><strong>${first.value}</strong><small>${first.source}</small></div>
            <div class="overview-time"><span>2nd Bus</span><strong>${second.value}</strong><small>${second.source}</small></div>
          </div>
          <p class="overview-stop-sequence">${route.previousStop || 'Previous stop'} → <b>${route.name}</b> → ${route.nextStop || 'Next stop'}</p>
        </article>`;
    }).join('');
  }

  function setVisible(nextVisible) {
    visible = nextVisible;
    overview.hidden = !visible;
    if (visible) {
      window.dispatchEvent(new CustomEvent('busstop:data-request'));
      render();
    }
  }

  closeButton.addEventListener('click', () => setVisible(false));
  window.addEventListener('busstop:data-updated', (event) => {
    latestRoutes = event.detail?.routes || [];
    if (visible) render();
  });
  window.addEventListener('busstop:overview-toggle', () => setVisible(!visible));
  window.addEventListener('busstop:route-change', () => setVisible(false));
  window.setInterval(() => { if (visible) render(); }, 1000);
})();
