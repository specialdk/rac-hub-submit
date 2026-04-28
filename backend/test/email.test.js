import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeepLink, buildNotifyEmail, NOTIFY_SUBJECT } from '../email.js';

// ---- buildDeepLink
test('buildDeepLink encodes the destination and row', () => {
  assert.equal(
    buildDeepLink('http://localhost:8081', 'CEO Messages', 5),
    'http://localhost:8081/?review=CEO%20Messages&row=5',
  );
});

test('buildDeepLink trims trailing slashes from PWA_URL', () => {
  assert.equal(
    buildDeepLink('http://localhost:8081/', 'General', 3),
    'http://localhost:8081/?review=General&row=3',
  );
  assert.equal(
    buildDeepLink('http://localhost:8081////', 'General', 3),
    'http://localhost:8081/?review=General&row=3',
  );
});

test('buildDeepLink returns empty string when PWA_URL is missing', () => {
  assert.equal(buildDeepLink('', 'General', 1), '');
  assert.equal(buildDeepLink(null, 'General', 1), '');
  assert.equal(buildDeepLink(undefined, 'General', 1), '');
});

test('buildDeepLink coerces row to string and encodes spaces', () => {
  // encodeURIComponent leaves apostrophes unescaped (RFC 3986 unreserved)
  assert.equal(
    buildDeepLink('https://hub.example.com', "Sam's Corner", 12),
    "https://hub.example.com/?review=Sam's%20Corner&row=12",
  );
});

// ---- buildNotifyEmail
test('buildNotifyEmail returns subject + html + text with all fields rendered', () => {
  const result = buildNotifyEmail({
    title: 'Test story',
    submittedBy: 'Duane Kuru',
    destination: 'General',
    deepLink: 'http://localhost:8081/?review=General&row=5',
  });
  assert.equal(result.subject, NOTIFY_SUBJECT);
  assert.match(result.html, /Test story/);
  assert.match(result.html, /Duane Kuru/);
  assert.match(result.html, /General/);
  // The HTML escapes & to &amp; — that's correct per the HTML spec
  assert.match(result.html, /href="http:\/\/localhost:8081\/\?review=General&amp;row=5"/);
  assert.match(result.text, /Test story/);
  assert.match(result.text, /Duane Kuru/);
  assert.match(result.text, /Review at: http:\/\/localhost:8081/);
});

test('buildNotifyEmail HTML-escapes user-supplied content (XSS defence)', () => {
  const result = buildNotifyEmail({
    title: 'Story <script>alert(1)</script> "test"',
    submittedBy: "Mary <O'Brien>",
    destination: 'General',
    deepLink: 'http://localhost:8081/?review=General&row=1',
  });
  assert.equal(result.html.includes('<script>'), false);
  assert.match(result.html, /&lt;script&gt;/);
  assert.match(result.html, /&quot;test&quot;/);
  assert.match(result.html, /&lt;O&#39;Brien&gt;/);
});

test('buildNotifyEmail handles missing fields without throwing', () => {
  const result = buildNotifyEmail({
    title: '',
    submittedBy: '',
    destination: '',
    deepLink: '',
  });
  assert.equal(typeof result.subject, 'string');
  assert.equal(typeof result.html, 'string');
  assert.equal(typeof result.text, 'string');
  assert.equal(result.subject, NOTIFY_SUBJECT);
});

test('buildNotifyEmail subject is constant for inbox filtering', () => {
  const r1 = buildNotifyEmail({ title: 'A', submittedBy: 'B', destination: 'General', deepLink: 'x' });
  const r2 = buildNotifyEmail({ title: 'X', submittedBy: 'Y', destination: 'CEO Messages', deepLink: 'y' });
  assert.equal(r1.subject, r2.subject);
  assert.equal(r1.subject, 'New RAC Hub story awaiting review');
});

test('buildNotifyEmail HTML includes plain-text fallback URL for clients that strip buttons', () => {
  const link = 'http://localhost:8081/?review=Safety%20Messages&row=3';
  const result = buildNotifyEmail({
    title: 'X',
    submittedBy: 'Y',
    destination: 'Safety Messages',
    deepLink: link,
  });
  // After HTML escaping, the link appears twice — once as href, once as
  // visible text fallback for clients that strip the styled button.
  const escapedLink = link.replace(/&/g, '&amp;');
  const escaped = escapedLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const occurrences = (result.html.match(new RegExp(escaped, 'g')) || []).length;
  assert.equal(occurrences >= 2, true);
});
