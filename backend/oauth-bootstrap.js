// One-time helper: capture a long-lived OAuth refresh token for Drive writes.
//
// Why this exists: service accounts cannot own files in a personal (non-
// Workspace) Google Drive — they have no storage quota, so files.create
// in a personal Drive parent fails with "Service Accounts do not have
// storage quota". The workaround is to run Drive operations as the human
// owner via OAuth. Sheets writes are unaffected and stay on the SA.
//
// Run once, locally, after creating an OAuth Web client in Google Cloud
// Console with redirect URI http://localhost:3001/oauth/callback.
//
//   1. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env
//   2. node oauth-bootstrap.js
//   3. Open the printed URL, click Allow
//   4. Copy the printed refresh_token into .env as GOOGLE_OAUTH_REFRESH_TOKEN
//
// The refresh token is reusable across deploys; you only re-run this if
// you revoke access, rotate the OAuth client, or change scopes.

import 'dotenv/config';
import http from 'node:http';
import { google } from 'googleapis';

const PORT = 3001;
const REDIRECT = `http://localhost:${PORT}/oauth/callback`;
// drive.file: only files this app creates or opens. Non-sensitive scope,
// no verification required even in Production. Sufficient for our needs:
// create submission folders, create files inside them, list our own
// folders for collision detection.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env.\n' +
      'Create them in Google Cloud Console > APIs & Services > Credentials.',
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  // offline + consent prompt guarantees a refresh_token in the response
  // even if the user has previously authorized this client.
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log(`\n2. After clicking Allow, Google will redirect to ${REDIRECT}.`);
console.log('   This script is listening on that URL and will capture the token.\n');
console.log('Waiting for callback...');

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth/callback')) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res
      .writeHead(400, { 'Content-Type': 'text/plain' })
      .end(`OAuth error: ${error}\n\nReturn to the terminal.`);
    console.error('\nOAuth error:', error);
    server.close();
    process.exit(1);
    return;
  }
  if (!code) {
    res.writeHead(400).end('Missing code parameter.');
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    res
      .writeHead(200, { 'Content-Type': 'text/plain' })
      .end('OAuth complete. The refresh token is in your terminal — you can close this tab.');

    console.log('\n=== SUCCESS ===');

    if (!tokens.refresh_token) {
      console.error(
        '\nNo refresh_token in response. This usually means you previously authorized\n' +
          'this app and Google decided not to re-issue a refresh token. To fix:\n' +
          '  1. Revoke access at https://myaccount.google.com/permissions\n' +
          '  2. Re-run this script.',
      );
      server.close();
      process.exit(1);
      return;
    }

    console.log('\nrefresh_token:\n');
    console.log(tokens.refresh_token);
    console.log('\nAdd this to backend/.env:\n');
    console.log(`  GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\nToken exchange failed:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Token exchange failed.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);
