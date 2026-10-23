// Obtain original fonts directly from their licensor. Never convert, subset or
// edit font metadata, and never redistribute the raw files in the public repo.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
export const families = [
  { slug: 'satoshi', archiveRoot: 'Satoshi_Complete', files: {
    'Satoshi-Regular.ttf': 'b94308c3dc042ffbca813300ce851412100b6526ee03594c3137a9bbfab60952',
    'Satoshi-Medium.ttf': '1b8add8dd01432467171646ee43f56ef035190f6f5002f80bc1766f03aa0f024',
    'Satoshi-Bold.ttf': '4b7a5e6f7673cf13e96ec2b8dd20897a6a1ac2e548f1bb78b475ebc4c787deaa',
    'Satoshi-Black.ttf': 'aa8747f0b1d944b32e2fa9805b9012253a5807b24e51d89a25b2b18482c6f1f4',
  } },
  { slug: 'clash-display', archiveRoot: 'ClashDisplay_Complete', files: {
    'ClashDisplay-Medium.ttf': 'd8840198f4bf1d3b78a6c73ff1edc28b212a5947c53817387171c973a30d79fd',
    'ClashDisplay-Semibold.ttf': 'ce0644787df5d697c947208c3f702f3dd3459867981f9414f28b61d9b17f81f1',
    'ClashDisplay-Bold.ttf': '2c27c46f9f9586e55a7d37439101c8bdf61008c8548fccd144d3bb2c438a06d3',
  } },
];
export function verifyFont(bytes, expected, name) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`${name}: original font checksum mismatch. Review the licensor's update before changing the pinned hash.`);
  }
}
async function verifiedLocal(family) {
  try {
    for (const [name, hash] of Object.entries(family.files)) verifyFont(await readFile(join(destination,name)),hash,name);
    return true;
  } catch { return false; }
}
export async function prepareFonts(checkOnly = false) {
  await mkdir(destination,{recursive:true});
  for (const family of families) {
    if (await verifiedLocal(family)) continue;
    if (checkOnly) throw new Error(`Missing or modified ${family.slug} originals. Run npm run fonts:prepare.`);
    const folder = await mkdtemp(join(tmpdir(),'viewrr-fonts-'));
    try {
      const response = await fetch(`https://api.fontshare.com/v2/fonts/download/${family.slug}`, {signal:AbortSignal.timeout(60_000)});
      if (!response.ok) throw new Error(`Fontshare download failed: ${response.status}`);
      const archive = Buffer.from(await response.arrayBuffer());
      if (archive.length > 10_000_000) throw new Error('Unexpectedly large font archive.');
      const zipPath = join(folder,'official.zip');
      await writeFile(zipPath,archive);
      const originals = [];
      for (const [name,hash] of Object.entries(family.files)) {
        // Extract a single fixed entry to stdout: no archive paths reach disk.
        const bytes = execFileSync('unzip',['-p',zipPath,`${family.archiveRoot}/Fonts/WEB/fonts/${name}`],{maxBuffer:2_000_000});
        verifyFont(bytes,hash,name);
        originals.push([name,bytes]);
      }
      for (const [name,bytes] of originals) {
        const temp = join(destination,`${name}.tmp`);
        await writeFile(temp,bytes);
        await rename(temp,join(destination,name));
      }
      const license = execFileSync('unzip',['-p',zipPath,`${family.archiveRoot}/License/FFL.txt`],{maxBuffer:100_000});
      await writeFile(join(destination,`FFL-${family.slug}.txt`),license);
    } finally { await rm(folder,{recursive:true,force:true}); }
  }
  console.log('Verified official Satoshi and Clash Display font files.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  prepareFonts(process.argv.includes('--check')).catch(error => { console.error(error.message); process.exitCode=1; });
}
