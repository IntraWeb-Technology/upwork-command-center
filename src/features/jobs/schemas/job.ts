import { z } from 'zod';
import { MAX_LISTING_CHARS } from '../constants/job-options';

export const createJobSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a job title.')
    .max(300, 'Keep the title under 300 characters.'),
  url: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^https?:\/\/\S+$/i.test(value),
      'Enter a full link starting with https://, or leave it empty.'
    ),
  listing_text: z
    .string()
    .refine((value) => value.trim().length > 0, 'Paste the full job listing.')
    .refine(
      (value) => value.length <= MAX_LISTING_CHARS,
      `The listing must be at most ${MAX_LISTING_CHARS.toLocaleString('en-US')} characters.`
    )
});

export type CreateJobFormValues = z.infer<typeof createJobSchema>;

export const declineJobSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Add a reason for declining.')
    .max(1000, 'Keep the reason under 1,000 characters.')
});

export type DeclineJobFormValues = z.infer<typeof declineJobSchema>;

const SCORE_PATTERN = /^\d{1,2}(\.\d)?$/;

/** Select value meaning "no owner disposition, use the system one". */
export const SYSTEM_DISPOSITION = 'SYSTEM';

export const overrideSchema = z
  .object({
    manual_score: z
      .string()
      .trim()
      .refine((value) => {
        if (value === '') return true;
        if (!SCORE_PATTERN.test(value)) return false;
        const score = Number(value);
        return score >= 1 && score <= 10;
      }, 'Use a score from 1 to 10 with at most one decimal, or leave it empty.'),
    manual_disposition: z.string(),
    reason: z.string().trim().max(1000, 'Keep the reason under 1,000 characters.'),
    system_disposition: z.string()
  })
  .refine(
    (value) =>
      value.manual_disposition === SYSTEM_DISPOSITION ||
      value.manual_disposition === value.system_disposition ||
      value.reason.length > 0,
    { message: 'Explain why you are changing the disposition.', path: ['reason'] }
  );

export type OverrideFormValues = z.infer<typeof overrideSchema>;
