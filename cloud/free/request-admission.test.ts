import assert from 'node:assert/strict';
import { it } from 'node:test';
import { RequestAdmission } from './request-admission';

it('admits one request, bounds waiting, cancels waiters and makes release idempotent', async () => {
  const admission = new RequestAdmission(1, 1000);
  const first = await admission.acquire();
  const cancelled = new AbortController();
  const waiting = admission.acquire(cancelled.signal);
  await assert.rejects(admission.acquire(), /queue full/);
  cancelled.abort(); await assert.rejects(waiting, /cancelled/);
  const next = admission.acquire();
  first(); const second = await next;
  first(); // Releasing an old lease twice must not open a second active slot.
  const third = admission.acquire();
  await assert.rejects(admission.acquire(), /queue full/);
  second(); const releaseThird = await third; releaseThird();
  const recovered = await admission.acquire(); recovered();
});

it('expires waiting requests within the configured deadline and leaves subsequent admission usable', async () => {
  const admission = new RequestAdmission(1, 10);
  const first = await admission.acquire();
  await assert.rejects(admission.acquire(), /timeout/);
  first(); const recovered = await admission.acquire(); recovered();
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(admission.acquire(aborted.signal), /cancelled/);
  assert.throws(() => new RequestAdmission(9, 1000), /limits/);
  assert.throws(() => new RequestAdmission(8, 10001), /limits/);
});
