export const AI_CATEGORIES = [
  "drone_operator",
  "real_estate_photographer",
  "real_estate_media_company",
  "videographer",
  "commercial_media",
  "mixed_media",
  "other",
] as const;

export type AiCategory = (typeof AI_CATEGORIES)[number];

export const AI_CATEGORY_LABELS: Record<AiCategory, string> = {
  drone_operator: "Drone Operator",
  real_estate_photographer: "Real Estate Photographer",
  real_estate_media_company: "Real Estate Media",
  videographer: "Videographer",
  commercial_media: "Commercial Media",
  mixed_media: "Media Business",
  other: "Other",
};

export function isAiCategory(value: string): value is AiCategory {
  return AI_CATEGORIES.some((category) => category === value);
}

export function categoryLabel(value: string | null | undefined) {
  if (!value) return "Uncategorized";
  return isAiCategory(value) ? AI_CATEGORY_LABELS[value] : value;
}
