import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadWithRetry } from "./orvyq_fetch_music.mjs";

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("downloadWithRetry returns the response bytes on first-attempt success without retrying", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls += 1;
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("audio-bytes").buffer };
    },
    async () => {
      const bytes = await downloadWithRetry("https://example.invalid/track.mp3", {}, { attempts: 3, delaysMs: [0, 0] });
      assert.equal(bytes.toString(), "audio-bytes");
      assert.equal(calls, 1);
    }
  );
});

test("downloadWithRetry retries after a transient network error and succeeds once the fetch recovers", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("fetch failed");
        error.cause = { code: "ETIMEDOUT" };
        throw error;
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("recovered").buffer };
    },
    async () => {
      const bytes = await downloadWithRetry("https://example.invalid/track.mp3", {}, { attempts: 3, delaysMs: [0, 0] });
      assert.equal(bytes.toString(), "recovered");
      assert.equal(calls, 3);
    }
  );
});

test("downloadWithRetry reports the HTTP status code when the response is not ok", async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 503 }),
    async () => {
      await assert.rejects(
        () => downloadWithRetry("https://example.invalid/track.mp3", {}, { attempts: 1, delaysMs: [] }),
        /HTTP 503/
      );
    }
  );
});

test("downloadWithRetry gives up after the configured attempt count, preserving the last error as cause", async () => {
  let calls = 0;
  const networkError = new Error("fetch failed");
  networkError.cause = { code: "ENOTFOUND" };
  await withMockedFetch(
    async () => {
      calls += 1;
      throw networkError;
    },
    async () => {
      await assert.rejects(
        () => downloadWithRetry("https://example.invalid/track.mp3", {}, { attempts: 3, delaysMs: [0, 0] }),
        (error) => {
          assert.match(error.message, /after 3 attempts/);
          assert.equal(error.cause, networkError);
          return true;
        }
      );
      assert.equal(calls, 3);
    }
  );
});

test("downloadWithRetry does not retry beyond the configured attempts or invent a fallback source", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls += 1;
      throw new Error("fetch failed");
    },
    async () => {
      await assert.rejects(() => downloadWithRetry("https://example.invalid/track.mp3", {}, { attempts: 3, delaysMs: [0, 0] }));
      assert.equal(calls, 3, "must stop at exactly the configured attempt count, never more");
    }
  );
});
