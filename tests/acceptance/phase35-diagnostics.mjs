import { classifyDiagnosticText, readinessRequirements } from './import-diagnostics.mjs';

const duplicate = /^\[(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\] \[Server thread\/WARN\]: handleDisconnection\(\) called twice$/u;
const done = /^\[\d{2}:\d{2}:\d{2}\] \[Server thread\/INFO\]: Done \(\d+(?:\.\d+)?s\)! For help, type "help"$/u;

// P3.5 only: defer this classification until normal shutdown is fully proven.
// Every capture surface containing the warning must independently prove order.
export function classifyBrowserDiagnostics(input, context = {}) {
  const result = classifyDiagnosticText(input);
  const surfaces = { 'latest.log': input.log ?? '', stdout: input.stdout ?? '', stderr: input.stderr ?? '' };
  // An exception or explicit save failure cannot be excused by later save lines.
  const failures = Object.values(surfaces).flatMap((text) => text.split(/\r?\n/u))
    .filter((text) => /\b\w*Exception\b|Failed to save|Couldn't save|Could not save|Error saving/iu.test(text));
  result.fatalRuntimeDiagnostics = [...new Set([...result.fatalRuntimeDiagnostics, ...failures])];
  const ready = readinessRequirements.every((key) => context.verifiedReadiness?.[key] === true);
  const gate = ready && !result.errors.length && !result.fatalRuntimeDiagnostics.length &&
    !result.unclassifiedWarnings.length && !result.captureOverflow && !result.prematureExit &&
    result.shutdownAuthorized && result.shutdownObserved && context.exitCode === 0 &&
    context.exitSignal === null && context.portsReleased === true && context.outputClosed === true;
  for (const text of result.blockingMinecraftWarnings.slice()) {
    if (!gate || !duplicate.test(text)) continue;
    const occurrences = [];
    let safe = true;
    for (const [source, raw] of Object.entries(surfaces)) {
      const lines = raw.split(/\r?\n/u);
      for (const [index, line] of lines.entries()) {
        if (line !== text) continue;
        const before = lines.slice(0, index);
        const after = lines.slice(index + 1);
        const stopping = after.findIndex((entry) => /\[Server thread\/INFO\]: Stopping server$/u.test(entry));
        const saving = after.slice(stopping + 1);
        safe &&= Number.isInteger(context.readinessLines?.[source]) && index >= context.readinessLines[source] &&
          before.some((entry) => done.test(entry)) &&
          before.some((entry) => /\[Server thread\/INFO\]: RCON running on 127\.0\.0\.1:\d+$/u.test(entry)) &&
          !before.some((entry) => /Stopping server/u.test(entry)) && stopping >= 0 &&
          after.slice(0, stopping).some((entry) => /\[Server thread\/INFO\]: System chat: \[Rcon: Changed the block at -?\d+, -?\d+, -?\d+\]$/u.test(entry)) &&
          saving.some((entry) => /\[Server thread\/INFO\]: Saving players$/u.test(entry)) &&
          saving.some((entry) => /\[Server thread\/INFO\]: Saving worlds$/u.test(entry)) &&
          ['overworld', 'the_nether', 'the_end'].every((dimension) =>
            saving.some((entry) => entry.endsWith(`/minecraft:${dimension}`) && /\[Server thread\/INFO\]: Saving chunks for level /u.test(entry))) &&
          saving.some((entry) => /\[Server thread\/INFO\]: Thread RCON Listener stopped$/u.test(entry));
        occurrences.push({ source, line: index + 1 });
      }
    }
    if (!safe || !occurrences.length) continue;
    result.classifiedMinecraftWarnings.push({ classification: 'minecraft-handle-disconnection-duplicate-after-ready',
      text, sources: [...new Set(occurrences.map((entry) => entry.source))], occurrences });
    result.blockingMinecraftWarnings = result.blockingMinecraftWarnings.filter((entry) => entry !== text);
  }
  return result;
}
