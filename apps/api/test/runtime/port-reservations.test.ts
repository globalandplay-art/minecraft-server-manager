import { expect, it } from 'vitest';
import { RuntimePortReservations } from '../../src/infra/runtime/port-reservations.js';

it('reserves both roles atomically and rejects cross-role conflicts', () => {
  const ports = new RuntimePortReservations(), first = ports.acquire(25000, 25001);
  expect(() => ports.acquire(25002, 25001)).toThrow(expect.objectContaining({ code: 'INSTANCE_PORT_CONFLICT' }));
  expect(() => ports.acquire(25001, null)).toThrow();
  // Failure did not reserve the non-conflicting first port of the rejected set.
  const other = ports.acquire(25002, null); other.release(); first.release();
  expect(ports.acquire(25000, 25001).active).toBe(true);
});
it('late duplicate release cannot remove a new launch reservation', () => {
  const ports = new RuntimePortReservations(), old = ports.acquire(25000, null);
  old.release(); const current = ports.acquire(25000, null); old.release();
  expect(old.active).toBe(false); expect(current.active).toBe(true);
  expect(() => ports.acquire(25000, null)).toThrow();
});
it.each([0, 65536, 1.5, NaN])('rejects invalid port %s without retaining any reservation', port => {
  const ports = new RuntimePortReservations(); expect(() => ports.acquire(25000, port)).toThrow();
  expect(ports.acquire(25000, null).active).toBe(true);
});
it('rejects game and RCON sharing one port within the same plan', () => {
  const ports = new RuntimePortReservations(); expect(() => ports.acquire(25000, 25000)).toThrow();
  expect(ports.acquire(25000, null).active).toBe(true);
});
