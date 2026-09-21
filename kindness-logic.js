/*
 * Pure logic for the Kindness Tree feature: AI output validation,
 * safety filtering, fallback-bank selection, and the
 * localStorage-backed tree repository.
 *
 * Loaded as a plain <script> in the browser (exposes window.KindnessLogic)
 * and required as a CommonJS module from the Vercel function / node:test.
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.KindnessLogic = exported;
  }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : null), function () {
  const TASK_TIME_OPTIONS = [1, 3, 5, 10];
  const HARD_MINUTES_CAP = 10;
  const MAX_TAGS = 3;
  const MAX_REROLLS = 2;
  const IDLE_TIMEOUT_MS = 45_000;
  const IDLE_WARNING_MS = 10_000;
  const AI_TIMEOUT_MS = 8_000;

  const SAFETY_PATTERNS = [
    /\bmoney\b/i, /\bpay(ment)?\b/i, /\bbuy\b/i, /\bpurchase\b/i, /\bdonate\b/i, /\btip\b/i, /\bgift\b/i, /venmo|paypal|cash\s*app/i,
    /phone\s*number/i, /contact\s*info/i, /social\s*media/i, /follow\s*(them|him|her)/i, /\baddress\b/i,
    /\btouch\b/i, /\bpet\s+(the|a|an)\s+/i, /\bfeed\s+(the|a|an)\s+/i, /\bhug\b/i,
    /\bpick\s*up\s+(the|a|an)\s+(\w+\s+)?(dog|cat|bird|puppy|kitten|squirrel|rabbit|animal|pet)\b/i,
    /\bedge\s+of\s+the\s+platform\b/i, /\btrack(s)?\b/i, /\blane\b/i, /while\s+walking/i, /walk\s+while/i,
    /\bpolitic/i, /\breligio/i, /\bdiagnos/i, /\bmedication\b/i, /\billness\b/i, /\bidentity\b/i, /\blooks?\b.*\b(nice|pretty|attractive)\b/i,
    /\bphotograph\b/i, /\btake\s+a\s+photo\s+of\s+(them|him|her|someone)/i, /\bstranger.?s?\s+(number|address)/i
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function countWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function withinTextLimits(text, locale, kind) {
    const isZh = locale === 'zh-CN';
    const limits = kind === 'title' ? { en: 8, zh: 16 } : { en: 24, zh: 40 };
    if (isZh) return String(text || '').replace(/\s+/g, '').length <= limits.zh;
    return countWords(text) <= limits.en;
  }

  function passesSafetyFilter(act) {
    const haystack = `${act.title || ''} ${act.description || ''} ${act.whyThisFits || ''}`;
    return !SAFETY_PATTERNS.some((pattern) => pattern.test(haystack));
  }

  function filterSafeActs(acts) {
    return (acts || []).filter((act) => act && typeof act === 'object' && passesSafetyFilter(act));
  }

  function validateActs(payload, context) {
    const errors = [];
    const acts = payload && Array.isArray(payload.acts) ? payload.acts : null;
    if (!acts) {
      return { valid: false, acts: [], errors: ['payload.acts must be an array'] };
    }
    if (acts.length !== 3) {
      errors.push(`expected exactly 3 acts, got ${acts.length}`);
    }
    const selectedTags = new Set(context.tags || []);
    const locale = context.locale || 'en';
    const cleaned = [];
    acts.forEach((act, index) => {
      if (!act || typeof act !== 'object') {
        errors.push(`act[${index}] is not an object`);
        return;
      }
      const { id, title, description, estimatedMinutes, tags, whyThisFits, emoji } = act;
      if (typeof id !== 'string' || !id) errors.push(`act[${index}].id missing`);
      if (typeof title !== 'string' || !title) errors.push(`act[${index}].title missing`);
      if (typeof description !== 'string' || !description) errors.push(`act[${index}].description missing`);
      if (typeof whyThisFits !== 'string' || !whyThisFits) errors.push(`act[${index}].whyThisFits missing`);
      if (typeof estimatedMinutes !== 'number' || estimatedMinutes <= 0) {
        errors.push(`act[${index}].estimatedMinutes invalid`);
      } else if (estimatedMinutes > context.availableMinutes) {
        errors.push(`act[${index}].estimatedMinutes ${estimatedMinutes} exceeds availableMinutes ${context.availableMinutes}`);
      }
      if (!Array.isArray(tags) || tags.length === 0 || !tags.every((tag) => selectedTags.has(tag))) {
        errors.push(`act[${index}].tags must be a non-empty subset of selected tags`);
      }
      if (typeof title === 'string' && !withinTextLimits(title, locale, 'title')) {
        errors.push(`act[${index}].title exceeds length limit`);
      }
      if (typeof description === 'string' && !withinTextLimits(description, locale, 'description')) {
        errors.push(`act[${index}].description exceeds length limit`);
      }
      cleaned.push({
        ...act,
        emoji: typeof emoji === 'string' && emoji.trim() ? emoji.trim() : '✨'
      });
    });
    if (selectedTags.size > 1 && cleaned.length) {
      const covered = new Set(cleaned.flatMap((act) => act.tags || []));
      const missing = [...selectedTags].filter((tag) => !covered.has(tag));
      if (missing.length === selectedTags.size) {
        errors.push('acts do not cover any of the selected tags');
      }
    }
    return { valid: errors.length === 0, acts: cleaned, errors };
  }

  function seededShuffle(list, seed) {
    const array = list.slice();
    let state = seed >>> 0 || 1;
    for (let i = array.length - 1; i > 0; i -= 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const j = state % (i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function selectFallbackActs(bank, context, count, randomSeed) {
    const wantCount = count || 3;
    const selectedTags = context.tags && context.tags.length ? context.tags : [];
    const eligible = (bank || []).filter((item) => {
      const withinTime = item.estimatedMinutes <= context.availableMinutes;
      const matchesTag = selectedTags.length === 0 || item.tags.some((tag) => selectedTags.includes(tag));
      return withinTime && matchesTag && passesSafetyFilter(item);
    });
    const shuffled = randomSeed === undefined
      ? eligible.slice().sort(() => Math.random() - 0.5)
      : seededShuffle(eligible, randomSeed);

    const picked = [];
    const remainingTags = new Set(selectedTags);
    shuffled.forEach((item) => {
      if (picked.length >= wantCount) return;
      const coversNewTag = item.tags.some((tag) => remainingTags.has(tag));
      if (coversNewTag || remainingTags.size === 0) {
        picked.push(item);
        item.tags.forEach((tag) => remainingTags.delete(tag));
      }
    });
    shuffled.forEach((item) => {
      if (picked.length >= wantCount) return;
      if (!picked.includes(item)) picked.push(item);
    });
    return picked.slice(0, wantCount).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      estimatedMinutes: item.estimatedMinutes,
      tags: item.tags,
      emoji: item.emoji || '✨',
      whyThisFits: item.whyThisFitsTemplate
        ? item.whyThisFitsTemplate(context)
        : 'A small, doable moment for today.'
    }));
  }

  function todayKey(date) {
    const d = date || new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const values = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function createTreeRepository(storage) {
    const backend = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const memory = new Map();

    function keyFor(stopId, date) {
      return `kindness-tree:${stopId}:${date || todayKey()}`;
    }

    function load(stopId, date) {
      const key = keyFor(stopId, date);
      try {
        if (backend) {
          const raw = backend.getItem(key);
          return raw ? JSON.parse(raw) : [];
        }
      } catch (error) {
        /* fall through to memory */
      }
      return memory.get(key) || [];
    }

    function save(stopId, blossoms, date) {
      const key = keyFor(stopId, date);
      try {
        if (backend) {
          backend.setItem(key, JSON.stringify(blossoms));
          return;
        }
      } catch (error) {
        /* fall through to memory */
      }
      memory.set(key, blossoms);
    }

    function addBlossom(stopId, blossom, date) {
      const blossoms = load(stopId, date);
      blossoms.push(blossom);
      save(stopId, blossoms, date);
      return blossoms;
    }

    return { keyFor, load, save, addBlossom, todayKey };
  }

  // Maps an Open-Meteo WMO weather code (+ temperature/wind) to this app's
  // simplified single-value weather enum. Precipitation wins first (most
  // relevant to what's safe to suggest outdoors), then extreme temperature,
  // then wind, then falls back to a clear/overcast read of the code itself.
  const WEATHER_RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
  const WEATHER_SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

  function mapWeatherCode(code, tempC, windKmh) {
    if (WEATHER_RAIN_CODES.has(code)) return 'rain';
    if (WEATHER_SNOW_CODES.has(code)) return 'snow';
    if (Number.isFinite(tempC) && tempC >= 32) return 'hot';
    if (Number.isFinite(tempC) && tempC <= 2) return 'cold';
    if (Number.isFinite(windKmh) && windKmh >= 30) return 'windy';
    if (code === 0 || code === 1) return 'sunny';
    return 'cloudy';
  }

  return {
    TASK_TIME_OPTIONS,
    HARD_MINUTES_CAP,
    MAX_TAGS,
    MAX_REROLLS,
    IDLE_TIMEOUT_MS,
    IDLE_WARNING_MS,
    AI_TIMEOUT_MS,
    SAFETY_PATTERNS,
    clamp,
    withinTextLimits,
    passesSafetyFilter,
    filterSafeActs,
    validateActs,
    selectFallbackActs,
    createTreeRepository,
    todayKey,
    mapWeatherCode
  };
});
