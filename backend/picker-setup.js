// One-time helper to grant the OAuth client access to the three skill-
// owned Drive folders (Processed, Quarantine, Photos). The OAuth scope
// is `drive.file`, which only grants access to files this app has
// created or opened. The Drive Picker is the canonical companion to
// drive.file: when the user picks a folder in the picker, that folder
// becomes accessible to this OAuth client for the life of the refresh
// token (until the user revokes access at myaccount.google.com/permissions).
//
// Run once, locally, after you've already minted GOOGLE_OAUTH_REFRESH_TOKEN
// via oauth-bootstrap.js.
//
//   1. Enable the Google Picker API in Cloud Console
//   2. Create an API key and store as GOOGLE_PICKER_API_KEY in .env
//   3. node picker-setup.js
//   4. Open the printed URL, pick the three folders in order
//   5. Copy the three printed env-var lines into backend/.env and Railway

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { google } from 'googleapis';

const PORT = 3001;
const ROOT = path.dirname(url.fileURLToPath(import.meta.url));

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
const apiKey = process.env.GOOGLE_PICKER_API_KEY;

if (!clientId || !clientSecret || !refreshToken || !apiKey) {
  console.error(
    'Missing one or more required env vars in backend/.env:\n' +
      '  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ' +
      'GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_PICKER_API_KEY\n' +
      'See the comments at the top of this file.',
  );
  process.exit(1);
}

// Mint a short-lived access token from the existing refresh token. The
// picker JS in the browser needs an access token to authorize the picker
// dialog; we don't expose the refresh token client-side.
async function getAccessToken() {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Could not mint access token from refresh token');
  return token;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/' && req.method === 'GET') {
    try {
      const accessToken = await getAccessToken();
      const html = fs
        .readFileSync(path.join(ROOT, 'picker-setup.html'), 'utf8')
        .replace('{{API_KEY}}', apiKey)
        .replace('{{CLIENT_ID}}', clientId)
        .replace('{{ACCESS_TOKEN}}', accessToken);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } catch (err) {
      console.error('Token mint failed:', err.message);
      res
        .writeHead(500, { 'Content-Type': 'text/plain' })
        .end('Failed to mint access token: ' + err.message);
    }
    return;
  }

  if (reqUrl.pathname === '/done' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const required = ['processed', 'quarantine', 'photos'];
        for (const key of required) {
          if (!data[key] || typeof data[key] !== 'string') {
            res.writeHead(400).end(`Missing folder id: ${key}`);
            return;
          }
        }
        console.log('\n=== SUCCESS ===\n');
        console.log('Add these three lines to backend/.env (and to Railway env vars):\n');
        console.log(`DRIVE_PROCESSED_FOLDER_ID=${data.processed}`);
        console.log(`DRIVE_QUARANTINE_FOLDER_ID=${data.quarantine}`);
        console.log(`DRIVE_PHOTOS_FOLDER_ID=${data.photos}`);
        console.log(
          '\nThe folders are now accessible to this OAuth client under drive.file ' +
            'scope. Access persists until the refresh token is revoked.',
        );
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 200);
      } catch (err) {
        res.writeHead(400).end('Invalid JSON: ' + err.message);
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
});

server.listen(PORT, () => {
  console.log(`Picker setup running at http://localhost:${PORT}`);
  console.log('Open that URL in your browser. Pick the three folders when prompted.\n');
});
