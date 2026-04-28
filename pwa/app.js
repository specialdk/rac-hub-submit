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
  // Submit form state — preserved across re-renders within this screen
  form: {
    destination: 'General',
    text: '',
    title: '',
    highlight: '',
    files: [], // Array of File objects in selection order; [0] is banner
  },
  signinError: null,
  submitError: null,
  submitProgress: null, // 'uploading' | 'done' | null
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
    errBox.innerHTML = `<div class="error">${state.signinError}</div>`;
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
    !!form.destination &&
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
        <label class="photo-picker" for="photos">
          <div class="photo-picker__icon">📷</div>
          <div><strong>Tap to add photos</strong></div>
          <span class="photo-picker__hint">First photo is the banner. Camera or library.</span>
          <input
            id="photos"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
          />
        </label>
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
  document.getElementById('submit-form').addEventListener('submit', onSubmit);
}

function renderPhotoCards(files) {
  if (!files.length) return '';
  return files
    .map((f, i) => {
      const url = URL.createObjectURL(f);
      const label = i === 0 ? 'Banner' : `Photo ${i + 1}`;
      const cls = i === 0 ? 'photo-card__label photo-card__label--banner' : 'photo-card__label';
      return `
        <div class="photo-card">
          <img src="${url}" alt="${escapeAttr(label)}" />
          <span class="${cls}">${label}</span>
        </div>
      `;
    })
    .join('');
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

  // Update char count colour live
  const count = document.querySelector('.field__count');
  if (count) {
    count.textContent =
      `${charCount} / ${TEXT_MAX}` +
      (charCount < TEXT_MIN ? ` · ${TEXT_MIN - charCount} more to go` : '');
    count.classList.toggle('field__count--over', charCount > TEXT_MAX);
  }
}

function onPhotosPicked(e) {
  // Append newly-picked files to the current list. The picker fires once
  // per `change`; selecting again *adds* to selection rather than replacing.
  // Item 5 will layer in resize/EXIF; for now we pass File objects through.
  const picked = Array.from(e.target.files || []);
  if (!picked.length) return;
  state.form.files = state.form.files.concat(picked);
  // Reset input so picking the same filename twice still fires `change`
  e.target.value = '';
  // Re-render just the grid + button state
  document.getElementById('photo-grid').innerHTML = renderPhotoCards(state.form.files);
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
  state.submitProgress = 'uploading';
  state.submitError = null;
  render();

  const fd = new FormData();
  fd.append('pin', state.user.pin);
  fd.append('destination', f.destination);
  fd.append('text', f.text);
  fd.append('submitted_at', new Date().toISOString());
  if (f.title.trim()) fd.append('title_suggestion', f.title.trim());
  if (f.highlight.trim()) fd.append('highlight_suggestion', f.highlight.trim());
  fd.append('banner', f.files[0]);
  for (let i = 1; i < f.files.length && i <= 10; i++) {
    fd.append(`body_${i}`, f.files[i]);
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
    // Reset form fields but keep user logged in
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

  root.innerHTML = `
    <div class="topbar">
      <div class="topbar__greeting">Hi, ${escapeHtml(u.name || 'there')}</div>
    </div>
    <div class="progress">
      <div class="progress__spinner" aria-hidden="true"></div>
      <div class="progress__step">Uploading your story…</div>
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
