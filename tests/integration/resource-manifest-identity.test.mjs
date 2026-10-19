import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { executePluginCommand } from '../../src/interfaces/plugin/bridge.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const legacyTemplate = 'shared/templates/panorama.svg.js';
const genericTemplateHash = 'a49787714407adc40f747ee18e4e3ff9169e1ddac0ccfe3c04787a1b0cad39f7';

test('shipped legacy renderer retains its generic identity without a manifest mismatch', async () => {
  const doctor = await executePluginCommand({
    command: 'doctor',
    packageRoot,
    dataDir: fileURLToPath(new URL('../../output/doctor-readonly', import.meta.url)),
  });

  assert.equal(doctor.runtime.renderer.files[legacyTemplate], genericTemplateHash);
  assert.equal(
    doctor.diagnostics.some(diagnostic => diagnostic.code === 'RUNTIME_MISMATCH'
      && diagnostic.resource === legacyTemplate),
    false,
  );
});
