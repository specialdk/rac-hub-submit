import { google } from 'googleapis';

let cachedAuth;
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

function getAuth() {
  if (cachedAuth) return cachedAuth;
  const credentials = decodeServiceAccountJson();
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return cachedAuth;
}

export function getSheetsClient() {
  if (cachedSheets) return cachedSheets;
  cachedSheets = google.sheets({ version: 'v4', auth: getAuth() });
  return cachedSheets;
}

export function getDriveClient() {
  if (cachedDrive) return cachedDrive;
  cachedDrive = google.drive({ version: 'v3', auth: getAuth() });
  return cachedDrive;
}
