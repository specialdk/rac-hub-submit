/* RAC Hub Submit — phone-first PWA.
   Single-page app with conditional rendering between screens. No router,
   no framework. State lives in `state` and a few localStorage keys. */

const API = (window.RAC_CONFIG && window.RAC_CONFIG.apiBase) || 'http://localhost:3000';

const DESTINATIONS = [
  'General',
  'CEO Messages',
  'Business Messages',
  'Operations Messages',
  'Community Messages',
  'Safety Messages',
];

const TEXT_MIN = 10;
const TEXT_MAX = 1000;

// Web Speech API feature detection. Both names exist in the wild —
// webkitSpeechRecognition on iOS Safari and older Chrome, SpeechRecognition
// in the modern spec. If neither is present we hide the dictation button
// entirely (graceful degradation — typing still works).
const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;
const SPEECH_SUPPORTED = !!SpeechRecognitionImpl;
let recognition = null;
let recognitionActive = false;
// 10 total = banner + up to 9 body. The backend will accept up to 11
// (banner + 10) as a safety net plus a 20 MB total-bytes cap, but the
// PWA enforces a tighter, user-friendly count cap. Post-resize totals
// are tiny (typically a few hundred KB per photo) so byte-count
// gating client-side adds confusion without value.
const MAX_PHOTOS = 10;

/* ---- LocalStorage helpers ---- */
const LS_PIN = 'rac_hub_pin';
const LS_NAME = 'rac_hub_user_name';
const LS_EMAIL = 'rac_hub_user_email';
const LS_ROLE = 'rac_hub_user_role';

function loadUser() {
  const pin = localStorage.getItem(LS_PIN);
  if (!pin) return null;
  return {
    pin,
    name: localStorage.getItem(LS_NAME) || '',
    email: localStorage.getItem(LS_EMAIL) || '',
    role: localStorage.getItem(LS_ROLE) || 'User',
  };
}

function saveUser(u) {
  localStorage.setItem(LS_PIN, u.pin);
  localStorage.setItem(LS_NAME, u.name || '');
  localStorage.setItem(LS_EMAIL, u.email || '');
  localStorage.setItem(LS_ROLE, u.role || 'User');
}

function clearUser() {
  localStorage.removeItem(LS_PIN);
  localStorage.removeItem(LS_NAME);
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_ROLE);
}

/* ---- App state ---- */
const state = {
  screen: 'signin',
  user: null,
  form: {
    destination: 'General',
    text: '',
    title: '',
    highlight: '',
    files: [], // Array of File objects in selection order; [0] is banner
  },
  signinError: null,
  submitError: null,
  submitProgress: null, // 'resizing' | 'uploading' | 'done' | null
  lastFolderName: null,
  recent: {
    loading: false,
    error: null,
    items: null, // null = not yet loaded; [] = loaded but empty
    loadedAt: null,
    limit: 10, // current page size (10 default, 30 when "Show older" tapped)
    total: null, // total count returned by backend, used to show/hide Show older
  },
  // Admin-only state slices (only populated when state.user.role === 'Admin')
  adminQueue: {
    loading: false,
    error: null,
    items: null, // null = not yet loaded
    count: 0,
  },
  review: {
    loading: false,
    error: null,
    errorCode: null, // for special handling of NOT_FOUND deep links
    data: null,
    destination: null,
    rowNumber: null,
    acting: false, // true while approve/reject/edit in flight
    rejecting: false, // true when the reject reason form is open
    editing: false, // true when the edit form is open
    editValues: null, // { title, highlight, text } — only while editing
  },
  toast: null, // transient banner shown at the top of any screen
};

let toastTimer = null;
function setToast(text) {
  state.toast = text;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, 3500);
}

/* ---- Render entry ---- */
const root = document.getElementById('app');

// Live badge polling — runs only while an Admin user is on the Submit screen.
// Off in every other state (signed out, on review/queue/recent/submitting).
const PENDING_POLL_MS = 30_000;
let pendingPollTimer = null;

function clearPendingPoll() {
  if (pendingPollTimer) {
    clearInterval(pendingPollTimer);
    pendingPollTimer = null;
  }
}

function ensurePendingPoll() {
  if (pendingPollTimer) return;
  pendingPollTimer = setInterval(() => {
    if (state.user && state.user.role === 'Admin' && state.screen === 'submit') {
      fetchPendingCount();
    }
  }, PENDING_POLL_MS);
}

function render() {
  // Manage admin badge polling lifecycle from the single render() entry point
  // so we don't have to plumb start/stop calls through every navigation handler.
  if (state.user && state.user.role === 'Admin' && state.screen === 'submit') {
    ensurePendingPoll();
  } else {
    clearPendingPoll();
  }

  // Stop dictation if we're navigating off the submit screen — the mic
  // button and textarea are about to disappear, so the recogniser would
  // be running with no UI. Tapping Submit also triggers this naturally.
  if (state.screen !== 'submit' && recognitionActive) {
    recognitionActive = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
    }
  }

  switch (state.screen) {
    case 'signin':
      renderSignIn();
      break;
    case 'submit':
      renderSubmit();
      break;
    case 'preview':
      renderPreview();
      break;
    case 'submitting':
      renderSubmitting();
      break;
    case 'recent':
      renderRecent();
      break;
    case 'queue':
      renderQueue();
      break;
    case 'review':
      renderReview();
      break;
    default:
      root.innerHTML = '';
  }
}

// Toast banner — call from any screen's render to inject the current toast.
function toastHtml() {
  return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : '';
}

/* ---- Screen: sign in ---- */
function renderSignIn() {
  root.innerHTML = `
    <div class="signin">
      <div class="wordmark">
        <span class="wordmark__rac">RAC</span><span class="wordmark__hub">Hub</span>
      </div>
      <h1>Sign in</h1>
      <p class="lead">Enter your PIN to submit a story to the Hub.</p>
      <form id="signin-form" novalidate>
        <div class="field">
          <label class="field__label" for="pin">Your PIN</label>
          <input
            id="pin"
            class="pin-input"
            type="password"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            autofocus
            required
          />
        </div>
        <div id="signin-error"></div>
        <button id="signin-btn" class="btn" type="submit">Sign in</button>
      </form>
    </div>
  `;

  const errBox = document.getElementById('signin-error');
  if (state.signinError) {
    errBox.innerHTML = `<div class="error">${escapeHtml(state.signinError)}</div>`;
  }

  document.getElementById('signin-form').addEventListener('submit', onSignInSubmit);
}

async function onSignInSubmit(e) {
  e.preventDefault();
  const pin = document.getElementById('pin').value.trim();
  const btn = document.getElementById('signin-btn');

  if (!/^\d+$/.test(pin)) {
    state.signinError = 'PIN must be numeric.';
    render();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  state.signinError = null;

  try {
    const resp = await fetch(API + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      state.signinError = errorMessageFor(data.error, resp.status);
      render();
      return;
    }
    const user = { pin, name: data.name, email: data.email, role: data.role };
    saveUser(user);
    state.user = user;
    state.screen = 'submit';
    render();
    if (user.role === 'Admin') fetchPendingCount();
  } catch (err) {
    state.signinError = 'Could not reach the server. Check your connection.';
    render();
  }
}

/* ---- Screen: submit ---- */
function renderSubmit() {
  const u = state.user;
  const form = state.form;
  const charCount = form.text.length;
  const overLimit = charCount > TEXT_MAX;
  const canSubmit =
    !!u &&
    DESTINATIONS.includes(form.destination) &&
    charCount >= TEXT_MIN &&
    !overLimit &&
    form.files.length >= 1;

  const isAdmin = u.role === 'Admin';
  const queueCount = state.adminQueue.count;

  root.innerHTML = `
    ${toastHtml()}
    <div class="topbar">
      <div class="topbar__greeting">Hi, ${escapeHtml(u.name || 'there')}</div>
      <button class="topbar__signout" type="button" id="signout-btn">Sign out</button>
    </div>

    ${
      isAdmin
        ? `<button class="admin-banner${queueCount === 0 ? ' admin-banner--empty' : ''}" type="button" id="queue-btn">
            <strong>${queueCount}</strong>
            <span>${queueCount === 0 ? 'all stories reviewed' : queueCount === 1 ? 'story waiting your approval' : 'stories waiting your approval'}</span>
            <span class="admin-banner__chevron">→</span>
          </button>`
        : ''
    }

    <h1>Submit a story</h1>
    <p class="lead">Share what's happening so it can go on the Hub.</p>

    <form id="submit-form" novalidate>
      <div class="field">
        <label class="field__label" for="destination">Destination</label>
        <select id="destination" name="destination">
          ${DESTINATIONS.map(
            (d) =>
              `<option value="${escapeAttr(d)}"${form.destination === d ? ' selected' : ''}>${escapeHtml(d)}</option>`,
          ).join('')}
        </select>
      </div>

      <div class="field">
        <div class="field__label-row">
          <label class="field__label" for="text">Your story</label>
          ${
            SPEECH_SUPPORTED
              ? `<button class="mic-btn" type="button" id="mic-btn" aria-label="Start dictation">
                  <span class="mic-btn__icon" aria-hidden="true">🎤</span>
                  <span class="mic-btn__label">Dictate</span>
                </button>`
              : ''
          }
        </div>
        <textarea
          id="text"
          name="text"
          placeholder="What happened? Tell the story… or tap Dictate to speak it."
          maxlength="${TEXT_MAX + 200}"
        >${escapeHtml(form.text)}</textarea>
        ${SPEECH_SUPPORTED ? '<div class="mic-status" id="mic-status" aria-live="polite"></div>' : ''}
        <div class="field__count${overLimit ? ' field__count--over' : ''}">
          ${charCount} / ${TEXT_MAX}${charCount < TEXT_MIN ? ` · ${TEXT_MIN - charCount} more to go` : ''}
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="title">Title <span class="field__hint">(optional)</span></label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder="Leave blank to auto-generate"
          value="${escapeAttr(form.title)}"
        />
      </div>

      <div class="field">
        <label class="field__label" for="highlight">Highlight <span class="field__hint">(optional)</span></label>
        <input
          id="highlight"
          name="highlight"
          type="text"
          placeholder="Leave blank to auto-generate. One short line."
          value="${escapeAttr(form.highlight)}"
        />
      </div>

      <div class="field">
        <span class="field__label">Photos</span>
        <div class="photo-picker${form.files.length >= MAX_PHOTOS ? ' photo-picker--disabled' : ''}">
          <div class="photo-picker__icon">📷</div>
          <div><strong>Add photos</strong></div>
          <span class="photo-picker__hint">First photo is the banner.</span>
          <div class="photo-picker__buttons">
            <label class="photo-picker__btn">
              <span class="photo-picker__btn-icon" aria-hidden="true">📸</span>
              <span>Take photo</span>
              <input
                id="photos-camera"
                class="photo-picker__input"
                type="file"
                accept="image/*"
                capture="environment"
                ${form.files.length >= MAX_PHOTOS ? 'disabled' : ''}
              />
            </label>
            <label class="photo-picker__btn">
              <span class="photo-picker__btn-icon" aria-hidden="true">🖼️</span>
              <span>From library</span>
              <input
                id="photos-library"
                class="photo-picker__input"
                type="file"
                accept="image/*"
                multiple
                ${form.files.length >= MAX_PHOTOS ? 'disabled' : ''}
              />
            </label>
          </div>
        </div>
        <p class="photo-picker__tip">
          Maximum ${MAX_PHOTOS} photos per story. For best banner display, frame the most important part of your first photo near the centre.
        </p>
        <div class="photo-grid" id="photo-grid">
          ${renderPhotoCards(form.files)}
        </div>
      </div>

      <div id="submit-error"></div>

      <button id="submit-btn" class="btn" type="submit"${canSubmit ? '' : ' disabled'}>
        Preview
      </button>
    </form>

    <p class="bottom-link">
      <button class="link-btn" type="button" id="view-recent-btn">View my recent submissions</button>
    </p>
  `;

  if (state.submitError) {
    document.getElementById('submit-error').innerHTML =
      `<div class="error">${escapeHtml(state.submitError)}</div>`;
  }

  // Wire events
  document.getElementById('signout-btn').addEventListener('click', onSignOut);
  document.getElementById('destination').addEventListener('change', (e) => {
    state.form.destination = e.target.value;
  });
  document.getElementById('text').addEventListener('input', (e) => {
    state.form.text = e.target.value;
    refreshSubmitDisabled();
  });
  document.getElementById('title').addEventListener('input', (e) => {
    state.form.title = e.target.value;
  });
  document.getElementById('highlight').addEventListener('input', (e) => {
    state.form.highlight = e.target.value;
  });
  document.querySelectorAll('.photo-picker__input').forEach((input) => {
    input.addEventListener('change', onPhotosPicked);
  });
  document.getElementById('photo-grid').addEventListener('click', onPhotoControl);
  document.getElementById('submit-form').addEventListener('submit', onPreview);
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.addEventListener('click', toggleDictation);
  document.getElementById('view-recent-btn').addEventListener('click', () => {
    state.screen = 'recent';
    render();
    // Auto-fetch on first open if we haven't loaded yet
    if (state.recent.items === null && !state.recent.loading) {
      fetchRecentSubmissions();
    }
  });
  if (isAdmin) {
    document.getElementById('queue-btn').addEventListener('click', () => {
      state.screen = 'queue';
      render();
      if (state.adminQueue.items === null && !state.adminQueue.loading) {
        fetchPendingQueue();
      }
    });
  }
}

function renderPhotoCards(files) {
  if (!files.length) return '';
  const last = files.length - 1;
  return files
    .map((f, i) => {
      const url = URL.createObjectURL(f);
      const label = i === 0 ? 'Banner' : `Photo ${i + 1}`;
      const labelCls =
        i === 0 ? 'photo-card__label photo-card__label--banner' : 'photo-card__label';
      return `
        <div class="photo-card" data-idx="${i}">
          <img src="${url}" alt="${escapeAttr(label)}" />
          <span class="${labelCls}">${label}</span>
          <button
            type="button"
            class="photo-card__btn photo-card__btn--remove"
            data-action="remove"
            data-idx="${i}"
            aria-label="Remove ${escapeAttr(label)}"
          >✕</button>
          <div class="photo-card__moves">
            <button
              type="button"
              class="photo-card__btn photo-card__btn--move"
              data-action="left"
              data-idx="${i}"
              aria-label="Move ${escapeAttr(label)} left"
              ${i === 0 ? 'disabled' : ''}
            >◀</button>
            <button
              type="button"
              class="photo-card__btn photo-card__btn--move"
              data-action="right"
              data-idx="${i}"
              aria-label="Move ${escapeAttr(label)} right"
              ${i === last ? 'disabled' : ''}
            >▶</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function onPhotoControl(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx, 10);
  const action = btn.dataset.action;
  const files = state.form.files;
  if (Number.isNaN(idx) || idx < 0 || idx >= files.length) return;

  if (action === 'remove') {
    files.splice(idx, 1);
  } else if (action === 'left' && idx > 0) {
    [files[idx - 1], files[idx]] = [files[idx], files[idx - 1]];
  } else if (action === 'right' && idx < files.length - 1) {
    [files[idx], files[idx + 1]] = [files[idx + 1], files[idx]];
  } else {
    return;
  }
  document.getElementById('photo-grid').innerHTML = renderPhotoCards(files);
  refreshPickerCap();
  refreshSubmitDisabled();
}

// Toggle the picker between enabled and disabled states based on file
// count. Called when files are added or removed without a full re-render
// of the form (full re-renders would clobber textarea cursor state).
function refreshPickerCap() {
  const picker = document.querySelector('.photo-picker');
  const inputs = document.querySelectorAll('.photo-picker__input');
  if (!picker || !inputs.length) return;
  const atCap = state.form.files.length >= MAX_PHOTOS;
  picker.classList.toggle('photo-picker--disabled', atCap);
  inputs.forEach((input) => {
    input.disabled = atCap;
  });
}

/* ---- Speech-to-text dictation -------------------------------------------
   Web Speech API → SpeechRecognition / webkitSpeechRecognition. Browser
   prompts for mic permission on first use, then runs through the system's
   built-in speech engine (Siri on iOS, Google's on Android Chrome).

   Continuous mode keeps the recogniser running across natural pauses.
   Some browsers (notably Chrome) end the session after extended silence
   even in continuous mode — onend auto-restarts while the user-facing
   "is dictating?" flag is still true, so a single tap-to-start works for
   long dictations.

   Final transcripts are appended to whatever's currently in the textarea
   with a single space separator. Since JS-driven value changes don't fire
   the 'input' event, we update state.form.text and refresh the submit
   button manually.
*/
function setMicStatus(text) {
  const el = document.getElementById('mic-status');
  if (el) el.textContent = text;
}

function ensureRecognition() {
  if (recognition || !SPEECH_SUPPORTED) return recognition;
  recognition = new SpeechRecognitionImpl();
  // iOS Safari and Chrome handle continuous mode differently. iOS often
  // returns no results when continuous=true. One-shot sessions plus an
  // auto-restart on end gives the same "keeps listening" feeling and
  // works on both. interimResults=true lets us show partial transcription
  // as the engine works — also helps surface "is anything happening?"
  // for the user, especially on iOS where the round-trip can be slow.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-AU';

  let gotAnyFinalThisSession = false;

  recognition.onstart = () => {
    setMicStatus('Listening… speak now');
    gotAnyFinalThisSession = false;
  };

  recognition.onspeechstart = () => {
    setMicStatus('Hearing you…');
  };

  recognition.onresult = (event) => {
    const textarea = document.getElementById('text');
    if (!textarea) return;
    let final = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }
    final = final.trim();
    if (final) {
      gotAnyFinalThisSession = true;
      const current = textarea.value;
      const sep = current && !/\s$/.test(current) ? ' ' : '';
      textarea.value = current + sep + final;
      state.form.text = textarea.value;
      refreshSubmitDisabled();
      setMicStatus(recognitionActive ? 'Listening…' : '');
    } else if (interim.trim()) {
      setMicStatus(`… ${interim.trim()}`);
    }
  };

  recognition.onnomatch = () => {
    setMicStatus("Couldn't make that out — try again.");
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      recognitionActive = false;
      updateMicButton(false);
      setMicStatus('Microphone blocked. Check browser settings.');
    } else if (event.error === 'audio-capture') {
      recognitionActive = false;
      updateMicButton(false);
      setMicStatus('No mic detected. Check your device.');
    } else if (event.error === 'no-speech') {
      // Quiet error — user just paused. onend will restart.
    } else if (event.error === 'aborted') {
      // We called stop(); benign.
    } else {
      console.warn('Speech recognition error:', event.error);
      setMicStatus(`Error: ${event.error}. You can keep typing.`);
    }
  };

  recognition.onend = () => {
    if (recognitionActive) {
      // Auto-restart after a small delay — iOS needs the previous session
      // to fully release before a new start() will work.
      setTimeout(() => {
        if (recognitionActive) {
          try {
            recognition.start();
          } catch (err) {
            recognitionActive = false;
            updateMicButton(false);
            setMicStatus("Stopped (couldn't restart). Tap Dictate to resume.");
          }
        }
      }, 250);
    } else {
      updateMicButton(false);
      if (!gotAnyFinalThisSession) {
        setMicStatus(
          "No transcription captured. Try speaking louder, or use the " +
            "microphone button on your phone keyboard instead.",
        );
      } else {
        setMicStatus('');
      }
    }
  };

  return recognition;
}

function toggleDictation() {
  if (!SPEECH_SUPPORTED) return;
  ensureRecognition();
  if (recognitionActive) {
    recognitionActive = false;
    try {
      recognition.stop();
    } catch {}
    updateMicButton(false);
  } else {
    recognitionActive = true;
    try {
      recognition.start();
      updateMicButton(true);
    } catch (err) {
      // Safari throws if start is called while already started — flip state to match
      recognitionActive = false;
      updateMicButton(false);
      console.warn('Could not start dictation:', err);
    }
  }
}

function updateMicButton(active) {
  const btn = document.getElementById('mic-btn');
  if (!btn) return;
  btn.classList.toggle('mic-btn--active', active);
  btn.setAttribute('aria-label', active ? 'Stop dictation' : 'Start dictation');
  const labelEl = btn.querySelector('.mic-btn__label');
  const iconEl = btn.querySelector('.mic-btn__icon');
  if (labelEl) labelEl.textContent = active ? 'Stop' : 'Dictate';
  if (iconEl) iconEl.textContent = active ? '⏹' : '🎤';
}

function refreshSubmitDisabled() {
  const charCount = state.form.text.length;
  const canSubmit =
    state.user &&
    DESTINATIONS.includes(state.form.destination) &&
    charCount >= TEXT_MIN &&
    charCount <= TEXT_MAX &&
    state.form.files.length >= 1;
  const btn = document.getElementById('submit-btn');
  if (btn) btn.disabled = !canSubmit;

  const count = document.querySelector('.field__count');
  if (count) {
    count.textContent =
      `${charCount} / ${TEXT_MAX}` +
      (charCount < TEXT_MIN ? ` · ${TEXT_MIN - charCount} more to go` : '');
    count.classList.toggle('field__count--over', charCount > TEXT_MAX);
  }
}

function onPhotosPicked(e) {
  // Append newly-picked files to the current list. Cap total at MAX_PHOTOS;
  // anything past that is silently dropped (the picker will already prevent
  // a single user pick from going wild — this guards against multiple picks).
  const picked = Array.from(e.target.files || []);
  if (!picked.length) return;
  const room = Math.max(0, MAX_PHOTOS - state.form.files.length);
  state.form.files = state.form.files.concat(picked.slice(0, room));
  // Reset input so picking the same filename again still fires `change`
  e.target.value = '';
  document.getElementById('photo-grid').innerHTML = renderPhotoCards(state.form.files);
  refreshPickerCap();
  refreshSubmitDisabled();
}

function onSignOut() {
  clearUser();
  state.user = null;
  state.form = { destination: 'General', text: '', title: '', highlight: '', files: [] };
  state.signinError = null;
  state.submitError = null;
  state.recent = { loading: false, error: null, items: null, loadedAt: null, limit: 10, total: null };
  state.adminQueue = { loading: false, error: null, items: null, count: 0 };
  state.review = freshReviewState();
  state.toast = null;
  state.screen = 'signin';
  render();
}

// Form-submit handler from the Submit screen. Validates and transitions
// to the preview screen instead of starting the upload directly. Submitter
// reviews on the preview screen, then taps Submit there to actually upload.
function onPreview(e) {
  e.preventDefault();
  if (!state.user) return;
  const f = state.form;
  if (f.text.length < TEXT_MIN || f.text.length > TEXT_MAX || f.files.length < 1) return;
  state.submitError = null;
  state.screen = 'preview';
  render();
}

// Triggered from the preview screen's Submit button. Confirms intent and
// runs the actual upload pipeline.
async function confirmSubmit() {
  await performSubmit();
}

async function performSubmit() {
  if (!state.user) return;
  const f = state.form;
  if (f.text.length < TEXT_MIN || f.text.length > TEXT_MAX || f.files.length < 1) return;

  state.screen = 'submitting';
  state.submitProgress = 'resizing';
  state.submitError = null;
  render();

  // Resize, re-orient, and strip EXIF on the device. Run in parallel —
  // for the typical 1-3 photo case this is fast; even with 11 photos it
  // stays under a few seconds on a modern phone.
  let processed;
  try {
    processed = await Promise.all(f.files.map((file) => RAC_PHOTOS.processImage(file)));
  } catch (err) {
    state.submitError =
      'Could not process one of your photos. Try removing it or picking a different image.';
    state.screen = 'submit';
    render();
    return;
  }

  state.submitProgress = 'uploading';
  render();

  const fd = new FormData();
  fd.append('pin', state.user.pin);
  fd.append('destination', f.destination);
  fd.append('text', f.text);
  fd.append('submitted_at', localISOString());
  if (f.title.trim()) fd.append('title_suggestion', f.title.trim());
  if (f.highlight.trim()) fd.append('highlight_suggestion', f.highlight.trim());
  // Always send banner + body_N as JPEGs (canvas exports JPEG regardless of input)
  fd.append('banner', processed[0], 'banner.jpg');
  for (let i = 1; i < processed.length && i <= 10; i++) {
    fd.append(`body_${i}`, processed[i], `body-${i}.jpg`);
  }

  try {
    const resp = await fetch(API + '/submit', { method: 'POST', body: fd });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      state.submitError = errorMessageFor(data.error, resp.status);
      state.screen = 'submit';
      render();
      return;
    }
    state.lastFolderName = data.folder_name;
    state.submitProgress = 'done';
    state.form = { destination: 'General', text: '', title: '', highlight: '', files: [] };
    render();
  } catch (err) {
    state.submitError = 'Could not reach the server. Check your connection and try again.';
    state.screen = 'submit';
    render();
  }
}

/* ---- Screen: preview before submit ----
   Read-only render of what the submitter is about to submit. Lets them
   check title, highlight, body text, photos, and destination once before
   committing. Two actions: Edit (back to the form, all values preserved
   in state.form) or Submit (proceeds with the actual upload pipeline).

   Photos render with object URLs from the local File objects — the same
   resize/EXIF/strip pipeline still runs at upload time, but for the
   preview we just show the raw images at a comfortable size. */
function renderPreview() {
  const u = state.user;
  const f = state.form;

  const titleHtml = f.title.trim()
    ? `<h2 class="preview-card__title">${escapeHtml(f.title.trim())}</h2>`
    : `<h2 class="preview-card__title preview-card__placeholder">(Title will be auto-generated)</h2>`;

  const highlightHtml = f.highlight.trim()
    ? `<p class="preview-card__highlight">${escapeHtml(f.highlight.trim())}</p>`
    : `<p class="preview-card__highlight preview-card__placeholder">(Highlight will be auto-generated)</p>`;

  const photosHtml = f.files.length
    ? `<div class="preview-photos">
        ${f.files
          .map((file, i) => {
            const url = URL.createObjectURL(file);
            const label = i === 0 ? 'Banner' : `Photo ${i + 1}`;
            const cls = i === 0 ? 'preview-photo preview-photo--banner' : 'preview-photo';
            return `
              <figure class="${cls}">
                <img src="${url}" alt="${escapeAttr(label)}" />
                <figcaption>${label}</figcaption>
              </figure>`;
          })
          .join('')}
      </div>`
    : '';

  // Render body as paragraphs split on blank lines, mirroring how the
  // skill will produce the final ContentDescription.
  const bodyParas = String(f.text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const bodyHtml = bodyParas.length
    ? bodyParas.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : '<p><em>(empty)</em></p>';

  root.innerHTML = `
    ${toastHtml()}
    <div class="topbar">
      <button class="topbar__back" type="button" id="back-to-edit-btn">← Back to edit</button>
    </div>
    <h1>Preview</h1>
    <p class="lead">
      This is what you're about to submit. Tap <strong>Submit</strong> when you're
      happy, or <strong>Edit</strong> to change anything before posting.
    </p>

    <article class="preview-card">
      <header class="preview-card__header">
        ${titleHtml}
        ${highlightHtml}
      </header>
      ${photosHtml}
      <div class="preview-card__body">
        ${bodyHtml}
      </div>
      <div class="preview-card__meta">
        <strong>Destination:</strong> ${escapeHtml(f.destination)}
      </div>
    </article>

    <div class="preview-actions">
      <button class="btn btn--secondary" type="button" id="back-edit-btn">Edit</button>
      <button class="btn" type="button" id="confirm-submit-btn">Submit</button>
    </div>
  `;

  document.getElementById('back-to-edit-btn').addEventListener('click', backToEdit);
  document.getElementById('back-edit-btn').addEventListener('click', backToEdit);
  document.getElementById('confirm-submit-btn').addEventListener('click', confirmSubmit);
}

function backToEdit() {
  state.screen = 'submit';
  render();
}

/* ---- Screen: submitting / done ---- */
function renderSubmitting() {
  const u = state.user;
  if (state.submitProgress === 'done') {
    root.innerHTML = `
      <div class="topbar">
        <div class="topbar__greeting">Hi, ${escapeHtml(u.name || 'there')}</div>
        <button class="topbar__signout" type="button" id="signout-btn">Sign out</button>
      </div>
      <div class="progress">
        <div class="success">
          <strong>Thanks ${escapeHtml(u.name || 'there')}!</strong><br>
          Your story has been submitted and will appear on the Hub once approved.
        </div>
        <p class="lead lead--small">
          It usually takes around 15 minutes for your story to appear in
          <strong>My Stories</strong> as <em>Awaiting review</em>.
        </p>
        <button class="btn" id="view-stories-btn" type="button">View My Stories</button>
        <button class="btn btn--secondary" id="back-btn" type="button">Submit another story</button>
      </div>
    `;
    document.getElementById('signout-btn').addEventListener('click', onSignOut);
    document.getElementById('view-stories-btn').addEventListener('click', () => {
      state.screen = 'recent';
      state.submitProgress = null;
      // Force a fresh fetch — the just-submitted story usually isn't visible
      // for ~15 minutes (Task Scheduler cadence), but the user sees their
      // existing stories immediately and can pull-to-refresh later.
      state.recent = { loading: false, error: null, items: null, loadedAt: null, limit: 10, total: null };
      render();
      fetchRecentSubmissions();
    });
    document.getElementById('back-btn').addEventListener('click', () => {
      state.screen = 'submit';
      state.submitProgress = null;
      render();
    });
    return;
  }

  const message =
    state.submitProgress === 'resizing' ? 'Resizing photos…' : 'Uploading your story…';

  root.innerHTML = `
    <div class="topbar">
      <div class="topbar__greeting">Hi, ${escapeHtml(u.name || 'there')}</div>
    </div>
    <div class="progress">
      <div class="progress__spinner" aria-hidden="true"></div>
      <div class="progress__step">${message}</div>
    </div>
  `;
}

/* ---- Helpers ---- */
function errorMessageFor(code, status) {
  switch (code) {
    case 'INVALID_PIN':
      return 'That PIN didn\u2019t match. Try again.';
    case 'INACTIVE_USER':
      return 'Your account is not active. Talk to your manager.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a minute and try again.';
    case 'INVALID_DESTINATION':
      return 'Pick a destination from the list.';
    case 'TEXT_LENGTH':
      return `Your story must be between ${TEXT_MIN} and ${TEXT_MAX} characters.`;
    case 'INVALID_SUBMITTED_AT':
      return 'Couldn\u2019t timestamp the submission. Refresh and try again.';
    case 'BANNER_REQUIRED':
      return 'Please add at least one photo \u2014 the first one is the banner.';
    case 'BANNER_FORMAT':
    case 'BODY_FORMAT':
      return 'One of your photos is in an unsupported format. JPEG or PNG please.';
    case 'UPLOAD_TOO_LARGE':
      return 'Your photos are too big to upload. Try fewer or smaller images.';
    case 'UNEXPECTED_FILE_FIELD':
      return 'Too many photos. The maximum is 11 (banner + 10 body).';
    case 'INTERNAL_ERROR':
      return 'Something went wrong on our end. Try again in a minute.';
    default:
      if (status === 0 || status >= 500) return 'Server problem. Try again in a minute.';
      return code ? `Submit failed: ${code}` : 'Submit failed. Try again.';
  }
}

/* ---- Screen: my recent submissions ---- */
// Translate the canonical backend status into submitter-friendly copy.
// CSS class still keys off the canonical value (existing colour rules
// stay correct — green for approved, ochre for waiting, grey for archived).
function friendlyStatus(rawStatus) {
  const s = String(rawStatus || '').trim();
  if (s === 'Approved') return 'Live on the Hub';
  if (s === 'Waiting Approval') return 'Awaiting review';
  if (s === 'Archived') return 'Not published';
  return s || 'Unknown';
}

function statusSlug(rawStatus) {
  return String(rawStatus || 'unknown')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-');
}

// Banner shown at the top of the review-body in self-mode for non-Approved
// stories. Approved stories render without a banner — the submitter is
// looking at exactly what's live on the Hub. Archived stories surface
// the AdminNote when the admin left one, so submitters get rejection
// feedback in the PWA rather than only via email.
function renderSelfBanner(status, adminNote) {
  const s = String(status || '').trim();
  if (s === 'Waiting Approval') {
    return `
      <div class="review-self-banner review-self-banner--waiting">
        <p class="review-self-banner__heading">Awaiting review</p>
        <p class="review-self-banner__note">An admin checks new stories before they go live on the Hub. You'll get an email once it's approved or if any changes are needed.</p>
      </div>`;
  }
  if (s === 'Archived') {
    const note = String(adminNote || '').trim();
    const noteHtml = note
      ? escapeHtml(note)
      : 'This story isn\u2019t visible on the Hub. Talk to your manager if you have questions.';
    return `
      <div class="review-self-banner review-self-banner--archived">
        <p class="review-self-banner__heading">Not published</p>
        <p class="review-self-banner__note">${noteHtml}</p>
      </div>`;
  }
  return '';
}

function renderRecent() {
  const u = state.user;
  const r = state.recent;

  let body;
  if (r.loading && r.items === null) {
    body = `
      <div class="progress">
        <div class="progress__spinner" aria-hidden="true"></div>
        <div class="progress__step">Loading…</div>
      </div>`;
  } else if (r.error) {
    body = `<div class="error">${escapeHtml(r.error)}</div>`;
  } else if (!r.items || r.items.length === 0) {
    body = `<p class="lead">No submissions yet — submit your first story above.</p>`;
  } else {
    const list = `<ul class="recent-list">${r.items.map(renderRecentItem).join('')}</ul>`;
    // Show "Show older" only if backend reported more rows than we currently
    // show AND we're still on the default 10. Once expanded to 30, no
    // further pagination — that's enough for any plausible RAC scale.
    const moreAvailable =
      r.limit < 30 && Number.isFinite(r.total) && r.total > r.items.length;
    const showOlder = moreAvailable
      ? `<button class="btn btn--secondary show-older-btn" type="button" id="show-older-btn">Show older stories</button>`
      : '';
    body = `${list}${showOlder}`;
  }

  root.innerHTML = `
    <div class="topbar">
      <button class="topbar__back" type="button" id="back-btn">← Back</button>
      <button class="topbar__refresh" type="button" id="refresh-btn"${r.loading ? ' disabled' : ''}>
        ${r.loading ? '↻ Refreshing…' : '↻ Refresh'}
      </button>
    </div>
    <div class="pull-indicator" id="pull-indicator"><div class="pull-indicator__inner">Pull down to refresh</div></div>
    <h1>My Stories</h1>
    <p class="lead">Tap a story to see how it looks.</p>
    ${body}
  `;

  document.getElementById('back-btn').addEventListener('click', () => {
    state.screen = 'submit';
    render();
  });
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (!r.loading) fetchRecentSubmissions();
  });
  const showOlderBtn = document.getElementById('show-older-btn');
  if (showOlderBtn) {
    showOlderBtn.addEventListener('click', () => {
      state.recent.limit = 30;
      fetchRecentSubmissions();
    });
  }

  // Tap-through: each list item opens the self-view detail render.
  // Event delegation on the list — no per-item listener.
  const list = document.querySelector('.recent-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.recent-item');
      if (!li) return;
      const destination = li.dataset.destination;
      const rowNumber = parseInt(li.dataset.row, 10);
      if (destination && Number.isInteger(rowNumber)) {
        openMyStory(destination, rowNumber);
      }
    });
  }
}

function renderRecentItem(item) {
  const slug = statusSlug(item.status);
  const friendly = friendlyStatus(item.status);
  const banner = item.banner_url
    ? `<img class="recent-item__thumb" src="${escapeAttr(item.banner_url)}" alt="" loading="lazy" />`
    : `<div class="recent-item__thumb recent-item__thumb--placeholder" aria-hidden="true">📰</div>`;
  return `
    <li class="recent-item recent-item--tappable"
        data-destination="${escapeAttr(item.destination)}"
        data-row="${item.row_number}"
        role="button"
        tabindex="0"
        aria-label="Open ${escapeAttr(item.title || 'untitled story')}">
      ${banner}
      <div class="recent-item__content">
        <div class="recent-item__row">
          <span class="recent-item__title">${escapeHtml(item.title || '(untitled)')}</span>
          <span class="status status--${slug}">${escapeHtml(friendly)}</span>
        </div>
        <div class="recent-item__meta">
          ${escapeHtml(item.destination || '')} · ${escapeHtml(item.date || '')}
        </div>
      </div>
    </li>
  `;
}

async function fetchRecentSubmissions() {
  if (!state.user) return;
  state.recent.loading = true;
  state.recent.error = null;
  if (state.screen === 'recent') render();

  try {
    const url = `${API}/my-submissions?pin=${encodeURIComponent(state.user.pin)}&limit=${state.recent.limit}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      state.recent.error = errorMessageFor(data.error, resp.status);
      state.recent.items = state.recent.items || [];
    } else {
      state.recent.items = Array.isArray(data.submissions) ? data.submissions : [];
      state.recent.total = Number.isFinite(data.total) ? data.total : state.recent.items.length;
      state.recent.loadedAt = Date.now();
    }
  } catch (err) {
    state.recent.error = 'Could not reach the server. Check your connection.';
    state.recent.items = state.recent.items || [];
  } finally {
    state.recent.loading = false;
    if (state.screen === 'recent') render();
  }
}

// Opens the review screen in self-view mode for one of the submitter's own
// stories. Reuses the admin Review Detail render with mode='self', which
// hides the Reject/Edit/Approve footer and surfaces status-appropriate
// banners (Awaiting review note, AdminNote on Not published).
async function openMyStory(destination, rowNumber) {
  state.review = freshReviewState();
  state.review.destination = destination;
  state.review.rowNumber = rowNumber;
  state.review.mode = 'self';
  state.review.loading = true;
  state.screen = 'review';
  render();

  try {
    const url =
      `${API}/my-submission?pin=${encodeURIComponent(state.user.pin)}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&row=${rowNumber}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      state.review.errorCode = data.error || 'UNKNOWN';
      state.review.error = errorMessageFor(data.error, resp.status);
    } else {
      state.review.data = data.submission;
    }
  } catch (err) {
    state.review.error = 'Could not reach the server.';
  } finally {
    state.review.loading = false;
    if (state.screen === 'review') render();
  }
}

/* Pull-to-refresh: only active when on the recent screen. The browser's
   own pull-to-refresh is suppressed via CSS overscroll-behavior. */
const PULL_THRESHOLD = 60;
let pullStartY = null;
let pullActive = false;

document.addEventListener(
  'touchstart',
  (e) => {
    if (state.screen !== 'recent') return;
    if (window.scrollY === 0 && e.touches.length === 1) {
      pullStartY = e.touches[0].clientY;
      pullActive = false;
    }
  },
  { passive: true },
);

document.addEventListener(
  'touchmove',
  (e) => {
    if (state.screen !== 'recent' || pullStartY === null) return;
    const delta = e.touches[0].clientY - pullStartY;
    if (delta <= 0) return;
    pullActive = true;
    const indicator = document.getElementById('pull-indicator');
    if (indicator) {
      const capped = Math.min(delta, 100);
      indicator.style.height = `${capped}px`;
      indicator.classList.toggle('pull-indicator--ready', capped >= PULL_THRESHOLD);
    }
    // Prevent the page from scrolling further while we're pulling
    if (delta > 5 && e.cancelable) e.preventDefault();
  },
  { passive: false },
);

document.addEventListener('touchend', () => {
  if (state.screen !== 'recent') return;
  const indicator = document.getElementById('pull-indicator');
  const triggered =
    pullActive && indicator && parseInt(indicator.style.height || '0', 10) >= PULL_THRESHOLD;
  if (indicator) {
    indicator.style.height = '';
    indicator.classList.remove('pull-indicator--ready');
  }
  pullStartY = null;
  pullActive = false;
  if (triggered && !state.recent.loading) fetchRecentSubmissions();
});

/* ---- Screen: review queue (Admin only) ---- */
function renderQueue() {
  const q = state.adminQueue;

  let body;
  if (q.loading && q.items === null) {
    body = `
      <div class="progress">
        <div class="progress__spinner" aria-hidden="true"></div>
        <div class="progress__step">Loading…</div>
      </div>`;
  } else if (q.error) {
    body = `<div class="error">${escapeHtml(q.error)}</div>`;
  } else if (!q.items || q.items.length === 0) {
    body = `<p class="lead">No stories waiting approval right now.</p>`;
  } else {
    body = `<ul class="queue-list">${q.items.map(renderQueueItem).join('')}</ul>`;
  }

  root.innerHTML = `
    ${toastHtml()}
    <div class="topbar">
      <button class="topbar__back" type="button" id="back-btn">← Back</button>
      <button class="topbar__refresh" type="button" id="refresh-btn"${q.loading ? ' disabled' : ''}>
        ${q.loading ? '↻ Refreshing…' : '↻ Refresh'}
      </button>
    </div>
    <h1>Review queue</h1>
    <p class="lead">Stories waiting your approval. Tap one to review.</p>
    ${body}
  `;

  document.getElementById('back-btn').addEventListener('click', () => {
    state.screen = 'submit';
    render();
  });
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (!q.loading) fetchPendingQueue();
  });
  const list = document.querySelector('.queue-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.queue-item');
      if (!li) return;
      const destination = li.dataset.destination;
      const rowNumber = parseInt(li.dataset.row, 10);
      openReview(destination, rowNumber);
    });
  }
}

function renderQueueItem(item) {
  return `
    <li class="queue-item" data-destination="${escapeAttr(item.destination)}" data-row="${item.row_number}">
      <div class="queue-item__title">${escapeHtml(item.title || '(untitled)')}</div>
      <div class="queue-item__meta">
        ${escapeHtml(item.destination || '')} · ${escapeHtml(item.submitted_by || 'Unknown')} · ${escapeHtml(item.submitted_date || '')}
      </div>
    </li>
  `;
}

/* ---- Screen: review detail (Admin only) ---- */
/* Renders a faithful preview of the live Intranet's modal: terracotta
   header with title + date pill + close button, white body with
   carousel + text + Key Highlights card, footer row with Approve /
   Reject. The runtime-only features of the live modal (reactions,
   between-stories pagination) are intentionally omitted — they don't
   apply to a single-story preview. */
function renderReview() {
  const r = state.review;

  if (r.loading) {
    root.innerHTML = `
      ${toastHtml()}
      <div class="topbar"><button class="topbar__back" type="button" id="back-btn">← Back</button></div>
      <div class="progress">
        <div class="progress__spinner" aria-hidden="true"></div>
        <div class="progress__step">Loading submission…</div>
      </div>`;
    document.getElementById('back-btn').addEventListener('click', closeReview);
    return;
  }

  if (r.errorCode === 'NOT_FOUND') {
    root.innerHTML = `
      ${toastHtml()}
      <div class="topbar"><button class="topbar__back" type="button" id="back-btn">← Back</button></div>
      <div class="error">
        This submission is still being processed. Try again in a few minutes.
      </div>`;
    document.getElementById('back-btn').addEventListener('click', closeReview);
    return;
  }

  if (r.error) {
    root.innerHTML = `
      ${toastHtml()}
      <div class="topbar"><button class="topbar__back" type="button" id="back-btn">← Back</button></div>
      <div class="error">${escapeHtml(r.error)}</div>`;
    document.getElementById('back-btn').addEventListener('click', closeReview);
    return;
  }

  if (!r.data) {
    root.innerHTML = `<p class="lead">No data.</p>`;
    return;
  }

  const d = r.data;
  const isSelf = r.mode === 'self';
  const images = reviewImages(d);
  const idx = Math.max(0, Math.min(r.imageIndex, images.length - 1));
  const datePill = formatDatePill(d.submitted_date);

  // Self-view banner: only shown when the submitter is looking at their
  // own story AND the status is not Approved. Approved stories appear
  // exactly as they do on the Hub — no callout needed.
  const selfBannerHtml = isSelf ? renderSelfBanner(d.status, d.admin_note) : '';

  const carouselHtml = images.length
    ? `
      <div class="review-carousel">
        <img class="review-carousel__image" src="${escapeAttr(images[idx])}" alt="Story image ${idx + 1}" />
        <span class="review-carousel__counter">${idx + 1} / ${images.length}</span>
        ${images.length > 1
          ? `
            <button type="button" class="review-carousel__nav review-carousel__nav--prev"
                    id="carousel-prev" aria-label="Previous image"${idx === 0 ? ' disabled' : ''}>‹</button>
            <button type="button" class="review-carousel__nav review-carousel__nav--next"
                    id="carousel-next" aria-label="Next image"${idx === images.length - 1 ? ' disabled' : ''}>›</button>
            <div class="review-carousel__dots">
              ${images.map((_, i) => `
                <button type="button" class="review-carousel__dot${i === idx ? ' review-carousel__dot--active' : ''}"
                        data-idx="${i}" aria-label="Go to image ${i + 1}"></button>
              `).join('')}
            </div>`
          : ''}
      </div>`
    : '';

  const highlightsHtml = d.highlight
    ? `
      <aside class="review-highlights">
        <h3 class="review-highlights__heading">Key Highlights:</h3>
        <ul class="review-highlights__list">
          <li>${escapeHtml(d.highlight)}</li>
        </ul>
      </aside>`
    : '';

  // Body content swaps when editing — form replaces the read-only preview
  // for title/highlight/text. Carousel + meta card stay (admin can see
  // banner while editing; meta is auto and not editable).
  // Editing is admin-only; in self-mode we always render the read-only path.
  const bodyContentHtml = r.editing && !isSelf
    ? `
      <form class="review-edit" id="edit-form" novalidate>
        <div class="field">
          <label class="field__label" for="edit-title">Title</label>
          <input
            id="edit-title"
            type="text"
            class="review-edit__input"
            value="${escapeAttr(r.editValues?.title ?? '')}"
            maxlength="200"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label class="field__label" for="edit-highlight">Highlight (subtitle on the Hub)</label>
          <input
            id="edit-highlight"
            type="text"
            class="review-edit__input"
            value="${escapeAttr(r.editValues?.highlight ?? '')}"
            maxlength="500"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label class="field__label" for="edit-text">Body</label>
          <textarea
            id="edit-text"
            class="review-edit__textarea"
            rows="10"
            maxlength="1200"
          >${escapeHtml(r.editValues?.text ?? '')}</textarea>
          <div class="field__hint">10 to 1000 characters. Admin edits stay as Waiting Approval until you tap Approve separately.</div>
        </div>
      </form>`
    : `
      <div class="review-body__text">
        ${renderReviewBody(d.text)}
      </div>
      ${highlightsHtml}
      <div class="review-meta-card">
        <div><strong>Submitted by</strong> ${escapeHtml(d.submitted_by || 'Unknown')}</div>
        <div><strong>Destination</strong> ${escapeHtml(d.destination || '')}</div>
      </div>`;

  // In self-mode the footer is empty — submitters can only view, not act.
  const footerHtml = isSelf
    ? ''
    : r.editing
    ? `
      <div class="review-footer">
        <button class="btn btn--secondary" type="button" id="cancel-edit-btn"${r.acting ? ' disabled' : ''}>
          Cancel
        </button>
        <button class="btn" type="button" id="save-edit-btn"${r.acting ? ' disabled' : ''}>
          ${r.acting ? 'Saving…' : 'Save changes'}
        </button>
      </div>`
    : r.rejecting
      ? `
        <form class="reject-form" id="reject-form">
          <label class="reject-form__label" for="reject-reason">
            Why are you rejecting this? <span class="field__hint">(optional)</span>
          </label>
          <textarea
            id="reject-reason"
            class="reject-form__textarea"
            placeholder="A short note saved alongside the rejection. Won't be shown to the submitter."
            rows="3"
          ></textarea>
          <div class="reject-form__actions">
            <button class="btn" type="submit" id="confirm-reject-btn"${r.acting ? ' disabled' : ''}>
              ${r.acting ? 'Working…' : 'Confirm rejection'}
            </button>
            <button class="btn btn--secondary" type="button" id="cancel-reject-btn"${r.acting ? ' disabled' : ''}>
              Cancel
            </button>
          </div>
        </form>`
      : `
        <div class="review-footer review-footer--three">
          <button class="btn btn--secondary" type="button" id="reject-btn"${r.acting ? ' disabled' : ''}>
            Reject
          </button>
          <button class="btn btn--secondary" type="button" id="edit-btn"${r.acting ? ' disabled' : ''}>
            Edit
          </button>
          <button class="btn" type="button" id="approve-btn"${r.acting ? ' disabled' : ''}>
            ${r.acting ? 'Working…' : 'Approve'}
          </button>
        </div>`;

  root.innerHTML = `
    ${toastHtml()}
    <button class="topbar__back review-mobile-back" type="button" id="back-btn">← Back</button>
    <article class="review-modal">
      <header class="review-header">
        <h2 class="review-header__title">${escapeHtml(d.title || '(no title)')}</h2>
        ${datePill ? `<span class="review-header__date">${escapeHtml(datePill)}</span>` : ''}
        <button type="button" class="review-header__close" id="close-btn" aria-label="Close">✕</button>
      </header>
      <div class="review-body">
        ${selfBannerHtml}
        ${carouselHtml}
        ${bodyContentHtml}
      </div>
      ${footerHtml}
    </article>
  `;

  document.getElementById('back-btn').addEventListener('click', closeReview);
  document.getElementById('close-btn').addEventListener('click', closeReview);
  const approve = document.getElementById('approve-btn');
  const reject = document.getElementById('reject-btn');
  const editBtn = document.getElementById('edit-btn');
  const rejectForm = document.getElementById('reject-form');
  const cancelReject = document.getElementById('cancel-reject-btn');
  const cancelEdit = document.getElementById('cancel-edit-btn');
  const saveEdit = document.getElementById('save-edit-btn');
  if (approve) approve.addEventListener('click', onApprove);
  if (reject) reject.addEventListener('click', onReject);
  if (editBtn) editBtn.addEventListener('click', onEdit);
  if (rejectForm) rejectForm.addEventListener('submit', onConfirmReject);
  if (cancelReject) cancelReject.addEventListener('click', onCancelReject);
  if (cancelEdit) cancelEdit.addEventListener('click', onCancelEdit);
  if (saveEdit) saveEdit.addEventListener('click', onSaveEdit);

  // Wire edit-form input listeners to keep state.review.editValues in sync
  // with what the user has typed. Without this, any incidental re-render
  // (e.g. toast clearing) would clobber unsaved typing.
  if (r.editing) {
    const titleInput = document.getElementById('edit-title');
    const highlightInput = document.getElementById('edit-highlight');
    const textArea = document.getElementById('edit-text');
    if (titleInput)
      titleInput.addEventListener('input', (e) => {
        if (state.review.editValues) state.review.editValues.title = e.target.value;
      });
    if (highlightInput)
      highlightInput.addEventListener('input', (e) => {
        if (state.review.editValues) state.review.editValues.highlight = e.target.value;
      });
    if (textArea)
      textArea.addEventListener('input', (e) => {
        if (state.review.editValues) state.review.editValues.text = e.target.value;
      });
  }

  // Carousel navigation
  const prev = document.getElementById('carousel-prev');
  const next = document.getElementById('carousel-next');
  if (prev) prev.addEventListener('click', () => moveCarousel(-1));
  if (next) next.addEventListener('click', () => moveCarousel(1));
  document.querySelectorAll('.review-carousel__dot').forEach((dot) => {
    dot.addEventListener('click', (e) => {
      const i = parseInt(e.currentTarget.dataset.idx, 10);
      if (Number.isInteger(i)) {
        state.review.imageIndex = i;
        render();
      }
    });
  });
}

function moveCarousel(delta) {
  const images = reviewImages(state.review.data || {});
  const next = state.review.imageIndex + delta;
  if (next < 0 || next >= images.length) return;
  state.review.imageIndex = next;
  render();
}

function closeReview() {
  // Branch on the mode the review screen was opened in:
  //   'self'  → submitter came from My Stories; return them there
  //   'admin' → admin came from the review queue (or notify deep link);
  //             return them to the queue and refresh it if stale
  const wasSelf = state.review.mode === 'self';
  state.review = freshReviewState();
  if (wasSelf) {
    state.screen = 'recent';
    render();
    return;
  }
  state.screen = 'queue';
  render();
  if (state.adminQueue.items === null && !state.adminQueue.loading) {
    fetchPendingQueue();
  }
}

// Convert the body text into structured paragraphs for the preview. Splits
// on blank lines (one or more newlines surrounded by optional whitespace)
// and renders each paragraph as a <p>; any remaining single newlines
// inside a paragraph become <br>. This makes the preview look like a
// readable article rather than a single wall of text.
function renderReviewBody(text) {
  const paragraphs = String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '<p><em>(empty)</em></p>';
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function freshReviewState() {
  return {
    loading: false,
    error: null,
    errorCode: null,
    data: null,
    destination: null,
    rowNumber: null,
    acting: false,
    rejecting: false,
    editing: false,
    editValues: null,
    imageIndex: 0,
    mode: 'admin', // 'admin' (review queue, full controls) | 'self' (My Stories, view-only)
  };
}

// Build the ordered list of images shown in the review carousel — banner
// first, then body images. This matches what the admin actually sees on
// the live Intranet card + modal.
function reviewImages(d) {
  const list = [];
  if (d.banner_url) list.push(d.banner_url);
  if (Array.isArray(d.body_urls)) list.push(...d.body_urls.filter(Boolean));
  return list;
}

// Format a "Month D, YYYY" ContentDate as DD/MM/YYYY for the header pill.
// Returns the original string if parsing fails.
function formatDatePill(s) {
  if (!s) return '';
  const t = Date.parse(s);
  if (Number.isNaN(t)) return String(s);
  const dt = new Date(t);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

/* ---- Admin fetch + action functions ---- */
async function fetchPendingCount() {
  if (!state.user || state.user.role !== 'Admin') return;
  try {
    const url = `${API}/admin/pending?pin=${encodeURIComponent(state.user.pin)}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.ok) {
      state.adminQueue.count = (data.submissions || []).length;
      // If we already have items loaded, keep them in sync too
      if (state.adminQueue.items !== null) state.adminQueue.items = data.submissions;
      if (state.screen === 'submit') render();
    }
  } catch {
    // Non-fatal; the badge stays at its last value
  }
}

async function fetchPendingQueue() {
  if (!state.user || state.user.role !== 'Admin') return;
  state.adminQueue.loading = true;
  state.adminQueue.error = null;
  if (state.screen === 'queue') render();
  try {
    const url = `${API}/admin/pending?pin=${encodeURIComponent(state.user.pin)}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      state.adminQueue.error = errorMessageFor(data.error, resp.status);
      state.adminQueue.items = state.adminQueue.items || [];
    } else {
      state.adminQueue.items = data.submissions || [];
      state.adminQueue.count = state.adminQueue.items.length;
    }
  } catch {
    state.adminQueue.error = 'Could not reach the server. Check your connection.';
    state.adminQueue.items = state.adminQueue.items || [];
  } finally {
    state.adminQueue.loading = false;
    if (state.screen === 'queue') render();
  }
}

function openReview(destination, rowNumber) {
  state.review = freshReviewState();
  state.review.destination = destination;
  state.review.rowNumber = rowNumber;
  state.screen = 'review';
  render();
  fetchReviewData();
}

async function fetchReviewData() {
  const r = state.review;
  if (!state.user || !r.destination || !r.rowNumber) return;
  r.loading = true;
  r.error = null;
  r.errorCode = null;
  if (state.screen === 'review') render();
  try {
    const url = `${API}/admin/submission?pin=${encodeURIComponent(state.user.pin)}&destination=${encodeURIComponent(r.destination)}&row=${r.rowNumber}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      r.errorCode = data.error || 'UNKNOWN';
      r.error = errorMessageFor(data.error, resp.status);
    } else {
      r.data = data.submission;
    }
  } catch {
    r.error = 'Could not reach the server. Check your connection.';
  } finally {
    r.loading = false;
    if (state.screen === 'review') render();
  }
}

async function onApprove() {
  await performReviewAction('/admin/approve', null, 'Story approved.');
}

function onReject() {
  // Open the reason form. The actual reject hits the backend on confirm.
  state.review.rejecting = true;
  render();
  // Focus the textarea for fast typing
  const ta = document.getElementById('reject-reason');
  if (ta) ta.focus();
}

function onCancelReject() {
  state.review.rejecting = false;
  render();
}

/* Open the edit form, snapshotting the current data into editValues. The
   form's three fields are bound to state.review.editValues via input
   listeners (see renderReview), so unsaved typing survives any incidental
   re-render. */
function onEdit() {
  const d = state.review.data;
  if (!d) return;
  state.review.editing = true;
  state.review.editValues = {
    title: String(d.title || ''),
    highlight: String(d.highlight || ''),
    text: String(d.text || ''),
  };
  render();
}

function onCancelEdit() {
  if (state.review.acting) return;
  state.review.editing = false;
  state.review.editValues = null;
  render();
}

async function onSaveEdit() {
  const r = state.review;
  if (r.acting || !r.editValues) return;

  const title = r.editValues.title.trim();
  const highlight = r.editValues.highlight.trim();
  const text = r.editValues.text.trim();

  // Mirror backend validation client-side for fast feedback. Backend is
  // still the authority — it returns 400 if these slip through.
  if (!title) {
    setToast('Title is required.');
    return;
  }
  if (title.length > 200) {
    setToast('Title is too long (max 200 characters).');
    return;
  }
  if (!highlight) {
    setToast('Highlight is required.');
    return;
  }
  if (highlight.length > 500) {
    setToast('Highlight is too long (max 500 characters).');
    return;
  }
  if (text.length < 10) {
    setToast('Body text must be at least 10 characters.');
    return;
  }
  if (text.length > 1000) {
    setToast('Body text is too long (max 1000 characters).');
    return;
  }

  state.review.acting = true;
  render();

  try {
    const resp = await fetch(`${API}/admin/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: state.user.pin,
        destination: r.destination,
        row_number: r.rowNumber,
        title,
        highlight,
        text,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      state.review.acting = false;
      setToast(errorMessageFor(data.error, resp.status) || 'Save failed.');
      render();
      return;
    }
    setToast('Changes saved.');
    state.review.editing = false;
    state.review.editValues = null;
    state.review.acting = false;
    // Refetch so the read-only view shows the freshly-saved values
    fetchReviewData();
  } catch (err) {
    state.review.acting = false;
    setToast('Could not reach the server.');
    render();
  }
}

async function onConfirmReject(e) {
  e.preventDefault();
  const ta = document.getElementById('reject-reason');
  const reason = ta ? ta.value.trim() : '';
  state.review.rejecting = false;
  await performReviewAction('/admin/reject', reason, 'Story rejected.');
}

async function performReviewAction(path, reason, successMessage) {
  const r = state.review;
  if (!state.user || !r.data || r.acting) return;
  r.acting = true;
  if (state.screen === 'review') render();
  try {
    const body = {
      pin: state.user.pin,
      destination: r.destination,
      row_number: r.rowNumber,
    };
    if (reason !== null) body.reason = reason;
    const resp = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      r.acting = false;
      r.error = errorMessageFor(data.error, resp.status);
      if (state.screen === 'review') render();
      return;
    }
    setToast(successMessage);
    state.review = freshReviewState();
    state.screen = 'queue';
    state.adminQueue.items = null; // force re-fetch
    state.adminQueue.count = Math.max(0, state.adminQueue.count - 1);
    render();
    fetchPendingQueue();
  } catch {
    r.acting = false;
    r.error = 'Could not reach the server. Check your connection and try again.';
    if (state.screen === 'review') render();
  }
}

// ISO 8601 timestamp with the device's local timezone offset, to-the-second.
// Date.prototype.toISOString() always emits UTC ("...Z"), which would make
// a submission at 11pm NT time stamp as the next UTC day — wrong folder
// date in Drive, wrong ContentDate in the sheet. The contract example
// shape is `2026-04-27T14:32:11+09:30`.
function localISOString(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  // getTimezoneOffset returns minutes BEHIND UTC; flip the sign so + means ahead.
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const offH = pad(Math.floor(Math.abs(off) / 60));
  const offM = pad(Math.abs(off) % 60);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${offH}:${offM}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/* ---- Boot ---- */
function boot() {
  const u = loadUser();
  state.user = u || null;

  const params = new URLSearchParams(window.location.search);

  // Deep link from admin notification email: /?review={destination}&row={n}
  // Honoured only if the user is signed in as Admin. After consuming, the
  // query string is cleared so a refresh doesn't re-trigger it.
  const reviewDest = params.get('review');
  const reviewRow = parseInt(params.get('row'), 10);

  if (u && reviewDest && Number.isInteger(reviewRow) && u.role === 'Admin') {
    state.review = freshReviewState();
    state.review.destination = reviewDest;
    state.review.rowNumber = reviewRow;
    state.screen = 'review';
    window.history.replaceState({}, '', window.location.pathname);
    render();
    fetchReviewData();
    fetchPendingCount(); // populate badge for when admin returns to submit
    return;
  }

  // Deep link to a submitter's own story: /?my-story={destination}&row={n}
  // Honoured for any signed-in user (non-admins included). The /my-submission
  // endpoint enforces self-only authorisation server-side, so a user
  // sharing a link can't open someone else's story. Mirrors the admin
  // ?review= pattern, including the history.replaceState cleanup.
  // Forward-compatible with v1.5 push notifications, which will use this
  // same URL shape to open the submitter back to their story.
  const myStoryDest = params.get('my-story');
  const myStoryRow = parseInt(params.get('row'), 10);

  if (u && myStoryDest && Number.isInteger(myStoryRow)) {
    window.history.replaceState({}, '', window.location.pathname);
    if (u.role === 'Admin') fetchPendingCount();
    openMyStory(myStoryDest, myStoryRow);
    return;
  }

  if (u) {
    state.screen = 'submit';
    if (u.role === 'Admin') fetchPendingCount();
  } else {
    state.screen = 'signin';
  }
  render();
}
boot();
