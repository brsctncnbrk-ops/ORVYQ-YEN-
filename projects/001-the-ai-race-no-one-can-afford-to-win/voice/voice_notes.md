# Voice Notes — The AI Race No One Can Afford to Win

**Project:** 001-the-ai-race-no-one-can-afford-to-win
**Source:** `scripts/script.md` (post-refinement, fact-audited, script_qa-passed)
**Paste target:** `voice/voice_script.txt` (1,680 words, no headings/metadata)

## Recommended ElevenLabs voice profile

A **calm, deep-register, measured/essayistic** voice — matching the
Aperture-style documentary tone, not a bright or high-energy default:

- Lower pitch, slower baseline cadence, minimal vocal fry or upspeak.
- ElevenLabs settings: **higher Stability** (~0.65–0.75) to avoid
  emotional swings on the tense passages; **lower Style Exaggeration**
  (~0.15–0.30) to keep delivery controlled rather than dramatic/sensational;
  moderate Similarity Boost is fine.
- If choosing a stock ElevenLabs voice, favor a lower-register
  narration-style voice (e.g. a "documentary"/"news narrator" preset) over
  conversational or upbeat presets.

## Pacing target

- Target **~145–150 words per minute**. At 1,680 words this is
  approximately **672–695 seconds (~11.2–11.6 min)** of narration,
  consistent with `scripts/script_metadata.json`'s
  `estimated_duration_sec: 680` against a `target_duration_sec: 660`.
- Controlled tension throughout — no sensational delivery, even on the
  cyber/bio and dark-turning-point passages. Let the hedged, evidence-led
  language carry the weight rather than vocal emphasis.
- **Closing should run slower and more reflective** than the rest of the
  narration. Blank-line breaks and short standalone lines near the end
  ("Maybe nothing sudden.", "That work hasn't been done yet.") are
  deliberate pacing cues — read them as unhurried, weighted beats, not
  a summary rattled off quickly.

## Structural changes from `scripts/script.md`

- All Markdown headings (`# Title`, `## Hook`, `## Section: ...`) were
  **removed** — none should be spoken. The paste-ready text contains only
  narration prose.
- No wording, facts, dates, examples, or statistics were added, removed, or
  altered beyond the three already-approved editorial refinements baked
  into `scripts/script.md` (cyber-capability hedge, EU AI Act
  compliance-cost framing, closed-model misuse framing). All existing
  factual hedges ("may," "reportedly," "not independently verified in
  every detail," etc.) are preserved verbatim.
- A handful of long sentences were split into two shorter sentences at
  existing em-dash/clause boundaries purely for breath control (e.g. the
  "In controlled evaluations..." and "Late in 2025..." sentences in the
  Warning Signs / Why the Race Accelerates passages, and the paragraph
  under "Some of it is structural" in Safeguards). No clause was reworded
  or removed — only re-punctuated for a natural breath point.
- QA pass added three more splits on sentences with a long unbroken clause
  and no internal comma/dash breath point: the espionage-campaign sentence
  in the cyber passage, the "who writes the rules" sentence in The Control
  Paradox, and the "power itself" / sunset-clauses sentence in Safeguards.
  Content and wording are unchanged — only a period replacing a comma/
  connector at each split.
- Blank lines mark natural pause points between beats/paragraphs, matching
  the original section breaks.
- One ellipsis (`...`) was added on the final line ("It's still being
  decided... by people, right now.") as a deliberate dramatic pause for the
  slower, reflective closing delivery. No other ellipses were introduced.
- **No CTA is present.** `closing.cta` is `"none"` in
  `script_metadata.json` — no comment/subscribe/like prompt was added, per
  direction.

## Pronunciation / simplification notes

- No unusual proper names, foreign words, or acronyms requiring
  phoneticization appear in the narration (the script deliberately keeps
  company/product names out of the spoken text — see fact_audit resolution
  notes for claims #4, #12).
- Numbers are all spoken as ordinary language already ("half a million
  dollars," "one to five years," "double digits") — nothing requiring
  digit-by-digit reading.
- "AI" should be read as the initialism ("ay-eye"), not "artificial
  intelligence" expanded, except where the script already spells it out
  ("artificial intelligence" appears once, in the hook).

## Before recording

1. Paste `voice_script.txt` into ElevenLabs exactly as-is (no re-formatting).
2. Generate at the calm/deep profile and settings above.
3. Drop the resulting file in as `assets/audio/final_voice.mp3`.
4. Tell the orchestrator "ready" once the file is in place — that's the
   audio gate that unblocks `storyboard`.
