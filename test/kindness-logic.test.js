const test = require('node:test');
const assert = require('node:assert/strict');
const KindnessLogic = require('../kindness-logic.js');
const KindnessData = require('../kindness-data.js');

test('time choices are fixed and independent of bus arrival time', () => {
  assert.deepEqual(KindnessLogic.TASK_TIME_OPTIONS, [1, 3, 5, 10]);
});

test('mapWeatherCode prioritizes precipitation over everything else', () => {
  assert.equal(KindnessLogic.mapWeatherCode(63, 18, 5), 'rain', 'moderate rain code');
  assert.equal(KindnessLogic.mapWeatherCode(96, 18, 5), 'rain', 'thunderstorm with hail still reads as rain');
  assert.equal(KindnessLogic.mapWeatherCode(75, -1, 5), 'snow', 'heavy snow code');
  assert.equal(KindnessLogic.mapWeatherCode(61, 35, 5), 'rain', 'rain wins even on a hot day');
});

test('mapWeatherCode falls through to temperature, then wind, then sky', () => {
  assert.equal(KindnessLogic.mapWeatherCode(1, 34, 5), 'hot');
  assert.equal(KindnessLogic.mapWeatherCode(1, 0, 5), 'cold');
  assert.equal(KindnessLogic.mapWeatherCode(2, 18, 35), 'windy');
  assert.equal(KindnessLogic.mapWeatherCode(0, 20, 5), 'sunny');
  assert.equal(KindnessLogic.mapWeatherCode(3, 20, 5), 'cloudy');
});

function validAct(overrides) {
  return Object.assign({
    id: 'a1',
    title: 'Notice three good things',
    description: 'Look around and name three small things going right nearby.',
    estimatedMinutes: 3,
    tags: ['outdoor'],
    whyThisFits: 'A sunny afternoon is a good moment to look up.'
  }, overrides);
}

test('validateActs accepts a well-formed 3-act payload', () => {
  const payload = { acts: [validAct({ id: 'a1' }), validAct({ id: 'a2' }), validAct({ id: 'a3' })] };
  const result = KindnessLogic.validateActs(payload, { tags: ['outdoor'], availableMinutes: 5, locale: 'en' });
  assert.equal(result.valid, true);
  assert.equal(result.acts.length, 3);
  assert.equal(result.acts[0].emoji, '✨', 'missing emoji receives a safe visual fallback');
});

test('validateActs rejects wrong act count', () => {
  const payload = { acts: [validAct()] };
  const result = KindnessLogic.validateActs(payload, { tags: ['outdoor'], availableMinutes: 5, locale: 'en' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('exactly 3')));
});

test('validateActs rejects estimatedMinutes exceeding availableMinutes', () => {
  const payload = { acts: [validAct({ id: 'a1', estimatedMinutes: 8 }), validAct({ id: 'a2' }), validAct({ id: 'a3' })] };
  const result = KindnessLogic.validateActs(payload, { tags: ['outdoor'], availableMinutes: 3, locale: 'en' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('exceeds availableMinutes')));
});

test('validateActs rejects tags outside the selected set', () => {
  const payload = { acts: [validAct({ id: 'a1', tags: ['friends'] }), validAct({ id: 'a2' }), validAct({ id: 'a3' })] };
  const result = KindnessLogic.validateActs(payload, { tags: ['outdoor'], availableMinutes: 5, locale: 'en' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('subset of selected tags')));
});

test('validateActs enforces the zh-CN character limits', () => {
  const longTitle = '这是一个非常非常非常长的标题超过十六个字符的限制了';
  const payload = {
    acts: [
      validAct({ id: 'a1', title: longTitle }),
      validAct({ id: 'a2' }),
      validAct({ id: 'a3' })
    ]
  };
  const result = KindnessLogic.validateActs(payload, { tags: ['outdoor'], availableMinutes: 5, locale: 'zh-CN' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('title exceeds length limit')));
});

test('passesSafetyFilter blocks money, animal contact, and stranger contact-info prompts', () => {
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Buy a coffee for a stranger.' })), false);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Pet the dog waiting nearby.' })), false);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Ask a stranger for their phone number.' })), false);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct()), true);
});

test('passesSafetyFilter blocks picking up an animal but allows picking up litter', () => {
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ title: 'Pick up the stray cat nearby' })), false);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ title: 'Pick up litter nearby and dispose of it' })), true);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ title: 'Pick Up Litter Nearby' })), true);
});

test('filterSafeActs removes only the unsafe entries', () => {
  const acts = [validAct({ id: 'safe' }), validAct({ id: 'unsafe', description: 'Give them money.' })];
  const result = KindnessLogic.filterSafeActs(acts);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'safe');
});

test('selectFallbackActs respects the time cap and selected tags', () => {
  const context = { tags: ['friends'], availableMinutes: 1, timeOfDay: 'afternoon', weather: { condition: 'sunny' } };
  const picks = KindnessLogic.selectFallbackActs(KindnessData.FALLBACK_BANK, context, 3, 42);
  assert.ok(picks.length > 0 && picks.length <= 3);
  picks.forEach((act) => {
    assert.ok(act.estimatedMinutes <= 1);
    assert.ok(act.tags.includes('friends'));
  });
});

test('selectFallbackActs tries to cover every selected tag across the picks', () => {
  const context = { tags: ['friends', 'family'], availableMinutes: 5, timeOfDay: 'evening', weather: { condition: 'cloudy' } };
  const picks = KindnessLogic.selectFallbackActs(KindnessData.FALLBACK_BANK, context, 3, 7);
  const coveredTags = new Set(picks.flatMap((act) => act.tags));
  assert.ok(coveredTags.has('friends'));
  assert.ok(coveredTags.has('family'));
});

test('fallback bank has at least 28 entries across the 7 tags', () => {
  assert.ok(KindnessData.FALLBACK_BANK.length >= 28);
  assert.ok(KindnessData.FALLBACK_BANK.every((item) => typeof item.emoji === 'string' && item.emoji.length > 0));
  KindnessData.TAGS.forEach((tag) => {
    const count = KindnessData.FALLBACK_BANK.filter((item) => item.tags.includes(tag.id)).length;
    assert.ok(count >= 4, `expected at least 4 fallback items for tag ${tag.id}`);
  });
});

test('every tag can produce three safe fallback choices', () => {
  KindnessData.TAGS.forEach((tag, index) => {
    const context = { tags: [tag.id], availableMinutes: 10, timeOfDay: 'afternoon', weather: { condition: 'sunny' } };
    const picks = KindnessLogic.selectFallbackActs(KindnessData.FALLBACK_BANK, context, 3, index + 1);
    assert.equal(picks.length, 3, `expected three choices for tag ${tag.id}`);
  });
});

test('treeRepository stores and retrieves blossoms per stop and date, scoped in memory when storage is unavailable', () => {
  const repo = KindnessLogic.createTreeRepository(null);
  const date = '2026-09-20';
  assert.deepEqual(repo.load('010101', date), []);
  repo.addBlossom('010101', {
    id: 'b1', type: 'friends', x: 0.4, y: 0.3, petalColor: '#ef7180', centerColor: '#f6c443',
    createdAt: Date.now(), status: 'promised', flowerVariant: 4,
    actTitle: 'Send a quick check-in text', actDescription: 'Message a friend a short thinking-of-you note.'
  }, date);
  const loaded = repo.load('010101', date);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'b1');
  assert.equal(loaded[0].petalColor, '#ef7180');
  assert.equal(loaded[0].centerColor, '#f6c443');
  assert.equal(loaded[0].flowerVariant, 4);
  assert.equal(loaded[0].actTitle, 'Send a quick check-in text');
});

test('minuteRange sizes acts to the chosen time, not just under it', () => {
  assert.deepEqual(KindnessLogic.minuteRange(1), { min: 1, max: 1 });
  assert.deepEqual(KindnessLogic.minuteRange(3), { min: 2, max: 3 });
  assert.deepEqual(KindnessLogic.minuteRange(5), { min: 3, max: 5 });
  assert.deepEqual(KindnessLogic.minuteRange(10), { min: 6, max: 10 });
});

test('validateActs rejects acts far shorter than the chosen time', () => {
  const payload = { acts: [validAct({ id: 'a1', estimatedMinutes: 1 }), validAct({ id: 'a2', estimatedMinutes: 8 }), validAct({ id: 'a3', estimatedMinutes: 10 })] };
  const result = KindnessLogic.validateActs(payload, { tags: ['outdoor'], availableMinutes: 10, locale: 'en' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('too short')));
});

test('selectFallbackActs prefers acts sized to a longer chosen time', () => {
  const context = { tags: ['family'], availableMinutes: 10, timeOfDay: 'afternoon', weather: { condition: 'sunny' } };
  const acts = KindnessLogic.selectFallbackActs(KindnessData.FALLBACK_BANK, context, 3, 7);
  assert.ok(acts[0].estimatedMinutes >= KindnessLogic.minuteRange(10).min);
});

test('passesSafetyFilter keeps harmless phrasings that used to be false positives', () => {
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ title: 'Leave a tip for the next rider', description: 'Write a weather tip on a note.' })), true);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Share an adoptable pet post on your social media.' })), true);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'If someone looks lost, point them to a nice cafe.' })), true);
});

test('passesSafetyFilter still blocks money tips, stranger social media, and appearance comments', () => {
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Tip the driver a few dollars.' })), false);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Ask for their social media so you can follow up.' })), false);
  assert.equal(KindnessLogic.passesSafetyFilter(validAct({ description: 'Tell someone they look nice today.' })), false);
});
