import { z } from "zod";
import { AI_CATEGORIES } from "@/lib/ai/categories";
import { FIT_LABELS } from "@/lib/constants/prospects";

export const EXCLUSION_REASONS = [
  "already_following",
  "already_contacted",
  "hobby",
  "meme",
  "unrelated_drone",
  "large_company",
  "non_english",
  "wrong_niche",
  "follower_range",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

const confidence = z.number().min(0).max(1);
const nullableBoolean = z.boolean().nullable();

export const qualificationSchema = z.object({
  qualified: z.boolean(),
  fit_score: z.number().int().min(0).max(100),
  fit_label: z.enum(FIT_LABELS),
  category: z.enum(AI_CATEGORIES).nullable(),
  first_name: z.string().trim().max(40).nullable(),
  first_name_confidence: confidence,
  english_likely: nullableBoolean,
  english_confidence: confidence,
  us_based_likely: nullableBoolean,
  location_confidence: confidence,
  exclusion_reason: z.enum(EXCLUSION_REASONS).nullable(),
  qualification_reason: z.string().trim().min(1).max(500),
  signals: z.object({
    professional_media_business: z.boolean(),
    drone_services: z.boolean(),
    real_estate_media: z.boolean(),
    videography_services: z.boolean(),
    commercial_media: z.boolean(),
    solo_or_small_team: z.boolean(),
  }),
});

export type QualificationAnalysis = z.infer<typeof qualificationSchema>;

export const QUALIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "qualified",
    "fit_score",
    "fit_label",
    "category",
    "first_name",
    "first_name_confidence",
    "english_likely",
    "english_confidence",
    "us_based_likely",
    "location_confidence",
    "exclusion_reason",
    "qualification_reason",
    "signals",
  ],
  properties: {
    qualified: { type: "boolean" },
    fit_score: { type: "integer", minimum: 0, maximum: 100 },
    fit_label: { type: "string", enum: ["strong_fit", "possible_fit", "skip"] },
    category: {
      anyOf: [{ type: "string", enum: [...AI_CATEGORIES] }, { type: "null" }],
    },
    first_name: { anyOf: [{ type: "string" }, { type: "null" }] },
    first_name_confidence: { type: "number", minimum: 0, maximum: 1 },
    english_likely: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    english_confidence: { type: "number", minimum: 0, maximum: 1 },
    us_based_likely: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    location_confidence: { type: "number", minimum: 0, maximum: 1 },
    exclusion_reason: {
      anyOf: [{ type: "string", enum: [...EXCLUSION_REASONS] }, { type: "null" }],
    },
    qualification_reason: { type: "string" },
    signals: {
      type: "object",
      additionalProperties: false,
      required: [
        "professional_media_business",
        "drone_services",
        "real_estate_media",
        "videography_services",
        "commercial_media",
        "solo_or_small_team",
      ],
      properties: {
        professional_media_business: { type: "boolean" },
        drone_services: { type: "boolean" },
        real_estate_media: { type: "boolean" },
        videography_services: { type: "boolean" },
        commercial_media: { type: "boolean" },
        solo_or_small_team: { type: "boolean" },
      },
    },
  },
} as const;
