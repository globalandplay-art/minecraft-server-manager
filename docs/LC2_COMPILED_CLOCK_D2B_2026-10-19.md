# D2b conservative deadline mapping — source-only candidate

No native calibration, launch or epoch authority is implemented. This is a pure
integer mapping component proposed for D1's dedicated future transport. Existing
performance.now-based action/session timers remain unchanged and authoritative.

## Selected model

Use Node monotonic nanosecond coordinates and broker QPC ticks with a trusted
frequency. During a single already-admitted bootstrap handshake, Node brackets
one broker sample by sentNs and receivedNs. Fixed candidate limits: round trip
at most250ms, signed-positive64-bit input values, frequency1MHz..1GHz, conservative
1ms conversion/measurement guard and at most40s mapping lifetime. These restrict
admission; none extends the existing request, child, rotation or action budget.
No repeated sampling to find a favourable result. Unsupported clock source,
untrusted frequency, negative/backwards clock or unknown calibration means refusal.

Let Rlo=floor(remoteTicks*1e9/frequency), Rhi=ceil(...).
The same-host monotonic offset interval is:

```text
offsetLow  = sentNs     - Rhi - guard
offsetHigh = receivedNs - Rlo + guard
```

For a trusted existing Node deadline D, choose:

```text
remoteExpiryTicks = floor((D - offsetHigh)*frequency/1e9)
```

Thus even the largest admitted offset cannot make broker expiry later than D.
All arithmetic is bigint; no floating midpoint, nearest rounding or receive-time
plus fresh timeout. Reject nonpositive expiry, expired mapping/deadline or expiry
at/before the current possible tick upper bound. Callers still enforce the original5s
query/50s action and supply their minimum; this utility creates no new timer.

The projected output must also fit1..2^63-1 native signed ticks; no truncation.
Node current time must never go backwards across uses. Mapping origin is pinned
to sentNs and cannot be renewed; at40s it is invalid. Bad input, backwards time,
expiry or a rejected projection permanently invalidates this candidate instance.
Native MUST verify
current QPC time against the received absolute tick deadline before work; Node
MUST reject late replies under its original timer. An expired permit in transit
cannot become fresh merely by arriving later.

## Trust and integration boundaries

The pure constructor validates arithmetic shape, not native clock identity. No
API/config/environment input may provide calibration, frequency or existing
deadline. Node monotonic domain differs from existing performance.now origin:
future composition must conservatively bracket that conversion too, or refuse;
it cannot pass raw performance.now milliseconds as nanoseconds. The1ms guard is
a conservative candidate assumption requiring native validation, not measured
precision or proof for arbitrary clocks/VM drift.

Windows QPC same-host/frequency properties and libuv's Windows hrtime implementation
motivate this choice; they do not establish the deployed Node/native measurement
error. Before native execution, verify the packaged runtime implementation and
guard suitability. No use of wall-clock Date.now or Stopwatch elapsed-since-start.
No HResult/ACL/permissions changes.

## Deterministic verification before any native use

Test asymmetric round trips, non-divisible tick frequencies, nonzero/negative
offsets, worst-case offset endpoints and large coordinates. For every accepted
projection and every admitted offset endpoint, exact rational arithmetic must
show projected Node expiry <= original D. Test stale/backwards/malformed clocks,
boundary250ms RTT/40s lifetime, expired/tight deadlines and no automatic reset.
No sleep/native process needed. Passing these tests proves only the pure mapping.

## Primary references

- [Windows high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)
- [libuv Windows hrtime source](https://github.com/libuv/libuv/blob/v1.x/src/win/util.c)

Independent design review: P1=0/P2=0/P3=2 (output signed range and precise lifetime/
invalidation rules). Both are resolved by the explicit rules above. Source-only
implementation review is now complete: source P1/P2/P3=0. Two evidence descriptions
were corrected: current possible tick upper bound (not lower), and36 rational
test cases (4 frequencies x3 offsets x3 asymmetric brackets), not48. Focused
control+clock:87 PASS/exit0. Native proof and complete D2 remain pending.

## Supplied performance.now origin bridge

The pure `CompiledPerformanceBridge` now converts supplied values only: one
hrtimeNs sample bracketed by beforeMs/afterMs, with guarded floor/ceil coordinate
bounds. It does not take a real sample or validate its ordering/provenance.
It subtracts guard and uses the smallest admitted H-P offset for the original
performance deadline; stale/backwards/tight/overflow cases permanently reject.
Maximum supplied performance coordinate is9e12ms. Floating multiplication followed
by floor/ceil alone is not exact outward arithmetic; the conservative result
depends on the1ms guard bounding representation/measurement error. Native/runtime
guard suitability is still unverified. A composed-domain test checks nonextension.

The expanded clock focused suite is33 PASS/exit0. Independent bridge delta review:
source P1/P2=0, oneP3 obsolete module comment corrected to state supplied-coordinate
conversion. No clocks, processes or real calibration were sampled.
