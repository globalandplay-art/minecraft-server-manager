import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { PRIVATE_ACL_DESCRIPTOR_READ, PRIVATE_ACL_INSPECT_SCRIPT, WindowsPrivateAclVerifier } from '../../src/auth/windows-private-acl.js';
import { runWindowsNativeScript, nativePathData } from '../../src/auth/windows-native.js';
import { createPrivateEntry } from '../../src/auth/private-publication.js';

it.skipIf(process.platform !== 'win32')('matches legacy complete descriptors for files/directories and preserves private ACL rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcsm-acl-descriptor-'));
  try {
    const file = join(root, 'inert.txt'); await writeFile(file, 'SYNTHETIC');
    const privateFile = join(root, 'private.txt'); const acl = new WindowsPrivateAclVerifier();
    await createPrivateEntry(privateFile, false, acl);
    const legacy = PRIVATE_ACL_INSPECT_SCRIPT.replace('Read-AuthPrivateAcl', 'Read-LegacyAcl')
      .replace(PRIVATE_ACL_DESCRIPTOR_READ, '$acl=Get-Acl -LiteralPath $target');
    // Only booleans escape the helper. Never print descriptors, SIDs or paths.
    const result = await runWindowsNativeScript(`$ErrorActionPreference='Stop'\n${PRIVATE_ACL_INSPECT_SCRIPT}\n${legacy}\n` +
      `$targets=@(${[root, file, privateFile].map(nativePathData).join(',')})\n` +
      `$same=@(foreach($target in $targets){$a=Read-AuthPrivateAcl $target;$b=Read-LegacyAcl $target;` +
      `(ConvertTo-Json -InputObject $a -Depth 5 -Compress) -ceq (ConvertTo-Json -InputObject $b -Depth 5 -Compress)})\n` +
      `@{same=@($same)}|ConvertTo-Json -Compress`);
    expect(result).toEqual({ same: [true, true, true] });
    expect(await acl.verify(privateFile)).toMatch(/^[a-f0-9]{64}$/u);
    // Explicit wrong owner cannot become trusted after the reader optimization.
    expect(() => acl.verifyNativeSnapshot({ userSid: 'S-1-5-21-1', ownerSid: 'S-1-5-18', protected: true, aces: [] }))
      .toThrow('AUTH_PRIVATE_UNSAFE');
  } finally { await rm(root, { recursive: true }); }
}, 20_000);
