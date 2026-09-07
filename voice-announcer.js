(() => {
  let speaking = false;

  function chooseEnglishVoice() {
    const voices = window.speechSynthesis?.getVoices() || [];
    return voices.find((voice) => voice.lang === 'en-US')
      || voices.find((voice) => voice.lang?.startsWith('en'))
      || null;
  }

  function announce(text) {
    if (!('speechSynthesis' in window) || !text || speaking) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.voice = chooseEnglishVoice();
    speaking = true;
    utterance.addEventListener('end', () => { speaking = false; }, { once: true });
    utterance.addEventListener('error', () => { speaking = false; }, { once: true });
    window.speechSynthesis.speak(utterance);
  }

  function primeVoice() {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.getVoices();
  }

  window.addEventListener('busstop:voice-unlock', primeVoice);
  window.addEventListener('busstop:announce', (event) => announce(event.detail?.text));
  window.addEventListener('pagehide', () => window.speechSynthesis?.cancel());
})();
