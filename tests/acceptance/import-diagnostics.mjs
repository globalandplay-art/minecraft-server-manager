// Pure acceptance-only classification. Input capture surfaces remain unchanged.
import { recognizePaperDiagnostics } from './phase55-paper-diagnostics.mjs';
import { recognizeFabricDiagnostics } from './phase55-fabric-diagnostics.mjs';
const timingWarning = /^\[(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\] \[Server thread\/WARN\]: Can't keep up! Is the server overloaded\? Running \d+ms or \d+ ticks behind$/u;
const javaBlocks = [
  ['java25-jna-native-access', /WARNING: A restricted method in java\.lang\.System has been called\r?\nWARNING: java\.lang\.System::load has been called by com\.sun\.jna\.Native in an unnamed module \(file:[^\r\n]*\/libraries\/net\/java\/dev\/jna\/jna\/5\.17\.0\/jna-5\.17\.0\.jar\)\r?\nWARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module\r?\nWARNING: Restricted methods will be blocked in a future release unless native access is enabled/gu],
  ['java25-joml-unsafe-deprecation', /WARNING: A terminally deprecated method in sun\.misc\.Unsafe has been called\r?\nWARNING: sun\.misc\.Unsafe::objectFieldOffset has been called by org\.joml\.MemUtil\$MemUtilUnsafe \(file:[^\r\n]*\/libraries\/org\/joml\/joml\/1\.10\.9\/joml-1\.10\.9\.jar\)\r?\nWARNING: Please consider reporting this to the maintainers of class org\.joml\.MemUtil\$MemUtilUnsafe\r?\nWARNING: sun\.misc\.Unsafe::objectFieldOffset will be removed in a future release/gu]
];
export function runtimeDiagnostic(text) {
  return /Perflib|HkeyPerformanceDataUtil|Unable to locate English counter names|Win32Exception|ERROR_INVALID_PARAMETER|Error 0x80070057|COM exception querying Win32_/u.test(text);
}
export function classifyDiagnosticText({ log = '', stdout = '', stderr = '', captureOverflow = false, prematureExit = false, shutdownAuthorized = false, paperContext = null, fabricContext = null }) {
  const surfaces = { 'latest.log': log, stdout, stderr };
  const events = new Map();
  for (const [source, text] of Object.entries(surfaces)) {
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      const event = events.get(line) ?? { text: line, sources: [], occurrences: [] };
      if (!event.sources.includes(source)) event.sources.push(source);
      event.occurrences.push({ source, line: index + 1 }); events.set(line, event);
    }
  }
  let remaining = stderr;
  const classifiedJavaWarnings = [];
  for (const [classification, pattern] of javaBlocks) remaining = remaining.replace(pattern, (text) => {
    classifiedJavaWarnings.push({ classification, text }); return '';
  });
  const all = [...events.values()];
  const paper = recognizePaperDiagnostics(surfaces, paperContext);
  const fabric = recognizeFabricDiagnostics(surfaces, fabricContext);
  const uncovered = (event) => event.occurrences.some(({ source, line }) => !paper.covered.has(`${source}:${line}`) && !fabric.covered.has(`${source}:${line}`));
  const minecraft = all.filter(({ text }) => /\[[^\]]*\/WARN\]/u.test(text));
  const classifiedMinecraftWarnings = minecraft.filter(({ text }) => timingWarning.test(text))
    .map((event) => ({ classification: 'minecraft-cant-keep-up', ...event }));
  const generic = new Set([log, stdout, remaining].flatMap((text) => text.split(/\r?\n/u)));
  return {
    errors: all.filter(({ text }) => /\bERROR\b/u.test(text)).map(({ text }) => text),
    // Raw ERROR remains visible; only exact, evidence-bound occurrences are conditional.
    blockingErrors: all.filter((event) => /\bERROR\b/u.test(event.text) && uncovered(event)).map(({ text }) => text),
    classifiedPaperDiagnostics: paper.recognized,
    classifiedFabricDiagnostics: fabric.recognized,
    blockingPaperExceptions: paperContext?.kind === 'paper' ? all.filter((event) =>
      /^(?:Exception in thread |(?:Caused by: |Suppressed: )?[\w.$]+(?:Exception|Error):)/u.test(event.text) && uncovered(event)).map(({ text }) => text) : [],
    blockingFabricExceptions: fabricContext?.kind === 'fabric' ? all.filter((event) =>
      /^(?:Exception in thread |(?:Caused by: |Suppressed: )?[\w.$]+(?:Exception|Error):)/u.test(event.text) && uncovered(event)).map(({ text }) => text) : [],
    rawDiagnosticEvents: all.filter(({ text }) => /\bERROR\b|\bWARN(?:ING)?\b/u.test(text)),
    fatalRuntimeDiagnostics: all.filter(({ text }) => runtimeDiagnostic(text) || /Encountered an unexpected exception|crash report has been saved/iu.test(text)).map(({ text }) => text),
    minecraftWarnings: minecraft.map(({ text }) => text),
    classifiedMinecraftWarnings,
    blockingMinecraftWarnings: minecraft.filter(({ text }) => !timingWarning.test(text)).map(({ text }) => text),
    // Minecraft WARNs belong to exactly one Minecraft class, never this generic class.
    unclassifiedWarnings: [...generic].filter((text) => /\bWARN(?:ING)?\b/u.test(text) && !/\[[^\]]*\/WARN\]/u.test(text) && uncovered(events.get(text))),
    classifiedJavaWarnings,
    captureOverflow, prematureExit, shutdownAuthorized,
    shutdownObserved: all.some(({ text }) => /Stopping server/u.test(text))
  };
}
export const readinessRequirements = Object.freeze([
  'processAlive', 'managedChild', 'freshDone', 'rconReady', 'listSucceeded',
  'expectedWorldLoaded', 'gamePortReady', 'rconPortReady', 'noCrashReport', 'noPrematureShutdown'
]);
export function diagnosticsAllowed(diagnostics, readiness = {}) {
  if ((diagnostics.blockingErrors ?? diagnostics.errors).length || diagnostics.fatalRuntimeDiagnostics.length || diagnostics.blockingMinecraftWarnings.length ||
      diagnostics.unclassifiedWarnings.length || diagnostics.captureOverflow || diagnostics.prematureExit ||
      diagnostics.blockingPaperExceptions?.length ||
      diagnostics.blockingFabricExceptions?.length ||
      (diagnostics.shutdownObserved && !diagnostics.shutdownAuthorized)) return false;
  const boundDiagnostic = diagnostics.classifiedPaperDiagnostics?.length > 0 || diagnostics.classifiedFabricDiagnostics?.length > 0;
  return (!boundDiagnostic || readiness.ownedChildIdentityValid === true) &&
    (!(boundDiagnostic || diagnostics.classifiedMinecraftWarnings.length) || readinessRequirements.every((key) => readiness[key] === true));
}
// Fabric uses the exact same final health evidence requirements as Paper.
export const fabricFinalDiagnosticsAllowed = paperFinalDiagnosticsAllowed;
export function paperFinalDiagnosticsAllowed(diagnostics, readiness, final) {
  return diagnosticsAllowed(diagnostics, readiness) && readinessRequirements.every((key) => readiness?.[key] === true) && readiness?.ownedChildIdentityValid === true &&
    final?.explicitManagerNormalStop === true && final.exitCode === 0 && final.exitSignal === null &&
    final.outputPipesClosed === true && final.finalStopped === true && final.recoveryRequired === false;
}
