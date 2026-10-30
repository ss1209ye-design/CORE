import { z } from 'zod';

export const GEMINI_MODEL = 'gemini-3.6-flash';
export const AI_TIMEOUT_MS = 60_000;

export const aiExperienceSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(300),
  category: z.string().max(80),
  period: z.string().max(150),
  level: z.string().max(80),
  body: z.string().min(1).max(12000),
  demo: z.boolean(),
  keywords: z.array(z.string().min(1).max(80)).max(20),
});
export const aiJobSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(300),
  organization: z.string().max(300),
  duties: z.string().max(10000),
  qualifications: z.string().max(10000),
  documents: z.string().max(10000),
});
export const aiEvidenceSchema = z.object({
  sourceId: z.string().min(1).max(120),
  quote: z.string().min(6).max(1000),
});
export const aiQuestionSchema = z.object({
  question: z.string().min(1).max(1000),
  intent: z.string().min(1).max(1000),
  evidence: z.array(aiEvidenceSchema).min(1).max(5),
});
export const keywordResultSchema = z.object({
  keywords: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        category: z.enum(['역할', '행동', '역량', '배운 점']),
        evidence: z.string().min(6).max(1000),
      }),
    )
    .max(5),
  questions: z.array(z.string().min(1).max(1000)).max(5).default([]),
});
export const draftResultSchema = z.object({
  draft: z.string().max(10000),
  sourceIds: z.array(z.string().min(1).max(100)).max(10),
  evidence: z.array(aiEvidenceSchema).max(20),
  questions: z.array(z.string().min(1).max(1000)).max(8),
});
export const interviewResultSchema = z.object({
  questions: z.array(aiQuestionSchema).length(5),
});
export const feedbackResultSchema = z.object({
  followUp: z.string().min(1).max(1000),
  improvements: z.array(z.string().min(1).max(1000)).min(1).max(5),
  evidence: z.array(z.string().min(6).max(1000)).min(1).max(5),
});
const experiences = z.array(aiExperienceSchema).max(10);
export const aiRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keywords'), experience: aiExperienceSchema }),
  z.object({
    action: z.literal('draft'),
    question: z.string().min(1).max(3000),
    targetRole: z.string().trim().max(300).default(''),
    job: aiJobSchema.nullable(),
    experiences: experiences.min(1),
  }),
  z
    .object({
      action: z.literal('interview'),
      essay: z.string().max(12000),
      job: aiJobSchema.nullable(),
      experiences,
    })
    .refine(
      (input) =>
        input.essay.trim().length >= 20 || input.experiences.length > 0,
      { message: '자기소개서 또는 포트폴리오를 선택해 주세요.' },
    ),
  z.object({
    action: z.literal('feedback'),
    question: aiQuestionSchema,
    answer: z.string().min(10).max(12000),
  }),
]);
export type AIExperience = z.infer<typeof aiExperienceSchema>;
export type AIJob = z.infer<typeof aiJobSchema>;
export type AIEvidence = z.infer<typeof aiEvidenceSchema>;
export type AIQuestion = z.infer<typeof aiQuestionSchema>;
export type AIRequest = z.infer<typeof aiRequestSchema>;
export type AIKeywordResult = z.infer<typeof keywordResultSchema>;
export type AIDraftResult = z.infer<typeof draftResultSchema>;
export type AIInterviewResult = z.infer<typeof interviewResultSchema>;
export type AIFeedbackResult = z.infer<typeof feedbackResultSchema>;

export function aiSourceTexts(input: AIRequest): Map<string, string> {
  const sources = new Map<string, string>();
  if (input.action === 'keywords')
    sources.set(`experience:${input.experience.id}`, input.experience.body);
  if (input.action === 'draft' || input.action === 'interview') {
    for (const experience of input.experiences)
      sources.set(
        `experience:${experience.id}`,
        `${experience.title}\n${experience.category}\n${experience.period}\n${experience.level}\n${experience.body}`,
      );
    if (input.job)
      sources.set(
        'job',
        `${input.job.title}\n${input.job.organization}\n${input.job.duties}\n${input.job.qualifications}\n${input.job.documents}`,
      );
    if (input.action === 'interview') sources.set('essay', input.essay);
  }
  if (input.action === 'feedback') sources.set('answer', input.answer);
  return sources;
}
