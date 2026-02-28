// === iOS SAFARI: KILL ZOOM (pinch + gesture) ===
document.addEventListener('touchmove', (e) => {
  if (e.scale && e.scale !== 1) e.preventDefault();
}, { passive: false });

document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
document.addEventListener('DOMContentLoaded', () => {

  // =========================================================
  // === State / Playlist ===
  // =========================================================
  const PLAYLIST = [
    { type: 'video', src: 'assets/video/swip-001.mp4' },
    { type: 'video', src: 'assets/video/swip-002.mp4' },
    { type: 'video', src: 'assets/video/swip-003.mp4' },
    { type: 'video', src: 'assets/video/swip-004.mp4' },
    { type: 'video', src: 'assets/video/swip-005.mp4' },
    { type: 'video', src: 'assets/video/swip-006.mp4' },
    { type: 'video', src: 'assets/video/swip-007.mp4' },
    { type: 'video', src: 'assets/video/swip-008.mp4' },
    { type: 'video', src: 'assets/video/swip-009.mp4' }
  ];

  let layerCurrent = document.getElementById('layerCurrent');
  let layerNext    = document.getElementById('layerNext');

  let videoCurrent = document.getElementById('videoCurrent');
  let videoNext    = document.getElementById('videoNext');
  let imgCurrent   = document.getElementById('imgCurrent');
  let imgNext      = document.getElementById('imgNext');

  const seekWrap = document.getElementById('seekWrap');
  const seekPill = document.getElementById('seekPill');
  const seekFill = document.getElementById('seekFill');

  // === HARDEN VIDEO ELEMENTS FOR iOS / SMOOTHNESS ===
  [videoCurrent, videoNext].forEach(v => {
    v.preload = 'auto';
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('disablepictureinpicture', '');
    v.setAttribute('x-webkit-airplay', 'deny');
  });

  imgCurrent.decoding = 'async';
  imgNext.decoding = 'async';

  let index = 0;
  let isAnimating = false;

  let dragging = false;
  let startY = 0;
  let startX = 0;
  let dy = 0;
  let preparedDir = 0;
  let raf = 0;

  const THRESHOLD_RATIO = 0.25;
  const MOVE_ACTIVATE_PX = 10;

  // === Velocity commit (makes swipe feel "instant" without needing huge distance)
  const MIN_COMMIT_DY = 60;          // px
  const MIN_COMMIT_VY = 0.65;        // px/ms (higher = stricter)
  let startT = 0;
  let lastMoveY = 0;
  let lastMoveT = 0;

  let isMuted = true;
  let autoTimer = 0;
  let autoBoundVideo = null;

  let progRaf = 0;
  let pillTouching = false;
  let pillSeeking = false;
  let pillStartX = 0;
  let pillStartY = 0;
  let pillMoved = false;

  // === TRACK WHAT IS CURRENTLY LOADED IN NEXT LAYER (to avoid reloads during swipe) ===
  let nextLoadedIndex = null;
  let nextLoadedDir = 0; // 1 = positioned for forward, -1 = positioned for backward

  // === Prevent timeupdate listener stacking ===
  let timeupdateBoundEl = null;

  function defer(fn){
    setTimeout(fn, 0);
  }

  // =========================================================
  // === Video Engine ===
  // =========================================================
  function updateSeekFill(){
    const d = videoCurrent.duration;
    if (d && isFinite(d) && d > 0) {
      const p = Math.max(0, Math.min(1, videoCurrent.currentTime / d));
      seekFill.style.width = (p * 100) + '%';
    } else {
      seekFill.style.width = '0%';
    }
  }

  function syncSoundUI() {
    /* sound UI removed intentionally */
  }

  function ensureSoundOn(shouldPlay) {
    if (!isMuted) {
      if (shouldPlay) tryPlay(videoCurrent);
      return;
    }
    isMuted = false;
    if (PLAYLIST[index].type === 'video') {
      videoCurrent.muted = false;
      tryPlay(videoCurrent);
    }
    syncSoundUI();
  }

  function vh() {
    return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  }
  function normalizeIndex(i) {
    const len = PLAYLIST.length;
    return (i % len + len) % len;
  }
  function tryPlay(el) {
    return el.play().catch(() => {});
  }
  function isInteractiveTarget(target) {
    return !!target?.closest('button, a, input, textarea, select, label, .nav, .side, .modal, .modal-backdrop, #gateOverlay');
  }

  function clearAuto() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
    if (autoBoundVideo) {
      autoBoundVideo.onended = null;
      autoBoundVideo.onerror = null;
      autoBoundVideo = null;
    }
  }

  function stopProg() {
    if (progRaf) cancelAnimationFrame(progRaf);
    progRaf = 0;
  }

  function startProg() {
    stopProg();
    const tick = () => {
      progRaf = 0;
      const item = PLAYLIST[index];
      if (item.type !== 'video') return;

      const d = videoCurrent.duration;
      if (d && isFinite(d) && d > 0) {
        const p = Math.max(0, Math.min(1, videoCurrent.currentTime / d));
        seekFill.style.width = (p * 100) + '%';
      } else {
        seekFill.style.width = '0%';
      }
      if (!videoCurrent.paused && !videoCurrent.ended) {
        progRaf = requestAnimationFrame(tick);
      }
    };
    progRaf = requestAnimationFrame(tick);
  }

  function showSeek(show) {
    if (!seekWrap) return;
    seekWrap.style.display = show ? 'flex' : 'none';
    seekWrap.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) {
      seekFill.style.width = '0%';
      stopProg();
    }
  }

  function seekToClientX(clientX) {
    const d = videoCurrent.duration;
    if (!d || !isFinite(d) || d <= 0) return;
    const r = seekPill.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    const t = (x / r.width) * d;
    videoCurrent.currentTime = t;
    const p = Math.max(0, Math.min(1, t / d));
    seekFill.style.width = (p * 100) + '%';
  }

  function togglePlayPause() {
    const item = PLAYLIST[index];
    if (item.type !== 'video') return;
    if (videoCurrent.paused || videoCurrent.ended) {
      tryPlay(videoCurrent);
      startProg();
    } else {
      videoCurrent.pause();
      stopProg();
    }
  }

  function hideAll(layer) {
    const v = layer.querySelector('video');
    const im = layer.querySelector('img');
    v.style.display = 'none';
    im.style.display = 'none';
    im.style.opacity = '0';
    im.onload = null;
    im.onerror = null;
  }

  // =========================================================
  // === CODEC PICKER (HEVC primary, H264 fallback) ===
  // Naming rule:
  //   assets/video/swip-001.mp4        (H.264 / AVC)
  //   assets/video/swip-001-hevc.mp4   (H.265 / HEVC) [optional]
  // =========================================================
  function supportsHEVC() {
    const v = document.createElement('video');
    const can = v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
    return !!can && can !== 'no';
  }
  const USE_HEVC = supportsHEVC();

  function deriveHevcSrc(h264Src) {
    if (!h264Src || !h264Src.endsWith('.mp4')) return h264Src;
    return h264Src.replace(/\.mp4$/i, '-hevc.mp4');
  }

  function setVideoSmart(el, h264Src) {
    if (!h264Src) return;

    const hevcSrc = deriveHevcSrc(h264Src);
    const wantHevc = USE_HEVC && hevcSrc !== h264Src;

    // reset marker by default
    el.dataset.codecFallback = '0';

    const current = el.getAttribute('src') || '';
    const desired = wantHevc ? hevcSrc : h264Src;
    if (current && current.endsWith(desired)) return;

    if (wantHevc) {
      // mark: we are attempting HEVC (if it errors, autoAdvance must NOT skip)
      el.dataset.codecFallback = 'hevc_try';

      const onErr = () => {
        // We are intentionally falling back, ignore one error-triggered autoAdvance
        el.dataset.codecFallback = '1';

        const now = el.getAttribute('src') || '';
        if (!now.endsWith(h264Src)) {
          el.src = h264Src;
          el.load();
        }
      };

      el.addEventListener('error', onErr, { once: true });
      el.src = hevcSrc;
      el.load();
      return;
    }

    el.src = h264Src;
    el.load();
  }

  function setVideo(el, src) {
    setVideoSmart(el, src);
  }

  function clearVideo(el) {
    el.pause?.();
    el.removeAttribute('src');
    el.load();
  }

  function clearImage(el) {
    el.onload = null;
    el.onerror = null;
    el.style.opacity = '0';
    el.style.display = 'none';
    el.removeAttribute('src');
  }

  function setImageSafe(el, src) {
    el.onload = null;
    el.onerror = null;
    el.style.opacity = '0';
    el.style.display = 'block';

    el.onload = () => {
      el.style.opacity = '1';
    };
    el.onerror = () => {
      el.style.opacity = '0';
      el.style.display = 'none';
    };

    if (el.getAttribute('src') !== src) {
      el.src = src;
    }
  }

  // === PRIME NEXT VIDEO (BUFFER WITHOUT STEALING FPS) ===
  function primeNextVideo(v) {
    v.muted = true;
    if (v.readyState >= 3) return;
    try {
      const p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { v.pause(); }).catch(() => {});
      } else {
        v.pause();
      }
    } catch(e) {}
  }

  function setLayerContent(layer, item, forNext) {
    const v = layer.querySelector('video');
    const im = layer.querySelector('img');
    hideAll(layer);

    if (item.type === 'video') {
      im.style.display = 'none';
      v.style.display = 'block';
      v.muted = forNext ? true : isMuted;
      setVideo(v, item.src);

      if (!forNext) {
        tryPlay(v);
      } else {
        primeNextVideo(v);
      }
      return;
    } else {
      v.style.display = 'none';
      clearVideo(v);
      setImageSafe(im, item.src);
      return;
    }
  }

  function resetTransformsNoAnim() {
    const height = vh();
    layerCurrent.style.transition = 'none';
    layerNext.style.transition = 'none';
    layerCurrent.style.transform = 'translate3d(0,0,0)';
    layerNext.style.transform = `translate3d(0,${height}px,0)`;
  }

  // === ALWAYS WARM FORWARD (so touchmove doesn't trigger load/decode spikes)
  function warmForwardNext() {
    if (isAnimating || dragging) return;
    const height = vh();
    const targetIndex = normalizeIndex(index + 1);
    const item = PLAYLIST[targetIndex];

    if (nextLoadedIndex !== targetIndex) {
      setLayerContent(layerNext, item, true);
      nextLoadedIndex = targetIndex;
    } else {
      if (item.type === 'video') primeNextVideo(videoNext);
    }

    layerNext.style.transition = 'none';
    layerNext.style.transform = `translate3d(0,${height}px,0)`;
    nextLoadedDir = 1;
  }

  function prepareNextForDirection(dir) {
    const height = vh();
    const targetIndex = normalizeIndex(index + dir);
    const item = PLAYLIST[targetIndex];

    if (nextLoadedIndex !== targetIndex) {
      setLayerContent(layerNext, item, true);
      nextLoadedIndex = targetIndex;
    } else {
      if (item.type === 'video') primeNextVideo(videoNext);
    }

    layerNext.style.transition = 'none';
    layerNext.style.transform =
      dir > 0 ? `translate3d(0,${height}px,0)` : `translate3d(0,${-height}px,0)`;
    nextLoadedDir = dir;

    preparedDir = dir;
  }

  function applyDragTransforms() {
    const height = vh();
    layerCurrent.style.transform = `translate3d(0,${dy}px,0)`;

    if (preparedDir > 0) {
      layerNext.style.transform = `translate3d(0,${height + dy}px,0)`;
    } else if (preparedDir < 0) {
      layerNext.style.transform = `translate3d(0,${-height + dy}px,0)`;
    }
  }

  function bindAutoAdvanceForCurrent() {
    clearAuto();
    stopProg();

    const item = PLAYLIST[index];

    // prevent stacking listeners
    if (timeupdateBoundEl) {
      timeupdateBoundEl.removeEventListener('timeupdate', updateSeekFill);
      timeupdateBoundEl = null;
    }

    if (item.type === 'video') {
      showSeek(true);
      autoBoundVideo = videoCurrent;

      autoBoundVideo.onended = () => autoAdvance();

      autoBoundVideo.onerror = () => {
        // Ignore codec fallback errors (HEVC fail -> H264 retry)
        const flag = videoCurrent?.dataset?.codecFallback;
        if (flag === '1' || flag === 'hevc_try') {
          videoCurrent.dataset.codecFallback = '0';
          return;
        }
        autoAdvance();
      };

      autoBoundVideo.onplay = () => startProg();
      autoBoundVideo.onpause = () => stopProg();

      autoBoundVideo.onloadedmetadata = () => {
        // once we have valid metadata, clear any fallback marker
        if (videoCurrent?.dataset) videoCurrent.dataset.codecFallback = '0';
        startProg();
      };

      autoBoundVideo.onseeked = () => startProg();

      startProg();

      videoCurrent.addEventListener('timeupdate', updateSeekFill);
      timeupdateBoundEl = videoCurrent;

    } else {
      showSeek(false);
      autoTimer = setTimeout(() => autoAdvance(), 3000);
    }
  }

  // =========================================================
  // === Swipe Engine ===
  // =========================================================
  function commit(dir) {
    if (isAnimating) return;

    isAnimating = true;
    clearAuto();
    stopProg();

    const height = vh();
    const duration = 200;

    layerCurrent.style.transition = `transform ${duration}ms ease-out`;
    layerNext.style.transition    = `transform ${duration}ms ease-out`;

    layerCurrent.style.transform = `translate3d(0,${dir > 0 ? -height : height}px,0)`;
    layerNext.style.transform    = 'translate3d(0,0,0)';

    let doneOnce = false;

    const onDone = (e) => {
      if (doneOnce) return;
      if (e.propertyName !== 'transform') return;

      doneOnce = true;
      layerCurrent.removeEventListener('transitionend', onDone);

      index = normalizeIndex(index + dir);

      const tmpLayer = layerCurrent;
      layerCurrent = layerNext;
      layerNext = tmpLayer;

      const tmpV = videoCurrent;
      videoCurrent = videoNext;
      videoNext = tmpV;

      const tmpI = imgCurrent;
      imgCurrent = imgNext;
      imgNext = tmpI;

      layerNext.style.transition = 'none';
      layerNext.style.transform = `translate3d(0,${height}px,0)`;
      preparedDir = 0;

      const currentItem = PLAYLIST[index];
      if (currentItem.type === 'video') {
        videoCurrent.muted = isMuted;
        tryPlay(videoCurrent);
      }

      nextLoadedIndex = null;
      nextLoadedDir = 0;

      layerCurrent.style.transition = 'none';
      layerCurrent.style.transform = 'translate3d(0,0,0)';

      syncSoundUI();
      bindAutoAdvanceForCurrent();

      isAnimating = false;

      defer(() => {
        warmForwardNext();
      });
    };

    layerCurrent.addEventListener('transitionend', onDone);
  }

  function snapBack() {
    if (isAnimating) return;

    isAnimating = true;
    const height = vh();
    const duration = 200;

    layerCurrent.style.transition = `transform ${duration}ms ease-out`;
    layerNext.style.transition    = `transform ${duration}ms ease-out`;

    layerCurrent.style.transform = 'translate3d(0,0,0)';
    layerNext.style.transform =
      preparedDir > 0 ? `translate3d(0,${height}px,0)` :
      preparedDir < 0 ? `translate3d(0,${-height}px,0)` :
      `translate3d(0,${height}px,0)`;

    let doneOnce = false;

    const onDone = (e) => {
      if (doneOnce) return;
      if (e.propertyName !== 'transform') return;

      doneOnce = true;
      layerCurrent.removeEventListener('transitionend', onDone);

      preparedDir = 0;
      resetTransformsNoAnim();

      isAnimating = false;

      bindAutoAdvanceForCurrent();

      defer(() => {
        warmForwardNext();
      });
    };

    layerCurrent.addEventListener('transitionend', onDone);
  }

  function autoAdvance() {
    if (isAnimating || dragging) return;

    warmForwardNext();
    preparedDir = 1;

    layerCurrent.style.transition = 'none';
    layerNext.style.transition = 'none';
    layerCurrent.style.transform = 'translate3d(0,0,0)';
    layerNext.style.transform = `translate3d(0,${vh()}px,0)`;

    void layerCurrent.offsetHeight;
    commit(1);
  }

  // =========================================================
  // === UI Actions ===
  // =========================================================
  if (seekPill) {
    seekPill.addEventListener('touchstart', (e) => {
      if (PLAYLIST[index].type !== 'video') return;
      if (!e.touches || e.touches.length !== 1) return;

      ensureSoundOn(true);

      pillTouching = true;
      pillSeeking = false;
      pillMoved = false;
      pillStartX = e.touches[0].clientX;
      pillStartY = e.touches[0].clientY;
    }, { passive: true });

    seekPill.addEventListener('touchmove', (e) => {
      if (!pillTouching) return;
      if (PLAYLIST[index].type !== 'video') return;
      if (!e.touches || e.touches.length !== 1) return;

      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = x - pillStartX;
      const dy2 = y - pillStartY;

      if (!pillSeeking) {
        if (Math.abs(dx) > Math.abs(dy2) && Math.abs(dx) > 6) pillSeeking = true;
        else if (Math.abs(dy2) > Math.abs(dx) && Math.abs(dy2) > 6) { pillTouching = false; return; }
        else return;
      }

      pillMoved = true;
      e.preventDefault();
      e.stopPropagation();
      seekToClientX(x);
    }, { passive: false });

    seekPill.addEventListener('touchend', (e) => {
      if (PLAYLIST[index].type !== 'video') { pillTouching = false; pillSeeking = false; return; }
      const wasMoved = pillMoved;
      pillTouching = false;
      pillSeeking = false;
      pillMoved = false;

      if (!wasMoved) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        if (isMuted) {
          ensureSoundOn(true);
        } else {
          togglePlayPause();
        }
      }
    }, { passive: false });

    seekPill.addEventListener('click', (e) => {
      if (PLAYLIST[index].type !== 'video') return;
      if (pillMoved) return;
      e.preventDefault();

      if (isMuted) {
        ensureSoundOn(true);
      } else {
        togglePlayPause();
      }
    });
  }

  if (layerCurrent) {
    layerCurrent.addEventListener('click', (e) => {
      if (isInteractiveTarget(e.target)) return;
      if (PLAYLIST[index].type !== 'video') return;

      if (isMuted) {
        ensureSoundOn(true);
      } else {
        togglePlayPause();
      }
    });
  }

  function initFirst() {
    isMuted = true;
    syncSoundUI();

    setLayerContent(layerCurrent, PLAYLIST[index], false);
    resetTransformsNoAnim();

    defer(() => {
      warmForwardNext();
    });

    bindAutoAdvanceForCurrent();
  }

  document.addEventListener('touchstart', (e) => {
    if (isAnimating) return;
    if (e.touches.length !== 1) return;
    if (isInteractiveTarget(e.target)) return;

    ensureSoundOn(true);

    dragging = true;
    preparedDir = 0;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    dy = 0;

    startT = performance.now();
    lastMoveT = startT;
    lastMoveY = startY;

    clearAuto();
    stopProg();

    layerCurrent.style.transition = 'none';
    layerNext.style.transition = 'none';

    warmForwardNext();
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!dragging || isAnimating) return;
    if (e.touches.length !== 1) return;

    const y = e.touches[0].clientY;
    const x = e.touches[0].clientX;
    const ddy = y - startY;
    const ddx = x - startX;

    if (Math.abs(ddx) > Math.abs(ddy)) return;
    if (Math.abs(ddy) < MOVE_ACTIVATE_PX) return;

    e.preventDefault();
    dy = ddy;

    const now = performance.now();
    lastMoveT = now;
    lastMoveY = y;

    const dir = dy < 0 ? 1 : -1;

    prepareNextForDirection(dir);

    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyDragTransforms();
      });
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!dragging || isAnimating) return;
    dragging = false;

    if (preparedDir === 0) { dy = 0; bindAutoAdvanceForCurrent(); return; }

    const height = vh();
    const threshold = Math.round(height * THRESHOLD_RATIO);

    const endT = performance.now();
    const dt = Math.max(1, endT - startT);
    const vy = (lastMoveY - startY) / dt; // px/ms (positive = down, negative = up)
    const vAbs = Math.abs(vy);

    const distanceOK = Math.abs(dy) >= threshold;
    const velocityOK = (Math.abs(dy) >= MIN_COMMIT_DY) && (vAbs >= MIN_COMMIT_VY);

    if (distanceOK || velocityOK) commit(preparedDir);
    else snapBack();

    dy = 0;
  }, { passive: true });

  initFirst();

  const profileBtn    = document.getElementById('profileBtn');
  const profileModal  = document.getElementById('profileModal');
  const closeProfile  = document.getElementById('closeProfile');
  const avatarBtn     = document.getElementById('avatarBtn');

  function openProfile(){ profileModal.classList.add('show'); }
  function closeProfileFn(){ profileModal.classList.remove('show'); }

  if (profileBtn)   profileBtn.addEventListener('click', openProfile);
  if (avatarBtn)    avatarBtn.addEventListener('click', openProfile);
  if (closeProfile) closeProfile.addEventListener('click', closeProfileFn);
  if (profileModal) {
    profileModal.addEventListener('click', (e) => {
      if (e.target === profileModal) closeProfileFn();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (profileModal && profileModal.classList.contains('show')) closeProfileFn();
    }
  });

  // =========================================================
  // === Age Gate Storage ===
  // =========================================================
  const KEY = "swipe_age_ok";
  const gate = document.getElementById('gateOverlay');
  const enterBtn = document.getElementById('enterBtn');

  function hideGate(){
    if (!gate) return;
    gate.classList.add('hidden');
  }
  function showGate(){
    if (!gate) return;
    gate.classList.remove('hidden');
  }

  try {
    if (localStorage.getItem(KEY) === "1") { hideGate(); startUiArrowLoop(); }
    else showGate();
  } catch(e) { showGate(); }

  if (enterBtn) {
    enterBtn.addEventListener('click', function(){
      try { localStorage.setItem(KEY, "1"); } catch(e) {}
      this.textContent = "ENTERED";
      this.disabled = true;
      this.style.opacity = "0.75";
      hideGate();
      kickUiArrowSpin();
    });
  }
});

const likeBtn = document.getElementById('likeBtn');
const likeIcon = document.getElementById('likeIcon');

let liked = false;

likeBtn.addEventListener('click', () => {
  liked = !liked;

  likeIcon.classList.add('pop');
  setTimeout(() => likeIcon.classList.remove('pop'), 120);

  likeIcon.className = liked
    ? 'ph-fill ph-heart liked'
    : 'ph-fill ph-heart';
});

(function(){
  const logo = document.querySelector('img.logo');
  if(!logo) return;

  const kill = (e) => { e.preventDefault(); e.stopPropagation(); return false; };

  logo.addEventListener('contextmenu', kill, { passive:false });
  logo.addEventListener('touchstart',  kill, { passive:false });
  logo.addEventListener('touchend',    kill, { passive:false });
  logo.addEventListener('touchmove',   kill, { passive:false });
})();

// SHARE BUTTON (viral engine)
const shareBtn = document.querySelector('[aria-label="Share"]');

if (shareBtn && navigator.share) {
  shareBtn.addEventListener('click', () => {
    navigator.share({
      title: 'Fik.Porn',
      text: 'Watch this',
      url: 'https://fik.porn/'
    });
  });
}
// =========================================================
// UI TOGGLE ARROW — click only (no loop)
// =========================================================
const uiToggle = document.getElementById("uiToggle");

function kickUiArrowSpin(){
  if(!uiToggle) return;

  // restart animace (opakovaně na klik)
  uiToggle.classList.remove("spin");
  void uiToggle.offsetWidth; // force reflow
  uiToggle.classList.add("spin");
}

if (uiToggle) {
  uiToggle.addEventListener("click", kickUiArrowSpin);
}

