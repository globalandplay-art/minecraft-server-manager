import { isSensitiveKey } from '../infra/runtime/redactor.js';
export function sensitivePropertyKey(key: string): boolean {
  return isSensitiveKey(key) || /(?:api|private|access|signing|encryption)[._-]?key/iu.test(key);
}
export function privatePropertyValue(value: string): boolean {
  return /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) ||
    /[a-z][a-z0-9+.-]*:\/\/[^\s/]*@/iu.test(value) ||
    /(?:api|private|access|signing|encryption)[._-]?key\s*[:=]/iu.test(value);
}
