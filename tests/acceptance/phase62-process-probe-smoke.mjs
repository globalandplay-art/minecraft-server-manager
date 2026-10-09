// Read-only host probe. Does not launch Minecraft or touch any server directory.
import assert from 'node:assert/strict';
import { readWindowsProcessCounters } from '../../apps/api/src/infra/runtime/process-resources.ts';
const counters = await readWindowsProcessCounters(process.pid);
assert.equal(counters.pid, process.pid);
assert.equal(counters.executable.toLowerCase(), process.execPath.toLowerCase());
assert(counters.cpuMs >= 0 && counters.rssBytes > 0);
console.log('PASS: Windows process counters refer to the exact owned Node smoke process, not Minecraft acceptance.');
