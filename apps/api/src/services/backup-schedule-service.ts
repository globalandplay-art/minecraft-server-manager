import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Value } from "@sinclair/typebox/value";
import { backupScheduleResponseSchema, backupScheduleSettingsSchema, type BackupScheduleResponse, type BackupScheduleRun, type BackupScheduleUpdate } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { readBoundedRegularFile } from "../config/properties.js";
import { DomainError } from "./domain-errors.js";
import { ServerNotFoundError } from "./server-service.js";
import { missingFile, plainRestoreDirectory, syncRestoreDirectory, writeRestoreJson } from "./restore-files.js";
import type { BackupService } from "./backup-service.js";
import type { OperationService } from "./operation-service.js";

type PublicSchedule = BackupScheduleResponse["data"];
type StoredSchedule = PublicSchedule & { schemaVersion: 1; serverId: string; rootIdentity: string; daysByZone: Record<string, string> };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const unsafe = () => new DomainError(409, "SCHEDULE_STATE_UNSAFE", "备份计划需要人工检查，未执行计划", "schedule-identity-or-metadata-invalid");
const fallback = { enabled: false, localTime: "02:00", timezone: "Asia/Shanghai", allowStop: false };

/** Minute-exact daily scheduler: durable claim BEFORE submission; never replay a missed slot. */
export class BackupScheduleService {
  #tail: Promise<unknown> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #tickPending = false;
  readonly #submitted = new Set<string>();
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly backups: BackupService, private readonly managerRoot: string, private readonly clock: Clock,
    private readonly active: (serverId: string) => boolean) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(action);
    this.#tail = next.catch(() => {});
    return next;
  }
  private adapter(serverId: string) {
    const adapter = this.registry.getLocal(serverId);
    if (!this.registry.get(serverId)) throw new ServerNotFoundError();
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla") throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "备份计划仅支持本地 Vanilla 实例", "unsupported-schedule");
    return adapter;
  }
  private async identity(serverId: string) {
    const root = this.adapter(serverId).plan.rootPath;
    await plainRestoreDirectory(root);
    const stat = await lstat(root, { bigint: true });
    const canonical = await realpath(root);
    return hash(`${process.platform === "win32" ? canonical.toLowerCase() : canonical}\0${stat.dev}\0${stat.ino}\0${stat.birthtimeNs}`);
  }
  private async file(serverId: string) {
    this.adapter(serverId);
    await plainRestoreDirectory(this.managerRoot);
    const directory = path.join(this.managerRoot, "backup-schedules");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await plainRestoreDirectory(directory);
    return path.join(directory, `${serverId}.json`);
  }
  private defaultRecord(serverId: string, rootIdentity: string): StoredSchedule {
    return { schemaVersion: 1, serverId, rootIdentity, revision: hash(`default\0${serverId}\0${rootIdentity}`),
      settings: { ...fallback }, runs: [], daysByZone: {} };
  }
  private public(record: StoredSchedule): PublicSchedule {
    return structuredClone({ revision: record.revision, settings: record.settings, runs: record.runs });
  }
  private async load(serverId: string): Promise<StoredSchedule> {
    this.adapter(serverId);
    const identity = await this.identity(serverId).catch(() => { throw unsafe(); });
    const file = await this.file(serverId).catch(() => { throw unsafe(); });
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw unsafe();
      const value = JSON.parse(await readBoundedRegularFile(file, 64 * 1024, "备份计划")) as StoredSchedule;
      if (!value || value.schemaVersion !== 1 || value.serverId !== serverId || value.rootIdentity !== identity ||
        !Value.Check(backupScheduleResponseSchema.properties.data, this.public(value)) ||
        !value.daysByZone || typeof value.daysByZone !== "object" || Array.isArray(value.daysByZone) || Object.keys(value.daysByZone).length > 64 ||
        !Object.entries(value.daysByZone).every(([zone, day]) => this.validZone(zone) && typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(day)) ||
        Object.keys(value).some((key) => !["schemaVersion", "serverId", "rootIdentity", "revision", "settings", "runs", "daysByZone"].includes(key)) ||
        !this.validZone(value.settings.timezone) ||
        value.runs.some((run) => !this.validZone(run.timezone) || !Number.isFinite(Date.parse(run.claimedAt)) ||
          (value.daysByZone[run.timezone] ?? "") < run.localDate) ||
        new Set(value.runs.map((run) => run.id)).size !== value.runs.length) throw unsafe();
      return value;
    } catch (error) { if (missingFile(error)) return this.defaultRecord(serverId, identity); throw unsafe(); }
  }
  private validZone(zone: string): boolean {
    if (!/^(?:UTC|[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/u.test(zone)) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date()); return true; } catch { return false; }
  }
  private async save(record: StoredSchedule) {
    if (record.rootIdentity !== await this.identity(record.serverId)) throw unsafe();
    const file = await this.file(record.serverId);
    await writeRestoreJson(file, record);
    await syncRestoreDirectory(this.managerRoot);
  }
  async get(serverId: string): Promise<PublicSchedule> {
    return this.serialize(async () => this.public(await this.load(serverId)));
  }
  async update(serverId: string, body: BackupScheduleUpdate): Promise<PublicSchedule> {
    return this.serialize(() => this.operations.runExclusive(serverId, async () => {
      if (!Value.Check(backupScheduleSettingsSchema, body.settings) || !this.validZone(body.settings.timezone)) {
        throw new DomainError(400, "VALIDATION_ERROR", "计划时间或 IANA 时区无效", "invalid-schedule-settings");
      }
      const record = await this.load(serverId);
      if (body.revision !== record.revision) throw new DomainError(409, "SCHEDULE_REVISION_CONFLICT", "计划已变化，请刷新后重新确认", "schedule-revision-conflict");
      if (record.settings.enabled && record.runs.some((run) => run.state === "submitted" && ["queued", "running"].includes(this.operations.get(run.operationId!)?.state ?? ""))) {
        throw new DomainError(409, "OPERATION_CONFLICT", "计划备份尚未结束", "scheduled-backup-active");
      }
      if (!(body.settings.timezone in record.daysByZone) && Object.keys(record.daysByZone).length >= 64) throw unsafe();
      record.settings = { ...body.settings, timezone: new Intl.DateTimeFormat("en-US", { timeZone: body.settings.timezone }).resolvedOptions().timeZone };
      record.revision = hash(randomUUID());
      await this.save(record);
      return this.public(record);
    }));
  }
  async initialize(): Promise<void> {
    await this.serialize(async () => {
      for (const adapter of this.registry.list()) {
        if (this.registry.getLocal(adapter.serverId)?.plan.serverInfo.type !== "vanilla") continue;
        try {
          const record = await this.load(adapter.serverId);
          let changed = false;
          for (const run of record.runs) {
            if (!["claimed", "submitted"].includes(run.state)) continue;
            const outcome = run.operationId ? this.operations.get(run.operationId) : undefined;
            run.state = outcome?.state === "succeeded" ? "succeeded" : "interrupted";
            run.code = run.state === "interrupted" ? "SCHEDULE_INTERRUPTED" : null;
            changed = true;
          }
          if (changed) await this.save(record);
        } catch { /* Isolate corrupt plans: GET remains 409; lifecycle/recovery APIs stay reachable. */ }
      }
    });
  }
  start(): void {
    if (this.#timer || this.#closed) return;
    this.#timer = setInterval(() => {
      if (this.#tickPending || this.#closed) return;
      this.#tickPending = true;
      void this.tick().catch(() => {}).finally(() => { this.#tickPending = false; });
    }, 15_000);
    this.#timer.unref();
  }
  async close(): Promise<void> {
    this.#closed = true; clearInterval(this.#timer); await this.#tail;
    await Promise.all([...this.#submitted].map((id) => new Promise<void>((resolve) => {
      const terminal = () => !["queued", "running"].includes(this.operations.get(id)?.state ?? "");
      if (terminal()) { resolve(); return; }
      const unsubscribe = this.operations.subscribe((operation) => { if (operation.id === id && terminal()) { unsubscribe(); resolve(); } });
      if (terminal()) { unsubscribe(); resolve(); }
    })));
  }
  async tick(): Promise<void> {
    return this.serialize(async () => {
      if (this.#closed) return;
      for (const adapter of this.registry.list()) {
        if (this.registry.getLocal(adapter.serverId)?.plan.serverInfo.type !== "vanilla") continue;
        // One unavailable instance does not stop other instances; invalid metadata remains untouched.
        try { await this.tickServer(adapter.serverId); } catch { /* get() exposes invalid state instead of fabricated success. */ }
      }
    });
  }
  private async tickServer(serverId: string): Promise<void> {
    const record = await this.load(serverId);
    let changed = false;
    for (const run of record.runs) {
      if (run.state !== "submitted" || !run.operationId) continue;
      const outcome = this.operations.get(run.operationId);
      if (outcome && !["queued", "running"].includes(outcome.state)) {
        run.state = outcome.state === "succeeded" ? "succeeded" : outcome.state === "failed" ? "failed" : "interrupted";
        run.code = outcome.error?.code ?? null;
        this.#submitted.delete(run.operationId);
        changed = true;
      }
    }
    if (changed) await this.save(record);
    if (!record.settings.enabled) return;
    const now = this.clock.now();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: record.settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)!.value;
    const date = `${value("year")}-${value("month")}-${value("day")}`;
    if (`${value("hour")}:${value("minute")}` !== record.settings.localTime || (record.daysByZone[record.settings.timezone] ?? "") >= date) return;
    const run: BackupScheduleRun = { id: randomUUID(), localDate: date, timezone: record.settings.timezone, localTime: record.settings.localTime,
      claimedAt: now.toISOString(), operationId: null, state: "claimed", code: null };
    record.daysByZone[record.settings.timezone] = date;
    record.runs.unshift(run); record.runs = record.runs.slice(0, 30);
    // Claim is consumed even if submission fails or Manager stops immediately after this write.
    await this.save(record);
    try {
      if (!this.active(serverId)) throw new DomainError(409, "NO_ACTIVE_WORLD", "没有可计划备份的活动世界");
      const assertActive = async () => {
        if (record.rootIdentity !== await this.identity(serverId)) throw unsafe();
        if (this.#closed) throw new DomainError(409, "SCHEDULE_CLOSED", "管理器正在关闭，未启动计划备份");
        if (!this.active(serverId)) throw new DomainError(409, "NO_ACTIVE_WORLD", "没有可计划备份的活动世界");
      };
      await assertActive();
      const operation = await this.backups.create(serverId, { scope: "world-set", allowStop: record.settings.allowStop, label: `Scheduled ${date} ${record.settings.localTime}` }, run.id, "auto", assertActive);
      run.operationId = operation.id; run.state = "submitted";
      this.#submitted.add(operation.id);
    } catch (error) { run.state = "skipped"; run.code = error instanceof DomainError ? error.code : "SCHEDULE_SUBMISSION_FAILED"; }
    await this.save(record);
  }
}
