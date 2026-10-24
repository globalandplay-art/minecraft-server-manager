import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Build local, reviewable annotation-only test code against hash-verified
 * source dependencies. No downloader, Gradle, shell, source-world access. */
export async function buildMarkerMod({ manifest, javaExecutable, evidence, runId }) {
  assert(['forge', 'neoforge'].includes(manifest.kind));
  assert(/^[a-z0-9-]+$/u.test(runId));
  const root = path.join(evidence, 'marker-build'); await mkdir(root);
  const classes = path.join(root, 'classes'), resources = path.join(root, 'resources');
  await mkdir(classes); await mkdir(path.join(resources, 'META-INF'), { recursive: true });
  const javaBin = path.dirname(javaExecutable);
  for (const name of ['java.exe', 'javac.exe', 'jar.exe']) {
    const file = path.join(javaBin, name), info = await lstat(file);
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
    assert.equal((await realpath(file)).toLowerCase(), file.toLowerCase());
  }
  const marker = `LT_M3_MARKER_LOADED_${runId}`;
  const source = `package ltacceptance;\n@${manifest.kind === 'forge' ? 'net.minecraftforge' : 'net.neoforged'}.fml.common.Mod("lt_m3_marker")\npublic final class MarkerMod { public MarkerMod() { System.out.println("${marker}"); } }\n`;
  const sourceFile = path.join(root, 'MarkerMod.java'); await writeFile(sourceFile, source, { flag: 'wx' });
  const classpath = [];
  for (const item of manifest.files.filter(item => item.relative.endsWith('.jar'))) {
    const file = path.join(manifest.sourceRoot, item.relative), bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    classpath.push(file);
  }
  const quote = value => { assert(!/[\r\n"\0]/u.test(value)); return `"${value.replaceAll('\\', '/')}"`; };
  const args = path.join(root, 'javac-args.txt');
  await writeFile(args, ['-proc:none', '--release', '25', '-encoding', 'UTF-8', '-classpath', quote(classpath.join(path.delimiter)),
    '-d', quote(classes), quote(sourceFile)].join('\n'), { flag: 'wx' });
  const execute = async (file, argv) => {
    try { await promisify(execFile)(file, argv, { shell: false, windowsHide: true, cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
    catch (error) {
      await writeFile(path.join(root, 'build-error.log'), `${String(error.stdout ?? '')}\n${String(error.stderr ?? '')}`);
      throw new Error(`MARKER_BUILD_FAILED:${error.code ?? 'NO_EXPLICIT_ERROR_CODE'}`);
    }
  };
  await execute(path.join(javaBin, 'javac.exe'), [`@${args}`]);
  const descriptor = `modLoader="javafml"\nloaderVersion="[1,)"\nlicense="MIT"\n[[mods]]\nmodId="lt_m3_marker"\nversion="1.0.0"\ndisplayName="LT isolated acceptance marker"\n`;
  await writeFile(path.join(resources, 'META-INF', manifest.kind === 'forge' ? 'mods.toml' : 'neoforge.mods.toml'), descriptor, { flag: 'wx' });
  const jar = path.join(root, 'lt-m3-marker.jar');
  await execute(path.join(javaBin, 'jar.exe'), ['--create', '--file', jar, '-C', classes, '.', '-C', resources, '.']);
  const bytes = await readFile(jar);
  return { bytes, marker, sha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: createHash('sha256').update(source).digest('hex') };
}
