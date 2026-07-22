# Master Edit-Direction Plan — "The AI Race No One Can Afford to Win"

Project: `001-the-ai-race-no-one-can-afford-to-win` · Stage: `director`
Source of truth: `scripts/script.md` + `scripts/script_metadata.json` (approved script), `assets/audio/final_voice.mp3` timing as encoded in `storyboard/storyboard.json` / `storyboard/storyboard.md`, `footage/footage_manifest.json` + `footage/scene_asset_map.json` + `footage/acquired_assets.json` (effective footage mapping), `qa/visual_qa.md` (gate: **PASS**, re-verified this run), `style/visual_style_bible.md` + `style/color_palette.md` + `style/camera_language.md` + `style/character_style.md` + `style/graphic_style.md` + `style/prompt_rules.md`, and `prompts/visual_prompts.md` (the authoritative director-stage input per `scripts/lib/pipeline.mjs` `STAGE_REQUIRED_FILES.director`).

**No files were modified to produce this plan.** No network or provider calls were made. No Remotion files or render assets were created. `manifest.json` / `projects/_index.json` were read-only inputs and are not touched by this stage — the state transition is left to the orchestrator.

## AI-fallback status (explicit record)

`prompts/visual_prompts.json` contains `scenes: []`. This is **expected and downstream-safe**, not missing data: `footage/footage_manifest.json` shows `fallback_to_ai_visual: false` for all 33 scenes — every scene in this project resolves to real, licensed stock footage, and the JSON schema (`schemas/visual_prompts.schema.json`) explicitly allows zero AI-fallback entries. The authoritative scene-by-scene direction input is `prompts/visual_prompts.md` (verified present for scene_001–scene_033, no gaps), not the JSON file. This direction plan treats `visual_prompts.md` as ground truth for existing-footage edit treatment and does not attempt to synthesize new AI-fallback prompts.

---

## 1. Rhythm & Arc

The film is a calm, evidence-led documentary, not a thriller — every pacing and motion decision below serves that thesis: the danger in the AI race is systemic and human (competitive incentive, concentration of power), not a single malevolent machine. Energy rises and falls across seven narrative groups:

- **Group A — scene_001–002 (0:00–0:51.5, coolest register).** Cold open: rapid restrained cross-cutting energy in scene_001 settles immediately into a single held wide shot in scene_002 for the thesis line ("Not someday. Right now."). Fastest apparent motion in the film is here, but it is cross-cutting rhythm, not frantic cutting — no shot exceeds native speed.
- **Group B — scene_003–006 (0:51.5–2:20, clinical).** Calm lab procedural tone builds through the controlled-evaluation setup, tightens at scene_005 (the film's single most sensitive reconstruction), then resolves at scene_006's fire-drill metaphor. Tension here is built by framing and the introduction of the amber hedge-label grammar (first used scene_004), never by horror lighting.
- **Group C — scene_007–016 (2:20–6:03, ink/steel base, amber hedges).** The longest group: boardroom pressure → market/benchmark race (008–009, matched-cut momentum) → punchy 6.4s thesis beat (010) → institutional-outpaced transition (011) → the cyber/bio risk spectrum (012–014, darkest SOC lighting in the film) → information-ecosystem ambiguity (015) → labor-market forecast (016, dashed-line equal-weight treatment). Cutting pace tracks narration density and is fastest here, per `visual_style_bible.md` Section 13.
- **Group D — scene_017–021 (6:03–7:52.5, bureaucratic, warming toward the caveat).** Concentration-of-power network diagram → control paradox → the EU AI Act as the film's one authorized real-regulation callout → incumbency critique → a held, static caveat line closing the section.
- **Group E — scene_022–025 (7:52.5–9:24, perfectly symmetrical).** The open/closed debate, bookended by an intentionally reused shot (scene_025 = scene_022's physical asset). This is the one place in the film where composition itself carries meaning — see Section 4.
- **Group F — scene_026–029 (9:24–10:52.9, warmest daylight register).** The safeguards section: technical → procedural → structural → power-focused proposals. Deliberate tonal pivot from critique to construction; scene_029's static equally-sized nodes intentionally mirror-and-invert scene_017's convergence animation.
- **Group G — scene_030–033 (10:52.9–11:59.9, closing dusk, darkening to ink-950).** The slowest rhythm in the film by design — near-static holds, no rapid cuts, deliberate absence of on-screen text as the intended accessibility/text-density treatment (not an omission). See Section 5 for the differentiation strategy across these four scenes.

**Transition timing policy (director decision — storyboard specifies transition *type* only, not duration; the following durations and easing are this stage's concrete addition):**

| Transition type | Groups A–F duration | Group G duration | Easing |
|---|---|---|---|
| `cut` | 0s (instant) | n/a (Group G uses no hard cuts) | none |
| `dissolve` | 0.6s | 1.0s (slower, "room to breathe" per storyboard) | `ff-ease-standard` |
| `fade` | 0.8s | 1.2s | `ff-ease-standard` |

All graphic/label overlays enter on a narration beat, never mid-sentence (`visual_style_bible.md` Section 13) — this applies globally and is not repeated per scene below unless a scene has an additional audio-sync note.

## 2. Camera & Motion Philosophy

Every scene in this project is existing licensed footage — there is no Ken Burns pan/zoom vocabulary to assign; the clip's own motion (or, for graphic inserts, the specified animation) carries it. Camera movement decreases monotonically across the film: slow parallel push-ins and cross-cuts (Group A) → static/slow-handheld observational coverage (Groups B/C/F) → slow tilt/pan on institutional exteriors (Group D) → locked symmetrical static composition (Group E) → near-static holds with minimal drift only (Group G). No handheld chaos, no whip pans, no Dutch angles, no extreme close-ups anywhere in the film.

## 3. Color Arc

Groups A→G form one continuous color register, detailed per-scene in the appendix: coolest ink/steel with no accent (A) → clinical ink/steel/fog with the first amber label (B) → ink/steel base with amber REPORTED/DISCLOSED/FORECAST hedge labels, darkening further at the SOC scenes 012–013 (C) → bureaucratic ink/steel warming slightly toward the scene_021 caveat (D) → perfectly symmetrical neutral ink/steel, no side favors either accent (E) → ink/steel lifted toward gold-400 daylight warmth (F) → ink/steel shifting toward coral-500 dusk, darkening to ink-950 by scene_033 (G).

## 4. Bookend Reuse — scene_022 / scene_025

`footage/footage_manifest.json` confirms scene_025 is a deliberate `asset_role: "reuse"` of scene_022's canonical clip (`reuse_of_scene: "scene_022"`, identical `asset_path`/`sha256` = `a4c0e364b66752924dc0d13168ca4b3f3b467bf1b39269acb1efa867ef8a733c`, `physical_download_performed: false`, `duplicate_download_prevented: true`, `reuse_policy_passed: true`). This is intentional structural bookending, not an error, and this stage does not source a different clip. To avoid an identical-repeat feel without altering the balanced, non-favoring meaning of the composition, the bookend variation is:

| | scene_022 (establish) | scene_025 (close) |
|---|---|---|
| Crop | Fuller symmetrical split-frame | Marginally tighter static crop, same symmetry, no left/right shift |
| Camera | Symmetrical static, freshly establishing | Symmetrical static, held/settled |
| Transition in/out | dissolve / cut | dissolve / fade (slower exit signals closure) |
| Overlay scrim | `ff-overlay-scrim-low` | Marginally heavier, toward `ff-overlay-scrim-high` |
| On-screen text | none | none (unchanged — no new text introduced) |

## 5. Closing Sequence Differentiation — scene_030–033

All four scenes share the warm dusk register and slow/near-static pacing by design (storyboard explicitly calls for slower pacing, no rapid cuts). Variation comes from crop, duration, and transition pattern only — never from content or text density (the absence of on-screen text across all four is itself the intended accessibility/text-density treatment, not an omission):

| Scene | Duration | Crop | Transition in/out | Color point |
|---|---|---|---|---|
| scene_030 | 6.443s (shortest, tied) | Widest establishing dusk skyline | fade / dissolve | Coral-500 begins |
| scene_031 | 24.914s (longest) | Office-tower windows, single silhouette | dissolve / dissolve | Deepening |
| scene_032 | 29.639s (second-longest) | Darkest, stillest, tightest — 1–2 silhouettes only | dissolve / dissolve | Darkest point, approaching ink-950 |
| scene_033 | 6.014s (shortest, tied) | Full wide, distinct from scene_030's crop | dissolve / fade (to black) | Ink-950 |

scene_032 carries an explicit editorial precedent, not just a stylistic preference: an earlier humanoid-robot candidate for this exact scene was rejected during footage retrieval (`footage/retrieval_report.md`); the current asset (pixabay/88219) is the confirmed replacement. The no-rogue-machine-imagery rule is enforced here with a concrete rejection on record.

## 6. Global Prohibited Treatments (stated once; per-scene table lists only scene-specific additions on top of this baseline)

No humanoid robot / robot face / evil AI face / glowing brain / anthropomorphized AI character; no neon cyberpunk lighting as the primary aesthetic; no scrolling code rain / hacker-in-a-hoodie cliché; no apocalyptic imagery, disaster/explosion iconography, dystopian ruins, or horror lighting; no Dutch angles or extreme close-ups on a face; no real company logo, real government seal, or named real individual; no legible real text or real credential values; no real platform branding; no gore/violence/weapons; no fabricated news headline or breaking-news graphics/branding/seals; no sensationalist stock-photo cliché; no fake data, invented statistics, fake numeric dashboard, or unsupported company/government behavior claim; no unsupported attribution; no fake quote or misquoting/source-meaning manipulation; no operational cyber/biological/chemical procedural detail. Source: `style/visual_style_bible.md` Section 15 (Do/Don't matrix) and `prompts/visual_prompts.md`'s per-scene `NEGATIVE_PROMPT` baseline.

## 7. Global Accessibility Rules (stated once; source `visual_style_bible.md` Section 14)

- Minimum 4.5:1 contrast for all on-screen labels, achieved via the mandated scrim tokens (`ff-overlay-scrim-low` 0.25 / `ff-overlay-scrim-high` 0.55) behind `ff-color-paper-100` text — never footage contrast alone.
- Minimum 1.5s hold on every on-screen evidentiary label.
- Caption-safe region: labels sit in `ff-safe-lower-third-bottom` (12% from bottom edge) and `ff-safe-side-margin` (6% each side), clear of where burned-in captions will sit.
- No flashing/strobing content anywhere; no graphic element may flicker or scroll-flicker faster than 3Hz (applies to scene_008 ticker, scene_015 feed-scroll, scene_017/029 node animations).
- Hedge/evidentiary meaning is always carried by explicit label text, never by color alone — color (amber/rust) is secondary reinforcement only. scene_016's forecast uncertainty is carried by dashed-line style **plus** the FORECAST text label, not color alone.

## 8. Non-Blocking QA Notes Carried Forward from `qa/visual_qa.md`

All entries below: `carried_forward=true`. Gate verdict was **PASS**, `BLOCKING_FINDING_COUNT: 0`. These are informational only and require no action at this stage.

| Code | Scope | Note | Mitigation | Why non-blocking |
|---|---|---|---|---|
| NB-001 | scene_010, scene_019, scene_021, scene_024, scene_028 | `rendition_metadata_mismatch` present (actual native resolution below staged/expected resolution for 5 clips) | Editor direction explicitly instructs no aggressive crop/upscale on scene_010/019/021 (all comfortably usable at loose framing); scene_024 (2732×1440) and scene_028 (2560×1440) remain comfortably above the 1080p delivery floor | `approval_basis: actual_ffprobe` on all five; all are at or above usable delivery resolution; explicit resolution notes already present in `visual_prompts.md` and repeated per-scene in the appendix below |
| NB-002 | scene_002–scene_006 | Historical `LOW_RESOLUTION_REVIEW_REQUIRED` flag from an earlier corrective batch, superseded by current `scene_asset_map.json` data | Treat `scene_asset_map.json` as the current authoritative record (per its own instruction); no re-review needed | Current record shows `approved_for_final_edit: true`, `editorial_quality_approved: true`, `human_review_status: NOT_REQUIRED` for all affected scenes |
| NB-003 | scene_002–scene_033 (32 of 33 scenes) | These scenes record exactly 2 `search_queries`, meeting the schema minimum (2) but below the schema description's stated target breadth (3) | None required — informational only | Not a gate blocker under the current schema contract (`minItems: 2, uniqueItems: true`) |
| NB-004 | scene_006, scene_008–scene_021 except scene_007 (15 scenes) | `license` field is literally `null`; only `license_approved: true` was added, not a license reference URL/text | Worth a human legal/licensing spot-check before `factforge-packaging`/`factforge-final-qa` | Satisfies the current validator contract (`license_approved: true` accepted as valid provenance evidence); not machine-verifiable from this record alone, hence flagged rather than silently passed |

---

## 9. Machine-Readable Scene Appendix

Exact scene order scene_001–scene_033, each appearing exactly once per table, in storyboard order. Timing is taken verbatim from `storyboard/storyboard.json` and sums to the project total with no gaps or overlaps (verified: 719.928s = `footage/footage_manifest.json`'s `total_duration_sec` = `storyboard/storyboard.json`'s `total_duration_sec`). All media paths are project-relative; no full URLs appear anywhere in this document.

### 9.1 — Timing, Narrative, Asset

| Scene | Start (s) | End (s) | Dur (s) | Narration purpose | Emphasis | Asset role | Effective media path | Src dur (s) | In (s) | Out (s) | Rate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| scene_001 | 0.000 | 28.780 | 28.780 | Cold open: labs know the risk, race anyway | Wide aerial/exterior, cross-cut energy (single clip; montage optional) | canonical | assets/footage/scene_001_52c2ebe35b131555e20a5ab5.mp4 | 23.787 | 0.000 | 23.787 | 1.0x |
| scene_002 | 28.780 | 51.546 | 22.766 | Land the film's thesis question | Wide, single held shot, static hold for the line to land | canonical | assets/footage/scene_002_55b0a8af17f137fd76d52766.mp4 | 6.000 | 0.000 | 6.000 | 1.0x |
| scene_003 | 51.546 | 70.446 | 18.900 | Setup: "danger would announce itself" | Medium-wide corridor/exterior, calm procedural | canonical | assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4 | 18.000 | 0.000 | 18.000 | 1.0x |
| scene_004 | 70.446 | 89.347 | 18.901 | Introduce controlled model evaluations | Medium/observational testing room, first amber label | canonical | assets/footage/scene_004_52abd7f745cc24b4ecad0215.mp4 | 10.000 | 0.000 | 10.000 | 1.0x |
| scene_005 | 89.347 | 111.254 | 21.907 | Depict the reported blackmail-style test case | Tight but calm, most sensitive reconstruction in project | canonical | assets/footage/scene_005_e98a421f0d9c432e4d2036fb.mp4 | 12.000 | 0.000 | 12.000 | 1.0x |
| scene_006 | 111.254 | 140.034 | 28.780 | Clarify designed test vs. real incident (fire-drill framing) | Medium/wide, calm procedural evacuation | canonical | assets/footage/scene_006_7e0d77fb76615c10d441204a.mp4 | 10.687 | 0.000 | 10.687 | 1.0x |
| scene_007 | 140.034 | 158.075 | 18.041 | Why labs keep building despite acknowledged risk | Medium, backs-of-heads boardroom framing | canonical | assets/footage/scene_007_6c8401e76cd6e2697fc70d7c.mp4 | 8.440 | 0.000 | 8.440 | 1.0x |
| scene_008 | 158.075 | 178.693 | 20.618 | Market/investor pressure drives the race | Wide + ticker overlay, matched-cut momentum | canonical | assets/footage/scene_008_42946788405d61ee3a28fa31.mp4 | 10.040 | 0.000 | 10.040 | 1.0x |
| scene_009 | 178.693 | 203.607 | 24.914 | Reported overtaking-benchmark/CEO-emergency event | Abstract leaderboard + ticker, matched cut, REPORTED hedge | canonical | assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4 | 37.960 | 0.000 | 24.914 | 1.0x |
| scene_010 | 203.607 | 210.051 | 6.444 | Closing thesis: unilateral slowdown fails | Tight, brief punchy connective beat | canonical | assets/footage/scene_010_6f7bc11f2a696985af0db15f.mp4 | 32.640 | 0.000 | 6.444 | 1.0x |
| scene_011 | 210.051 | 221.219 | 11.168 | Transition: institutions can't absorb the pace | Wide establishing, institutional scale vs. fast sky | canonical | assets/footage/scene_011_bff417a92fed9423fe0dd580.mp4 | 14.228 | 0.000 | 11.168 | 1.0x |
| scene_012 | 221.219 | 254.724 | 33.505 | Real disclosed cyber-misuse case | Medium/observational, darkest SOC lighting, DISCLOSED label | canonical | assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4 | 45.640 | 0.000 | 33.505 | 1.0x |
| scene_013 | 254.724 | 281.356 | 26.632 | Hedge + balance: automation helps defenders too | Medium, same SOC room reframed for balance | canonical | assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4 | 30.030 | 0.000 | 26.632 | 1.0x |
| scene_014 | 281.356 | 301.545 | 20.189 | Biological-risk capability-boost finding, high-level | Wide exterior-only, non-operational | canonical | assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4 | 21.353 | 0.000 | 20.189 | 1.0x |
| scene_015 | 301.545 | 327.318 | 25.773 | Information-ecosystem/political-manipulation risk | Static feed abstraction, volume/ambiguity | canonical | assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4 | 19.680 | 0.000 | 19.680 | 1.0x |
| scene_016 | 327.318 | 362.971 | 35.653 | Two competing labor-market forecasts, hedged | Split-screen forecast graphic + dusk desks | canonical | assets/footage/scene_016_e324304f99b3502cad464d69.mp4 | 8.633 | 0.000 | 8.633 | 1.0x |
| scene_017 | 362.971 | 391.321 | 28.350 | Introduce concentration-of-power risk | Network diagram, nodes converging | canonical | assets/footage/scene_017_17388828bde9ac80bd22eb8e.mp4 | 19.800 | 0.000 | 19.800 | 1.0x |
| scene_018 | 391.321 | 411.510 | 20.189 | Control paradox: oversight needs an empowered administrator | Medium static, bureaucratic-tense interior | canonical | assets/footage/scene_018_f681c3057e36f147005d2652.mp4 | 17.000 | 0.000 | 17.000 | 1.0x |
| scene_019 | 411.510 | 432.988 | 21.478 | EU AI Act compute-threshold mechanism (real example) | Wide/medium exterior, slow tilt/pan | canonical | assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4 | 32.533 | 0.000 | 21.478 | 1.0x |
| scene_020 | 432.988 | 452.318 | 19.330 | Compliance costs may favor large incumbents | Medium, campus + paperwork stack | canonical | assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4 | 15.600 | 0.000 | 15.600 | 1.0x |
| scene_021 | 452.318 | 472.506 | 20.188 | Balanced caveat: scrutinize who writes the rules | Wide held static, reflective | canonical | assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4 | 15.467 | 0.000 | 15.467 | 1.0x |
| scene_022 | 472.506 | 492.266 | 19.760 | Frame the open-weight vs. closed-model question | Perfectly symmetrical wide split-frame, establishing bookend #1 | canonical | assets/footage/scene_022_740741da33e14d6a45468490.mp4 | 25.880 | 0.000 | 19.760 | 1.0x |
| scene_023 | 492.266 | 520.187 | 27.921 | Case for open-weight models | Medium, left half of split motif brought forward | canonical | assets/footage/scene_023_dbe758e1473aee29a155377a.mp4 | 14.960 | 0.000 | 14.960 | 1.0x |
| scene_024 | 520.187 | 548.537 | 28.350 | Case for closed models + real cyber cases as counter-evidence | Medium, right half of split motif, SOC callback to scene_012 | canonical | assets/footage/scene_024_6e6f4af26cad60cc78930d6d.mp4 | 9.500 | 0.000 | 9.500 | 1.0x |
| scene_025 | 548.537 | 564.001 | 15.464 | Close open/closed subsection: no simply safe option | Symmetrical split-frame, settled/static, bookend #2 | **reuse of scene_022** | assets/footage/scene_022_740741da33e14d6a45468490.mp4 | 25.880 | 0.000 | 15.464 | 1.0x |
| scene_026 | 564.001 | 572.162 | 8.161 | Transition into safeguards: precision, not paralysis | Brief calm connective daylight beat | canonical | assets/footage/scene_026_8a460acd7183fb80baaa455e.mp4 | 29.5295 | 0.000 | 8.161 | 1.0x |
| scene_027 | 572.162 | 601.801 | 29.639 | Technical/procedural safeguards | Medium/observational, warmest human-positive framing | canonical | assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4 | 29.160 | 0.000 | 29.160 | 1.0x |
| scene_028 | 601.801 | 630.581 | 28.780 | Structural safeguards: compute governance | Wide legislative chamber, slow pan | canonical | assets/footage/scene_028_d4c7a6d60c700cc3f1dddeff.mp4 | 10.200 | 0.000 | 10.200 | 1.0x |
| scene_029 | 630.581 | 652.918 | 22.337 | Safeguard aimed at power: competition, sunset clauses | Static equally-sized nodes, hopeful, contrasts scene_017 | canonical | assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4 | 33.280 | 0.000 | 22.337 | 1.0x |
| scene_030 | 652.918 | 659.361 | 6.443 | Open closing movement: quiet, non-catastrophic answer | Widest establishing dusk skyline, near-static | canonical | assets/footage/scene_030_3bee64eb585a0f8f6b6895c0.mp4 | 9.8765 | 0.000 | 6.443 | 1.0x |
| scene_031 | 659.361 | 684.275 | 24.914 | Risk accumulates through many small decisions | Office-tower windows, single silhouette, near-static | canonical | assets/footage/scene_031_12e168b42df0ef02be3b9707.mp4 | 12.360 | 0.000 | 12.360 | 1.0x |
| scene_032 | 684.275 | 713.914 | 29.639 | Reframe danger as systemic incentive, not rogue machine | Darkest/tightest/stillest, 1-2 silhouettes | canonical | assets/footage/scene_032_29ff7ef6ff7df132006f8e97.mp4 | 20.0333 | 0.000 | 20.0333 | 1.0x |
| scene_033 | 713.914 | 719.928 | 6.014 | Final lines: undecided, decided by people, right now | Full wide final shot, near-static, breathing room before black | canonical | assets/footage/scene_033_1b2f289c850d35e4a6e96dc4.mp4 | 11.2112 | 0.000 | 6.014 | 1.0x |

**Sum check:** 28.780+22.766+18.900+18.901+21.907+28.780+18.041+20.618+24.914+6.444+11.168+33.505+26.632+20.189+25.773+35.653+28.350+20.189+21.478+19.330+20.188+19.760+27.921+28.350+15.464+8.161+29.639+28.780+22.337+6.443+24.914+29.639+6.014 = **719.928s**, no gaps/overlaps (each scene's end equals the next scene's start).

### 9.2 — Crop, Motion, Color, Transitions

| Scene | Crop/scale/position | Motion | Color grade / group | Transition-in (dur/easing) | Transition-out (dur/easing) |
|---|---|---|---|---|---|
| scene_001 | Wide establishing aerial/exterior; do not crop tight enough to lose district-scale read | Slow parallel push-in | Group A — ink-950/ink-800, no accent | fade / 0.8s / ff-ease-standard | cut / 0s / none |
| scene_002 | Single held wide shot, full duration, no cutting away mid-line | Slow parallel push-in or held wide; stillness increases as line lands | Group A — ink-950/ink-800, no accent | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_003 | Medium-wide corridor/exterior, calm procedural | Slow lateral tracking | Group B — steel-600/fog-400 | dissolve / 0.6s / ff-ease-standard | cut / 0s / none |
| scene_004 | Medium/observational, closed-door testing room | Static or slow handheld | Group B — steel-600/fog-400, first amber-500 label | cut / 0s / none | cut / 0s / none |
| scene_005 | Tight but calm framing on abstracted document/email UI; no dramatic zoom | Static, tightened vs. scene_004 | Group B — steel-600/fog-400; rust-600 flagged-output underline only | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_006 | Medium/wide, procedural safety-drill framing | Calm literal fire-drill coverage; walking not running | Group B — steel-600/fog-400, amber-500 label | dissolve / 0.6s / ff-ease-standard | dissolve / 0.6s / ff-ease-standard |
| scene_007 | Tense boardroom; favor backs-of-heads over identifiable close-ups | Static or slow handheld | Group C — ink/steel base | dissolve / 0.6s / ff-ease-standard | cut / 0s / none |
| scene_008 | Ticker display over/against data-center exterior | Matched cut, ticker↔data-center | Group C — ink/steel base | cut / 0s / none | cut / 0s / none |
| scene_009 | Abstract leaderboard, newsroom-style ticker text | Matched cut, cross-cut on narration beat | Group C — ink/steel base, amber-500 REPORTED label | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_010 | Tight, brief connective-beat framing; loose enough for 1280x720 source (see 9.3 resolution note) | Short punchy held static beat; two abstract shapes only | Group C — ink/steel base, somber | dissolve / 0.6s / ff-ease-standard | fade / 0.8s / ff-ease-standard |
| scene_011 | Wide establishing, regulatory/government building facade | Wide shot; institutional scale vs. fast sky/traffic time-lapse (inherent motion, no ramp) | Group C — ink/steel base, somber | fade / 0.8s / ff-ease-standard | cut / 0s / none |
| scene_012 | Darkened analyst workstation, medium/observational | Static or slow handheld | Group C — darker SOC treatment, amber-500 DISCLOSED label | cut / 0s / none | cut / 0s / none |
| scene_013 | Same SOC room reframed for balance | Static or slow handheld | Group C — darker SOC treatment (as 012, reframed), amber-500 label | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_014 | Secure biosecurity-lab exterior only | Wide establishing, exterior-only, no interior movement | Group C — ink/steel base, somber | dissolve / 0.6s / ff-ease-standard | fade / 0.8s / ff-ease-standard |
| scene_015 | Crowded, fast-scrolling feed abstraction | Static camera on scrolling graphic (scroll itself is the animation, capped <3Hz) | Group C — ink/steel base, somber | fade / 0.8s / ff-ease-standard | cut / 0s / none |
| scene_016 | Split-screen: two divergent projection curves over quiet dusk desks | Static; graphic reveal ff-motion-slow 900ms | Group C — ink/steel base, amber-500 FORECAST label | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_017 | Many nodes converging into a handful of central hubs | Static camera on animating network diagram; ff-motion-slow 900ms, ff-ease-out, min 1200ms hold | Group D — bureaucratic ink/steel | dissolve / 0.6s / ff-ease-standard | fade / 0.8s / ff-ease-standard |
| scene_018 | Regulatory/legislative office; documents and stamps | Static, bureaucratic-tense interior | Group D — bureaucratic ink/steel | fade / 0.8s / ff-ease-standard | cut / 0s / none |
| scene_019 | European institutional exterior + regulatory paperwork; loose framing (see 9.3) | Slow tilt/pan on facade | Group D — bureaucratic ink/steel, warming toward 021 | cut / 0s / none | cut / 0s / none |
| scene_020 | Data-center campus exterior + compliance-paperwork stack | Static/slow push | Group D — bureaucratic ink/steel | cut / 0s / none | cut / 0s / none |
| scene_021 | Empty legislative chamber/hearing room, calm; loose framing (see 9.3) | Static hold; reflective transition shot | Group D — warming slightly, reflective | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_022 | Perfectly symmetrical split-frame, open repo (L) vs. locked vault (R), equal size/brightness/detail | Symmetrical static composition (meaning encoded in composition itself) | Group E — perfectly symmetrical neutral ink/steel | dissolve / 0.6s / ff-ease-standard | cut / 0s / none |
| scene_023 | Left half of split motif brought forward: independent researchers + open-repo interface | Cut in/cut out | Group E — perfectly symmetrical neutral ink/steel | cut / 0s / none | cut / 0s / none |
| scene_024 | Right half of split motif brought forward: monitored restricted-access terminal | Cut in/cut out; echoes scene_012's exact SOC UI style, not just palette | Group E — perfectly symmetrical neutral ink/steel | cut / 0s / none | cut / 0s / none |
| scene_025 | reuse_of_scene=scene_022; marginally tighter static crop, same symmetry, no L/R shift | Symmetrical static, held/settled (vs. scene_022's fresh establishing) | Group E — identical to scene_022; scrim toward ff-overlay-scrim-high for closure only | dissolve / 0.6s / ff-ease-standard | fade / 0.8s / ff-ease-standard |
| scene_026 | Daylight office/research setting | Brief calm connective shot, unhurried | Group F — lifted toward gold-400 | fade / 0.8s / ff-ease-standard | cut / 0s / none |
| scene_027 | Auditors/researchers reviewing documents collaboratively | Static or slow handheld, observational | Group F — gold-400 warm register | cut / 0s / none | cut / 0s / none |
| scene_028 | Legislative chamber in session + compute-cluster oversight visual; normal crop tolerance (see 9.3) | Slow tilt/pan on chamber | Group F — gold-400 warm register | cut / 0s / none | cut / 0s / none |
| scene_029 | Review-date/sunset-clause document + multi-player market motif | Static; equally-sized nodes, deliberately contrasts scene_017 | Group F — gold-400, hopeful | cut / 0s / none | dissolve / 0.6s / ff-ease-standard |
| scene_030 | Widest establishing skyline crop of the four closing scenes | Near-static hold, minimal drift | Group G — coral-500 begins | fade / 1.2s / ff-ease-standard | dissolve / 1.0s / ff-ease-standard |
| scene_031 | Tightens to office-tower windows, single silhouette | Near-static hold, minimal drift | Group G — deepening | dissolve / 1.0s / ff-ease-standard | dissolve / 1.0s / ff-ease-standard |
| scene_032 | Darkest, stillest, most tightly composed; 1-2 silhouettes only | Near-static hold, minimal drift | Group G — darkest point, approaching ink-950 | dissolve / 1.0s / ff-ease-standard | dissolve / 1.0s / ff-ease-standard |
| scene_033 | Full wide final composition, distinct from scene_030's crop | Near-static hold, minimal drift | Group G — ink-950 by final scene | dissolve / 1.0s / ff-ease-standard | fade / 1.2s / ff-ease-standard (to black) |

### 9.3 — Overlays, Context Labels, Accessibility, Editorial Constraints, Downstream Notes

| Scene | Overlays/on-screen text | Context label | Accessibility | Factual/editorial constraints | Prohibited (scene-specific, on top of global §6) | Audio-sync | Downstream notes | Validation |
|---|---|---|---|---|---|---|---|---|
| scene_001 | none | NONE | No text this scene | Do not narrate/caption as one clip showing 3 locations; 3-part motif completed only via in-edit cross-cuts to scene_002/scene_011 | no fabricated multi-location composite claim | Cross-cut inserts (if added) enter on narration beat | Old low-res file `assets/footage/scene_001_3bdb0f430d70b077a27a4b87.mp4` is **NOT used** — superseded, `approved_for_final_edit: false`, referenced only in `accounting.superseded_history_assets`. Supplemental montage (data-center/office/government cross-cut) is **optional, not asset-bound, and requires separate human approval** before use — not authorized by this stage. | PASS |
| scene_002 | none | NONE | No text this scene | Generic/unbranded server hallway or skyline; no real company | no named real entity | Held static for "Not someday. Right now." to land without a cut | NB-002 (carried_forward=true): historical LOW_RESOLUTION_REVIEW_REQUIRED flag superseded by current `scene_asset_map.json` (current record: approved) | PASS |
| scene_003 | none | NONE | No text this scene | Generic research-lab exterior/corridor; no real institution named | no ominous/horror lighting | — | NB-002 applies (see scene_002) | PASS |
| scene_004 | CONTROLLED EVALUATION (`ff-label-controlled-evaluation`) | CONTROLLED EVALUATION | Label hold ≥1.5s, 4.5:1 contrast via scrim; hedge carried by text not color | Must read as designed test, never real deployment | no depiction as real deployed incident | Label enters on narration beat | NB-002 applies. First amber-accent label in the film — sets grammar for all later hedge labels | PASS |
| scene_005 | SIMULATED TEST SCENARIO (`ff-label-simulated-test`) | SIMULATED TRANSCRIPT, ILLUSTRATIVE RECONSTRUCTION | Label hold ≥1.5s, 4.5:1 contrast; no flash >3Hz (explicitly forbids "alert flash") | Zero real people/company/usernames/messages; must not imply a real blackmail event | no real blackmail implication, no real people/company/usernames/messages, no dramatic zoom on "shocking" text, no red alert flash, no thriller sting | Label enters on narration beat | NB-002 applies. **SIMULATED TEST SCENARIO / SIMULATED TRANSCRIPT marker required; generic UI only** — the film's single most sensitive reconstruction | PASS |
| scene_006 | DESIGNED TEST — NOT AN ACTUAL EVENT (`ff-label-designed-test`) | CONTROLLED EVALUATION | Label hold ≥1.5s, 4.5:1 contrast | Designed test/metaphor only, not an actual event | no panicked running, no real emergency implication | Label enters on narration beat | — | PASS |
| scene_007 | none | NONE | No text this scene | No real company/executives identified | no identifiable real individual | — | Landscape-corrected asset supersedes an earlier portrait candidate (quarantined) | PASS |
| scene_008 | none | GENERIC INTERFACE | No flashing >3Hz in ticker animation | No real company names/logos/ticker symbols | no real ticker symbol, no real company name | Ticker/graphic insert matched-cut to footage | — | PASS |
| scene_009 | REPORTED (`ff-label-reported`) | GENERIC INTERFACE | Label hold ≥1.5s, 4.5:1 contrast | Real, hedged, reported event — "reportedly" framing must be visually reinforced | no real company name/logo, no false precision | Label enters on narration beat | — | PASS |
| scene_010 | none | NONE | No text this scene | Purely abstract motif; no real-world entity implied | no literal vehicle/runner rendering, no over-elaboration | Held static for thesis line to land | NB-001 (carried_forward=true): actual 1280x720 vs. 1920x1080 staged, `RENDITION_METADATA_MISMATCH`; mitigation = no aggressive crop/upscale, keep framing loose; not blocking since above/at usable delivery scale | PASS |
| scene_011 | none | NONE | No text this scene | Generic/unbranded government building; no real institution named | no named real institution | — | Reusable in-edit as one of scene_001's supplemental cross-cut candidates | PASS |
| scene_012 | DISCLOSED BY THE COMPANY — REPORTED INCIDENT (`ff-label-disclosed`) | GENERIC INTERFACE, ILLUSTRATIVE RECONSTRUCTION | Label hold ≥1.5s, 4.5:1 contrast | Real disclosed/reported incident; no operational exploit detail | no operational cyber/exploit detail | Label enters on narration beat | scene_024 will explicitly echo this dashboard's UI treatment — keep style consistent for that later callback | PASS |
| scene_013 | COMPANY'S OWN ASSESSMENT — NOT INDEPENDENTLY VERIFIED (`ff-label-company-assessment`) | GENERIC INTERFACE, ILLUSTRATIVE RECONSTRUCTION | Label hold ≥1.5s, 4.5:1 contrast | Company's own assessment; must carry "not independently verified" hedge | no overstatement of certainty beyond hedge | Label enters on narration beat | Same room as scene_012, reframed for balance — do not restage as new location | PASS |
| scene_014 | none | NONE | No text this scene | Exterior-only; no biological/chemical procedural detail or equipment depiction (hard rule) | no interior lab imagery, no biological/chemical procedural detail, no equipment depiction | — | Hard stop condition, project-wide non-negotiable rule | PASS |
| scene_015 | none | GENERIC INTERFACE | Scroll animation must not flicker faster than 3Hz | Not any specific real platform or post; ambiguous/generic only | no real platform branding, no real post/usernames | — | — | PASS |
| scene_016 | FORECAST — NOT A CONFIRMED OUTCOME (`ff-label-forecast`) | FORECAST / ESTIMATE | Dash pattern + explicit FORECAST label (not color alone) so uncertainty survives grayscale/colorblind viewing | Forecast/estimate only, not confirmed outcome | no solid/confirmed line style, no false precision, no favoring one forecast | Label + graphic reveal enter on narration beat | Both forecast lines must render with identical stroke weight — hard equal-weight rule | PASS |
| scene_017 | none | GENERIC INTERFACE | No flashing >3Hz in node animation | Abstract concentration motif only; no real company/entity on any node | no real company name on any node | — | Deliberately contrasts scene_029's static equally-sized-nodes composition later | PASS |
| scene_018 | none | NONE | No text this scene | Generic regulatory/legislative office; no specific real agency named | no real government seal/logo | — | Sets up the paradox scenes 019-021 unpack via the EU AI Act example | PASS |
| scene_019 | EU AI ACT — COMPUTE THRESHOLD (`ff-label-regulation-real`) | ILLUSTRATIVE RECONSTRUCTION | Label hold ≥1.5s, 4.5:1 contrast | EU AI Act is the one scene where naming a real regulatory framework is explicitly authorized by the storyboard's own label — do not extend this authorization elsewhere | no fabricated regulatory detail beyond what script/storyboard state | Label enters on narration beat | NB-001 (carried_forward=true): actual 1280x720 vs. 1920x1080 staged; mitigation = no aggressive crop/upscale, favor wide/medium framing; not blocking, usable at delivery scale | PASS |
| scene_020 | none | NONE | No text this scene | Generic/unbranded "large established company"; no specific real company | no real company name/logo | — | — | PASS |
| scene_021 | none | NONE | No text this scene | Generic legislative/hearing room; no real government body named | no real government seal/name | Held static for caveat line to land | NB-001 (carried_forward=true): actual 1280x720 vs. 1920x1080 staged; mitigation = no aggressive crop/upscale, keep frame static and loose; not blocking | PASS |
| scene_022 | none | GENERIC INTERFACE, ILLUSTRATIVE RECONSTRUCTION | No text this scene | Neutral framing of open-vs-closed debate; no favoring; no real product/repo named | no asymmetry favoring open or closed, no real repo/product name | — | Establishes the bookend pair with scene_025 — see Section 4 | PASS |
| scene_023 | none | GENERIC INTERFACE | No text this scene | "Neither side has a clean claim to safety" — present open-weight case fairly | no real repo/product name | — | Balances against scene_024's closed-model case; keep visual weight comparable | PASS |
| scene_024 | SAME REPORTED INCIDENTS AS EARLIER — REAL, NOT SIMULATED (`ff-label-same-incident-callback`) | GENERIC INTERFACE, ILLUSTRATIVE RECONSTRUCTION | Label hold ≥1.5s, 4.5:1 contrast | Same disclosed incidents as scene_012/013; carries "not independently verified" hedge; no operational cyber detail | no operational cyber/exploit detail, no new claim beyond scene_012/013 | Label enters on narration beat | NB-001 (carried_forward=true): actual 2732x1440 vs. 4096x2160 staged; comfortably above 1080p delivery floor, normal crop tolerance; not blocking. Must visually echo scene_012's exact SOC UI style | PASS |
| scene_025 | none | GENERIC INTERFACE, ILLUSTRATIVE RECONSTRUCTION | No text this scene | reuse_of_scene=scene_022, deliberate structural bookend; do not source a different clip; balance must stay identical in substance | no new on-screen text, no left/right balance shift, no different clip substituted | — | **Deliberate reuse of scene_022** — see Section 4 for the full bookend variation table | PASS |
| scene_026 | none | NONE | No text this scene | Generic daylight office/research setting; no real institution named | no real institution named | — | Short connective beat (8.2s) — brief by design, do not pad | PASS |
| scene_027 | none | NONE | No text this scene | Generic auditors/researchers; no real institution or individual named | no real institution/individual named | — | Marks pivot from critique to constructive proposal | PASS |
| scene_028 | none | ILLUSTRATIVE RECONSTRUCTION | No text this scene | Generic legislative chamber; no real government body named | no real government body named | — | NB-001 (carried_forward=true): actual 2560x1440 vs. 3840x2160 staged; comfortably above 1080p delivery floor, normal crop tolerance; not blocking | PASS |
| scene_029 | none | GENERIC INTERFACE | No flashing >3Hz | Abstract competition/sunset-clause motif only; no real company/entity named | no real company name on any node | — | Static equally-sized nodes is the deliberate contrast to scene_017's convergence — do not reuse scene_017's convergence motion | PASS |
| scene_030 | none | NONE | No text (deliberate silence — see §5) | Human silhouettes/environment only | no rogue-machine/robot-takeover imagery | — | Opens the closing movement — see Section 5 differentiation table | PASS |
| scene_031 | none | NONE | No text (deliberate silence) | Quiet contemplative human silhouettes only | no rogue-machine/robot-takeover imagery, no single hero/villain figure | — | See Section 5 differentiation table | PASS |
| scene_032 | none | NONE | No text (deliberate silence) | Quiet human silhouettes only; concrete editorial rejection precedent on record for this exact scene | no rogue-machine/robot-takeover imagery (explicit prior rejection precedent) | — | Current asset (pixabay/88219) supersedes a rejected humanoid-robot candidate — see Section 5 | PASS |
| scene_033 | none | NONE | No text (deliberate silence) | Quiet human-agency framing; no CTA/title card | no rogue-machine/robot imagery, no CTA/title card | — | Final scene — ample breathing room before black; see Section 5 | PASS |

---

## 10. Pre-advance self-check (internal consistency, per skill instructions)

- All 33 `scene_id`s from `storyboard/storyboard.json` are covered exactly once across all three appendix tables, in order, scene_001→scene_033. ✅
- Every scene's motion/transition choice was checked against the storyboard's own `transition_in`/`transition_out` type and does not contradict it (e.g. no dramatic push called against a hard cut). ✅
- Timing sums to 719.928s with zero gaps/overlaps (each `end_sec` equals the next scene's `start_sec`; verified by direct sum in Section 9.1). ✅
- scene_001's canonical asset and the non-use of the superseded low-res file are both stated explicitly; the supplemental montage is flagged as optional/unbound/requiring separate approval, not authorized here. ✅
- scene_005's SIMULATED TEST SCENARIO/SIMULATED TRANSCRIPT treatment, scene_010/019/021's no-aggressive-crop/upscale direction, scene_024/028's above-floor-resolution acknowledgment, scene_025's reuse-with-bookend-variation, and scene_030–033's differentiated closing sequence are all encoded in the appendix and Sections 4–5. ✅
- Global prohibited-treatment list (Section 6) and accessibility rules (Section 7) are stated once and referenced per scene via the "scene-specific addition" column rather than repeated in full 33 times. ✅
- All four `qa/visual_qa.md` non-blocking findings (NB-001–NB-004) are carried forward with `carried_forward=true`, mitigation, and why-non-blocking (Section 8), and referenced per affected scene row. ✅
- No project-relative path in this document is a full URL; all effective media paths are `assets/footage/...`. ✅

## 11. Handoff note

This plan is ready for `factforge-motion` to consume for `remotion/composition.json` authoring. Per the explicit scope of this run, **no manifest state transition was performed** — advancing `director` → `remotion` is left to the orchestrator/human reviewer. No Remotion files, `scene_config.json`, `asset_map.json`, or render assets were created or modified by this stage.
