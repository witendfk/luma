import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UploadScope = z.object({ conversationId: z.string().min(1), subjectRevisionId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(), exerciseId: z.string().min(1).optional() }).strict();
export const CreateUploadRequest = z.object({
  purpose: z.enum(['question_origin', 'process_photo', 'knowledge_material', 'answer_photo']),
  format: z.enum(['jpg', 'jpeg', 'png', 'webp']),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES), scope: UploadScope,
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;
export interface UploadTicket { uploadId: string; objectKey: string; url: string; maxBytes: number; expiresAt: string }
export const RecognitionRequest = z.object({
  requestId: z.string().min(8).max(64), attachmentIds: z.array(z.string().min(1)).min(1).max(3),
  intent: z.enum(['question', 'knowledge', 'practice']).default('question'), text: z.string().max(2000).default(''),
  subjectRevisionId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(), exerciseId: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if ((value.attemptId || value.exerciseId) && (!value.attemptId || !value.exerciseId || !value.subjectRevisionId))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '作答转写需要题目、轮次和来源版本' });
});
export type RecognitionRequest = z.infer<typeof RecognitionRequest>;
export const RecognizedContent = z.object({
  items: z.array(z.object({
    text: z.string().trim().min(1).max(8000), imageIndexes: z.array(z.number().int().min(0).max(2)).min(1).max(3),
    subquestions: z.array(z.string().trim().min(1).max(1000)).max(20),
    uncertainties: z.array(z.string().trim().min(1).max(500)).max(20), tags: z.array(z.string().trim().min(1).max(80)).max(20),
  })).max(12),
  steps: z.array(z.string().trim().min(1).max(2000)).max(30),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(20),
});
export type RecognizedContent = z.infer<typeof RecognizedContent>;
export interface RecognitionView {
  id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'superseded';
  materialType: 'question' | 'process' | 'answer'; attachmentIds: string[]; text: string;
  transcriptId?: string; steps?: string[]; uncertainties?: string[];
  transcriptConfirmed?: boolean; confirmedSteps?: string[];
  error: { message: string; retryable: boolean } | null;
}
