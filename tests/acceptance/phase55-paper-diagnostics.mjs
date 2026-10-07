// Acceptance-only, opt-in profile of the exact artifacts inspected for P5.5.
// A different build/version/bytecode requires separate analysis, not a wildcard.
import { createHash } from 'node:crypto';
import { exactJoml108Block, joml108Profile, verifyDiagnosticDependencies } from './phase55-diagnostic-dependencies.mjs';

export const paperDiagnosticProfile = Object.freeze({
  paper: Object.freeze({ target: 'versions/26.2/paper-26.2.jar', sha256: '09622eeea2dc90b37a5dc8c94d275da910c9a46a4bf6570d8535189334205bff' }),
  terminal: Object.freeze({ target: 'libraries/net/minecrell/terminalconsoleappender/1.3.0/terminalconsoleappender-1.3.0.jar', sha256: '1afea1bca095068f7f4483f061feed94753be34233ddb0df9ec380fc14d5a985' }),
  joml: joml108Profile
});
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Captured before Java starts, then refreshed against that immutable copy identity
// at each classification. Source identities and isolated identities are distinct.
export async function verifyPaperDiagnosticFiles(manifest, serverRoot, baseline) {
  return verifyDiagnosticDependencies(manifest, serverRoot, baseline, 'paper', paperDiagnosticProfile);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const prefixFrames = [
  'sun.nio.ch.NioSocketImpl.timedRead', 'sun.nio.ch.NioSocketImpl.implRead', 'sun.nio.ch.NioSocketImpl.read', 'sun.nio.ch.NioSocketImpl$1.read',
  'java.net.Socket$SocketInputStream.implRead', 'java.net.Socket$SocketInputStream.read', 'sun.security.ssl.SSLSocketInputRecord.read',
  'sun.security.ssl.SSLSocketInputRecord.readHeader', 'sun.security.ssl.SSLSocketInputRecord.decode', 'sun.security.ssl.SSLTransport.decode',
  'sun.security.ssl.SSLSocketImpl.decode', 'sun.security.ssl.SSLSocketImpl.readHandshakeRecord', 'sun.security.ssl.SSLSocketImpl.startHandshake',
  'sun.security.ssl.SSLSocketImpl.startHandshake', 'sun.net.www.protocol.https.HttpsClient.afterConnect',
  'sun.net.www.protocol.https.AbstractDelegateHttpsURLConnection.connect', 'sun.net.www.protocol.http.HttpURLConnection.getInputStream0',
  'sun.net.www.protocol.http.HttpURLConnection.getInputStream', 'sun.net.www.protocol.https.HttpsURLConnectionImpl.getInputStream'
];
const suffixFrames = ['java.util.concurrent.CompletableFuture$AsyncRun.run', 'java.util.concurrent.ThreadPoolExecutor.runWorker',
  'java.util.concurrent.ThreadPoolExecutor$Worker.run', 'java.lang.Thread.run'];
const framePattern = (method) => new RegExp('^\\tat java\\.base/' + escape(method) + '\\(' + escape(method.slice(0, method.lastIndexOf('.')).split('.').at(-1).split('$')[0]) + '\\.java:\\d+\\) ~\\[\\?:\\?\\]$', 'u');
const hhmmss = '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d';
const logHeader = new RegExp('^\\[(' + hhmmss + ')\\] \\[(Paper Async Task Handler Thread - [1-9]\\d*)/ERROR\\]: (.*)$', 'u');
const stdoutHeader = new RegExp('^\\[(' + hhmmss + ') ERROR\\]: (.*)$', 'u');
const rootTail = '*** Error obtaining version information! Cannot fetch version info ***';
const queries = {
  '[PaperVersionFetcher] Error while parsing version list': { method: 'fetchMinecraftVersionList', line: 150, startupLine: 74, endpoint: 'https://fill.papermc.io/v3/projects/paper' },
  '[PaperVersionFetcher] Error while parsing version': { method: 'fetchDistanceFromSiteApi', line: 209, startupLine: 76, endpoint: 'https://fill.papermc.io/v3/projects/paper/versions/26.2/builds' }
};
function trusted(context, key) {
  const file = context?.files?.[key]; const profile = paperDiagnosticProfile[key];
  return context?.kind === 'paper' && context.javaMajor === 25 && typeof context.launchId === 'string' && context.launchId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(context.manifestSha256 ?? '') && file?.verified === true && file.target === profile.target &&
    file.sha256 === profile.sha256 && file.manifestSha256 === context.manifestSha256 && typeof file.identity === 'string' && file.identity.length > 0;
}
function completeStack(lines, start, query) {
  const count = 1 + prefixFrames.length + 2 + suffixFrames.length;
  const stack = lines.slice(start, start + count);
  if (stack.length !== count || stack[0] !== 'java.net.SocketTimeoutException: Read timed out') return null;
  if (!prefixFrames.every((method, n) => framePattern(method).test(stack[n + 1]))) return null;
  const offset = 1 + prefixFrames.length;
  if (stack[offset] !== `\tat com.destroystokyo.paper.PaperVersionFetcher.${query.method}(PaperVersionFetcher.java:${query.line}) ~[paper-26.2.jar:?]` ||
      stack[offset + 1] !== `\tat com.destroystokyo.paper.PaperVersionFetcher.getUpdateStatusStartupMessage(PaperVersionFetcher.java:${query.startupLine}) ~[paper-26.2.jar:?]` ||
      !suffixFrames.every((method, n) => framePattern(method).test(stack[offset + 2 + n]))) return null;
  if (/^(?:\s+at |Caused by:|Suppressed:|.*(?:Exception|Error):)/u.test(lines[start + count] ?? '')) return null;
  return stack;
}

// Returned occurrences, not just text strings: a duplicate unknown source stays blocking.
export function recognizePaperDiagnostics(surfaces, context) {
  const recognized = []; const covered = new Set();
  const add = (classification, source, start, lines, extra = {}) => {
    const item = { classification, status: 'conditionally-recognized', launchId: context.launchId, source, line: start + 1, text: lines.join('\n'), ...extra };
    recognized.push(item); lines.forEach((_, n) => covered.add(`${source}:${start + n + 1}`)); return item;
  };
  if (!trusted(context, 'paper')) return { recognized, covered };
  // latest.log is the thread-bearing authoritative event stream for this launch.
  // Its source occurrence index distinguishes real identical events. Other
  // captures may supply ordered copies, but never create authorization evidence.
  const logs = surfaces['latest.log'].split(/\r?\n/u); const canonical = [];
  const eventId = (line, type, text) => hash(JSON.stringify([context.launchId, 'latest.log', line + 1, type, text]));
  for (let n = 0; n < logs.length; n++) {
    const header = logHeader.exec(logs[n]); if (!header) continue;
    const query = queries[header[3]];
    if (query) {
      const stack = completeStack(logs, n + 1, query); if (!stack) continue;
      const id = eventId(n, 'query', [logs[n], ...stack].join('\n'));
      const item = add('paper-version-check-tls-read-timeout', 'latest.log', n, [logs[n], ...stack], {
        eventId: id, consumed: false, component: 'com.destroystokyo.paper.PaperVersionFetcher', endpoint: query.endpoint });
      canonical.push({ type: 'query', eventId: id, time: header[1], thread: header[2], message: header[3], stack,
        method: query.method, order: n, end: n + stack.length, consumed: false, retired: false, item });
    } else if (header[3] === rootTail) {
      const evidence = canonical.findLast((event) => event.type === 'query' && event.thread === header[2] && event.end < n && !event.consumed && !event.retired);
      if (!evidence) continue;
      // Consume the canonical evidence once. Alias captures cannot consume it again.
      evidence.consumed = true; evidence.item.consumed = true;
      // The inspected synchronous startup call performs list then builds lookup
      // on this same async thread. Its final result closes the earlier list
      // failure too; that unused evidence cannot authorize an orphan later tail.
      if (evidence.method === 'fetchDistanceFromSiteApi') for (const previous of canonical) {
        if (previous.type === 'query' && previous.thread === evidence.thread && previous.order < evidence.order &&
            previous.method === 'fetchMinecraftVersionList' && !previous.consumed) {
          previous.retired = true; previous.item.retired = true;
        }
      }
      const id = eventId(n, 'tail', logs[n]);
      add('paper-version-check-correlated-result', 'latest.log', n, [logs[n]], { eventId: id, queryEventId: evidence.eventId });
      canonical.push({ type: 'tail', eventId: id, queryEventId: evidence.eventId, time: header[1], thread: header[2], message: header[3], order: n });
    }
  }
  for (const source of ['stdout', 'stderr']) {
    const lines = surfaces[source].split(/\r?\n/u); let lastOrder = -1;
    const matchedQueries = new Set();
    for (let n = 0; n < lines.length; n++) {
      const detailed = logHeader.exec(lines[n]); const short = !detailed && stdoutHeader.exec(lines[n]);
      if (!detailed && !short) continue;
      const time = (detailed ?? short)[1], thread = detailed?.[2], message = detailed ? detailed[3] : short[2];
      const query = queries[message];
      if (query) {
        const stack = completeStack(lines, n + 1, query);
        const original = stack && canonical.find((event) => event.type === 'query' && event.order > lastOrder &&
          event.time === time && (!thread || event.thread === thread) && event.message === message && event.stack.join('\n') === stack.join('\n'));
        if (!original) continue;
        add('paper-version-check-tls-read-timeout', source, n, [lines[n], ...stack], { eventId: original.eventId,
          consumed: original.consumed, ...(original.retired ? { retired: true } : {}), component: original.item.component, endpoint: original.item.endpoint });
        lastOrder = original.order; matchedQueries.add(original.eventId);
      } else if (message === rootTail) {
        const original = canonical.find((event) => event.type === 'tail' && event.order > lastOrder && event.time === time &&
          (!thread || event.thread === thread) && matchedQueries.has(event.queryEventId));
        if (!original) continue;
        add('paper-version-check-correlated-result', source, n, [lines[n]], { eventId: original.eventId, queryEventId: original.queryEventId });
        lastOrder = original.order;
      }
    }
  }
  const stderr = surfaces.stderr.split(/\r?\n/u);
  for (let n = 0; n < stderr.length; n++) {
    if (trusted(context, 'terminal')) {
      const terminal = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.(?:\d{6}|\d{9})Z) ServerMain WARN Advanced terminal features are not available in this environment$/u.exec(stderr[n]);
      const date = terminal && Date.parse(terminal[1]);
      if (terminal && date >= Date.parse(context.startupWindow?.spawnedAt) && date <= Date.parse(context.startupWindow?.doneAt))
        add('terminalconsoleappender-1.3.0-noninteractive', 'stderr', n, [stderr[n]], { component: 'net.minecrell.terminalconsole.TerminalConsoleAppender' });
    }
    if (trusted(context, 'joml')) {
      const expected = exactJoml108Block(stderr, n, context.files.joml.fileUrl);
      if (expected) add('java25-joml-1.10.8-unsafe-deprecation', 'stderr', n, expected);
    }
  }
  return { recognized, covered };
}
