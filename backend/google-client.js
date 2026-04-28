import { google } from 'googleapis';

let cachedSAAuth;
let cachedOAuth;
let cachedSheets;
let cachedDrive;

function decodeServiceAccountJson() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  }
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

// Service account auth — used for Sheets only. Service accounts cannot own
// files in personal Drive (no storage quota), so Drive operations cannot
// use this auth path.
function getServiceAccountAuth() {
  if (cachedSAAuth) return cachedSAAuth;
  const credentials = decodeServiceAccountJson();
  cachedSAAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return cachedSAAuth;
}

// OAuth2 client backed by Duane's refresh token — used for Drive writes.
// The googleapis library auto-refreshes access tokens behind the scenes
// using the refresh token. Run oauth-bootstrap.js once to mint the token.
function getOAuthClient() {
  if (cachedOAuth) return cachedOAuth;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN must all be set. Run `node oauth-bootstrap.js` first.',
    );
  }
  cachedOAuth = new google.auth.OAuth2(clientId, clientSecret);
  cachedOAuth.setCredentials({ refresh_token: refreshToken });
  return cachedOAuth;
}

export function getSheetsClient() {
  if (cachedSheets) return cachedSheets;
  cachedSheets = google.sheets({ version: 'v4', auth: getServiceAccountAuth() });
  return cachedSheets;
}

export function getDriveClient() {
  if (cachedDrive) return cachedDrive;
  cachedDrive = google.drive({ version: 'v3', auth: getOAuthClient() });
  return cachedDrive;
}
