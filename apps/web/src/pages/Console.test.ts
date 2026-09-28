import { describe, expect, it } from 'vitest';
import { validateCommand } from './Console';

describe('Console 命令输入', () => {
  it('拒绝空命令、控制字符与超过 1024 UTF-8 字节的内容', () => {
    expect(validateCommand('  ')).toMatch(/请输入/);
    expect(validateCommand('say hello\nstop')).toMatch(/控制字符/);
    expect(validateCommand(`say ${'界'.repeat(341)}`)).toMatch(/1024/);
  });

  it('接受普通单行 Minecraft 命令', () => {
    expect(validateCommand('list')).toBeNull();
    expect(validateCommand('say 服务器维护将在五分钟后开始')).toBeNull();
  });
});
