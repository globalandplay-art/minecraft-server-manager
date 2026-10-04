import { describe, expect, it } from "vitest";
import { classifyBrowserDiagnostics } from "../../../tests/acceptance/phase35-diagnostics.mjs";
import { diagnosticsAllowed, readinessRequirements } from "../../../tests/acceptance/import-diagnostics.mjs";
const warning = "[14:44:30] [Server thread/WARN]: handleDisconnection() called twice";
const lines = [
  '[14:43:46] [Server thread/INFO]: Done (2.056s)! For help, type "help"',
  '[14:43:46] [Server thread/INFO]: RCON running on 127.0.0.1:8479', warning,
  '[14:44:31] [Server thread/INFO]: System chat: [Rcon: Changed the block at 0, 80, 0]',
  '[14:44:35] [Server thread/INFO]: Stopping server',
  '[14:44:35] [Server thread/INFO]: Saving players',
  '[14:44:35] [Server thread/INFO]: Saving worlds',
  ...['overworld', 'the_nether', 'the_end'].map(d => `[14:44:35] [Server thread/INFO]: Saving chunks for level 'ServerLevel[world]'/minecraft:${d}`),
  '[14:44:35] [Server thread/INFO]: Thread RCON Listener stopped'
];
const ready = Object.fromEntries(readinessRequirements.map((key: string) => [key, true]));
const context = { verifiedReadiness: ready, readinessLines: { 'latest.log': 2, stdout: 2 }, exitCode: 0, exitSignal: null, portsReleased: true, outputClosed: true };
const run = (log = lines.join('\n'), overrides = {}, flags = {}) => classifyBrowserDiagnostics({ log, stdout: log, shutdownAuthorized: true, ...flags }, { ...context, ...overrides });
describe('P3.5 precise duplicate disconnection warning', () => {
  it('classifies only after readiness and proven clean normal shutdown, preserving raw sources', () => {
    const input = lines.join('\n'); const result = run(input);
    expect(result.blockingMinecraftWarnings).toEqual([]);
    expect(result.minecraftWarnings).toEqual([warning]);
    expect(result.classifiedMinecraftWarnings[0].classification).toBe('minecraft-handle-disconnection-duplicate-after-ready');
    expect(result.classifiedMinecraftWarnings[0].occurrences).toHaveLength(2);
    expect(diagnosticsAllowed(result, ready)).toBe(true);
    expect(run(input)).toEqual(result);
    expect(input).toBe(lines.join('\n'));
  });
  it('blocks warning before Done even with later complete readiness', () => {
    expect(run([warning, ...lines.filter(line => line !== warning)].join('\n')).blockingMinecraftWarnings).toContain(warning);
  });
  it('blocks warning after Done but before complete readiness or without a boundary', () => {
    expect(run(undefined, { readinessLines: { 'latest.log': 3, stdout: 3 } }).blockingMinecraftWarnings).toContain(warning);
    expect(run(undefined, { readinessLines: undefined }).blockingMinecraftWarnings).toContain(warning);
  });
  it.each(readinessRequirements)('blocks missing readiness %s', (key: string) => {
    expect(run(undefined, { verifiedReadiness: { ...ready, [key]: false } }).blockingMinecraftWarnings).toContain(warning);
  });
  it.each([{ exitCode: 1 }, { exitSignal: 'SIGTERM' }, { portsReleased: false }, { outputClosed: false }])('blocks incomplete shutdown %j', (override) => {
    expect(run(undefined, override).blockingMinecraftWarnings).toContain(warning);
  });
  it.each([{ prematureExit: true }, { captureOverflow: true }, { shutdownAuthorized: false }])('blocks unsafe capture %j', (flags) => {
    expect(run(undefined, {}, flags).blockingMinecraftWarnings).toContain(warning);
  });
  it.each(['[ERROR]: save failed', 'crash report has been saved', 'Perflib unavailable', 'java.io.IOException: disk failure', 'Failed to save world', '[Server thread/WARN]: unknown warning', 'WARNING: unknown'])('blocks other diagnostics %s', (line) => {
    expect(diagnosticsAllowed(run(lines.join('\n') + '\n' + line), ready)).toBe(false);
  });
  it.each(['handleDisconnection called twice', 'handleDisconnection() called three times', 'SomeOtherThing called twice'])('blocks near match %s', (text) => {
    expect(run(lines.join('\n').replace('handleDisconnection() called twice', text)).blockingMinecraftWarnings).toHaveLength(1);
  });
  it.each([3, 4, 5, 6, 7, 8, 9, 10])('blocks missing post-warning evidence at line %s', (index) => {
    expect(run(lines.filter((_, i) => i !== index).join('\n')).blockingMinecraftWarnings).toContain(warning);
  });
  it('blocks an occurrence in another surface without ordering evidence', () => {
    const result = classifyBrowserDiagnostics({ log: lines.join('\n'), stdout: warning, shutdownAuthorized: true }, context);
    expect(result.blockingMinecraftWarnings).toContain(warning);
  });
});
