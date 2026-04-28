// Pure helpers for the admin notification email. No I/O — kept separate
// from the route handler so they're unit-testable without network or
// fixtures.

const TERRACOTTA = '#C4651A';
const CHARCOAL = '#2D1B0E';
const CREAM = '#F5E6D3';

export const NOTIFY_SUBJECT = 'New RAC Hub story awaiting review';

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build the deep link the email's button points at. The PWA's boot logic
// reads ?review={destination}&row={n} and lands the admin straight on
// the Review Detail screen if they're already signed in.
export function buildDeepLink(pwaUrl, destination, rowNumber) {
  if (!pwaUrl) return '';
  const base = String(pwaUrl).replace(/\/+$/, '');
  const dest = encodeURIComponent(String(destination ?? ''));
  const row = encodeURIComponent(String(rowNumber ?? ''));
  return `${base}/?review=${dest}&row=${row}`;
}

// Build the email body in three forms. HTML is the primary; text is the
// fallback for clients that block remote rendering. Subject is constant
// so admin can filter on it in their inbox.
export function buildNotifyEmail({ title, submittedBy, destination, deepLink }) {
  const t = htmlEscape(title);
  const s = htmlEscape(submittedBy);
  const d = htmlEscape(destination);
  const link = htmlEscape(deepLink);

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, 'Segoe UI', sans-serif; background: ${CREAM}; margin: 0; padding: 24px; color: ${CHARCOAL};">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background: white; border-radius: 14px; overflow: hidden;">
      <tr>
        <td style="padding: 28px 32px;">
          <h2 style="color: ${TERRACOTTA}; margin: 0 0 18px; font-size: 22px;">New RAC Hub story awaiting review</h2>
          <p style="margin: 8px 0;"><strong>Title:</strong> ${t}</p>
          <p style="margin: 8px 0;"><strong>Submitted by:</strong> ${s}</p>
          <p style="margin: 8px 0;"><strong>Destination:</strong> ${d}</p>
          <p style="margin: 28px 0 8px;">
            <a href="${link}"
               style="display: inline-block; background: ${TERRACOTTA}; color: white; padding: 14px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
              Review and approve →
            </a>
          </p>
          <p style="color: #888; font-size: 12px; margin-top: 28px; line-height: 1.4;">
            If the button doesn't work, paste this URL into your browser:<br>
            <span style="word-break: break-all;">${link}</span>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `New RAC Hub story awaiting review

Title: ${title || ''}
Submitted by: ${submittedBy || ''}
Destination: ${destination || ''}

Review at: ${deepLink || ''}
`;

  return { subject: NOTIFY_SUBJECT, html, text };
}
