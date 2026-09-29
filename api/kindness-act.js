const KindnessLogic = require('../kindness-logic.js');
const KindnessData = require('../kindness-data.js');

const ALLOWED_TAGS = KindnessData.TAGS.map((tag) => tag.id);
const ALLOWED_TIME_OF_DAY = ['morning', 'afternoon', 'evening', 'night'];
const ALLOWED_WEATHER = ['sunny', 'cloudy', 'rain', 'snow', 'windy', 'hot', 'cold'];
const ALLOWED_LOCALE = ['en', 'zh-CN'];

// Static instructions (identical on every call). Everything that varies per request
// goes in the user message built by buildUserPrompt().
const SYSTEM_PROMPT = `You write "small kindness" ideas for riders waiting at a SEPTA bus stop in Philadelphia.
A rider picked 1-3 topic tags and how many minutes they want to spend. You return 3 acts they could start
right now, from the bus stop, with only their phone, their own belongings, and what is physically around the
stop (the shelter, the bench, the sidewalk, other riders nearby). The bus arrival time must never limit or
influence the acts.

WHAT EACH TAG MEANS — an act may only carry a tag if it clearly belongs to that tag's definition:
- indoor: done inside the bus shelter or on the bus the rider is about to board, or from their phone without
  moving (e.g. leaving a kind note in the shelter, making room on the bench, setting up something helpful on
  their phone for someone else).
- outdoor: improves the block around the stop or the people on it (e.g. clearing a flyer-strewn bench,
  reporting a broken streetlight or overflowing bin through Philly311, giving a lost visitor directions if they
  ask).
- animals: animals are the direct beneficiary or the clear subject (e.g. sharing an adoptable-pet listing from
  PAWS or ACCT Philly with someone who wants a pet, writing a thank-you review for a local shelter, sharing a
  lost-pet post). Plants, litter, or parks alone are NOT animals.
- weather: a direct response to today's actual weather and temperature (e.g. warning a friend to bring an
  umbrella, making room under the shelter roof during rain, telling someone about a nice evening for a walk).
- memories: starts from a specific shared memory and ends by sharing it with the person in it (e.g. sending a
  friend an old photo with the story behind it). Remembering privately does not count.
- friends: aimed at one specific friend.
- family: aimed at one specific family member.

SIZE EACH ACT TO THE TIME THE RIDER CHOSE. The user message gives an allowed minute range; every act's
estimatedMinutes must fall inside it and must honestly describe how long the act takes. Scale the act itself,
not just the number:
- 1 minute: one quick action (one tap, one sentence, one small physical fix).
- 2-3 minutes: a short message with a specific personal detail, or one small task done carefully.
- 4-5 minutes: something with a little thought or two steps (a heartfelt paragraph, finding and sending the
  right photo with context, tidying a whole bench area).
- 6-10 minutes: a small project with several steps (a voice memo telling a story, a handwritten note left
  for the next rider, researching something useful and sending a summary, a thoughtful letter draft).
Never pad a 1-minute act by claiming it takes 10 minutes.

MAKE EVERY ACT CONCRETE AND DO-ABLE NOW:
- The title starts with a verb and names the specific thing or person ("Send your sister the beach photo",
  not "Connect with family").
- The description says exactly how to start, with a concrete detail (which app, what to write, what to
  look for), so the rider could begin within ten seconds of reading it.
- Avoid passive or inward-only verbs: notice, observe, watch, think about, reflect, imagine, appreciate,
  wish, send good vibes. Every act must end in something that reaches another person, an animal, or the
  shared space.
- The 3 acts must use 3 different kinds of action (for example: a message, a physical fix at the stop,
  making something, helping someone present, finding and sharing useful information).
- Avoid the most generic ideas unless the angle makes them genuinely specific: "thinking of you" texts,
  watching birds, generic compliments, picking up litter.
- Use the creative angles given in the user message as inspiration so ideas differ between riders.

Tone: warm, light, never preachy or guilt-tripping. Respond sensibly to time of day and weather (no
standing in the rain, no approaching strangers at night).

HARD SAFETY RULES — never violate:
- No spending, sending, or transferring money, and no buying or giving gifts.
- No deep conversation with strangers, no asking for contact info, no touching anyone, no entering private
  spaces.
- No approaching, feeding, or touching animals.
- Nothing requiring a phone while walking, standing near the curb or platform edge, or anything that could
  make the rider miss their bus.
- No politics, religion, health or medical topics, identity, or appearance comments, and no photographing
  other people.
- Do not assume physical ability; the rider may use a wheelchair, have low vision, or be unable to stand long.

OUTPUT: exactly one JSON object and nothing else:
{"acts":[{"id":"string","emoji":"one emoji","title":"string","description":"string","estimatedMinutes":number,"tags":["tag"],"whyThisFits":"string"}]}
- Exactly 3 acts. Each act's tags are a non-empty subset of the rider's selected tags, and together the 3
  acts cover every selected tag. When only one tag is selected, all 3 acts use it in 3 different ways.
- estimatedMinutes is a whole number inside the allowed range.
- title: 8 words or fewer (16 characters or fewer for zh-CN). description: 24 words or fewer (40 characters
  or fewer for zh-CN). Write title, description, and whyThisFits in the requested language.
- whyThisFits: one short sentence linking the act to the rider's time, weather, or time of day.
- emoji: one emoji that depicts this specific act, with no words.`;

// Per-tag idea angles; a few are sampled per request so different riders (and rerolls)
// get pushed toward different kinds of acts instead of the model's most obvious answer.
const TAG_ANGLES = {
  indoor: ['a note left in the shelter for the next rider', 'making the shelter more comfortable for others',
    'setting up something on your phone that helps someone else', 'a kind gesture on the bus you are about to board',
    'offering space or a seat to someone who needs it', 'writing something encouraging to leave behind'],
  outdoor: ['reporting a fixable problem on the block via Philly311', 'tidying one specific spot at the stop',
    'helping a visitor who is asking for directions', 'a note or tip left for neighbours on the block',
    'thanking a worker who keeps the area running', 'sharing a nearby spot someone would enjoy'],
  animals: ['sharing an adoptable pet listing with someone looking for a pet', 'a thank-you review for a local shelter or rescue',
    'passing along a lost-pet post in a neighbourhood group', 'sending a friend an animal fact or video to brighten their day',
    'looking up foster or volunteer info and sending it to someone who would enjoy it', 'checking in on a friend\'s pet'],
  weather: ['a heads-up to someone about today\'s weather', 'making room for others under the shelter roof',
    'suggesting a plan that suits today\'s weather to a friend or family member', 'a weather-appropriate heads-up note for the next rider',
    'checking that someone got home dry or warm', 'sharing what today\'s sky or air feels like with someone far away'],
  memories: ['an old photo sent with the story behind it', 'a voice memo retelling a shared moment',
    'thanking someone for something they did years ago', 'recreating an old inside joke in a message',
    'a "this reminded me of you" message about something at the stop', 'a list of favourite moments shared with someone'],
  friends: ['a specific thank-you for something recent', 'a concrete plan with a date and place',
    'helping a friend with something they mentioned they needed', 'a voice note instead of a text',
    'recommending something picked just for them', 'reconnecting with a friend you have not talked to in a while'],
  family: ['a message to an older relative with a real update from your day', 'asking a family member for their recipe or story',
    'a specific thank-you for something they do quietly', 'setting up a call at a time that suits them',
    'sharing a photo from today with context', 'a small plan to help with a chore this week']
};

function pickRandom(list, count) {
  return list.slice().sort(() => Math.random() - 0.5).slice(0, count);
}

function buildUserPrompt(context) {
  const range = KindnessLogic.minuteRange(context.availableMinutes);
  const rangeText = range.min === range.max ? `exactly ${range.max} minute(s)` : `between ${range.min} and ${range.max} minutes`;
  const angles = context.tags.map((tag) => `- ${tag}: ${pickRandom(TAG_ANGLES[tag] || [], 2).join('; ')}`).join('\n');
  const avoid = context.excludeTitles.length
    ? `\nThe rider already saw these ideas and asked for new ones. Do NOT repeat them or close variations; use different kinds of actions:\n${context.excludeTitles.map((title) => `- ${title}`).join('\n')}\n`
    : '';
  return `Rider's choices:
- Tags: ${context.tags.join(', ')}
- Time they want to spend: ${context.availableMinutes} minute(s). Every act's estimatedMinutes must be ${rangeText}.
- Time of day: ${context.timeOfDay}
- Weather: ${context.weather.condition}, ${Math.round(context.weather.tempC)}°C
- Language: ${context.locale === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'English'}

Creative angles for this rider (draw from these, one per act where possible):
${angles}
${avoid}
Return the JSON object now.`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    if (request.body && typeof request.body === 'object') {
      resolve(request.body);
      return;
    }
    if (typeof request.body === 'string') {
      try {
        resolve(request.body ? JSON.parse(request.body) : {});
      } catch (error) {
        reject(error);
      }
      return;
    }
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sanitizeContext(body) {
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.filter((tag) => ALLOWED_TAGS.includes(tag)))].slice(0, KindnessLogic.MAX_TAGS)
    : [];
  const availableMinutes = KindnessLogic.clamp(Math.floor(Number(body.availableMinutes)) || 0, 0, KindnessLogic.HARD_MINUTES_CAP);
  const timeOfDay = ALLOWED_TIME_OF_DAY.includes(body.timeOfDay) ? body.timeOfDay : 'afternoon';
  const conditionRaw = body.weather && body.weather.condition;
  const condition = ALLOWED_WEATHER.includes(conditionRaw) ? conditionRaw : 'sunny';
  const tempCRaw = Number(body.weather && body.weather.tempC);
  const tempC = Number.isFinite(tempCRaw) ? KindnessLogic.clamp(tempCRaw, -40, 55) : 20;
  const locale = ALLOWED_LOCALE.includes(body.locale) ? body.locale : 'en';
  // Titles already shown this session, so "Try 3 new ideas" really gets new ideas.
  const excludeTitles = Array.isArray(body.excludeTitles)
    ? body.excludeTitles.filter((title) => typeof title === 'string' && title.trim()).map((title) => title.trim().slice(0, 80)).slice(0, 12)
    : [];
  return { tags, availableMinutes, timeOfDay, weather: { condition, tempC }, locale, excludeTitles };
}

function extractJsonBlock(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

async function callAnthropic(context, apiKey, model, baseUrl, correctionNote, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5',
        max_tokens: 900,
        temperature: 0.9,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent(context, correctionNote) }]
      })
    });
    if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
    const data = await response.json();
    const text = (data.content || []).map((block) => block.text || '').join('');
    return JSON.parse(extractJsonBlock(text));
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAI(context, apiKey, model, baseUrl, correctionNote, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl || 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.9,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent(context, correctionNote) }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return JSON.parse(extractJsonBlock(text));
  } finally {
    clearTimeout(timeout);
  }
}

function userContent(context, correctionNote) {
  const prompt = buildUserPrompt(context);
  return correctionNote ? `${prompt}\n\n${correctionNote}` : prompt;
}

const PROVIDERS = { anthropic: callAnthropic, openai: callOpenAI };

module.exports = async (request, response) => {
  let context;
  try {
    const body = await readJsonBody(request);
    context = sanitizeContext(body);
  } catch (error) {
    response.status(400).json({ error: 'Invalid request body' });
    return;
  }

  if (context.tags.length === 0 || context.availableMinutes <= 0) {
    response.status(400).json({ error: 'At least one tag and a positive available time are required' });
    return;
  }

  response.setHeader('Cache-Control', 'no-store, max-age=0');

  const apiKey = process.env.LLM_API_KEY;
  const provider = PROVIDERS[process.env.LLM_PROVIDER || 'anthropic'];

  // Both attempts must finish inside the client's wait, or the kiosk silently shows the local bank.
  const deadline = Date.now() + KindnessLogic.AI_SERVER_BUDGET_MS;

  async function attempt(correctionNote) {
    const remaining = deadline - Date.now();
    if (remaining < 2500) throw new Error('no time left for another attempt');
    const raw = await provider(context, apiKey, process.env.LLM_MODEL, process.env.LLM_BASE_URL, correctionNote, Math.min(KindnessLogic.AI_TIMEOUT_MS, remaining));
    const validation = KindnessLogic.validateActs(raw, context);
    const safeActs = KindnessLogic.filterSafeActs(validation.acts);
    if (!validation.valid || safeActs.length !== 3) {
      if (process.env.KINDNESS_DEBUG) {
        console.error('[kindness-act][debug] raw model output:', JSON.stringify(raw));
        console.error('[kindness-act][debug] validation errors:', validation.errors);
        console.error('[kindness-act][debug] acts removed by safety filter:', validation.acts.filter((act) => !KindnessLogic.passesSafetyFilter(act)));
      }
      throw new Error(`validation failed: ${validation.errors.join('; ') || 'unsafe content removed'}`);
    }
    return safeActs;
  }

  if (apiKey) {
    try {
      const acts = await attempt();
      response.status(200).json({ acts, source: 'ai' });
      return;
    } catch (firstError) {
      try {
        // Tell the model exactly what was wrong instead of a generic "try again".
        const acts = await attempt(
          `Your previous answer was rejected for these reasons:\n${firstError.message.replace(/^validation failed: /, '').split('; ').map((reason) => `- ${reason}`).join('\n')}\nFix them and return ONLY one valid JSON object with exactly 3 acts, following every rule.`
        );
        response.status(200).json({ acts, source: 'ai' });
        return;
      } catch (secondError) {
        console.error('[kindness-act] AI generation failed, using fallback bank.', firstError.message, secondError.message);
      }
    }
  }

  const acts = KindnessLogic.selectFallbackActs(KindnessData.FALLBACK_BANK, context, 3);
  response.status(200).json({ acts, source: 'fallback' });
};
