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
};

/* ---- Render entry ---- */
const root = document.getElementById('app');

function render() {
  switch (state.screen) {
    case 'signin':
      renderSignIn();
      break;
    case 'submit':
      renderSubmit();
      break;
    case 'submitting':
      renderSubmitting();
      break;
    default:
      root.innerHTML = '';
  }
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

  root.innerHTML = `
    <div class="topbar">
      <div class="topbar__greeting">Hi, ${escapeHtml(u.name || 'there')}</div>
      <button class="topbar__signout" type="button" id="signout-btn">Sign out</button>
    </div>

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
        <label class="field__label" for="text">Your story</label>
        <textarea
          id="text"
          name="text"
          placeholder="What happened? Tell the story…"
          maxlength="${TEXT_MAX + 200}"
        >${escapeHtml(form.text)}</textarea>
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
        <label class="photo-picker${form.files.length >= MAX_PHOTOS ? ' photo-picker--disabled' : ''}" for="photos">
          <div class="photo-picker__icon">📷</div>
          <div><strong>Tap to add photos</strong></div>
          <span class="photo-picker__hint">First photo is the banner. Camera or library.</span>
          <input
            id="photos"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            ${form.files.length >= MAX_PHOTOS ? 'disabled' : ''}
          />
        </label>
        <p class="photo-picker__tip">
          Maximum ${MAX_PHOTOS} photos per story. For best banner display, frame the most important part of your first photo near the centre.
        </p>
        <div class="photo-grid" id="photo-grid">
          ${renderPhotoCards(form.files)}
        </div>
      </div>

      <div id="submit-error"></div>

      <button id="submit-btn" class="btn" type="submit"${canSubmit ? '' : ' disabled'}>
        Submit story
      </button>
    </form>
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
  document.getElementById('photos').addEventListener('change', onPhotosPicked);
  document.getElementById('photo-grid').addEventListener('click', onPhotoControl);
  document.getElementById('submit-form').addEventListener('submit', onSubmit);
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
  const input = document.getElementById('photos');
  if (!picker || !input) return;
  const atCap = state.form.files.length >= MAX_PHOTOS;
  picker.classList.toggle('photo-picker--disabled', atCap);
  input.disabled = atCap;
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
  state.screen = 'signin';
  render();
}

async function onSubmit(e) {
  e.preventDefault();
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
        <button class="btn" id="back-btn" type="button">Submit another story</button>
      </div>
    `;
    document.getElementById('signout-btn').addEventListener('click', onSignOut);
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
  if (u) {
    state.user = u;
    state.screen = 'submit';
  } else {
    state.screen = 'signin';
  }
  render();
}
boot();
