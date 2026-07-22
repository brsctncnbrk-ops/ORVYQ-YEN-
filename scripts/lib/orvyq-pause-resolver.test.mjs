import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFullFilmPauses } from "./orvyq-pause-resolver.mjs";

// Minimal synthetic word timeline: "Not someday. Right now. It works well.
// Right now is not later." at one word per 0.5s, matching how real ASR
// output from voice/narration_alignment.json is shaped.
function wordsFrom(text, secondsPerWord = 0.5) {
  return text.split(/\s+/).map((w, i) => ({ text: w, start: i * secondsPerWord, end: (i + 1) * secondsPerWord - 0.05, probability: 0.9 }));
}

test("resolves a single anchor to the real end timestamp of the matched phrase", () => {
  const words = wordsFrom("Not someday. Right now. Then it continued for a while longer here.");
  const { pauses } = resolveFullFilmPauses({ words, anchors: [{ anchor_text: "Not someday. Right now.", purpose: "present tense turn", planned_seconds: 4 }] });
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].source_time_seconds, words[3].end);
  assert.equal(pauses[0].duration_seconds, 4);
});

test("multiple similar phrases: matches the first occurrence at or after the previous anchor", () => {
  const words = wordsFrom("Right now is fine. Later we said right now again just to test matching. And then the narration continued on for a good while longer past that point.");
  const anchors = [
    { anchor_text: "Right now is fine.", purpose: "first", planned_seconds: 3 },
    { anchor_text: "right now again just to test matching.", purpose: "second", planned_seconds: 3 }
  ];
  const { pauses } = resolveFullFilmPauses({ words, anchors });
  assert.equal(pauses.length, 2);
  assert.ok(pauses[1].source_time_seconds > pauses[0].source_time_seconds);
});

test("throws when an anchor cannot be found in the narration", () => {
  const words = wordsFrom("This narration never mentions the missing phrase at all.");
  assert.throws(
    () => resolveFullFilmPauses({ words, anchors: [{ anchor_text: "Nothing like this exists here.", purpose: "x", planned_seconds: 3 }] }),
    /was not found/
  );
});

test("throws when a later anchor would resolve before or at an earlier pause (overlap)", () => {
  // Second anchor's text is fully contained before the first anchor's match
  // position, so searching forward-only from the cursor should fail to find
  // it again (already consumed) -- confirms pauses cannot overlap or go
  // backwards.
  const words = wordsFrom("Alpha beta gamma. Delta epsilon zeta. Then the recording kept going for quite a while after this point too.");
  const anchors = [
    { anchor_text: "Delta epsilon zeta.", purpose: "first", planned_seconds: 3 },
    { anchor_text: "Alpha beta gamma.", purpose: "second, but earlier in the text", planned_seconds: 3 }
  ];
  assert.throws(() => resolveFullFilmPauses({ words, anchors }), /was not found/);
});

test("throws when a pause resolves too close to the end of the narration", () => {
  const words = wordsFrom("It is still being decided by people right now.");
  assert.throws(
    () => resolveFullFilmPauses({ words, anchors: [{ anchor_text: "right now.", purpose: "final", planned_seconds: 4 }], minSecondsFromNarrationEnd: 3 }),
    /closer than the required/
  );
});

test("throws when an anchor does not end at a sentence boundary", () => {
  const words = wordsFrom("Not someday right now continues without punctuation here");
  assert.throws(
    () => resolveFullFilmPauses({ words, anchors: [{ anchor_text: "Not someday right now", purpose: "x", planned_seconds: 3 }] }),
    /sentence boundary/
  );
});

test("allows the final anchor in a multi-anchor list to resolve at the very end of the narration (closing hold)", () => {
  const words = wordsFrom("Not someday. Right now. It is still being decided by people right now.");
  const anchors = [
    { anchor_text: "Not someday. Right now.", purpose: "present tense turn", planned_seconds: 4 },
    { anchor_text: "It is still being decided by people right now.", purpose: "final human-agency landing and music decay", planned_seconds: 6 }
  ];
  const { pauses } = resolveFullFilmPauses({ words, anchors });
  assert.equal(pauses.length, 2);
  assert.equal(pauses[1].source_time_seconds, words.at(-1).end);
});

test("throws when planned_seconds is outside the allowed pause duration range", () => {
  const words = wordsFrom("Not someday. Right now. It kept going for a while after that point.");
  assert.throws(
    () => resolveFullFilmPauses({ words, anchors: [{ anchor_text: "Not someday. Right now.", purpose: "x", planned_seconds: 0.1 }] }),
    /invalid planned_seconds/
  );
});
