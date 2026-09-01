import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createBreaker, isFatal, oraErrorNumber } = require('../../server/db/circuitBreaker.js');

// A controllable clock so backoff is asserted, not slept through.
function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

// oracledb sets errorNum; some paths only give the message text.
const oraErr = (num, msg) => Object.assign(new Error(`ORA-${String(num).padStart(5, '0')}: ${msg}`), { errorNum: num });
const textOnlyErr = num => new Error(`ORA-${String(num).padStart(5, '0')}: something went wrong`);
const networkErr = () => Object.assign(new Error('connect ECONNREFUSED 10.1.1.221:1521'), { code: 'ECONNREFUSED' });

const build = (clock, opts = {}) => createBreaker({
  now: clock.now, baseDelayMs: 1000, maxDelayMs: 60000, failureThreshold: 3, ...opts,
});

describe('oraErrorNumber', () => {
  it('reads errorNum when oracledb supplies it', () => {
    expect(oraErrorNumber(oraErr(28000, 'the account is locked'))).toBe(28000);
  });

  it('falls back to parsing the message', () => {
    expect(oraErrorNumber(textOnlyErr(1017))).toBe(1017);
  });

  it('returns null for non-Oracle errors', () => {
    expect(oraErrorNumber(networkErr())).toBeNull();
  });
});

describe('isFatal', () => {
  // These are the errors where retrying is what caused the incident.
  it.each([
    [28000, 'account locked'],
    [1017,  'invalid username/password'],
    [28001, 'password expired'],
    [1005,  'no password given'],
    [12154, 'TNS could not resolve'],
  ])('treats ORA-%i (%s) as fatal', num => {
    expect(isFatal(oraErr(num, 'x'))).toBe(true);
  });

  it.each([
    [12541, 'no listener'],
    [12170, 'connect timeout'],
    [3113,  'end-of-file on communication channel'],
  ])('treats ORA-%i (%s) as transient', num => {
    expect(isFatal(oraErr(num, 'x'))).toBe(false);
  });

  it('treats network errors as transient', () => {
    expect(isFatal(networkErr())).toBe(false);
  });
});

describe('credential failures block permanently', () => {
  it('blocks on the first ORA-28000 and never retries on its own', () => {
    const clock = makeClock();
    const b = build(clock);

    b.assertAllowed();
    b.recordFailure(oraErr(28000, 'the account is locked'));

    expect(b.status().state).toBe('blocked');
    expect(() => b.assertAllowed()).toThrow(/blocked/i);

    // Not after a minute, an hour, or a day — a locked account needs a human.
    for (const ms of [60_000, 3_600_000, 86_400_000]) {
      clock.advance(ms);
      expect(() => b.assertAllowed()).toThrow(/blocked/i);
    }
  });

  it('blocks on ORA-01017 — the error that trips the lockout', () => {
    const clock = makeClock();
    const b = build(clock);
    b.assertAllowed();
    b.recordFailure(oraErr(1017, 'invalid username/password'));
    expect(b.status().state).toBe('blocked');
  });

  it('names the underlying Oracle error so the cause is visible', () => {
    const clock = makeClock();
    const b = build(clock);
    b.assertAllowed();
    b.recordFailure(oraErr(28000, 'the account is locked'));

    expect(() => b.assertAllowed()).toThrow(/ORA-28000/);
    expect(b.status().lastError.oraErrorNum).toBe(28000);
  });

  it('clears only on an explicit reset', () => {
    const clock = makeClock();
    const b = build(clock);
    b.assertAllowed();
    b.recordFailure(oraErr(28000, 'locked'));
    expect(() => b.assertAllowed()).toThrow();

    b.reset();
    expect(b.status().state).toBe('closed');
    expect(() => b.assertAllowed()).not.toThrow();
  });
});

describe('transient failures back off exponentially', () => {
  it('stays closed below the failure threshold', () => {
    const clock = makeClock();
    const b = build(clock);
    b.assertAllowed(); b.recordFailure(networkErr());
    b.assertAllowed(); b.recordFailure(networkErr());
    expect(b.status().state).toBe('closed');
    expect(() => b.assertAllowed()).not.toThrow();
  });

  it('opens at the threshold and rejects during cooldown', () => {
    const clock = makeClock();
    const b = build(clock);
    for (let i = 0; i < 3; i++) { b.assertAllowed(); b.recordFailure(networkErr()); }

    expect(b.status().state).toBe('open');
    expect(() => b.assertAllowed()).toThrow(/paused/i);

    clock.advance(999);
    expect(() => b.assertAllowed()).toThrow(/paused/i);
  });

  it('allows exactly one probe once the cooldown elapses', () => {
    const clock = makeClock();
    const b = build(clock);
    for (let i = 0; i < 3; i++) { b.assertAllowed(); b.recordFailure(networkErr()); }

    clock.advance(1000);
    expect(() => b.assertAllowed()).not.toThrow();   // the probe
    expect(() => b.assertAllowed()).toThrow();       // everyone else waits
  });

  it('doubles the cooldown each time the probe fails, up to the cap', () => {
    const clock = makeClock();
    const b = build(clock, { maxDelayMs: 8000 });
    for (let i = 0; i < 3; i++) { b.assertAllowed(); b.recordFailure(networkErr()); }
    expect(b.status().retryInMs).toBe(1000);

    for (const expected of [2000, 4000, 8000, 8000]) {
      clock.advance(b.status().retryInMs);
      b.assertAllowed();
      b.recordFailure(networkErr());
      expect(b.status().retryInMs).toBe(expected);
    }
  });

  it('closes and resets counters when the probe succeeds', () => {
    const clock = makeClock();
    const b = build(clock);
    for (let i = 0; i < 3; i++) { b.assertAllowed(); b.recordFailure(networkErr()); }

    clock.advance(1000);
    b.assertAllowed();
    b.recordSuccess();

    const s = b.status();
    expect(s.state).toBe('closed');
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastError).toBeNull();
  });
});

// The regression test for the actual incident: a locked account plus a caller
// that retries every ~22ms. Previously that produced ~46 connection attempts a
// second, every one of them a line in the listener log.
describe('regression: locked account under a hot retry loop', () => {
  it('makes one connection attempt, not thousands', () => {
    const clock = makeClock();
    const b = build(clock);

    let attempts = 0;
    const connect = () => {
      b.assertAllowed();          // throws without touching the network once blocked
      attempts += 1;              // stands in for a real connect reaching the listener
      throw oraErr(28000, 'the account is locked');
    };

    let rejectedWithoutIO = 0;
    // 60 seconds of the observed 22ms cadence.
    for (let i = 0; i < 2727; i++) {
      try {
        connect();
      } catch (err) {
        if (err.code === 'DB_CIRCUIT_BLOCKED') rejectedWithoutIO += 1;
        else b.recordFailure(err);
      }
      clock.advance(22);
    }

    expect(attempts).toBe(1);
    expect(rejectedWithoutIO).toBe(2726);
    expect(b.status().state).toBe('blocked');
  });

  it('bounds attempts for a sustained outage that is genuinely transient', () => {
    const clock = makeClock();
    const b = build(clock, { baseDelayMs: 1000, maxDelayMs: 300000 });

    const ERR = networkErr();       // hoisted; building errors dominates the loop
    const WINDOW_MS = 10 * 60 * 1000;
    const TICK_MS = 22;             // the cadence actually observed in log.xml

    let attempts = 0;
    for (let elapsed = 0; elapsed < WINDOW_MS; elapsed += TICK_MS) {
      try {
        b.assertAllowed();
        attempts += 1;              // stands in for a connect reaching the listener
        throw ERR;
      } catch (err) {
        if (err.code !== 'DB_CIRCUIT_OPEN') b.recordFailure(err);
      }
      clock.advance(TICK_MS);
    }

    // Same ten minutes at the observed cadence would have been ~27,000 attempts.
    // Exponential backoff to a 5-minute cap keeps it to the initial burst plus
    // roughly one probe per doubling.
    expect(attempts).toBeLessThan(20);
    expect(b.status().state).toBe('open');
  });
});
