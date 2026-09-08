const CONFIG = {
  moduleUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm',
  wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  modelUrl: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  minZoom: 0.85,
  maxZoom: 1.18,
  minGestureScore: 0.58,
  stableFrames: 4,
  inferenceIntervalMs: 90
};

const COMMANDS = {
  Victory: { label: 'Victory · speak once', event: 'busstop:announce-request' },
  Open_Palm: { label: 'Open palm · route overview', event: 'busstop:overview-toggle' },
  Point_Left: { label: 'Point left · next route', event: 'busstop:route-change', detail: { direction: 'next' } },
  Point_Right: { label: 'Point right · previous route', event: 'busstop:route-change', detail: { direction: 'previous' } }
};

const state = {
  active: false,
  loading: false,
  sessionId: 0,
  stream: null,
  recognizer: null,
  frameRequest: null,
  lastInferenceAt: 0,
  lastVideoTime: -1,
  stableName: 'None',
  stableCount: 0,
  commandLatched: false,
  lastCommandName: null,
  frozen: false,
  fistReleaseFrames: 0,
  resumeCooldownUntil: 0,
  pinchBaseline: null,
  zoomBaseline: 1,
  zoom: 1,
  noHandFrames: 0,
  feedbackTimer: null
};

const elements = createControls();

function createControls() {
  const root = document.createElement('aside');
  root.className = 'gesture-control';
  root.setAttribute('aria-label', 'Camera gesture controls');
  root.innerHTML = `
    <section class="gesture-panel" hidden>
      <video class="gesture-video" muted playsinline aria-label="Mirrored camera preview"></video>
      <p class="gesture-status" aria-live="polite">Camera off</p>
      <p class="gesture-help">V: speak · fist: hold · palm: overview · point left/right: routes · pinch: zoom</p>
      <button class="gesture-stop" type="button">Turn camera off</button>
    </section>
    <button class="gesture-toggle" type="button" aria-pressed="false">Enable gestures</button>
    <output class="gesture-feedback" aria-live="polite"></output>`;
  document.body.append(root);
  const controls = {
    panel: root.querySelector('.gesture-panel'),
    video: root.querySelector('.gesture-video'),
    status: root.querySelector('.gesture-status'),
    toggle: root.querySelector('.gesture-toggle'),
    stop: root.querySelector('.gesture-stop'),
    feedback: root.querySelector('.gesture-feedback')
  };
  controls.toggle.addEventListener('click', start);
  controls.stop.addEventListener('click', stop);
  return controls;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function showFeedback(message) {
  clearTimeout(state.feedbackTimer);
  elements.feedback.textContent = message;
  elements.feedback.classList.add('visible');
  state.feedbackTimer = setTimeout(() => elements.feedback.classList.remove('visible'), 750);
}

async function createRecognizer() {
  if (state.recognizer) return state.recognizer;
  const { FilesetResolver, GestureRecognizer } = await import(CONFIG.moduleUrl);
  const vision = await FilesetResolver.forVisionTasks(CONFIG.wasmUrl);
  const options = {
    baseOptions: { modelAssetPath: CONFIG.modelUrl, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5
  };
  try {
    state.recognizer = await GestureRecognizer.createFromOptions(vision, options);
  } catch (error) {
    options.baseOptions.delegate = 'CPU';
    state.recognizer = await GestureRecognizer.createFromOptions(vision, options);
  }
  return state.recognizer;
}

async function start() {
  if (state.active || state.loading) return;
  const sessionId = ++state.sessionId;
  state.loading = true;
  elements.toggle.disabled = true;
  elements.toggle.textContent = 'Starting camera…';
  elements.panel.hidden = false;
  setStatus('Requesting camera permission…');
  window.dispatchEvent(new CustomEvent('busstop:voice-unlock'));
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera gestures require the HTTPS Vercel page.');
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 24 }
      },
      audio: false
    });
    elements.video.srcObject = state.stream;
    await elements.video.play();
    setStatus('Loading standard gesture model…');
    await createRecognizer();
    if (sessionId !== state.sessionId) return;
    state.active = true;
    state.lastVideoTime = -1;
    elements.toggle.textContent = 'Gestures on';
    elements.toggle.setAttribute('aria-pressed', 'true');
    setStatus('Show one gesture to the camera');
    state.frameRequest = requestAnimationFrame(processFrame);
  } catch (error) {
    stopCameraStream();
    elements.panel.hidden = false;
    setStatus(error instanceof Error ? error.message : 'Unable to start camera gestures.');
    elements.toggle.textContent = 'Try gestures again';
    elements.toggle.setAttribute('aria-pressed', 'false');
  } finally {
    state.loading = false;
    elements.toggle.disabled = false;
  }
}

function stopCameraStream() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.video.srcObject = null;
}

function resetRecognition() {
  state.stableName = 'None';
  state.stableCount = 0;
  state.commandLatched = false;
  state.lastCommandName = null;
  state.frozen = false;
  state.fistReleaseFrames = 0;
  state.resumeCooldownUntil = 0;
  state.pinchBaseline = null;
  state.noHandFrames = 0;
}

function stop() {
  state.sessionId += 1;
  state.active = false;
  if (state.frameRequest) cancelAnimationFrame(state.frameRequest);
  state.frameRequest = null;
  stopCameraStream();
  resetRecognition();
  elements.panel.hidden = true;
  elements.toggle.textContent = 'Enable gestures';
  elements.toggle.setAttribute('aria-pressed', 'false');
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function jointAngle(a, joint, b) {
  const first = { x: a.x - joint.x, y: a.y - joint.y };
  const second = { x: b.x - joint.x, y: b.y - joint.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (denominator < 0.0001) return 0;
  const cosine = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator));
  return Math.acos(cosine) * (180 / Math.PI);
}

function fingerIsFolded(landmarks, mcpIndex, pipIndex, tipIndex) {
  const wrist = landmarks[0];
  const angle = jointAngle(landmarks[mcpIndex], landmarks[pipIndex], landmarks[tipIndex]);
  const tipNearPalm = distance(landmarks[tipIndex], wrist)
    < distance(landmarks[pipIndex], wrist) * 1.08;
  return angle < 145 || tipNearPalm;
}

function detectHorizontalPoint(landmarks) {
  if (!landmarks?.[8]) return null;

  const palmSize = Math.max(distance(landmarks[0], landmarks[9]), 0.05);
  const indexAngle = jointAngle(landmarks[5], landmarks[6], landmarks[8]);
  const rawDx = landmarks[8].x - landmarks[5].x;
  const dy = landmarks[8].y - landmarks[5].y;
  const screenDx = -rawDx; // The camera preview is mirrored for natural interaction.
  const indexLength = distance(landmarks[5], landmarks[8]);
  const foldedFingerCount = [
    fingerIsFolded(landmarks, 9, 10, 12),
    fingerIsFolded(landmarks, 13, 14, 16),
    fingerIsFolded(landmarks, 17, 18, 20)
  ].filter(Boolean).length;

  const isClearPoint = indexAngle > 152
    && indexLength > palmSize * 0.72
    && Math.abs(screenDx) > Math.abs(dy) * 1.45
    && Math.abs(screenDx) > palmSize * 0.55
    && foldedFingerCount >= 2;

  if (!isClearPoint) return null;
  return screenDx < 0 ? 'Point_Left' : 'Point_Right';
}

function updateStableGesture(name) {
  if (name === state.stableName) state.stableCount += 1;
  else {
    state.stableName = name;
    state.stableCount = 1;
    state.commandLatched = false;
    state.pinchBaseline = null;
  }
  if (state.stableName === 'None' && state.stableCount >= 5) state.lastCommandName = null;
}

function dispatchCommand(command) {
  window.dispatchEvent(new CustomEvent(command.event, { detail: command.detail }));
  showFeedback(command.label);
  setStatus(command.label);
}

function updateZoom(landmarks) {
  if (!landmarks || state.stableName !== 'None' || state.stableCount < 2) {
    state.pinchBaseline = null;
    return;
  }
  const palmSize = Math.max(distance(landmarks[0], landmarks[9]), 0.05);
  const pinchDistance = distance(landmarks[4], landmarks[8]) / palmSize;
  if (state.pinchBaseline === null) {
    state.pinchBaseline = pinchDistance;
    state.zoomBaseline = state.zoom;
    setStatus('Pinch detected · move fingers');
    return;
  }
  const ratio = pinchDistance / Math.max(state.pinchBaseline, 0.15);
  const target = state.zoomBaseline * (1 + (ratio - 1) * 0.7);
  const smoothed = state.zoom * 0.72 + target * 0.28;
  if (Math.abs(smoothed - state.zoom) < 0.003) return;
  state.zoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, smoothed));
  window.dispatchEvent(new CustomEvent('busstop:zoom', { detail: { scale: state.zoom } }));
  setStatus(`Pinch zoom · ${Math.round(state.zoom * 100)}%`);
}

function handleRecognition(result) {
  const category = result.gestures?.[0]?.[0];
  const landmarks = result.landmarks?.[0];
  const standardName = category?.score >= CONFIG.minGestureScore ? category.categoryName : 'None';
  const horizontalPoint = detectHorizontalPoint(landmarks);
  const name = horizontalPoint || standardName;
  updateStableGesture(name || 'None');

  if (state.frozen) {
    if (state.stableName === 'Closed_Fist') {
      state.fistReleaseFrames = 0;
      setStatus('Fist · controls held');
    } else {
      state.fistReleaseFrames += 1;
      if (state.fistReleaseFrames >= 4) {
        state.frozen = false;
        state.fistReleaseFrames = 0;
        state.resumeCooldownUntil = performance.now() + 700;
        showFeedback('Controls resumed');
        setStatus('Controls resumed');
      }
    }
    return;
  }

  if (performance.now() < state.resumeCooldownUntil) {
    state.pinchBaseline = null;
    return;
  }

  if (state.stableName === 'Closed_Fist' && state.stableCount >= 3) {
    state.frozen = true;
    state.commandLatched = true;
    state.pinchBaseline = null;
    showFeedback('Fist · controls held');
    setStatus('Fist · controls held');
    return;
  }

  const command = COMMANDS[state.stableName];
  if (command
    && state.stableCount >= CONFIG.stableFrames
    && !state.commandLatched
    && state.lastCommandName !== state.stableName) {
    state.commandLatched = true;
    state.lastCommandName = state.stableName;
    state.pinchBaseline = null;
    dispatchCommand(command);
    return;
  }

  updateZoom(landmarks);
}

function processFrame(timestamp) {
  if (!state.active) return;
  if (elements.video.readyState >= 2
    && elements.video.currentTime !== state.lastVideoTime
    && timestamp - state.lastInferenceAt >= CONFIG.inferenceIntervalMs) {
    state.lastInferenceAt = timestamp;
    state.lastVideoTime = elements.video.currentTime;
    try {
      const result = state.recognizer.recognizeForVideo(elements.video, performance.now());
      if (result.landmarks?.length) {
        state.noHandFrames = 0;
        handleRecognition(result);
      } else {
        state.noHandFrames += 1;
        if (state.noHandFrames > 5) {
          resetRecognition();
          setStatus('Show one gesture to the camera');
        }
      }
    } catch (error) {
      setStatus('Gesture tracking paused · retrying');
    }
  }
  state.frameRequest = requestAnimationFrame(processFrame);
}

window.addEventListener('pagehide', stopCameraStream);
