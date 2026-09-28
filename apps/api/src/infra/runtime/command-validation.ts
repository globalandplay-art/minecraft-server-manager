const MAX_COMMAND_BYTES = 1_024;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export class CommandValidationError extends Error {
  readonly code = "INVALID_COMMAND";

  constructor(message: string) {
    super(message);
    this.name = "CommandValidationError";
  }
}

export function validateMinecraftCommand(command: string): string {
  if (command.length === 0 || command.trim().length === 0) {
    throw new CommandValidationError("命令不能为空。");
  }
  if (CONTROL_CHARACTER.test(command)) {
    throw new CommandValidationError("命令不能包含换行、NUL 或控制字符。");
  }
  if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) {
    throw new CommandValidationError("命令不能超过 1024 UTF-8 字节。");
  }
  return command;
}

export { MAX_COMMAND_BYTES };
