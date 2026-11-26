import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_VERSION = '1.0.0';
export const PACKAGE_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'codegen.js',
  'injected/network.js',
  'lib/id.js',
  'lib/mutex.js',
  'lib/origin.js',
  'lib/redact.js',
  'lib/selectors.js',
  'lib/schema.js',
  'lib/reducer.js',
  'lib/ai.js',
  'lib/runner.js',
  'lib/registration.js',
  'lib/report.js',
  'lib/build.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosStamp() {
  const year = 2026 - 1980;
  const time = (12 << 11) | (0 << 5);
  const date = (year << 9) | (11 << 5) | 26;
  return { time, date };
}

function zipStore(files) {
  const { time, date } = dosStamp();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, name, data]));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += local.length + name.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

export function storeBuildSource() {
  return `(function (root) {
  const api = { storeBuild: true };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
}

export async function createPackage(options = {}) {
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (version !== PACKAGE_VERSION || manifest.version !== PACKAGE_VERSION) {
    throw new Error(`Version mismatch. Expected ${PACKAGE_VERSION}, package.json is ${version}, manifest is ${manifest.version}.`);
  }
  if (manifest.description.length > 132) throw new Error('Manifest description is longer than 132 characters.');
  const files = [];
  for (const name of PACKAGE_FILES) {
    const data = name === 'lib/build.js'
      ? Buffer.from(storeBuildSource())
      : await readFile(path.join(root, name));
    files.push({ name, data });
  }
  const archive = zipStore(files);
  const directory = options.outDir || path.join(root, 'dist');
  await mkdir(directory, { recursive: true });
  const zipPath = path.join(directory, `browser-test-recorder-${PACKAGE_VERSION}.zip`);
  await writeFile(zipPath, archive);
  return { zipPath, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') };
}

const SECRET_PATTERNS = [
  /PROXY_AUTH_TOKEN\s*=\s*\S+/,
  /AI_API_KEY\s*=\s*\S+/,
  /sk-[A-Za-z0-9]{20,}/,
  /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/,
  /demo123/,
];

export async function inspectPackage(zipPath) {
  const directory = await mkdtemp(path.join(tmpdir(), 'btr-package-'));
  await new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-q', zipPath, '-d', directory], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
  });
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const referenced = new Set([
    manifest.background && manifest.background.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ].filter(Boolean));
  const popup = await readFile(path.join(directory, 'popup.html'), 'utf8');
  for (const match of popup.matchAll(/src="([^"]+)"/g)) referenced.add(match[1]);
  for (const match of popup.matchAll(/href="([^"]+\.css)"/g)) referenced.add(match[1]);
  const worker = await readFile(path.join(directory, manifest.background.service_worker), 'utf8');
  const imported = worker.match(/importScripts\(([\s\S]*?)\);/);
  if (!imported) throw new Error('The service worker does not declare importScripts.');
  for (const match of imported[1].matchAll(/'([^']+)'/g)) referenced.add(match[1]);
  const missing = [];
  for (const name of referenced) {
    try {
      await readFile(path.join(directory, name));
    } catch (error) {
      missing.push(name);
    }
  }
  if (missing.length) throw new Error(`Package is missing ${missing.join(', ')}`);
  const build = await readFile(path.join(directory, 'lib/build.js'), 'utf8');
  if (!build.includes('storeBuild: true')) throw new Error('The store package does not disable remote AI planning.');
  const names = PACKAGE_FILES;
  for (const name of names) {
    if (/\.(png)$/.test(name)) continue;
    const text = await readFile(path.join(directory, name), 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) throw new Error(`${name} matches sensitive pattern ${pattern}`);
    }
  }
  const forbidden = ['server/ai-proxy.mjs', 'test/report.test.mjs', '.env', 'node_modules/puppeteer-core/package.json'];
  for (const name of forbidden) {
    try {
      await readFile(path.join(directory, name));
      throw new Error(`Package includes ${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { directory, manifest };
}

export async function loadPackagedExtension(directory) {
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    enableExtensions: true,
    args: ['--no-first-run', '--disable-default-apps'],
  });
  try {
    const extensionId = await browser.installExtension(directory);
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    const title = await page.$eval('h1', (node) => node.textContent);
    const notice = await page.evaluate(() => {
      document.querySelector('[data-view="ai"]').click();
      return document.body.innerText;
    });
    if (title !== 'Browser Test Recorder') throw new Error(`Unexpected title ${title}`);
    if (!notice.includes('Live AI is not included in this package')) {
      throw new Error('The packaged controller does not say that Live AI is omitted.');
    }
    if (notice.includes('Live proxy')) throw new Error('The packaged controller still offers Live AI.');
    return { extensionId, title };
  } finally {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const packed = await createPackage();
  const inspected = await inspectPackage(packed.zipPath);
  let chrome = 'UNVERIFIED';
  try {
    const loaded = await loadPackagedExtension(inspected.directory);
    chrome = `loaded ${loaded.extensionId}`;
  } catch (error) {
    chrome = `UNVERIFIED ${error.message}`;
  }
  await rm(inspected.directory, { recursive: true, force: true });
  console.log(JSON.stringify({ ...packed, chrome }, null, 2));
  if (chrome.startsWith('UNVERIFIED')) process.exitCode = 1;
}
