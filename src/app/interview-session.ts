import { z } from 'zod';
import {
  aiExperienceSchema,
  aiJobSchema,
  aiQuestionSchema,
  feedbackResultSchema,
  type AIFeedbackResult,
} from '@/lib/ai-contract';
const feedbackHistorySchema = z.object({
  answer: z.string().max(12000),
  feedback: feedbackResultSchema,
  followUpAnswer: z.string().max(12000),
});
export const interviewSessionTitleSchema = z
  .string()
  .trim()
  .min(1, '연습 제목을 입력해 주세요.')
  .max(300, '연습 제목은 300자 이내로 입력해 주세요.');
export const practiceQuestionSchema = aiQuestionSchema.extend({
  id: z.string().min(1).max(100),
  answer: z.string().max(12000),
  feedback: feedbackResultSchema.nullable(),
  feedbackForAnswer: z.string().max(12000).nullable(),
  followUpAnswer: z.string().max(12000),
  history: z.array(feedbackHistorySchema).max(20),
});
export const interviewSessionSchema = z.object({
  demo: z.boolean().default(false),
  id: z.string().min(1).max(100),
  createdAt: z.string().max(50),
  title: z.string().max(300),
  hospitalName: z.string().max(300).default(''),
  provider: z.enum(['openai', 'gemini']),
  model: z.string().max(100),
  essaySnapshot: z.string().max(12000),
  jobSnapshot: aiJobSchema.nullable(),
  experienceSnapshots: z.array(aiExperienceSchema).max(10),
  questions: z.array(practiceQuestionSchema).length(5),
  reflection: z.string().max(12000),
  completedAt: z.string().max(50).nullable(),
});
export type InterviewSession = z.infer<typeof interviewSessionSchema>;
export type PracticeQuestion = z.infer<typeof practiceQuestionSchema>;
export function attachInterviewFeedback(
  session: InterviewSession,
  questionId: string,
  answer: string,
  feedback: AIFeedbackResult,
): InterviewSession {
  const question = session.questions.find((item) => item.id === questionId);
  if (!question || question.answer !== answer)
    throw new Error('답변이 변경되어 이전 피드백을 반영하지 않았습니다.');
  if (question.history.length >= 20)
    throw new Error(
      '이 질문의 피드백 보관 한도에 도달했습니다. 새 연습을 시작해 주세요.',
    );
  return {
    ...session,
    questions: session.questions.map((item) =>
      item.id !== questionId
        ? item
        : {
            ...item,
            feedback,
            feedbackForAnswer: answer,
            followUpAnswer: '',
            history: item.feedback
              ? [
                  ...item.history,
                  {
                    answer: item.feedbackForAnswer ?? item.answer,
                    feedback: item.feedback,
                    followUpAnswer: item.followUpAnswer,
                  },
                ]
              : item.history,
          },
    ),
  };
}
