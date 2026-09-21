/*
 * Static content for the Kindness Tree feature: tag definitions, the
 * local fallback question bank (used when the AI path is unavailable),
 * and centralized i18n copy.
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.KindnessData = exported;
  }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : null), function () {
  const TAGS = [
    { id: 'indoor', label: 'Indoor', color: '#6d8f6b' },
    { id: 'outdoor', label: 'Outdoor', color: '#3f9142' },
    { id: 'animals', label: 'Animals', color: '#c98a3b' },
    { id: 'weather', label: 'Weather', color: '#3f7fbf' },
    { id: 'memories', label: 'Memories', color: '#a8578a' },
    { id: 'friends', label: 'Friends', color: '#d98a3d' },
    { id: 'family', label: 'Family', color: '#c65a5a' }
  ];

  const FALLBACK_EMOJIS = {
    'indoor-note': '📝', 'indoor-declutter': '🧹', 'indoor-seat': '💺', 'indoor-playlist': '🎵',
    'outdoor-litter': '🗑️', 'outdoor-notice': '🌱', 'outdoor-plant': '🪴', 'outdoor-photo': '📷',
    'animals-watch': '🐦', 'animals-wish': '🐾', 'animals-lookup': '🏠', 'animals-notice': '🦋',
    'weather-sky': '☁️', 'weather-share-shade': '☂️', 'weather-warm-wish': '🌤️', 'weather-forecast-share': '🌦️',
    'memories-favorite': '🚌', 'memories-thankyou': '💌', 'memories-photo-look': '🖼️', 'memories-write': '✍️',
    'friends-checkin': '💬', 'friends-compliment': '💛', 'friends-plan': '📅', 'friends-share-song': '🎧',
    'family-checkin': '☎️', 'family-photo': '👨‍👩‍👧', 'family-plan-call': '📞', 'family-gratitude': '❤️'
  };

  function weatherPhrase(weather) {
    const map = {
      sunny: 'A sunny stretch', cloudy: 'This cloudy lull', rain: 'This rainy pause',
      snow: 'This snowy moment', windy: 'This breezy moment', hot: 'This warm moment', cold: 'This cool moment'
    };
    if (!weather || !weather.condition) return 'Right now';
    return map[weather.condition] || 'Right now';
  }

  const WHY_TEMPLATES = {
    indoor: (ctx) => `A calm ${ctx.timeOfDay || 'quiet'} moment you can do right where you're standing.`,
    outdoor: (ctx) => `${weatherPhrase(ctx.weather)} — a good moment to be outside for a bit.`,
    animals: (ctx) => 'A gentle, hands-off moment — no need to approach anyone\'s pet.',
    weather: (ctx) => `${weatherPhrase(ctx.weather)} makes this an easy one to notice right now.`,
    memories: (ctx) => `A quiet ${ctx.timeOfDay || 'pause'} that only takes a moment of thought.`,
    friends: (ctx) => `A quick connection that fits the ${ctx.availableMinutes || 1} minutes you chose.`,
    family: (ctx) => `A small ${ctx.timeOfDay || 'today'} gesture for someone at home.`
  };

  function withWhy(tags) {
    const primary = tags[0];
    return (ctx) => WHY_TEMPLATES[primary] ? WHY_TEMPLATES[primary](ctx) : 'A small, doable moment for today.';
  }

  function bankItem(id, title, description, estimatedMinutes, tags) {
    return { id, title, description, estimatedMinutes, tags, emoji: FALLBACK_EMOJIS[id] || '✨', whyThisFitsTemplate: withWhy(tags) };
  }

  const FALLBACK_BANK = [
    bankItem('indoor-note', 'Leave an encouraging note', 'Write a short kind note and leave it for the next rider to find.', 3, ['indoor']),
    bankItem('indoor-declutter', 'Tidy the shelter bench', 'Straighten flyers or wipe down the bench you are sitting on.', 1, ['indoor']),
    bankItem('indoor-seat', 'Offer your seat first', 'When the bus arrives, let another rider board and sit before you do.', 1, ['indoor']),
    bankItem('indoor-playlist', 'Make a calm playlist to share', 'Put together a short calming playlist you could share with a friend later.', 5, ['indoor', 'memories']),

    bankItem('outdoor-litter', 'Spot one place to improve', 'Notice one small area nearby that could use a little care today.', 1, ['outdoor']),
    bankItem('outdoor-notice', 'Notice three good things outside', 'Look around and name three small things that are going right nearby.', 1, ['outdoor']),
    bankItem('outdoor-plant', 'Check on a nearby plant', 'See if a nearby tree or planter looks thirsty and note it for later.', 3, ['outdoor', 'weather']),
    bankItem('outdoor-photo', 'Share a nice view later', 'Notice something pleasant nearby and describe it to someone tonight.', 3, ['outdoor', 'memories']),

    bankItem('animals-watch', 'Watch birds for a minute', 'Spend a minute quietly watching any birds or squirrels nearby.', 1, ['animals']),
    bankItem('animals-wish', 'Send a wish to a shelter pet', 'Take a moment to wish a shelter animal well in your mind.', 1, ['animals']),
    bankItem('animals-lookup', 'Look up a local rescue', 'Search for a nearby animal rescue you could support another day.', 5, ['animals']),
    bankItem('animals-notice', 'Notice an animal\'s day', 'Watch a bird or pet nearby and imagine how its day is going.', 3, ['animals', 'memories']),

    bankItem('weather-sky', 'Study the sky for a moment', 'Look up and notice the clouds or light for a slow minute.', 1, ['weather']),
    bankItem('weather-share-shade', 'Offer to share shade or cover', 'If it helps, offer a bit of shade or shelter space to whoever is next to you.', 1, ['weather', 'friends']),
    bankItem('weather-warm-wish', 'Wish riders an easier commute', 'Silently hope the next few riders have an easier commute in this weather.', 1, ['weather']),
    bankItem('weather-forecast-share', 'Send someone the forecast', 'Text a friend a heads-up about today\'s weather before you board.', 3, ['weather', 'friends']),

    bankItem('memories-favorite', 'Recall a favorite bus ride', 'Think back to a bus or train ride that made you smile.', 1, ['memories']),
    bankItem('memories-thankyou', 'Text an old thank-you', 'Send a short thank-you message to someone from your past.', 3, ['memories', 'friends']),
    bankItem('memories-photo-look', 'Revisit one old photo', 'Open one favorite old photo and enjoy it for a moment.', 1, ['memories']),
    bankItem('memories-write', 'Jot a small memory down', 'Write one sentence about a happy memory before your ride.', 3, ['memories']),

    bankItem('friends-checkin', 'Send a quick check-in text', 'Message a friend a short "thinking of you" note.', 1, ['friends']),
    bankItem('friends-compliment', 'Send a genuine compliment', 'Text a friend one specific thing you appreciate about them.', 1, ['friends']),
    bankItem('friends-plan', 'Suggest a future hangout', 'Message a friend one simple idea for hanging out soon.', 3, ['friends']),
    bankItem('friends-share-song', 'Share a song you love', 'Send a friend a song that reminds you of a good time together.', 3, ['friends', 'memories']),

    bankItem('family-checkin', 'Check in with family', 'Send a short message home to say you are thinking of them.', 1, ['family']),
    bankItem('family-photo', 'Send a family photo', 'Share an old family photo with a sibling or parent.', 3, ['family', 'memories']),
    bankItem('family-plan-call', 'Plan a call with family', 'Text a family member to set up a quick catch-up call.', 3, ['family']),
    bankItem('family-gratitude', 'Note family gratitude', 'Write down one thing you are grateful a family member did.', 5, ['family'])
  ];

  const I18N = {
    en: {
      home: {
        count: (n) => (n === 1 ? '1 kind promise today' : `${n} kind promises today`)
      },
      infobar: {
        back: 'Back to home'
      },
      select: {
        title: 'What kind of kindness today?',
        tagsHint: 'Pick up to 3 flowers.',
        selectedCount: (n) => `${n} ${n === 1 ? 'flower' : 'flowers'} picked`,
        timeTitle: 'How much time do you have?',
        timeHint: 'Choose time for your act today.',
        aiContext: (ctx) => `${ctx.timeOfDayLabel} · ${ctx.weatherLabel}`,
        generate: 'Find 3 kind acts',
        back: 'Back'
      },
      generating: {
        thinking: 'AI is thinking of 3 small acts…'
      },
      pick: {
        aiCrafted: 'AI-crafted',
        title: 'A little kindness, your way.',
        hint: 'Three ideas for your flowers. Pick one.',
        why: 'Why this fits',
        choose: 'Choose this act',
        reroll: 'Try 3 new ideas',
        rerollLimit: 'No more new ideas this round'
      },
      plant: {
        headline: 'Let your kindness bloom.',
        dragHint: 'Drag your flower anywhere onto the tree.',
        promise: 'Your promise',
        yourFlower: 'Your flower',
        instructions: 'Or tap the flower, then tap a place on the tree.',
        placeForMe: 'Place for me',
        thankyou: 'One small promise. A little more bloom.',
        doneTitleLine1: 'One small promise.',
        doneTitleLine2: 'A little more bloom.',
        doneSubtitle: 'Thank you for adding to today\'s tree.',
        todayCount: (n) => `${n} ${n === 1 ? 'promise' : 'promises'} growing at this stop today`,
        promiseMark: 'Your flower marks a promise for today.',
        backToBus: 'Back to bus times',
        done: 'Done'
      },
      idle: {
        toast: (s) => `Returning to home in ${s}s · Tap anywhere to stay`
      },
      timeOfDay: { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' },
      weather: {
        sunny: 'Sunny', cloudy: 'Cloudy', rain: 'Rainy', snow: 'Snowy', windy: 'Windy', hot: 'Hot', cold: 'Cold'
      },
      tags: {
        indoor: 'Indoor', outdoor: 'Outdoor', animals: 'Animals', weather: 'Weather',
        memories: 'Memories', friends: 'Friends', family: 'Family'
      }
    },
    'zh-CN': {
      home: {
        count: (n) => `今天已有 ${n} 个善意承诺`
      },
      infobar: {
        back: '返回主页'
      },
      select: {
        title: '今天想做哪种善意？',
        tagsHint: '最多选择 3 朵花。',
        selectedCount: (n) => `已选择 ${n} 朵花`,
        timeTitle: '你有多少时间？',
        timeHint: '为今天的小行动选择时间。',
        aiContext: (ctx) => `${ctx.timeOfDayLabel} · ${ctx.weatherLabel}`,
        generate: '寻找 3 个善意行动',
        back: '返回'
      },
      generating: {
        thinking: 'AI 正在构思 3 个小小善举…'
      },
      pick: {
        aiCrafted: 'AI 生成',
        title: '一点善意，由你选择。',
        hint: '根据你的花朵生成了三个想法，请选择一个。',
        why: '推荐理由',
        choose: '选择这个行动',
        reroll: '换一批想法',
        rerollLimit: '本轮没有更多新想法了'
      },
      plant: {
        headline: '让你的善意绽放。',
        dragHint: '把花拖到树上的任意位置。',
        promise: '你的承诺',
        yourFlower: '你的花朵',
        instructions: '也可以先点花朵，再点击树上的位置。',
        placeForMe: '帮我放置',
        thankyou: '一个小小承诺，让善意多一朵花。',
        doneTitleLine1: '一个小小承诺，',
        doneTitleLine2: '让善意多一朵花。',
        doneSubtitle: '谢谢你为今天的善意树增添一份力量。',
        todayCount: (n) => `今天本站已有 ${n} 份善意承诺正在生长`,
        promiseMark: '这朵花记录着你今天的承诺。',
        backToBus: '返回公交信息',
        done: '完成'
      },
      idle: {
        toast: (s) => `${s} 秒后返回主页 · 点击屏幕可继续停留`
      },
      timeOfDay: { morning: '早晨', afternoon: '下午', evening: '傍晚', night: '夜晚' },
      weather: {
        sunny: '晴', cloudy: '多云', rain: '雨', snow: '雪', windy: '大风', hot: '炎热', cold: '寒冷'
      },
      tags: {
        indoor: '室内', outdoor: '户外', animals: '动物', weather: '天气',
        memories: '记忆', friends: '朋友', family: '亲友'
      }
    }
  };

  return { TAGS, FALLBACK_BANK, I18N };
});
