import { DomainError } from '../../services/domain-errors.js';

export interface RuntimePortLease {
  readonly active: boolean;
  readonly rconPort: number | null;
  release(): void;
}

/** In-process arbitration only, not an OS socket reservation or listener identity proof. */
export class RuntimePortReservations {
  readonly #owners = new Map<number, symbol>();

  acquire(gamePort: number, rconPort: number | null): RuntimePortLease {
    const ports = rconPort === null ? [gamePort] : [gamePort, rconPort];
    if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535) ||
      new Set(ports).size !== ports.length || ports.some(port => this.#owners.has(port))) {
      throw new DomainError(409, 'INSTANCE_PORT_CONFLICT', '游戏或 RCON 端口与正在启动或运行的实例冲突；未启动新进程');
    }
    const owner = Symbol('launch');
    for (const port of ports) this.#owners.set(port, owner);
    let released = false;
    return Object.freeze({ rconPort,
      get active() { return !released; },
      release: () => {
        if (released) return;
        released = true;
        for (const port of ports) if (this.#owners.get(port) === owner) this.#owners.delete(port);
      }
    });
  }
}
