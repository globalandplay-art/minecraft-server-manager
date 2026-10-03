// Pure acceptance-only classification. Input capture surfaces remain unchanged.
const timingWarning = /^\[(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\] \[Server thread\/WARN\]: Can't keep up! Is the server overloaded\? Running \d+ms or \d+ ticks behind$/u;
const javaBlocks = [
  ['java25-jna-native-access', /WARNING: A restricted method in java\.lang\.System has been called\r?\nWARNING: java\.lang\.System::load has been called by com\.sun\.jna\.Native in an unnamed module \(file:[^\r\n]*\/libraries\/net\/java\/dev\/jna\/jna\/5\.17\.0\/jna-5\.17\.0\.jar\)\r?\nWARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module\r?\nWARNING: Restricted methods will be blocked in a future release unless native access is enabled/gu],
  ['java25-joml-unsafe-deprecation', /WARNING: A terminally deprecated method in sun\.misc\.Unsafe has been called\r?\nWARNING: sun\.misc\.Unsafe::objectFieldOffset has been called by org\.joml\.MemUtil\$MemUtilUnsafe \(file:[^\r\n]*\/libraries\/org\/joml\/joml\/1\.10\.9\/joml-1\.10\.9\.jar\)\r?\nWARNING: Please consider reporting this to the maintainers of class org\.joml\.MemUtil\$MemUtilUnsafe\r?\nWARNING: sun\.misc\.Unsafe::objectFieldOffset will be removed in a future release/gu]
];
export function runtimeDiagnostic(text) {
  return /Perflib|HkeyPerformanceDataUtil|Unable to locate English counter names|Win32Exception|ERROR_INVALID_PARAMETER|Error 0x80070057|COM exception querying Win32_/u.test(text);
}
export function classifyDiagnosticText({ log = '', stdout = '', stderr = '', captureOverflow = false, prematureExit = false, shutdownAuthorized = false }) {
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
  const minecraft = all.filter(({ text }) => /\[[^\]]*\/WARN\]/u.test(text));
  const classifiedMinecraftWarnings = minecraft.filter(({ text }) => timingWarning.test(text))
    .map((event) => ({ classification: 'minecraft-cant-keep-up', ...event }));
  const generic = new Set([log, stdout, remaining].flatMap((text) => text.split(/\r?\n/u)));
  return {
    errors: all.filter(({ text }) => /\bERROR\b/u.test(text)).map(({ text }) => text),
    fatalRuntimeDiagnostics: all.filter(({ text }) => runtimeDiagnostic(text) || /Encountered an unexpected exception|crash report has been saved/iu.test(text)).map(({ text }) => text),
    minecraftWarnings: minecraft.map(({ text }) => text),
    classifiedMinecraftWarnings,
    blockingMinecraftWarnings: minecraft.filter(({ text }) => !timingWarning.test(text)).map(({ text }) => text),
    // Minecraft WARNs belong to exactly one Minecraft class, never this generic class.
    unclassifiedWarnings: [...generic].filter((text) => /\bWARN(?:ING)?\b/u.test(text) && !/\[[^\]]*\/WARN\]/u.test(text)),
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
  if (diagnostics.errors.length || diagnostics.fatalRuntimeDiagnostics.length || diagnostics.blockingMinecraftWarnings.length ||
      diagnostics.unclassifiedWarnings.length || diagnostics.captureOverflow || diagnostics.prematureExit ||
      (diagnostics.shutdownObserved && !diagnostics.shutdownAuthorized)) return false;
  return !diagnostics.classifiedMinecraftWarnings.length || readinessRequirements.every((key) => readiness[key] === true);
}
