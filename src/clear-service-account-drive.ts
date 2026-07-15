import 'dotenv/config';
import { readFileSync } from 'fs';
import { google } from 'googleapis';

const confirm = process.argv.includes('--confirm');

const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!keyPath) {
  console.error('GOOGLE_SERVICE_ACCOUNT_KEY is not set in .env');
  process.exit(1);
}

const key = JSON.parse(readFileSync(keyPath, 'utf-8'));
const auth = new google.auth.GoogleAuth({
  credentials: key,
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth });

// Collect all files owned by the service account across all pages.
const files: { id: string; name: string }[] = [];
let pageToken: string | undefined;
do {
  const res = await drive.files.list({
    q: "'me' in owners",
    fields: 'nextPageToken, files(id, name)',
    pageSize: 100,
    ...(pageToken ? { pageToken } : {}),
  });
  for (const f of res.data.files ?? []) {
    if (f.id && f.name) files.push({ id: f.id, name: f.name });
  }
  pageToken = res.data.nextPageToken ?? undefined;
} while (pageToken);

if (files.length === 0) {
  console.log('No files found — service account Drive is already empty.');
  process.exit(0);
}

console.log(`Found ${files.length} file(s) owned by the service account:\n`);
for (const f of files) console.log(`  ${f.name}  (${f.id})`);

if (!confirm) {
  console.log('\nDry run — pass --confirm to delete these files.');
  process.exit(0);
}

console.log('\nDeleting…');
for (const f of files) {
  await drive.files.delete({ fileId: f.id });
  console.log(`  Deleted: ${f.name}`);
}
console.log(`\nDone. ${files.length} file(s) deleted.`);
