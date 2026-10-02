import { z } from "zod";
import { WORKER_ERROR_CODES } from "@/lib/outreach/types";

export const workerIdSchema = z.string().trim().min(1).max(120);

export const verifyResultSchema = z.object({
  profileExists: z.boolean(),
  alreadyFollowing: z.boolean(),
  username: z.string().trim().max(30).optional(),
  observedUsername: z.string().trim().max(80).optional(),
  relationshipStatus: z.enum(["following", "not_following", "requested", "unknown"]).optional(),
  profileIsPrivate: z.boolean().optional(),
});

export const followResultSchema = z.object({
  followed: z.boolean(),
  skippedBecauseAlreadyFollowing: z.boolean().optional(),
  relationshipStatus: z.enum(["following", "not_following", "requested", "unknown"]).optional(),
  profileExists: z.boolean().optional(),
});

export const sendResultSchema = z.object({
  sent: z.boolean(),
  existingConversation: z.boolean().optional(),
  dmUnavailable: z.boolean().optional(),
  profileExists: z.boolean().optional(),
});

export const failJobSchema = z.object({
  worker_id: workerIdSchema,
  error_code: z.enum(WORKER_ERROR_CODES),
  error_message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
});

export const claimJobSchema = z.object({
  worker_id: workerIdSchema,
  machine_name: z.string().trim().max(200).optional(),
  prospect_id: z.string().uuid().optional(),
});

export const workerJobSchema = z.object({
  worker_id: workerIdSchema,
});
