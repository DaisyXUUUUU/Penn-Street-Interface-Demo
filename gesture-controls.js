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
  poseCandidate: null,
  poseStartedAt: 0,
  poseLatched: false,
  frozen: false,
  fistFrames: 0,
  fistReleaseFrames: 0,
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
      <p class="gesture-help">Pinch: zoom · point: routes · C: speak · fist: hold · open palm: overview</p>
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
  state.poseCandidate = null;
  state.poseStartedAt = 0;
  state.poseLatched = false;
  state.frozen = false;
  state.fistFrames = 0;
  state.fistReleaseFrames = 0;
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

function fingerExtended(landmarks, tip, pip, mcp, wrist) {
  return distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) * 1.12
    && distance(landmarks[tip], landmarks[mcp]) > distance(landmarks[pip], landmarks[mcp]) * 1.08;
}

function holdPose(name, duration, onReady) {
  const now = performance.now();
  if (state.poseCandidate !== name) {
    state.poseCandidate = name;
    state.poseStartedAt = now;
    state.poseLatched = false;
  }
  if (!state.poseLatched && now - state.poseStartedAt >= duration) {
    state.poseLatched = true;
    onReady();
  }
}

function clearHeldPose() {
  state.poseCandidate = null;
  state.poseStartedAt = 0;
  state.poseLatched = false;
}

function analyzeHand(landmarks) {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexMcp = landmarks[5];
  const indexTip = landmarks[8];
  const middleMcp = landmarks[9];
  const palmSize = Math.max(distance(wrist, middleMcp), 0.05);
  const fingerJoints = [
    [8, 6, 5],
    [12, 10, 9],
    [16, 14, 13],
    [20, 18, 17]
  ];
  const extended = fingerJoints.map(([tip, pip, mcp]) =>
    fingerExtended(landmarks, tip, pip, mcp, wrist));
  const folded = fingerJoints.map(([tip, pip]) =>
    distance(landmarks[tip], wrist) < distance(landmarks[pip], wrist) * 1.08);
  const extendedCount = extended.filter(Boolean).length;
  const foldedCount = folded.filter(Boolean).length;
  const normalizedPinch = distance(thumbTip, indexTip) / palmSize;
  const thumbSpread = distance(thumbTip, indexMcp) / palmSize;
  const screenDx = -(indexTip.x - indexMcp.x);
  const screenDy = indexTip.y - indexMcp.y;
  const isHorizontalPoint = Math.abs(screenDx) > CONFIG.pointThreshold
    && Math.abs(screenDx) > Math.abs(screenDy) * 1.25
    && distance(indexTip, wrist) > distance(indexMcp, wrist) * 1.35;
  const isFist = foldedCount >= 3 && thumbSpread < 1.15;
  const isOpenPalm = extendedCount === 4 && normalizedPinch > 0.55;
  const curvedFingerCount = fingerJoints.filter(([tip, pip, mcp]) => {
    const reach = distance(landmarks[tip], landmarks[mcp]) / palmSize;
    const curl = distance(landmarks[tip], wrist) / Math.max(distance(landmarks[pip], wrist), 0.02);
    return reach > 0.38 && curl < 1.28;
  }).length;
  const isCShape = !isOpenPalm && !isFist && !isHorizontalPoint
    && normalizedPinch > 0.42 && normalizedPinch < 1.25
    && curvedFingerCount >= 3;

  if (isFist) {
    state.fistFrames += 1;
    state.fistReleaseFrames = 0;
    state.pinchBaseline = null;
    clearHeldPose();
    if (state.fistFrames >= 3 && !state.frozen) {
      state.frozen = true;
      showFeedback('Controls held');
    }
    setStatus('Fist detected · controls held');
    return;
  }

  state.fistFrames = 0;
  if (state.frozen) {
    state.fistReleaseFrames += 1;
    if (state.fistReleaseFrames < 4) return;
    state.frozen = false;
    state.fistReleaseFrames = 0;
    state.pinchBaseline = null;
    showFeedback('Controls resumed');
    setStatus('Controls resumed');
    return;
  }

  if (isOpenPalm) {
    state.pinchBaseline = null;
    state.pointLatched = false;
    setStatus('Hold open palm for route overview');
    holdPose('open-palm', 650, () => {
      window.dispatchEvent(new CustomEvent('busstop:overview-toggle'));
      showFeedback('Route overview');
      setStatus('Open palm detected');
    });
    return;
  }

  if (isHorizontalPoint) {
    state.pinchBaseline = null;
    clearHeldPose();
    if (!state.pointLatched) {
      state.pointLatched = true;
      dispatchRoute(screenDx < 0 ? 'next' : 'previous');
      setStatus(screenDx < 0 ? 'Point left detected' : 'Point right detected');
    }
    return;
  }

  state.pointLatched = false;
  if (isCShape) {
    state.pinchBaseline = null;
    setStatus('Hold C shape to hear this route');
    holdPose('c-shape', 850, () => {
      window.dispatchEvent(new CustomEvent('busstop:announce-request'));
      showFeedback('Speaking once');
      setStatus('C shape detected · speaking');
    });
    return;
  }

  clearHeldPose();
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
          resetGestureState();
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
