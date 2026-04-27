// One-shot script: list the contents of the most recent submission folder
// in DRIVE_SUBMISSIONS_FOLDER_ID and dump submission.json.
// Run after a successful /submit to verify the contract §3-4 output.
import 'dotenv/config';
import { getDriveClient } from '../../google-client.js';

async function main() {
  const drive = getDriveClient();
  const parentId = process.env.DRIVE_SUBMISSIONS_FOLDER_ID;
  if (!parentId) {
    console.error('DRIVE_SUBMISSIONS_FOLDER_ID not set');
    process.exit(1);
  }

  // List folders under the parent, sorted by createdTime desc, take most recent
  const folders = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    orderBy: 'createdTime desc',
    pageSize: 5,
    fields: 'files(id, name, createdTime)',
  });
  if (!folders.data.files || folders.data.files.length === 0) {
    console.log('No submission folders found under parent', parentId);
    return;
  }

  console.log('Recent submission folders:');
  for (const f of folders.data.files) {
    console.log(`  ${f.createdTime}  ${f.name}  (${f.id})`);
  }

  const latest = folders.data.files[0];
  console.log(`\n=== Latest folder: ${latest.name} ===`);

  // List children
  const children = await drive.files.list({
    q: `'${latest.id}' in parents and trashed = false`,
    pageSize: 50,
    fields: 'files(id, name, mimeType, size)',
  });
  for (const c of children.data.files || []) {
    console.log(`  ${c.name}  (${c.mimeType}, ${c.size || '?'} bytes)`);
  }

  // Find and download submission.json
  const sj = (children.data.files || []).find((f) => f.name === 'submission.json');
  if (!sj) {
    console.log('\n(no submission.json in latest folder)');
    return;
  }
  const dl = await drive.files.get({ fileId: sj.id, alt: 'media' });
  console.log('\n=== submission.json ===');
  console.log(JSON.stringify(dl.data, null, 2));
}

main().catch((err) => {
  console.error('Inspect failed:', err.message);
  process.exit(1);
});
