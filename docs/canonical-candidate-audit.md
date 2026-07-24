# Faz A — Canonical Candidate Audit (pre-transformation)

Recorded before any architectural change, per task instructions. Branch rebuilt from
`claude/orvyq-assets-soundtrack-port-noz6bi` (itself a direct descendant of
`claude/orvyq-rebuild-canonical-udc3rx`) onto the designated branch
`claude/orvyq-canonical-candidate-parity-bl7w0u`.

## 1. Branch / commit state at audit time

- Source branch: `claude/orvyq-assets-soundtrack-port-noz6bi` @ `50bd976dba099813d29ac508e9ed05fc8f7b489b`
- Designated working branch reset to that commit (working tree was clean; no local
  changes existed to lose — the previously-pushed `bl7w0u` history, built on an
  unrelated `main`-derived lineage full of one-off "full-render technical-test"
  tracker commits, was superseded, not merged, since no PR existed against it).
- No open PRs existed anywhere in the repository at audit time.

## 2. This is not a from-scratch mess — it is a mature, already-partially-converged system

Contrary to the "proof vs full are two disjoint creative modes" framing in the task
brief, the checked-out branch has *already* migrated a meaningful part of the way to a
single-candidate model:

- `scripts/orvyq_edit_plan.mjs`'s `buildCanonicalEditPlan()` always calls one
  `buildFullPlan()` and reads one data model
  (`editorial_blueprint.json.full_production.shots`). `mode: "proof"` no longer
  dispatches to a separate generator/file/schema — it only changes
  `frame_range.end_frame` via `resolveProofBoundaryFrame()`, which locates a real emphasis
  card by anchor text and truncates the *same* candidate. Comments in the file describe
  this explicitly as "proof is a genuine frame-prefix of the full candidate, not a
  separately-authored cut."
- `orvyq_audio_mix.mjs --mode=full --allow-prefix-truncation` builds the *entire* real
  paused narration + full 9-cue music mix and only trims the final output file to the
  proof boundary — "this is not a separate proof-only soundtrack: it is the real full
  mix, cut short at render time."
- `orvyq-proof.yml` already uploads the rendered MP4 as an artifact with `if: always()`
  *before* the final "stop when post-render media QA failed" gate step, i.e. the
  MP4-survives-QA-failure requirement (task §16 item 9) is already implemented for the
  proof workflow.
- `orvyq_frozen_candidate.mjs` / `orvyq_verify_approval.mjs` already hash
  edit-plan/captions/audio-mix/asset-registry and catch real historical drift (the repo's
  own history has a documented incident: a later proof run silently replaced
  `frozen_candidate.json` without a new approval, which `verifyApprovalRecord()` was
  written specifically to catch).

**What this means for the rest of the task:** the required work is a further
tightening/consolidation and a removal of specific *creative-decision-making* code paths
still embedded in the generators — not a green-field rebuild of the freeze/approval/
render-dispatch model, which already exists in a materially compliant shape.

## 3. Confirmed forbidden patterns, with exact locations

All of the mechanical/backfill patterns the task brief describes as forbidden are real
and present today in `scripts/orvyq_full_production_plan.mjs`:

| Forbidden pattern (task §6) | Confirmed location |
|---|---|
| Fixed evidence→context→metaphor rotation | `sliceClaimWindow()`, `roleRotation = ["evidence","context","metaphor"]` (line ~373), applied mechanically by `i % 3` |
| Every-third-slice becomes a "boundary" tension card | `kindRotation`'s third slot is hardcoded `"boundary"` (line ~371) |
| Artificial duration variation to pass the pacing test | `DURATION_VARIATION_DELTA` (line 362) and the "final duration-variety correction" pass (lines ~966–1057) — **the code's own comment says this exists because "scripts/orvyq_pacing_audit.mjs fails any 3 consecutive shots... sharing one duration," i.e. it is gaming that exact QA check**, which is precisely what task §6/§20 forbid. |
| Automatic stock backfill to hit footage-ratio targets | `pickFootageFor()` / `FULL_FOOTAGE_POOL` (lines ~152–178, ~797–816), a rotation-based picker with a `footageCeilingSeconds` budget, invoked by the "break up uninterrupted evidence runs" pass |
| Same asset reused (2x cap, not 1x+reason) | `MAX_USES_PER_SOURCE = blueprint.global_rules.max_uses_per_source` = **2** today (`editorial_blueprint.json.global_rules.max_uses_per_source`), enforced with no `reuse_reason` concept anywhere in the schema |

These are the concrete removal targets for Faz D, not a hypothetical.

## 4. Music: provenance verified, "nine_cue_concatenation" confirmed real

- `direction/music_cue_sheet.json.proof_score.track_id = "sb_signal_to_noise"` — the
  approved 150s proof's real music is Scott Buckley's *Signal to Noise*, matching the
  task brief's expectation, confirmed by the committed `proof_score` block (CC BY 4.0,
  `assets/music/approved_bed.provenance.json` attribution file).
- `direction/music_cue_sheet.json.full_cues` declares **nine** distinct cues, each with
  its own `track_id` (`sb_intervention_nomelody`, `sb_signal_to_noise_nomelody`,
  `sb_catalyst`, `sb_emergent`, `sb_undertow`, `sb_signal_to_noise`, `sb_ephemera`,
  `sb_horizons`, `sb_solace`) — note two of these are explicitly no-melody/instrumental
  variants of the *same* proof-approved composition (`sb_signal_to_noise*`), so a
  same-tonal-family consolidation is achievable without discarding all nine assets.
- `scripts/orvyq_music_resolve.mjs`'s `buildFullMusicBed()` writes
  `provenance.assembly = "nine_cue_concatenation"` verbatim — confirmed, not inferred.
- `music_cue_sheet.json.policy.continuous_single_loop_forbidden = true` **actively
  contradicts** the task's required "single continuous musical backbone" and is enforced
  in code: `orvyq_audio_mix.mjs` throws if `full_cues.length < 2` when this policy is set.
  This policy must be redefined (Faz C).
- `scripts/orvyq_audio_mix.mjs`'s `EDITORIAL_PAUSE_GAIN = 1.02` is confirmed present,
  unchanged, in this branch — a ~0.17 dB rise, inaudible, exactly the defect described in
  task §12. `musicVolumeExpression()` applies it as a hard step function with no
  fade/ramp (`if(between(t,pause.start,pause.end),1.02,...)`), which is also a second,
  independent defect (abrupt on/off rather than an eased envelope) beyond just the
  magnitude.

## 5. Root causes of near-black / repetition / audio-tail / final-silence

- **Near-black / long empty tension cards**: caused directly by the
  evidence→context→metaphor rotation converting the "least evidentially loaded" (i.e.
  most frequent) slice role into a `"boundary"` graphic tension card by construction,
  compounded by the run-length-breaking pass's fallback to `graphic`/tension-card when
  `pickFootageFor()` returns null (pool exhausted or ratio ceiling hit) — an emergent,
  not hand-authored, source of dark/empty cards.
- **Stock repetition**: `MAX_USES_PER_SOURCE = 2` plus `pickFootageFor()`'s rotation
  reuses the same ~24-clip `FULL_FOOTAGE_POOL` across an 850s+ film by construction —
  arithmetically guaranteed repetition once the film's real footage need exceeds
  `24 clips × 2 uses`.
- **Nine-track concatenation "different film" feeling**: direct consequence of
  `nine_cue_concatenation` — 9 independently-mastered segments (different tracks, not
  stems of one composition) crossfaded only at cue boundaries.
- **Audio tail / final silence (~14.4s reported in the known-bad full render)**: The
  current pipeline has **no explicit check that the music bed or final mix extends
  through the terminal `END_CARD_SECONDS` (4s) graphic**. `buildFullProductionPlan()`
  adds the end card as pure video-timeline padding *after* `totalDuration` is computed;
  neither `orvyq_audio_mix.mjs` nor `orvyq_music_resolve.mjs` is ever told about
  `END_CARD_SECONDS`, so the audio duration target used throughout audio-mix building is
  the narration+pauses total, **not** narration+pauses+end-card. Any full mix built today
  will legitimately run `END_CARD_SECONDS` (4s) short of the actual video length before
  even considering the historical render's much larger ~14.4s gap (which likely compounds
  a second, separate defect from that older render's own line-up of shots vs. audio —
  full extent not independently reproducible without a real render, but the *architectural*
  gap — end-card duration excluded from the audio-duration source of truth — is
  independently confirmed here in the current code, and is exactly the class of bug task
  §5/§13 requires eliminating via one canonical `candidate_duration_frames` source that
  audio, video, and QA all read from.

## 5b. Confirmed second, more severe audio-timing bug: no head-silence for the motion hook

`templates/remotion/src/Video.tsx` places `<Audio src={staticFile(audioSrc)}/>` at the
composition root with **no `from=` offset** — the mix file plays from its own sample 0
in lockstep with video frame 0. But video frame 0 is the **motion hook**
(`hookShots`, ~10–14s of silent-narration footage prepended by
`buildFullProductionPlan()`), and `orvyq_audio_mix.mjs`'s `prepareEditorialNarration()`
starts the spoken narration at t=0 of the *mix* with no leading silence for the hook
duration at all. Concretely: today, a full render's narration would start speaking
`hookDuration` seconds (~10–14s) too early relative to the picture — a full desync, not
merely a short tail gap. Combined with the confirmed missing end-card padding (§5), the
current architecture has **two** independent duration-accounting gaps (a missing leading
silence and a missing trailing silence), both against the video's real total. This is
exactly what task §5's single `candidate_duration_frames` source (covering leading hook
+ narration/pauses + trailing end-card, all in one place) is designed to close, and is
addressed in Faz B/C by threading the real motion-hook duration into
`buildCanonicalAudioMix()` as leading silence and the real end-card duration as trailing
silence/fade room, both read from one shared timeline resolver instead of being
independently (and, in the hook's case, not at all) accounted for.

## 6. What is retained vs superseded (task §4, "do not delete history")

Nothing is being deleted. `direction/cinematic_proof_cut.json`, `proof_preview_cut.json`,
`cinematic_revision_plan.json` are already-inert historical files (per the file's own
header comments, no current script reads them) and are left in place as historical/
regression reference, per task instructions. The transformation targets the generator
*logic* (`orvyq_full_production_plan.mjs`'s rotation/backfill/variation passes,
`orvyq_music_resolve.mjs`'s nine-track assembly, `orvyq_audio_mix.mjs`'s pause-gain
constant and duration accounting) and the two workflow files, not historical project data.
