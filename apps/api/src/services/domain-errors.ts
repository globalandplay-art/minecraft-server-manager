export class DomainError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly safeMessage: string;
  readonly reason?: string;
  /** True when the caller cannot safely know whether a side effect completed. */
  readonly requiresRecovery: boolean;

  constructor(
    statusCode: number,
    code: string,
    safeMessage: string,
    reason?: string,
    requiresRecovery = false
  ) {
    super(safeMessage);
    this.name = "DomainError";
    this.statusCode = statusCode;
    this.code = code;
    this.safeMessage = safeMessage;
    if (reason !== undefined) {
      this.reason = reason;
    }
    this.requiresRecovery = requiresRecovery;
  }
}
