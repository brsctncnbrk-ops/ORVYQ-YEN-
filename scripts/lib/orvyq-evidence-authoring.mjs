// buildEvidenceContent() -- authors the complete PrimaryEvidenceSpec content
// (eyebrow, title, kind-specific body, limitation) for one full_production
// evidence shot from ONLY real, already-verified project data: the claim's
// own narration_excerpt, evidence_requirements, visual_treatment,
// recommended_rewrite and resolved status (research/evidence_map.json +
// evidence_resolutions.json, via loadResolvedEvidenceMap), the section's
// title/dramatic_function (evidence_map.json's sections[]), and the cited
// sources' own catalog fields (title/publisher/publication_date/
// limitation). Nothing here invents a statistic, date, quote, conclusion or
// causal claim -- every displayed string is either a real field verbatim or
// lightly reformatted (date formatting, truncation), or a short
// human-readable label naming which real field is being shown.
//
// A claim that produces several evidence shots (e.g. a long claim sliced
// into 5 evidence_chain beats) must not show the same title/eyebrow/body on
// every one of them. buildFactPool() below collects every distinct real
// fact available for a claim (one per cited source, one per
// evidence_requirement, the narration excerpt, the section context, and any
// recommended_rewrite), and each shot's `occurrence` index rotates which
// fact leads -- so repeated shots for one claim feature a different real
// fact first, and their kind-specific body is built starting from that
// same rotated order. No fact is fabricated to fill a gap: when a kind
// needs more items/steps than the rotation alone supplies, the pass falls
// back to the full (non-rotated) fact pool rather than inventing content.

const MAX_EYEBROW = 60;
const MAX_TITLE = 90;

function truncateWords(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// A long publisher name (e.g. "Stanford Institute for Human-Centered
// Artificial Intelligence") can eat most of a plain truncateWords(90)
// budget on its own, cutting off the actual distinguishing part -- the
// source's own document title -- before it ever appears, which made two
// different Stanford AI Index reports ("...Economy" vs "...Technical
// Performance") render as visually identical truncated titles. This gives
// `main` (the distinguishing part) the majority of the budget first, then
// fits `prefix` into whatever remains.
function combineTitle(prefix, main, max) {
  const mainBudget = Math.max(20, Math.round(max * 0.62));
  const mainText = truncateWords(main, mainBudget);
  const prefixBudget = Math.max(10, max - mainText.length - 2);
  const prefixText = truncateWords(prefix, prefixBudget);
  return truncateWords(`${prefixText}: ${mainText}`, max);
}

function shortClaimName(claimId) {
  return claimId.replace(/^CLM_\d+_/, "").replace(/_/g, " ").toLowerCase();
}

function formatDate(iso) {
  if (!iso) return "undated";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

// Requirement sentences are real authored editorial instructions (evidence_
// requirements[]) -- classifying them as a "boundary" (what NOT to claim) vs
// an "establishes" fact (what to show) lets both sides of a comparison/
// boundary card be grounded in real requirement text instead of an invented
// contrast.
const NEGATIVE_REQUIREMENT = /\b(do not|don't|avoid|without|not)\b/i;
function classifyRequirement(text) {
  return NEGATIVE_REQUIREMENT.test(text) ? "requirement_negative" : "requirement_positive";
}

// The one source in this project's catalog whose real usage_note explicitly
// requires every recreation to "retain the controlled-simulation
// limitation" (SRC_ANTHROPIC_AGENTIC_MISALIGNMENT_2025 -- see research/
// evidence_map.json) but which does not carry a structured `limitation`
// field of its own the way the other sources do. Its citing claims'
// evidence_requirements independently say the same thing in their own
// words (CLM_004: "State controlled simulations."; CLM_006: "Display the
// source's controlled-simulation limitation at main-text size." plus its
// own narration_excerpt "None of this happened in the wild."). This is a
// direct paraphrase of that real, shared requirement -- not a new fact.
const CONTROLLED_SIMULATION_SOURCE_ID = "SRC_ANTHROPIC_AGENTIC_MISALIGNMENT_2025";

export function claimLimitation(claim, ownSources) {
  const sourceLimitation = ownSources.map((source) => source.limitation).find(Boolean);
  if (sourceLimitation) return sourceLimitation;
  if ((claim.source_ids || []).includes(CONTROLLED_SIMULATION_SOURCE_ID)) return "Controlled simulation, not a documented real-world incident.";
  if (claim.status === "attributed_commentary") return "Attributed commentary, not a measured or universal industry finding.";
  return null;
}

function buildFactPool(claim, displaySources, section) {
  const facts = [];
  for (const source of displaySources) facts.push({ type: "source", source });
  for (const requirement of claim.evidence_requirements || []) facts.push({ type: classifyRequirement(requirement), text: requirement });
  if (claim.narration_excerpt) facts.push({ type: "narration", text: claim.narration_excerpt });
  if (section) facts.push({ type: "section", section });
  if (claim.recommended_rewrite) facts.push({ type: "rewrite", text: claim.recommended_rewrite });
  return facts;
}

function rotate(list, start) {
  if (!list.length) return list;
  const offset = ((start % list.length) + list.length) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

function factLabel(fact) {
  if (fact.type === "source") return fact.source.publisher.toUpperCase();
  if (fact.type === "requirement_negative") return "EVIDENCE BOUNDARY";
  if (fact.type === "requirement_positive") return "WHAT THIS ESTABLISHES";
  if (fact.type === "narration") return "FILM CLAIM";
  if (fact.type === "section") return "SECTION CONTEXT";
  if (fact.type === "rewrite") return "EDITORIAL RESOLUTION";
  return "EVIDENCE";
}

function factText(fact) {
  if (fact.type === "source") return fact.source.title;
  if (fact.type === "section") return `${fact.section.title} — ${fact.section.dramatic_function}`;
  return fact.text;
}

function factItem(fact) {
  if (fact.type === "source") return { label: truncateWords(fact.source.publisher.toUpperCase(), 28), value: formatDate(fact.source.publication_date), detail: truncateWords(fact.source.title, 120) };
  if (fact.type === "section") return { label: "SECTION", value: truncateWords(fact.section.title, 40), detail: truncateWords(fact.section.dramatic_function, 120) };
  return { label: factLabel(fact), value: truncateWords(fact.text, 70) };
}

function factStep(fact) {
  if (fact.type === "source") return truncateWords(`${fact.source.publisher} (${formatDate(fact.source.publication_date)}): ${fact.source.title}`, 90);
  if (fact.type === "section") return truncateWords(`${fact.section.title}: ${fact.section.dramatic_function}`, 90);
  return truncateWords(fact.text, 90);
}

const ROLE_LABEL = { evidence: "PRIMARY EVIDENCE", context: "VERIFIED CONTEXT", metaphor: "EVIDENCE BOUNDARY", archive: "ARCHIVE EVIDENCE" };

// occurrence: 0-based count of shots already built for this exact
// (claim_id, kind) pair -- rotates which real fact leads this shot's
// eyebrow/title/body so repeated shots for one claim/kind don't repeat the
// same authored content. displaySources are the sources actually attributed
// to THIS shot (a claim's own source_ids, or the recap union for a
// synthesis claim with none of its own); ownSources (used only for
// claimLimitation) are always the claim's own declared source_ids, never
// the recap union, so a recap card's limitation reflects its own
// attributed-commentary status rather than one arbitrarily-first other
// claim's limitation.
// A claim's primary-kind ("evidence" role) and secondary-kind ("context"
// role) shots each keep their own occurrence counter (they're different
// evidence kinds), so both can independently start at occurrence 0 and
// otherwise rotate to the exact same lead fact -- observed for real on
// CLM_006 (a comparison "evidence" shot and a source_article "context"
// shot, both occurrence 0, both citing the claim's one source). Offsetting
// the rotation start by role keeps a claim's different visual roles from
// ever opening on the same fact even at occurrence 0.
const ROLE_ROTATION_OFFSET = { evidence: 0, context: 1, metaphor: 2, archive: 0 };

export function buildEvidenceContent({ claim, kind, role, displaySources, ownSources, section, occurrence = 0 }) {
  const facts = buildFactPool(claim, displaySources, section);
  const rotated = rotate(facts, occurrence + (ROLE_ROTATION_OFFSET[role] || 0));
  const lead = rotated[0] || { type: "narration", text: claim.narration_excerpt };

  const roleLabel = ROLE_LABEL[role] || "EVIDENCE";
  const eyebrow = truncateWords(`${factLabel(lead)} — ${roleLabel}`, MAX_EYEBROW).toUpperCase();

  let title;
  if (lead.type === "source") title = combineTitle(lead.source.publisher, lead.source.title, MAX_TITLE);
  else if (lead.type === "section") title = combineTitle(lead.section.title, claim.narration_excerpt, MAX_TITLE);
  else title = truncateWords(factText(lead) || claim.narration_excerpt || shortClaimName(claim.claim_id), MAX_TITLE);

  const limitation = claimLimitation(claim, ownSources);
  const body = {};

  if (kind === "source_timeline" || kind === "source_article") {
    const items = [];
    for (const fact of rotated) {
      if (items.length >= 4) break;
      const item = factItem(fact);
      if (item.value && !items.some((existing) => existing.label === item.label && existing.value === item.value)) items.push(item);
    }
    if (items.length < 2) {
      for (const fact of facts) {
        if (items.length >= 2) break;
        const item = factItem(fact);
        if (item.value && !items.some((existing) => existing.label === item.label && existing.value === item.value)) items.push(item);
      }
    }
    body.items = items.slice(0, 4);
  } else if (kind === "concept_map" || kind === "evidence_chain") {
    const steps = [];
    for (const fact of rotated) {
      if (steps.length >= 5) break;
      const step = factStep(fact);
      if (step && !steps.includes(step)) steps.push(step);
    }
    if (steps.length < 3) {
      for (const fact of facts) {
        if (steps.length >= 3) break;
        const step = factStep(fact);
        if (step && !steps.includes(step)) steps.push(step);
      }
    }
    body.steps = steps.slice(0, 5);
  } else if (kind === "comparison" || kind === "boundary") {
    const positive = rotated.find((fact) => fact.type === "requirement_positive") || rotated.find((fact) => fact.type === "narration");
    const negativeFact = rotated.find((fact) => fact.type === "requirement_negative" && fact !== positive);
    // Rotates which cited source informs left_detail so a thin-content
    // claim (one narration + one requirement, e.g. CLM_013) still varies
    // something real across repeat comparison shots even when there is
    // only one real positive/negative fact to put on the cards themselves.
    const primarySource = (rotated.find((fact) => fact.type === "source") || { source: displaySources[0] }).source;
    body.left = truncateWords(positive ? factText(positive) : claim.narration_excerpt, 70);
    body.left_detail = primarySource ? truncateWords(`Per ${primarySource.publisher}, ${formatDate(primarySource.publication_date)}.`, 120) : "";
    if (negativeFact) {
      body.right = truncateWords(factText(negativeFact), 70);
      body.right_detail = limitation ? truncateWords(limitation, 120) : "";
    } else if (limitation) {
      body.right = truncateWords(limitation, 70);
      body.right_detail = "";
    } else {
      body.right = "A universal or fully settled conclusion";
      body.right_detail = "This claim's own evidence_requirements do not extend this far.";
    }
  }

  return { eyebrow, title, ...(limitation ? { limitation } : {}), ...body };
}
