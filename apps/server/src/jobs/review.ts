import { z } from 'zod';
import { extractJson } from '../lib/model';

const reviewSchema = z.object({ pass: z.boolean(), issues: z.array(z.string()) });

export function parseReview(raw: string) {
  return reviewSchema.parse(extractJson(raw));
}
