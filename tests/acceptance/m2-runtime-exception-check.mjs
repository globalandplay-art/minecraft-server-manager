// Conservative extra Gate for M2 lifecycle evidence, independent of loader allowlists.
// Input must be bounded and already redacted by the acceptance capture.
export function hasRuntimeException(text) {
  return /^(?:Exception in thread "[^"\r\n]+" |(?:Caused by: )?)(?:[\w$]+\.)*[\w$]*(?:Exception|Error)(?::[^\r\n]*|$)/mu.test(text);
}
