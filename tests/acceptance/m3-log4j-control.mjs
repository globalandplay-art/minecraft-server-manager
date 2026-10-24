// Offline control: no Minecraft main, world, port binding, dependency or logging-config edit.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import yauzl from 'yauzl';
import { neoForgeSourcePreflight } from './neoforge-source-preflight.mjs';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';

assert.equal(process.platform, 'win32');
assert.equal(process.env.LT_M3_LOG4J_CONTROL, 'AUTHORIZED_OFFLINE_CONTROL');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const manifest = await neoForgeSourcePreflight();
const config = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
const source = config.servers.find(row => row.id === 'vanilla-26-3'); assert(source);
const previousTools = JSON.parse(await readFile(path.join(workspace,
  '.manager/m3-diagnostics-f7db7f09-4386-4143-b07b-01ebe6aeae5d/report.json'), 'utf8')).tools;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runId = `m3-log4j-control-${randomUUID()}`, root = path.join(workspace, '.manager', runId);
for (let cursor = path.dirname(root);; cursor = path.dirname(cursor)) {
  assert(!(await lstat(cursor)).isSymbolicLink());
  assert.equal((await realpath(cursor)).toLowerCase(), cursor.toLowerCase());
  if (cursor === path.dirname(cursor)) break;
}
await mkdir(root);
const report = { runId, result: 'BLOCKED', strictGate: 'BLOCKED', minecraftStarts: 0, sourceWorldAccessed: false, manifestSha256: manifest.manifestSha256 };
const execute = promisify(execFile), cp = [], bin = path.dirname(source.javaExecutable);
try {
  report.toolSha256 = {};
  for (const name of ['java', 'javac']) {
    const file = path.join(bin, `${name}.exe`), stat = await lstat(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert.equal((await realpath(file)).toLowerCase(), file.toLowerCase());
    report.toolSha256[name] = hash(await readFile(file));
    assert.equal(report.toolSha256[name], previousTools[name], 'previously verified JDK tool drift');
  }
  let loader;
  for (const entry of manifest.files.filter(row => row.relative.endsWith('.jar'))) {
    const file = await readPrivatePropertiesFile(path.join(manifest.sourceRoot, entry.relative), 64 * 1024 ** 2);
    assert.equal(file.identity, entry.identity); assert.equal(file.checksum, entry.sha256); cp.push(path.join(manifest.sourceRoot, entry.relative));
    if (entry.relative === 'libraries/net/neoforged/fancymodloader/loader/12.0.12/loader-12.0.12.jar') loader = file.bytes;
  }
  assert(loader);
  const xml = await new Promise((resolve, reject) => {
    yauzl.fromBuffer(loader, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('zip-missing'));
      zip.once('error', reject); zip.once('end', () => reject(new Error('fixed-config-missing')));
      zip.on('entry', entry => {
        if (entry.fileName !== 'net/neoforged/fml/startup/log4j2.xml') return zip.readEntry();
        if (entry.uncompressedSize > 65536) { zip.close(); reject(new Error('config-limit')); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { zip.close(); reject(streamError ?? new Error('config-stream')); return; }
          const chunks = []; let size = 0;
          stream.on('data', bytes => { size += bytes.length; if (size > 65536) { stream.destroy(new Error('config-limit')); return; } chunks.push(bytes); });
          stream.once('error', error => { zip.close(); reject(error); });
          stream.once('end', () => { zip.close(); resolve(Buffer.concat(chunks)); });
        });
      }); zip.readEntry();
    });
  });
  const xmlFile = path.join(root, 'original-fml-log4j2.xml'); await writeFile(xmlFile, xml, { flag: 'wx' }); report.configSha256 = hash(xml);
  const java = `public final class Log4jControl { public static void main(String[] args) { var log=org.apache.logging.log4j.LogManager.getLogger("LT_M3_CONTROL"); log.info("LT_CONTROL_PRE_NATIVE"); boolean k=io.netty.channel.kqueue.KQueue.isAvailable(); boolean e=io.netty.channel.epoll.Epoll.isAvailable(); System.out.println("LT_CONTROL_NATIVE_RESULT="+k+","+e); if(k||e)throw new IllegalStateException("UNEXPECTED_NATIVE_AVAILABILITY"); log.error("LT_CONTROL_POST_ERROR",new RuntimeException("LT_CONTROL_ERROR_CHAIN",new IllegalStateException("LT_CONTROL_ERROR_CAUSE"))); log.fatal("LT_CONTROL_POST_FATAL",new RuntimeException("LT_CONTROL_FATAL_CHAIN",new IllegalStateException("LT_CONTROL_FATAL_CAUSE"))); log.debug("LT_CONTROL_POST_DEBUG"); org.apache.logging.log4j.LogManager.shutdown(); } }`;
  await writeFile(path.join(root, 'Log4jControl.java'), java, { flag: 'wx' }); report.javaSourceSha256 = hash(java);
  const quote = value => { assert(!/["\r\n\0]/u.test(value)); return `"${value.replaceAll('\\', '/')}"`; };
  await writeFile(path.join(root, 'compile.args'), ['-proc:none', '--release', '25', '-encoding', 'UTF-8', '-cp', quote(cp.join(path.delimiter)), quote(path.join(root, 'Log4jControl.java'))].join('\n'), { flag: 'wx' });
  await execute(path.join(bin, 'javac.exe'), ['@compile.args'], { cwd: root, windowsHide: true, shell: false, timeout: 30000, maxBuffer: 65536 });
  await writeFile(path.join(root, 'run.args'), [quote(`-Dlog4j.configurationFile=${pathToFileURL(xmlFile).href}`), '-cp', quote([root, ...cp].join(path.delimiter)), 'Log4jControl'].join('\n'), { flag: 'wx' });
  let out;
  try { out = await execute(source.javaExecutable, ['@run.args'], { cwd: root, windowsHide: true, shell: false, timeout: 15000, maxBuffer: 1024 * 1024 }); report.exitCode = 0; report.exitSignal = null; }
  catch (error) { out = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; report.exitCode = error.code; report.exitSignal = error.signal; throw error; }
  finally { if (out) { await writeFile(path.join(root, 'stdout.log'), out.stdout, { flag: 'wx' }); await writeFile(path.join(root, 'stderr.log'), out.stderr, { flag: 'wx' }); } }
  const latest = await readFile(path.join(root, 'logs/latest.log'), 'utf8'), debug = await readFile(path.join(root, 'logs/debug.log'), 'utf8');
  assert(out.stdout.includes('LT_CONTROL_NATIVE_RESULT=false,false'));
  const appenderErrors = out.stderr.split(/\r?\n/u).filter(line => /ERROR An exception occurred processing Appender/u.test(line));
  assert.equal(appenderErrors.length, 2); assert(appenderErrors.every(line => line.endsWith('Appender DebugFile')));
  for (const transport of ['kqueue', 'epoll']) assert(out.stderr.includes(`Could not initialize class io.netty.channel.${transport}.Native`));
  for (const signature of ['Only supported on OSX/BSD', 'Only supported on Linux', 'ThrowableExtendedStackTraceRenderer', 'LoaderUtil.loadClass']) {
    assert(out.stderr.includes(signature), `missing exact upstream signature:${signature}`);
  }
  for (const text of [out.stdout, out.stderr]) {
    for (const line of text.split(/\r?\n/u).filter(line => /\b(?:ERROR|FATAL)\b/u.test(line))) {
      assert(/LT_CONTROL_POST_(?:ERROR|FATAL)|ERROR An exception occurred processing Appender DebugFile/u.test(line), 'unexpected logging/configuration error');
    }
  }
  const markers = ['LT_CONTROL_POST_ERROR', 'LT_CONTROL_ERROR_CHAIN', 'LT_CONTROL_ERROR_CAUSE', 'LT_CONTROL_POST_FATAL', 'LT_CONTROL_FATAL_CHAIN', 'LT_CONTROL_FATAL_CAUSE'];
  report.coverage = markers.map(marker => ({ marker, stdout: out.stdout.includes(marker), latest: latest.includes(marker), debug: debug.includes(marker) }));
  assert(report.coverage.every(row => row.stdout && row.latest && row.debug)); assert(debug.includes('LT_CONTROL_POST_DEBUG'));
  assert(!/KQueue support is not available|Epoll support is not available/u.test(debug));
  report.nativeDebugEventsMissing = true; report.upstreamInteractionReproducedWithoutManager = true; report.result = 'PASS';
} catch (error) { report.errorCode = error.code ?? 'NO_EXPLICIT_ERROR_CODE'; report.error = String(error.message); }
finally {
  try { assert.deepEqual(await neoForgeSourcePreflight(), manifest); report.sourceInputsUnchanged = true; }
  catch { report.sourceInputsUnchanged = false; report.result = 'BLOCKED'; }
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(`${report.result}: ${runId}; Minecraft starts=0; strictGate=BLOCKED`); process.exitCode = report.result === 'PASS' ? 0 : 1;
}
