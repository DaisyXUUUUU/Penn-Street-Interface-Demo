(() => {
  const { TAGS, FALLBACK_BANK, I18N } = window.KindnessData;
  const Logic = window.KindnessLogic;
  const STOP_ID = '010101';
  const TIME_OPTIONS = Logic.TASK_TIME_OPTIONS;
  const BLOSSOM_PALETTES = [
    { petal: '#ef7180', center: '#f6c443' },
    { petal: '#8f67c7', center: '#ffd35a' },
    { petal: '#ec9b3b', center: '#7b4a24' },
    { petal: '#5f9fda', center: '#f4c84b' },
    { petal: '#d566ae', center: '#f7d76e' },
    { petal: '#e95f5f', center: '#ffd45d' },
    { petal: '#62aa75', center: '#f2bd3f' }
  ];
  const demoParams = new URLSearchParams(window.location.search);
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const repo = Logic.createTreeRepository();
  const kioskShell = document.querySelector('.kiosk-shell');

  function kioskScale() {
    if (!kioskShell || !kioskShell.offsetWidth) return 1;
    return kioskShell.getBoundingClientRect().width / kioskShell.offsetWidth;
  }

  const homeCountEl = document.getElementById('kindness-count');
  const homeCtaBtn = document.getElementById('kindness-cta');
  const homeBlossomsEl = document.getElementById('home-tree-blossoms');
  const kindnessHeroEl = document.querySelector('.kindness-hero');
  const flowerStoryEl = document.getElementById('flower-story');
  const flowerStoryIconEl = document.getElementById('flower-story-icon');
  const flowerStoryTitleEl = document.getElementById('flower-story-title');
  const flowerStoryTimeEl = document.getElementById('flower-story-time');
  const flowerStoryCloseEl = document.getElementById('flower-story-close');

  let latestRoutes = [];
  let latestSelectedRoute = null;

  function tagColor(tagId) {
    const tag = TAGS.find((item) => item.id === tagId);
    return tag ? tag.color : '#8bb98f';
  }

  function safeFlowerColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
  }

  function flowerStyle(petalColor, centerColor) {
    const petal = safeFlowerColor(petalColor, '#ef7180');
    const center = safeFlowerColor(centerColor, '#f6c443');
    return `--petal-color:${petal}; --center-color:${center}`;
  }

  function nextBlossomPalette(tagId) {
    const tagIndex = Math.max(0, TAGS.findIndex((tag) => tag.id === tagId));
    const plantedCount = repo.load(STOP_ID).length;
    return BLOSSOM_PALETTES[(plantedCount + tagIndex * 2) % BLOSSOM_PALETTES.length];
  }

  function currentLocale() {
    return demoParams.get('lang') === 'zh' ? 'zh-CN' : 'en';
  }

  function t() {
    return I18N[currentLocale()];
  }

  function currentTimeOfDay() {
    const override = demoParams.get('time');
    if (['morning', 'afternoon', 'evening', 'night'].includes(override)) return override;
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  // Same stop coordinates as ROUTE_STOPS in api/septa-arrivals.js (38th St &
  // Chestnut St) — keep these two in sync if the display ever moves stops.
  const WEATHER_LAT = 39.955084;
  const WEATHER_LNG = -75.198261;
  const WEATHER_CACHE_MS = 10 * 60 * 1000;
  const WEATHER_FETCH_TIMEOUT_MS = 4000;

  let cachedWeather = { condition: 'sunny', tempC: 24 };
  let weatherFetchedAt = 0;
  let weatherFetchInFlight = false;

  async function refreshWeather() {
    if (weatherFetchInFlight) return;
    weatherFetchInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LNG}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`weather ${res.status}`);
      const data = await res.json();
      const tempC = Number(data.current?.temperature_2m);
      const code = Number(data.current?.weather_code);
      const windKmh = Number(data.current?.wind_speed_10m);
      if (!Number.isFinite(tempC)) throw new Error('weather payload missing temperature');
      cachedWeather = { condition: Logic.mapWeatherCode(code, tempC, windKmh), tempC: Math.round(tempC) };
      weatherFetchedAt = Date.now();
      if (state.screen === 'select') render();
    } catch (error) {
      // Keep serving the last good reading (or the mock default) on failure.
    } finally {
      clearTimeout(timeout);
      weatherFetchInFlight = false;
    }
  }

  function getWeather() {
    const validConditions = ['sunny', 'cloudy', 'rain', 'snow', 'windy', 'hot', 'cold'];
    const override = demoParams.get('weather');
    if (validConditions.includes(override)) {
      const rawTemp = demoParams.get('temp');
      const temp = rawTemp !== null ? Number(rawTemp) : NaN;
      return { condition: override, tempC: Number.isFinite(temp) ? temp : 20 };
    }
    if (Date.now() - weatherFetchedAt > WEATHER_CACHE_MS) refreshWeather();
    return cachedWeather;
  }

  function currentRouteRecord(routeNumber) {
    return latestRoutes.find((route) => route.route === routeNumber);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function makeId() {
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function blossomVariant(blossom, index) {
    const saved = Number(blossom.flowerVariant);
    if (Number.isInteger(saved) && saved >= 0) return saved % 12;
    const idHash = [...String(blossom.id || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return (idHash + index) % 12;
  }

  function flowerSpriteStyle(variant) {
    const safeVariant = Math.max(0, Math.min(11, Number(variant) || 0));
    const column = safeVariant % 3;
    const row = Math.floor(safeVariant / 3);
    return `--flower-x:${column * 50}%; --flower-y:${(row * 100 / 3).toFixed(3)}%`;
  }

  function flowerSvg(extraClass) {
    return `<svg class="kf-tag-flower ${extraClass || ''}" viewBox="0 0 100 100" aria-hidden="true">
      <g class="kf-petals">
        <ellipse cx="50" cy="26" rx="15" ry="24" transform="rotate(0 50 50)"></ellipse>
        <ellipse cx="50" cy="26" rx="15" ry="24" transform="rotate(72 50 50)"></ellipse>
        <ellipse cx="50" cy="26" rx="15" ry="24" transform="rotate(144 50 50)"></ellipse>
        <ellipse cx="50" cy="26" rx="15" ry="24" transform="rotate(216 50 50)"></ellipse>
        <ellipse cx="50" cy="26" rx="15" ry="24" transform="rotate(288 50 50)"></ellipse>
      </g>
      <circle class="kf-center" cx="50" cy="50" r="13"></circle>
    </svg>`;
  }

  // ---------------- Home card ----------------

  function fallbackStory(blossom) {
    const item = FALLBACK_BANK.find((act) => act.tags.includes(blossom.type)) || FALLBACK_BANK[0];
    return {
      title: blossom.actTitle || blossom.title || item?.title || t().home.fallbackTitle,
      description: blossom.actDescription || blossom.description || item?.description || t().home.fallbackDescription
    };
  }

  function plantedTimeLabel(createdAt) {
    const date = new Date(Number(createdAt) || Date.now());
    const formatted = new Intl.DateTimeFormat(currentLocale(), {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    }).format(date);
    return t().home.plantedAt(formatted);
  }

  function closeFlowerStory() {
    flowerStoryEl.hidden = true;
    homeBlossomsEl.querySelectorAll('.home-blossom.is-active').forEach((flower) => flower.classList.remove('is-active'));
  }

  function showFlowerStory(button, blossom, variant) {
    const story = fallbackStory(blossom);
    homeBlossomsEl.querySelectorAll('.home-blossom.is-active').forEach((flower) => flower.classList.remove('is-active'));
    button.classList.add('is-active');
    flowerStoryIconEl.setAttribute('style', flowerSpriteStyle(variant));
    flowerStoryTitleEl.textContent = story.title;
    flowerStoryTimeEl.textContent = plantedTimeLabel(blossom.createdAt);
    flowerStoryEl.hidden = false;

    const heroRect = kindnessHeroEl.getBoundingClientRect();
    const flowerRect = button.getBoundingClientRect();
    const storyRect = flowerStoryEl.getBoundingClientRect();
    const centerX = flowerRect.left + flowerRect.width / 2 - heroRect.left;
    const centerY = flowerRect.top + flowerRect.height / 2 - heroRect.top;
    const margin = Math.max(8, heroRect.width * .018);
    const left = Logic.clamp(centerX - storyRect.width / 2, margin, heroRect.width - storyRect.width - margin);
    let top = centerY - storyRect.height - flowerRect.height * .65;
    if (top < margin) top = centerY + flowerRect.height * .65;
    top = Logic.clamp(top, margin, heroRect.height - storyRect.height - margin);
    flowerStoryEl.style.left = `${left}px`;
    flowerStoryEl.style.top = `${top}px`;
    flowerStoryEl.style.setProperty('--story-pointer-x', `${Logic.clamp(centerX - left, 18, storyRect.width - 18)}px`);
  }

  function refreshHomeCount() {
    const list = repo.load(STOP_ID);
    closeFlowerStory();
    homeCountEl.textContent = String(list.length);
    const visible = list.slice(-24);
    homeBlossomsEl.innerHTML = visible.map((blossom, index) => {
      const variant = blossomVariant(blossom, index);
      const story = fallbackStory(blossom);
      return `<button type="button" class="home-blossom" data-blossom-index="${index}" style="left:${(blossom.x * 100).toFixed(1)}%; top:${(blossom.y * 100).toFixed(1)}%; ${flowerSpriteStyle(variant)}" aria-label="${escapeHtml(t().home.openStory(story.title))}"><span class="home-blossom-image" aria-hidden="true"></span></button>`;
    }).join('');
    homeBlossomsEl.querySelectorAll('.home-blossom').forEach((button) => {
      const index = Number(button.dataset.blossomIndex);
      const blossom = visible[index];
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        showFlowerStory(button, blossom, blossomVariant(blossom, index));
      });
    });
  }

  function enableHomeButton() {
    homeCtaBtn.disabled = false;
    homeCtaBtn.removeAttribute('title');
  }

  function seedDemoData() {
    if (demoParams.get('demo') !== '1') return;
    if (repo.load(STOP_ID).length > 0) return;
    const count = 8 + Math.floor(Math.random() * 5);
    const blossoms = Array.from({ length: count }, (_, index) => {
      const type = TAGS[Math.floor(Math.random() * TAGS.length)].id;
      const act = FALLBACK_BANK.find((item) => item.tags.includes(type)) || FALLBACK_BANK[0];
      return {
        id: makeId(), type,
        x: 0.14 + Math.random() * 0.72,
        y: 0.12 + Math.random() * 0.53,
        createdAt: Date.now() - Math.floor(Math.random() * 4 * 3600 * 1000),
        status: 'promised', flowerVariant: index % 12,
        actTitle: act.title, actDescription: act.description
      };
    });
    repo.save(STOP_ID, blossoms);
  }

  flowerStoryCloseEl.addEventListener('click', closeFlowerStory);
  kindnessHeroEl.addEventListener('click', (event) => {
    if (!event.target.closest('.flower-story') && !event.target.closest('.home-blossom')) closeFlowerStory();
  });

  window.addEventListener('busstop:data-updated', (event) => {
    latestRoutes = event.detail?.routes || [];
    latestSelectedRoute = event.detail?.selectedRoute || latestSelectedRoute;
    enableHomeButton();
    if (!kindnessFlow.hidden) renderInfobar();
  });

  // ---------------- Flow overlay shell ----------------

  const kindnessFlow = document.createElement('section');
  kindnessFlow.className = 'kindness-flow';
  kindnessFlow.hidden = true;
  kindnessFlow.setAttribute('aria-label', 'Kindness tree flow');
  if (prefersReducedMotion) kindnessFlow.classList.add('kf-reduced-motion');
  kindnessFlow.innerHTML = `
    <div class="kf-infobar" id="kf-infobar">
      <button type="button" class="kf-back" id="kf-back" aria-label="Back to home">×</button>
      <div class="kf-route-badge" id="kf-route-badge">—</div>
      <div class="kf-route-meta">
        <span class="kf-direction" id="kf-direction"></span>
        <span class="kf-destination" id="kf-destination"></span>
      </div>
      <div class="kf-eta"><span class="kf-live-dot"></span><strong id="kf-eta-value">—</strong></div>
    </div>
    <div class="kf-idle-toast" id="kf-idle-toast" hidden aria-live="polite"></div>
    <div class="kf-stage" id="kf-stage"></div>`;
  document.querySelector('.screen-body')?.append(kindnessFlow);

  const stage = kindnessFlow.querySelector('#kf-stage');
  const backButton = kindnessFlow.querySelector('#kf-back');
  const routeBadgeEl = kindnessFlow.querySelector('#kf-route-badge');
  const directionEl = kindnessFlow.querySelector('#kf-direction');
  const destinationEl = kindnessFlow.querySelector('#kf-destination');
  const etaValueEl = kindnessFlow.querySelector('#kf-eta-value');
  const infobarEl = kindnessFlow.querySelector('#kf-infobar');
  const idleToastEl = kindnessFlow.querySelector('#kf-idle-toast');

  function createInitialState() {
    return {
      screen: 'closed', routeSnapshot: null, tags: [], availableMinutes: 3,
      acts: [], source: null, selectedActId: null, rerollCount: 0, pendingBlossomTag: null,
      pendingBlossomPalette: null, lastBlossom: null, lastActTitle: '', lastActDescription: ''
    };
  }

  let state = createInitialState();
  let idleTimer = null;
  let idleWarnTimer = null;
  let idleCountdownInterval = null;
  let doneTimer = null;
  let infobarTicker = null;

  // ---------------- Idle handling ----------------

  function hideIdleToast() {
    idleToastEl.hidden = true;
  }

  function updateIdleToast(remaining) {
    idleToastEl.hidden = false;
    idleToastEl.textContent = t().idle.toast(remaining);
  }

  function showIdleWarning() {
    let remaining = Math.round(Logic.IDLE_WARNING_MS / 1000);
    updateIdleToast(remaining);
    idleCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(idleCountdownInterval);
        return;
      }
      updateIdleToast(remaining);
    }, 1000);
  }

  function clearIdleTimers() {
    clearTimeout(idleTimer);
    clearTimeout(idleWarnTimer);
    clearInterval(idleCountdownInterval);
    hideIdleToast();
  }

  function resetIdle() {
    clearIdleTimers();
    if (state.screen === 'closed') return;
    idleWarnTimer = setTimeout(showIdleWarning, Logic.IDLE_TIMEOUT_MS - Logic.IDLE_WARNING_MS);
    idleTimer = setTimeout(() => closeFlow('idle'), Logic.IDLE_TIMEOUT_MS);
  }

  let lastIdleResetAt = 0;
  function onActivity() {
    const now = Date.now();
    if (now - lastIdleResetAt < 400) return;
    lastIdleResetAt = now;
    resetIdle();
  }
  kindnessFlow.addEventListener('pointerdown', onActivity);
  kindnessFlow.addEventListener('pointermove', onActivity);
  kindnessFlow.addEventListener('keydown', onActivity);

  // ---------------- Info bar ----------------

  function renderInfobar() {
    const route = currentRouteRecord(state.routeSnapshot);
    const first = route?.arrivals?.[0];
    routeBadgeEl.textContent = state.routeSnapshot || '—';
    directionEl.textContent = route?.direction || '';
    destinationEl.textContent = first?.destination || route?.destination || '';
    const seconds = first ? Math.max(0, first.arrivalEpoch - Date.now() / 1000) : NaN;
    const minutes = Number.isFinite(seconds) ? Math.ceil(seconds / 60) : null;
    etaValueEl.textContent = minutes === null ? '—' : `${minutes} min`;
    const arriving = minutes !== null && minutes <= 2;
    infobarEl.classList.toggle('kf-infobar--arriving', arriving);
  }

  backButton.addEventListener('click', () => closeFlow('back'));

  // ---------------- Templates ----------------

  function tagLabel(tag) {
    const strings = t();
    return (strings.tags && strings.tags[tag.id]) || tag.label;
  }

  function tagButtonHtml(tag) {
    const selected = state.tags.includes(tag.id);
    const label = tagLabel(tag);
    return `<button type="button" class="kf-tag" data-tag="${tag.id}" aria-pressed="${selected}" aria-label="${label}" style="--tag-color:${tag.color}">
      ${flowerSvg()}
      <span class="kf-tag-check" aria-hidden="true">✓</span>
      <span class="kf-tag-label">${escapeHtml(label)}</span>
    </button>`;
  }

  function timeOptionHtml(minutes) {
    const selected = state.availableMinutes === minutes;
    return `<button type="button" class="kf-time-option" data-minutes="${minutes}" aria-pressed="${selected}" aria-label="${minutes} minutes">
      <strong>${minutes}</strong>
      <span>min</span>
    </button>`;
  }

  function selectTemplate() {
    const strings = t();
    const weatherLabel = strings.weather[getWeather().condition] || getWeather().condition;
    const contextLine = strings.select.aiContext({
      timeOfDayLabel: strings.timeOfDay[currentTimeOfDay()],
      weatherLabel: `${weatherLabel} ${getWeather().tempC}°C`
    });
    return `
      <div class="kf-select">
        <div class="kf-select-content">
          <div class="kf-steps" aria-label="Kindness flow progress">
            <span class="kf-step kf-step--active"><b>1</b><em>Choose</em></span>
            <i></i>
            <span class="kf-step"><b>2</b><em>Pick</em></span>
            <i></i>
            <span class="kf-step"><b>3</b><em>Plant</em></span>
          </div>
          <section class="kf-choice-section">
            <h2 class="kf-title">${escapeHtml(strings.select.title)}</h2>
            <p class="kf-subtitle">${escapeHtml(strings.select.tagsHint)}</p>
            <div class="kf-tags" role="group" aria-label="Kindness tags">${TAGS.map(tagButtonHtml).join('')}</div>
            <p class="kf-picked-count">${escapeHtml(strings.select.selectedCount(state.tags.length))}</p>
          </section>
          <div class="kf-select-divider" aria-hidden="true"></div>
          <section class="kf-time-section">
            <h3 class="kf-title kf-title--small">${escapeHtml(strings.select.timeTitle)}</h3>
            <p class="kf-subtitle kf-time-subtitle">${escapeHtml(strings.select.timeHint)}</p>
            <div class="kf-time-options" role="group" aria-label="Available minutes">${TIME_OPTIONS.map(timeOptionHtml).join('')}</div>
            <div class="kf-hints">
              <p class="kf-ai-context">${escapeHtml(contextLine)}</p>
            </div>
          </section>
        </div>
        <div class="kf-actions">
          <button type="button" class="kf-btn kf-btn--ghost" id="kf-select-back"><span aria-hidden="true">&larr;</span>${escapeHtml(strings.select.back)}</button>
          <button type="button" class="kf-btn kf-btn--primary" id="kf-generate" ${(state.tags.length === 0 || !state.availableMinutes) ? 'disabled' : ''}>${escapeHtml(strings.select.generate)}<span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>`;
  }

  function bindSelectEvents() {
    stage.querySelectorAll('.kf-tag').forEach((button) => {
      button.addEventListener('click', () => {
        const tagId = button.dataset.tag;
        const selected = state.tags.includes(tagId);
        if (selected) {
          state.tags = state.tags.filter((id) => id !== tagId);
        } else if (state.tags.length < Logic.MAX_TAGS) {
          state.tags = [...state.tags, tagId];
        }
        render();
      });
    });
    stage.querySelectorAll('.kf-time-option').forEach((button) => {
      button.addEventListener('click', () => {
        state.availableMinutes = Number(button.dataset.minutes);
        render();
      });
    });
    stage.querySelector('#kf-select-back').addEventListener('click', () => closeFlow('back'));
    stage.querySelector('#kf-generate').addEventListener('click', () => {
      if (state.tags.length === 0 || !state.availableMinutes) return;
      state.rerollCount = 0;
      startGenerating();
    });
  }

  function generatingTemplate() {
    return `
      <div class="kf-generating">
        ${flowerSvg('kf-petal-spinner')}
        <p>${escapeHtml(t().generating.thinking)}</p>
      </div>`;
  }

  function cardHtml(act, index) {
    const selected = state.selectedActId === act.id;
    const labels = act.tags.map((tagId) => {
      const tag = TAGS.find((item) => item.id === tagId);
      return tag ? tagLabel(tag) : tagId;
    });
    const primaryTag = act.tags[0];
    return `<button type="button" class="kf-card kf-card--${(index % 3) + 1}" data-act-id="${escapeHtml(act.id)}" aria-pressed="${selected}">
      <span class="kf-card-visual" aria-hidden="true"><span class="kf-card-emoji">${escapeHtml(act.emoji || '✨')}</span></span>
      <span class="kf-card-content">
        <span class="kf-card-copy">
          <strong class="kf-card-title">${escapeHtml(act.title)}</strong>
          <span class="kf-card-desc">${escapeHtml(act.description)}</span>
        </span>
        <span class="kf-card-meta">
          <span class="kf-card-tag-list">${escapeHtml(labels.join(' · '))}</span>
          <span class="kf-card-meta-divider" aria-hidden="true"></span>
          <span class="kf-card-flower" style="--tag-color:${tagColor(primaryTag)}">${flowerSvg()}</span>
          <span class="kf-card-minutes">${act.estimatedMinutes} min</span>
        </span>
      </span>
      <span class="kf-card-check" aria-hidden="true">✓</span>
    </button>`;
  }

  function pickStepsHtml() {
    return `<div class="kf-steps" aria-label="Kindness flow progress">
      <span class="kf-step"><b>1</b><em>Choose</em></span>
      <i></i>
      <span class="kf-step kf-step--active"><b>2</b><em>Pick</em></span>
      <i></i>
      <span class="kf-step"><b>3</b><em>Plant</em></span>
    </div>`;
  }

  function pickTemplate() {
    const strings = t();
    const rerollExhausted = state.rerollCount >= Logic.MAX_REROLLS;
    return `
      <div class="kf-pick">
        ${pickStepsHtml()}
        <div class="kf-pick-heading">
          <h2>${escapeHtml(strings.pick.title)}</h2>
          <p>${escapeHtml(strings.pick.hint)}</p>
        </div>
        <div class="kf-pick-cards">${state.acts.map(cardHtml).join('')}</div>
        <div class="kf-actions">
          <button type="button" class="kf-btn kf-btn--ghost" id="kf-reroll" ${rerollExhausted ? 'disabled' : ''}>${escapeHtml(rerollExhausted ? strings.pick.rerollLimit : strings.pick.reroll)}</button>
          <button type="button" class="kf-btn kf-btn--primary" id="kf-choose" ${state.selectedActId ? '' : 'disabled'}>${escapeHtml(strings.pick.choose)}<span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>
    `;
  }

  function bindPickEvents() {
    stage.querySelectorAll('.kf-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.selectedActId = card.dataset.actId;
        render();
      });
    });
    const rerollButton = stage.querySelector('#kf-reroll');
    rerollButton.addEventListener('click', () => {
      if (state.rerollCount >= Logic.MAX_REROLLS) return;
      state.rerollCount += 1;
      startGenerating();
    });
    stage.querySelector('#kf-choose').addEventListener('click', () => {
      const act = state.acts.find((item) => item.id === state.selectedActId);
      if (!act) return;
      const overlapTag = act.tags.find((tagId) => state.tags.includes(tagId));
      state.pendingBlossomTag = overlapTag || act.tags[0];
      state.pendingBlossomPalette = nextBlossomPalette(state.pendingBlossomTag);
      state.lastActTitle = act.title;
      state.lastActDescription = act.description;
      state.screen = 'plant';
      render();
    });
  }

  function renderExistingBlossomsHtml() {
    const visible = repo.load(STOP_ID).slice(-24);
    return visible.map((b, index) => `<span class="kf-existing-blossom${b.id === state.lastBlossom?.id ? ' kf-existing-blossom--new' : ''}" style="left:${(b.x * 100).toFixed(1)}%; top:${(b.y * 100).toFixed(1)}%;">${spriteFlowerHtml(blossomVariant(b, index))}</span>`).join('');
  }

  // Same sprite sheet and leafy tree as the home card, so the flow matches what riders see there.
  function spriteFlowerHtml(variant) {
    return `<span class="kf-flower-sprite" style="${flowerSpriteStyle(variant)}" aria-hidden="true"></span>`;
  }

  function treeCanvasHtml(id) {
    return `<div class="kf-tree-canvas"${id ? ` id="${id}"` : ''}>
      <img class="kf-tree-canvas-img" src="assets/kindness-tree-leafy.png" alt="" />
      ${renderExistingBlossomsHtml()}
    </div>`;
  }

  function pendingFlowerVariant() {
    return repo.load(STOP_ID).length % 12;
  }

  function plantStepsHtml() {
    return `<div class="kf-steps" aria-label="Kindness flow progress">
      <span class="kf-step"><b>1</b><em>Choose</em></span>
      <i></i>
      <span class="kf-step"><b>2</b><em>Pick</em></span>
      <i></i>
      <span class="kf-step kf-step--active"><b>3</b><em>Plant</em></span>
    </div>`;
  }

  function plantTemplate() {
    const strings = t();
    return `
      <div class="kf-plant">
        ${plantStepsHtml()}
        <div class="kf-plant-heading">
          <h2>${escapeHtml(strings.plant.headline)}</h2>
          <p>${escapeHtml(strings.plant.dragHint)}</p>
        </div>
        <p class="kf-plant-promise"><span aria-hidden="true">♥</span><b>${escapeHtml(strings.plant.promise)}:</b> ${escapeHtml(state.lastActTitle || '')}</p>
        <div class="kf-plant-tree" id="kf-plant-tree" role="button" tabindex="0" aria-label="Tree planting area">
          ${treeCanvasHtml('kf-plant-canvas')}
        </div>
        <div class="kf-tray">
          <button type="button" class="kf-blossom" id="kf-pending-blossom" aria-pressed="false" aria-label="Your flower — drag onto the tree, or tap then tap the tree">
            ${spriteFlowerHtml(pendingFlowerVariant())}
            <span>${escapeHtml(strings.plant.yourFlower)}</span>
          </button>
          <p class="kf-plant-instructions">${escapeHtml(strings.plant.instructions)}</p>
          <button type="button" class="kf-btn kf-btn--ghost" id="kf-place-for-me">${escapeHtml(strings.plant.placeForMe)}</button>
        </div>
      </div>`;
  }

  function bindPlantEvents() {
    const blossomEl = stage.querySelector('#kf-pending-blossom');
    const treeEl = stage.querySelector('#kf-plant-tree');
    // Positions are stored relative to the tree canvas (same box as the home tree),
    // not the whole planting area, so a flower lands in the same spot on both.
    const canvasEl = stage.querySelector('#kf-plant-canvas');
    const placeForMeBtn = stage.querySelector('#kf-place-for-me');
    let armed = false;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let ghostEl = null;

    // .kiosk-shell carries a CSS transform (for pinch-zoom), which makes it the
    // containing block for any `position: fixed` descendant and rescales its
    // local coordinate space — so drag math is done in kiosk-local units,
    // derived from the shell's own rect, rather than raw viewport coordinates.
    // The original blossom button is left untouched in the tray's normal flow
    // (only dimmed) and a floating clone is dragged instead, so starting a
    // drag never reflows the tray/crown layout underneath the gesture.
    blossomEl.addEventListener('pointerdown', (event) => {
      dragging = true;
      moved = false;
      blossomEl.setPointerCapture(event.pointerId);
      const rect = blossomEl.getBoundingClientRect();
      const scale = kioskScale();
      const kioskRect = kioskShell.getBoundingClientRect();
      const centerXLocal = (rect.left + rect.width / 2 - kioskRect.left) / scale;
      const centerYLocal = (rect.top + rect.height / 2 - kioskRect.top) / scale;
      const pointerXLocal = (event.clientX - kioskRect.left) / scale;
      const pointerYLocal = (event.clientY - kioskRect.top) / scale;
      offsetX = pointerXLocal - centerXLocal;
      offsetY = pointerYLocal - centerYLocal;
      startX = event.clientX;
      startY = event.clientY;

      ghostEl = blossomEl.cloneNode(true);
      ghostEl.removeAttribute('id');
      ghostEl.style.position = 'fixed';
      ghostEl.style.left = `${centerXLocal}px`;
      ghostEl.style.top = `${centerYLocal}px`;
      ghostEl.style.width = `${rect.width / scale}px`;
      ghostEl.style.height = `${rect.height / scale}px`;
      ghostEl.style.margin = '0';
      ghostEl.style.pointerEvents = 'none';
      ghostEl.classList.add('kf-blossom--dragging');
      kioskShell.appendChild(ghostEl);
      blossomEl.classList.add('kf-blossom--source-dimmed');
    });

    blossomEl.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      if (Math.abs(event.clientX - startX) > 6 || Math.abs(event.clientY - startY) > 6) moved = true;
      if (!moved || !ghostEl) return;
      const scale = kioskScale();
      const kioskRect = kioskShell.getBoundingClientRect();
      const pointerXLocal = (event.clientX - kioskRect.left) / scale;
      const pointerYLocal = (event.clientY - kioskRect.top) / scale;
      ghostEl.style.left = `${pointerXLocal - offsetX}px`;
      ghostEl.style.top = `${pointerYLocal - offsetY}px`;
    });

    function removeGhost() {
      if (ghostEl) ghostEl.remove();
      ghostEl = null;
      blossomEl.classList.remove('kf-blossom--source-dimmed');
    }

    function finishDrag(event) {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        const treeRect = treeEl.getBoundingClientRect();
        const inside = event.clientX >= treeRect.left && event.clientX <= treeRect.right
          && event.clientY >= treeRect.top && event.clientY <= treeRect.bottom;
        removeGhost();
        if (inside) placeAtPointer(event);
      } else {
        removeGhost();
        armed = !armed;
        blossomEl.setAttribute('aria-pressed', String(armed));
        blossomEl.classList.toggle('kf-blossom--armed', armed);
      }
    }

    blossomEl.addEventListener('pointerup', finishDrag);
    blossomEl.addEventListener('pointercancel', () => {
      dragging = false;
      removeGhost();
    });

    function placeAtPointer(event) {
      const canvasRect = canvasEl.getBoundingClientRect();
      const x = Logic.clamp((event.clientX - canvasRect.left) / canvasRect.width, 0.04, 0.96);
      const y = Logic.clamp((event.clientY - canvasRect.top) / canvasRect.height, 0.04, 0.96);
      placeBlossom(x, y);
    }

    treeEl.addEventListener('click', (event) => {
      if (!armed) return;
      placeAtPointer(event);
    });

    placeForMeBtn.addEventListener('click', () => {
      placeBlossom(0.12 + Math.random() * 0.76, 0.12 + Math.random() * 0.56);
    });
  }

  function savePromiseBlossom(x, y) {
    const palette = state.pendingBlossomPalette || nextBlossomPalette(state.pendingBlossomTag);
    const plantedCount = repo.load(STOP_ID).length;
    const blossom = {
      id: makeId(), type: state.pendingBlossomTag, x: Logic.clamp(x, 0, 1), y: Logic.clamp(y, 0, 1),
      petalColor: palette.petal, centerColor: palette.center, createdAt: Date.now(), status: 'promised',
      flowerVariant: plantedCount % 12, actTitle: state.lastActTitle, actDescription: state.lastActDescription
    };
    repo.addBlossom(STOP_ID, blossom);
    refreshHomeCount();
    window.dispatchEvent(new CustomEvent('busstop:kindness-updated'));
    return blossom;
  }

  function placeBlossom(x, y) {
    state.lastBlossom = savePromiseBlossom(x, y);
    state.pendingBlossomTag = null;
    state.pendingBlossomPalette = null;
    state.screen = 'done';
    render();
  }

  function autoPlaceRandom() {
    savePromiseBlossom(0.12 + Math.random() * 0.76, 0.14 + Math.random() * 0.54);
    state.pendingBlossomTag = null;
    state.pendingBlossomPalette = null;
  }

  function doneTemplate() {
    const strings = t();
    const promises = repo.load(STOP_ID);
    return `
      <div class="kf-done">
        <div class="kf-done-check" aria-hidden="true">✓</div>
        <div class="kf-done-heading">
          <h2><span>${escapeHtml(strings.plant.doneTitleLine1)}</span><span>${escapeHtml(strings.plant.doneTitleLine2)}</span></h2>
          <p>${escapeHtml(strings.plant.doneSubtitle)}</p>
          <span>${escapeHtml(strings.plant.todayCount(promises.length))}</span>
        </div>
        <div class="kf-done-tree" aria-label="Today's kindness tree at this stop">
          ${treeCanvasHtml()}
        </div>
        <div class="kf-done-promise">
          <div class="kf-done-promise-flower">${spriteFlowerHtml(blossomVariant(state.lastBlossom || {}, 0))}</div>
          <div>
            <span>${escapeHtml(strings.plant.promise)}</span>
            <strong>${escapeHtml(state.lastActTitle || '')}</strong>
            <p>${escapeHtml(state.lastActDescription || '')}</p>
          </div>
        </div>
        <p class="kf-done-note">${escapeHtml(strings.plant.promiseMark)}</p>
        <button type="button" class="kf-btn kf-btn--primary" id="kf-done-btn">${escapeHtml(strings.plant.backToBus)}<span aria-hidden="true">&rarr;</span></button>
      </div>`;
  }

  function bindDoneEvents() {
    stage.querySelector('#kf-done-btn').addEventListener('click', () => closeFlow('done'));
  }

  function render() {
    if (state.screen === 'closed') {
      kindnessFlow.hidden = true;
      return;
    }
    kindnessFlow.hidden = false;
    renderInfobar();
    if (state.screen === 'select') {
      stage.innerHTML = selectTemplate();
      bindSelectEvents();
    } else if (state.screen === 'generating') {
      stage.innerHTML = generatingTemplate();
    } else if (state.screen === 'pick') {
      stage.innerHTML = pickTemplate();
      bindPickEvents();
    } else if (state.screen === 'plant') {
      stage.innerHTML = plantTemplate();
      bindPlantEvents();
    } else if (state.screen === 'done') {
      stage.innerHTML = doneTemplate();
      bindDoneEvents();
    }
  }

  function buildContext() {
    return {
      tags: state.tags,
      availableMinutes: state.availableMinutes,
      timeOfDay: currentTimeOfDay(),
      weather: getWeather(),
      locale: currentLocale()
    };
  }

  function applyGenerationResult(acts, source) {
    if (state.screen !== 'generating') return;
    state.acts = acts;
    state.source = source;
    state.selectedActId = null;
    state.screen = 'pick';
    render();
  }

  async function runGeneration() {
    const context = buildContext();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Logic.AI_TIMEOUT_MS);
    try {
      const res = await fetch('/api/kindness-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`kindness-act returned ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.acts) || data.acts.length === 0) throw new Error('empty acts');
      applyGenerationResult(data.acts, data.source);
    } catch (error) {
      clearTimeout(timeout);
      const acts = Logic.selectFallbackActs(FALLBACK_BANK, context, 3);
      applyGenerationResult(acts, 'fallback');
    }
  }

  function startGenerating() {
    state.screen = 'generating';
    render();
    runGeneration();
  }

  function openFlow() {
    window.dispatchEvent(new CustomEvent('busstop:data-request'));
    state = createInitialState();
    state.screen = 'select';
    state.routeSnapshot = latestSelectedRoute;
    render();
    resetIdle();
    infobarTicker = setInterval(renderInfobar, 1000);
  }

  function closeFlow() {
    clearIdleTimers();
    clearTimeout(idleTimer);
    clearTimeout(doneTimer);
    clearInterval(infobarTicker);
    if (state.screen === 'plant' && state.pendingBlossomTag) {
      autoPlaceRandom();
    }
    state = createInitialState();
    kindnessFlow.hidden = true;
    stage.innerHTML = '';
  }

  homeCtaBtn.addEventListener('click', openFlow);

  seedDemoData();
  refreshHomeCount();
  enableHomeButton();
  window.dispatchEvent(new CustomEvent('busstop:data-request'));
  refreshWeather();
  setInterval(refreshWeather, WEATHER_CACHE_MS);
})();
