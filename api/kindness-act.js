const KindnessLogic = require('../kindness-logic.js');
const KindnessData = require('../kindness-data.js');

const ALLOWED_TAGS = KindnessData.TAGS.map((tag) => tag.id);
const ALLOWED_TIME_OF_DAY = ['morning', 'afternoon', 'evening', 'night'];
const ALLOWED_WEATHER = ['sunny', 'cloudy', 'rain', 'snow', 'windy', 'hot', 'cold'];
const ALLOWED_LOCALE = ['en', 'zh-CN'];

const SYSTEM_PROMPT = `You are a gentle, non-preachy "small kindness" assistant embedded in a bus-stop display.
You suggest tiny, concrete, doable acts of kindness a rider can complete within the amount of time they
choose — never vague advice like "be nice". The bus arrival estimate is informational and must not limit,
discourage, or otherwise influence the suggestions.

Every act must reach outward: it should benefit another rider, a stranger nearby, an animal, the shared
space, or someone the rider contacts remotely (a text, a call, a note) — not just a private moment of
noticing, relaxing, or reflecting that only affects the rider themselves. Quietly admiring a view or
recalling a memory does NOT count as kindness on its own — only suggest it if it ends in a small outward
gesture, like sharing that memory with someone or leaving a note behind.

Respond naturally to the weather and time of day (for example: do not suggest standing outside in the rain,
and do not suggest approaching strangers at night). Keep the tone light and never guilt-trip the rider.

Hard safety rules — never violate these:
- No spending money, transferring money, or giving/buying gifts.
- No deep conversation with strangers, no asking for contact info, no touching anyone, no entering private spaces.
- No approaching, feeding, or touching animals — observation, silent well-wishing, or looking up rescue info only.
- Nothing that requires looking at a phone while walking, standing near the platform edge, or the travel lane,
  and nothing that could cause the rider to miss their bus.
- No politics, religion, health/medical diagnosis, identity, or appearance commentary, and no photographing
  other people.
- Do not assume any specific physical ability — the rider may use a wheelchair, be low-vision, or be unable
  to stand for long.

You must respond with exactly one JSON object and nothing else, matching this shape:
{"acts":[{"id":"string","emoji":"one relevant emoji","title":"string","description":"string","estimatedMinutes":number,"tags":["tag"],"whyThisFits":"string"}]}
Return exactly 3 acts. Each act's "tags" must be a non-empty subset of the rider's selected tags, and across
the 3 acts try to cover every tag the rider selected. estimatedMinutes must be less than or equal to the
rider's available minutes. Title must be 8 words or fewer (16 characters or fewer if locale is zh-CN).
Description must be 24 words or fewer (40 characters or fewer if locale is zh-CN). whyThisFits should briefly
connect the act to the rider's chosen duration, time of day, or weather. emoji must be one relevant emoji
that visually represents the specific act, with no surrounding words.`;

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
  return { tags, availableMinutes, timeOfDay, weather: { condition, tempC }, locale };
}

function extractJsonBlock(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

async function callAnthropic(context, apiKey, model, baseUrl, correctionNote) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KindnessLogic.AI_TIMEOUT_MS);
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
        max_tokens: 800,
        temperature: 0.8,
        system: correctionNote ? `${SYSTEM_PROMPT}\n\n${correctionNote}` : SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(context) }]
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

async function callOpenAI(context, apiKey, model, baseUrl, correctionNote) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KindnessLogic.AI_TIMEOUT_MS);
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
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: correctionNote ? `${SYSTEM_PROMPT}\n\n${correctionNote}` : SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(context) }
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

  async function attempt(correctionNote) {
    const raw = await provider(context, apiKey, process.env.LLM_MODEL, process.env.LLM_BASE_URL, correctionNote);
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
        const acts = await attempt(
          'Your previous response was invalid or unsafe. Return ONLY one strictly valid JSON object matching the schema, with exactly 3 acts, respecting every rule.'
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
