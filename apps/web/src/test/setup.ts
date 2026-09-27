import '@testing-library/jest-dom/vitest';

Object.defineProperty(document, 'hidden', {
  configurable: true,
  value: false,
});
