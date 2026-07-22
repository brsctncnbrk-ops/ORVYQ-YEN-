export type EvidenceItem = { label: string; value: string; detail?: string };
export type EvidenceFocus = { scale?: number; x?: number; y?: number };
export type PrimaryEvidenceSpec = {
  kind: "split_documents" | "official_document" | "official_figure" | "official_screen" | "image_sequence" | "source_timeline" | "source_article" | "concept_map" | "boundary" | "comparison" | "recap" | "evidence_chain";
  eyebrow: string; title: string; subtitle?: string; callout?: string; limitation?: string; source_label: string; source_ids: string[]; evidence_asset_ids?: string[]; image_assets?: string[]; items?: EvidenceItem[]; steps?: string[]; left?: string; right?: string; left_detail?: string; right_detail?: string; focus?: EvidenceFocus; font_px?: number;
};
