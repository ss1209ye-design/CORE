import { z } from 'zod';
import {
  aiExperienceSchema,
  aiJobSchema,
  draftResultSchema,
} from '@/lib/ai-contract';
import { interviewSessionSchema } from './interview-session';
export const text = z.string().max(12000);
export const statuses = [
  '관심',
  '준비 중',
  '지원 완료',
  '전형 진행',
  '종료',
] as const;
export const institutionTypes = [
  '의원',
  '병원',
  '종합병원',
  '상급종합병원',
  '기타·미확인',
] as const;
export const experienceTypes = [
  '실습',
  '근무',
  '교육',
  '자격',
  '프로젝트',
  '봉사활동',
  '교내활동',
  '프로젝트·수상',
  '대외활동·프로젝트',
] as const;
export const performanceLevels = [
  '관찰',
  '보조',
  '지도하 수행',
  '독립 수행',
  '해당 없음',
] as const;
export const experienceSchema = z.object({
  id: text,
  title: text,
  category: z.enum(experienceTypes),
  level: z.enum(performanceLevels),
  period: text,
  body: text,
  keywords: z.array(z.string().min(1).max(80)).max(20).default([]),
  demo: z.boolean(),
});
export const conditionSchema = z.object({
  id: text,
  text,
  evidence: text,
  verified: z.boolean(),
  experienceId: text,
  reason: text,
});
export const jobSchema = z.object({
  role: z.string().max(300).default(''),
  documents: text.default(''),
  rawText: z.string().max(40000).default(''),
  duties: text.default(''),
  workConditions: text.default(''),
  applicationPeriod: text.default(''),
  applicationStart: text.default(''),
  startDateConfirmed: z.boolean().default(false),
  id: text,
  title: text,
  organization: text,
  type: z.enum(institutionTypes),
  attributes: text,
  field: text,
  source: text,
  deadline: text,
  dateConfirmed: z.boolean(),
  status: z.enum(statuses),
  confirmed: z.boolean(),
  demo: z.boolean(),
  conditions: z.array(conditionSchema).max(40),
  tasks: z
    .array(
      z.object({
        id: text,
        title: text,
        due: text,
        reason: text,
        done: z.boolean(),
      }),
    )
    .max(100),
});
export const draftProvenanceSchema = z.object({
  targetRole: z.string().max(300).default(''),
  result: draftResultSchema,
  provider: z.enum(['openai', 'gemini']),
  model: z.string().max(100),
  question: text,
  jobSnapshot: aiJobSchema.nullable(),
  experienceSnapshots: z.array(aiExperienceSchema).max(10),
  generatedAt: text,
});
export type DraftProvenance = z.infer<typeof draftProvenanceSchema>;
export const essaySchema = z.object({
  targetRole: z.string().max(300).default(''),
  ai: draftProvenanceSchema.nullable().default(null),
  demo: z.boolean().default(false),
  id: text,
  jobId: text,
  question: text,
  experienceIds: z.array(text),
  outline: text,
  draft: text,
  revised: text,
  submissions: z
    .array(z.object({ id: text, content: text, savedAt: text }))
    .max(100),
  keywords: text.default(''),
});
export const interviewSchema = z.object({
  id: text,
  jobId: text,
  question: text,
  answer: text,
  improvement: text,
  reflection: text,
  source: text,
});
export const stateSchema = z.object({
  version: z.literal(1),
  profile: z.object({
    profession: text,
    career: text,
    education: text,
    license: text,
    goals: text,
    field: text,
    environment: text,
    institution: text,
    attributes: text,
  }),
  experiences: z.array(experienceSchema).max(500),
  jobs: z.array(jobSchema).max(500),
  essays: z.array(essaySchema).max(500),
  interviews: z.array(interviewSchema).max(500),
  interviewSessions: z.array(interviewSessionSchema).max(200).default([]),
});
export type Workspace = z.infer<typeof stateSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Essay = z.infer<typeof essaySchema>;
export function emptyState(): Workspace {
  return {
    version: 1,
    profile: {
      profession: '물리치료',
      career: '',
      education: '',
      license: '',
      goals: '',
      field: '',
      environment: '',
      institution: '',
      attributes: '',
    },
    experiences: [],
    jobs: [],
    essays: [],
    interviews: [],
    interviewSessions: [],
  };
}
