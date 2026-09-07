const CONFIG = {
  moduleUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm',
  wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  modelUrl: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  minZoom: 0.85,
  maxZoom: 1.18,
  pointThreshold: 0.13,
  inferenceIntervalMs: 80
};

const state = {
  active: false,
  loading: false,
  sessionId: 0,
  stream: null,
  landmarker: null,
  frameRequest: null,
  lastInferenceAt: 0,
  lastVideoTime: -1,
  pinchBaseline: null,
  zoomBaseline: 1,
  zoom: 1,
  pointLatched: false,
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
      <p class="gesture-help">Pinch to zoom · point left/right to switch routes</p>
      <button class="gesture-stop" type="button">Turn camera off</button>
    </section>
    <button class="gesture-toggle" type="button" aria-pressed="false">Enable gestures</button>
    <output class="gesture-feedback" aria-live="polite"></output>`;
  document.body.append(root);
  const controls = {
    root,
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
  state.feedbackTimer = setTimeout(() => elements.feedback.classList.remove('visible'), 700);
}

async function createLandmarker() {
  if (state.landmarker) return state.landmarker;
  const { FilesetResolver, HandLandmarker } = await import(CONFIG.moduleUrl);
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
    state.landmarker = await HandLandmarker.createFromOptions(vision, options);
  } catch (error) {
    options.baseOptions.delegate = 'CPU';
    state.landmarker = await HandLandmarker.createFromOptions(vision, options);
  }
  return state.landmarker;
}

async function start() {
  if (state.active || state.loading) return;
  const sessionId = ++state.sessionId;
  state.loading = true;
  elements.toggle.disabled = true;
  elements.toggle.textContent = 'Starting camera…';
  elements.panel.hidden = false;
  setStatus('Requesting camera permission…');
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
    setStatus('Loading hand recognition…');
    await createLandmarker();
    if (sessionId !== state.sessionId) return;
    state.active = true;
    state.lastVideoTime = -1;
    elements.toggle.textContent = 'Gestures on';
    elements.toggle.setAttribute('aria-pressed', 'true');
    setStatus('Show one hand to the camera');
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

function stop() {
  state.sessionId += 1;
  state.active = false;
  if (state.frameRequest) cancelAnimationFrame(state.frameRequest);
  state.frameRequest = null;
  stopCameraStream();
  resetGestureState();
  elements.panel.hidden = true;
  elements.toggle.textContent = 'Enable gestures';
  elements.toggle.setAttribute('aria-pressed', 'false');
}

function resetGestureState() {
  state.pinchBaseline = null;
  state.pointLatched = false;
  state.noHandFrames = 0;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dispatchRoute(direction) {
  window.dispatchEvent(new CustomEvent('busstop:route-change', { detail: { direction } }));
  showFeedback(direction === 'next' ? 'Next route' : 'Previous route');
}

function dispatchZoom(scale) {
  state.zoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, scale));
  window.dispatchEvent(new CustomEvent('busstop:zoom', { detail: { scale: state.zoom } }));
  setStatus(`Zoom ${Math.round(state.zoom * 100)}%`);
}

function analyzeHand(landmarks) {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexMcp = landmarks[5];
  const indexTip = landmarks[8];
  const middleMcp = landmarks[9];
  const screenDx = -(indexTip.x - indexMcp.x);
  const screenDy = indexTip.y - indexMcp.y;
  const isHorizontalPoint = Math.abs(screenDx) > CONFIG.pointThreshold
    && Math.abs(screenDx) > Math.abs(screenDy) * 1.25
    && distance(indexTip, wrist) > distance(indexMcp, wrist) * 1.35;

  if (isHorizontalPoint) {
    state.pinchBaseline = null;
    if (!state.pointLatched) {
      state.pointLatched = true;
      dispatchRoute(screenDx < 0 ? 'next' : 'previous');
      setStatus(screenDx < 0 ? 'Point left detected' : 'Point right detected');
    }
    return;
  }

  state.pointLatched = false;
  const palmSize = Math.max(distance(wrist, middleMcp), 0.05);
  const normalizedPinch = distance(thumbTip, indexTip) / palmSize;
  if (state.pinchBaseline === null) {
    state.pinchBaseline = normalizedPinch;
    state.zoomBaseline = state.zoom;
    setStatus('Hand detected · pinch or point');
    return;
  }
  const ratio = normalizedPinch / Math.max(state.pinchBaseline, 0.15);
  const target = state.zoomBaseline * (1 + (ratio - 1) * 0.7);
  const smoothed = state.zoom * 0.72 + target * 0.28;
  if (Math.abs(smoothed - state.zoom) > 0.003) dispatchZoom(smoothed);
}

function processFrame(timestamp) {
  if (!state.active) return;
  if (elements.video.readyState >= 2
    && elements.video.currentTime !== state.lastVideoTime
    && timestamp - state.lastInferenceAt >= CONFIG.inferenceIntervalMs) {
    state.lastInferenceAt = timestamp;
    state.lastVideoTime = elements.video.currentTime;
    try {
      const result = state.landmarker.detectForVideo(elements.video, performance.now());
      const landmarks = result.landmarks?.[0];
      if (landmarks) {
        state.noHandFrames = 0;
        analyzeHand(landmarks);
      } else {
        state.noHandFrames += 1;
        if (state.noHandFrames > 5) {
          state.pinchBaseline = null;
          state.pointLatched = false;
          setStatus('Show one hand to the camera');
        }
      }
    } catch (error) {
      setStatus('Hand tracking paused · retrying');
    }
  }
  state.frameRequest = requestAnimationFrame(processFrame);
}

window.addEventListener('pagehide', stopCameraStream);
