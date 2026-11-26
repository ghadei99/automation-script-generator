import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPackage, inspectPackage, PACKAGE_FILES, storeBuildSource } from '../scripts/package-extension.mjs';

test('the store package keeps the manifest at the root and leaves out development files', async () => {
  assert.match(storeBuildSource(), /storeBuild: true/);
  assert.equal(PACKAGE_FILES.includes('server/ai-proxy.mjs'), false);
  assert.equal(PACKAGE_FILES.some((name) => name.startsWith('test/')), false);
  const directory = await mkdtemp(path.join(tmpdir(), 'btr-zip-'));
  try {
    const packed = await createPackage({ outDir: directory });
    const inspected = await inspectPackage(packed.zipPath);
    assert.equal(inspected.manifest.manifest_version, 3);
    assert.equal(inspected.manifest.version, '1.0.0');
    assert.equal(inspected.manifest.name, 'Browser Test Recorder');
    await rm(inspected.directory, { recursive: true, force: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
