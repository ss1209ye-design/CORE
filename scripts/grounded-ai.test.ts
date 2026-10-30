import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import * as contract from '../src/lib/ai-contract';
import * as gemini from '../src/lib/gemini';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeEvidenceText,
  validateGroundedAIResult,
} from '../src/lib/grounded-ai';
import { aiRequestSchema, aiSourceTexts } from '../src/lib/ai-contract';
import { AIOutputValidationError } from '../src/lib/gemini';
import type {
  AIRequest,
  AIDraftResult,
  AIFeedbackResult,
  AIInterviewResult,
  AIKeywordResult,
} from '../src/lib/ai-contract';

// Every fixture below is synthetic test data, not an AI response or a factual claim.
const experience = {
  id: 'synthetic-exp',
  title: 'Synthetic activity',
  category: 'Synthetic category',
  period: 'Synthetic period',
  level: 'Assisted',
  body: 'I helped prepare 12 sample orders and observed the handoff.',
  demo: true,
  keywords: [],
};

function syntheticInterviewOutput(
  questions: AIInterviewResult['questions'],
): AIInterviewResult {
  return { questions };
}

test('normalizes whitespace only for evidence matching', () => {
  assert.equal(normalizeEvidenceText('  alpha\n\t beta  '), 'alpha beta');
});

test('accepts synthetic keyword evidence quoted from the experience body', () => {
  const input = { action: 'keywords', experience } satisfies AIRequest;
  const output: AIKeywordResult = {
    keywords: [
      {
        label: 'Preparation',
        category: '행동',
        evidence: 'helped prepare 12 sample orders',
      },
      {
        label: 'Handoff observation',
        category: '역할',
        evidence: 'observed the handoff',
      },
      {
        label: 'Assistance',
        category: '역량',
        evidence: 'I helped prepare 12 sample orders',
      },
    ],
    questions: [],
  };
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('rejects synthetic keyword evidence absent from the body', () => {
  const input = { action: 'keywords', experience } satisfies AIRequest;
  const output: AIKeywordResult = {
    keywords: [
      {
        label: 'Preparation',
        category: '행동',
        evidence: 'managed a nationwide team',
      },
      {
        label: 'Handoff observation',
        category: '역할',
        evidence: 'observed the handoff',
      },
      {
        label: 'Assistance',
        category: '역량',
        evidence: 'I helped prepare 12 sample orders',
      },
    ],
    questions: [],
  };
  assert.throws(
    () => validateGroundedAIResult(input, output),
    AIOutputValidationError,
  );
  const metadataQuote: AIKeywordResult = {
    ...output,
    keywords: output.keywords.map((keyword, index) =>
      index === 0 ? { ...keyword, evidence: experience.title } : keyword,
    ),
  };
  assert.throws(
    () => validateGroundedAIResult(input, metadataQuote),
    AIOutputValidationError,
  );
});

test('rejects duplicate synthetic keyword labels after whitespace and case normalization', () => {
  const input = { action: 'keywords', experience } satisfies AIRequest;
  const output: AIKeywordResult = {
    keywords: [
      {
        label: 'Preparation',
        category: '행동',
        evidence: 'helped prepare 12 sample orders',
      },
      {
        label: ' preparation ',
        category: '역할',
        evidence: 'observed the handoff',
      },
      {
        label: 'Assistance',
        category: '역량',
        evidence: 'I helped prepare 12 sample orders',
      },
    ],
    questions: [],
  };
  assert.throws(
    () => validateGroundedAIResult(input, output),
    AIOutputValidationError,
  );
});

test('accepts no synthetic keywords when evidence is insufficient and asks for clarification', () => {
  const input = { action: 'keywords', experience } satisfies AIRequest;
  const output: AIKeywordResult = {
    keywords: [],
    questions: ['어떤 역할을 맡으셨고 직접 수행한 일은 무엇인가요?'],
  };
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('rejects synthetic keyword results with one or two labels or no clarification', () => {
  const input = { action: 'keywords', experience } satisfies AIRequest;
  const keyword = {
    label: 'Handoff observation',
    category: '역할' as const,
    evidence: 'observed the handoff',
  };
  for (const output of [
    { keywords: [keyword], questions: ['What else did you do?'] },
    { keywords: [keyword, { ...keyword, label: 'Assistance' }], questions: [] },
    { keywords: [], questions: [] },
  ])
    assert.throws(
      () => validateGroundedAIResult(input, output),
      AIOutputValidationError,
    );
});

test('accepts a synthetic draft whose selected experience id and numeric evidence match', () => {
  const input = {
    action: 'draft',
    question: 'Describe this synthetic activity.',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const output: AIDraftResult = {
    draft:
      'As an assistant in a demo, I helped prepare 12 sample orders and observed the handoff.',
    sourceIds: ['synthetic-exp'],
    evidence: [
      {
        sourceId: 'experience:synthetic-exp',
        quote: 'helped prepare 12 sample orders',
      },
    ],
    questions: [],
  };
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('targetRole is a typed requested-role context, not experience evidence or a job source', () => {
  const request = {
    action: 'draft',
    question: 'Describe this synthetic activity.',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  };
  assert.equal(aiRequestSchema.safeParse(request).success, true);
  assert.equal(
    aiRequestSchema.safeParse({ ...request, targetRole: 42 }).success,
    false,
  );
  const input = {
    action: 'draft',
    question: 'Describe this synthetic activity.',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const sources = aiSourceTexts(input);
  assert.equal(sources.has('job'), false);
  assert.equal(sources.has(input.targetRole), false);
  const output: AIDraftResult = {
    draft: 'I observed the handoff.',
    sourceIds: [experience.id],
    evidence: [
      {
        sourceId: 'experience:' + experience.id,
        quote: input.targetRole,
      },
    ],
    questions: [],
  };
  assert.throws(
    () => validateGroundedAIResult(input, output),
    AIOutputValidationError,
  );
});

test('rejects a synthetic draft with an unsupported numerical achievement', () => {
  const input = {
    action: 'draft',
    question: 'Describe this synthetic activity.',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const output: AIDraftResult = {
    draft: 'I increased conversion by 80%.',
    sourceIds: ['synthetic-exp'],
    evidence: [
      { sourceId: 'experience:synthetic-exp', quote: 'observed the handoff' },
    ],
    questions: [],
  };
  assert.throws(
    () => validateGroundedAIResult(input, output),
    AIOutputValidationError,
  );
});

test('rejects a synthetic draft when source ids and evidence do not match selected experiences', () => {
  const input = {
    action: 'draft',
    question: 'Describe this synthetic activity.',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const output: AIDraftResult = {
    draft: 'I observed a handoff.',
    sourceIds: ['other-exp'],
    evidence: [
      { sourceId: 'experience:synthetic-exp', quote: 'observed the handoff' },
    ],
    questions: [],
  };
  assert.throws(
    () => validateGroundedAIResult(input, output),
    AIOutputValidationError,
  );
});

test('accepts five distinct synthetic interview questions grounded in source text', () => {
  const input = {
    action: 'interview',
    essay: 'Synthetic essay about coordinating a sample reading event.',
    job: null,
    experiences: [],
  } satisfies AIRequest;
  const quote = 'coordinating a sample reading event';
  const questions = [1, 2, 3, 4, 5].map((number) => ({
    question: 'Synthetic question ' + number + '?',
    intent: 'Clarify the synthetic example.',
    evidence: [{ sourceId: 'essay', quote }],
  }));
  const output = syntheticInterviewOutput(questions);
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('accepts experience-only interview input with exact experience citations and an empty essay', () => {
  const input = {
    action: 'interview',
    essay: '',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const quote = 'observed the handoff';
  const output = syntheticInterviewOutput(
    [1, 2, 3, 4, 5].map((number) => ({
      question: 'Synthetic experience question ' + number + '?',
      intent: 'Clarify the synthetic experience.',
      evidence: [{ sourceId: 'experience:' + experience.id, quote }],
    })),
  );
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('rejects invented synthetic interview quotations from selected experiences', () => {
  const input = {
    action: 'interview',
    essay: '',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const output = syntheticInterviewOutput(
    [1, 2, 3, 4, 5].map((number) => ({
      question: 'Synthetic experience question ' + number + '?',
      intent: 'Clarify the synthetic experience.',
      evidence: [
        {
          sourceId: 'experience:' + experience.id,
          quote:
            number === 1
              ? 'managed a synthetic clinic'
              : 'observed the handoff',
        },
      ],
    })),
  );
  assert.throws(
    () => validateGroundedAIResult(input, output),
    AIOutputValidationError,
  );
});

test('rejects duplicate synthetic interview questions after whitespace normalization', () => {
  const input = {
    action: 'interview',
    essay: 'Synthetic essay about coordinating a sample reading event.',
    job: null,
    experiences: [],
  } satisfies AIRequest;
  const questions = [1, 2, 3, 4, 5].map((number) => ({
    question: 'Synthetic question ' + number + '?',
    intent: 'Clarify the synthetic example.',
    evidence: [
      { sourceId: 'essay', quote: 'coordinating a sample reading event' },
    ],
  }));
  questions[1]!.question = '  SYNTHETIC QUESTION 1? ';
  assert.throws(
    () => validateGroundedAIResult(input, syntheticInterviewOutput(questions)),
    AIOutputValidationError,
  );
});

test('accepts synthetic feedback only when evidence is quoted from the answer', () => {
  const input = {
    action: 'feedback',
    question: {
      question: 'Synthetic question?',
      intent: 'Synthetic intent.',
      evidence: [{ sourceId: 'essay', quote: 'synthetic essay quote' }],
    },
    answer: 'I asked two synthetic teammates to review the sample plan.',
  } satisfies AIRequest;
  const output: AIFeedbackResult = {
    followUp: 'What changed after the review?',
    improvements: ['Explain the review process in more detail.'],
    evidence: ['asked two synthetic teammates to review the sample plan'],
  };
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('rejects synthetic feedback evidence absent from the answer and score predictions', () => {
  const input = {
    action: 'feedback',
    question: {
      question: 'Synthetic question?',
      intent: 'Synthetic intent.',
      evidence: [{ sourceId: 'essay', quote: 'synthetic essay quote' }],
    },
    answer: 'I asked two synthetic teammates to review the sample plan.',
  } satisfies AIRequest;
  const unsupportedQuote: AIFeedbackResult = {
    followUp: 'What changed after the review?',
    improvements: ['Explain the review process in more detail.'],
    evidence: ['synthetic essay quote'],
  };
  assert.throws(
    () => validateGroundedAIResult(input, unsupportedQuote),
    AIOutputValidationError,
  );

  const scorePrediction: AIFeedbackResult = {
    followUp: 'What changed after the review?',
    improvements: ['Your score is 9 out of 10.'],
    evidence: ['asked two synthetic teammates to review the sample plan'],
  };
  assert.throws(
    () => validateGroundedAIResult(input, scorePrediction),
    AIOutputValidationError,
  );

  const numericScore: AIFeedbackResult = {
    followUp: 'What changed after the review?',
    improvements: ['I would rate this answer 8/10.'],
    evidence: ['asked two synthetic teammates to review the sample plan'],
  };
  assert.throws(
    () => validateGroundedAIResult(input, numericScore),
    AIOutputValidationError,
  );

  const hiringPrediction: AIFeedbackResult = {
    followUp: 'Will you be hired based on this answer?',
    improvements: ['Explain the review process in more detail.'],
    evidence: ['asked two synthetic teammates to review the sample plan'],
  };
  assert.throws(
    () => validateGroundedAIResult(input, hiringPrediction),
    AIOutputValidationError,
  );
});

test('Korean numeric claims keep number-unit pairs and cannot hide behind particles', () => {
  const source = {
    ...experience,
    body: '가상 자료에서 참여자 120명을 안내했고 준비 비율 30%를 기록했습니다.',
  };
  const input = {
    action: 'draft',
    question: '가상 활동을 설명하세요.',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [source],
  } satisfies AIRequest;
  const output: AIDraftResult = {
    draft: '가상 자료에서 참여자 120명을 안내했습니다.',
    sourceIds: [source.id],
    evidence: [{ sourceId: 'experience:' + source.id, quote: source.body }],
    questions: [],
  };
  assert.deepEqual(validateGroundedAIResult(input, output), output);
  for (const draft of [
    '참여자 20명을 안내했습니다.',
    '준비 비율이 120%로 향상되었습니다.',
    '약3개월간 참여했습니다.',
  ])
    assert.throws(
      () => validateGroundedAIResult(input, { ...output, draft }),
      AIOutputValidationError,
    );
});
test('allows an empty synthetic draft when it asks for missing facts', () => {
  const input = {
    action: 'draft',
    question: '가상 질문',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  const output: AIDraftResult = {
    draft: '',
    sourceIds: [],
    evidence: [],
    questions: ['직접 맡은 역할과 수행한 행동을 구체적으로 알려 주세요.'],
  };
  assert.deepEqual(validateGroundedAIResult(input, output), output);
});

test('an empty draft must provide clarification rather than an empty success', () => {
  const input = {
    action: 'draft',
    question: '가상 질문',
    targetRole: 'Synthetic requested role',
    job: null,
    experiences: [experience],
  } satisfies AIRequest;
  assert.throws(
    () =>
      validateGroundedAIResult(input, {
        draft: '',
        sourceIds: [],
        evidence: [],
        questions: [],
      }),
    AIOutputValidationError,
  );
});

test('실제 생성 경로의 JSON 스키마는 선택한 경험 ID와 인용 ID만 허용한다', async () => {
  const input = aiRequestSchema.parse({
    action: 'draft',
    question: 'Describe the synthetic task.',
    job: null,
    experiences: [experience],
  });
  const result = {
    draft: 'I helped prepare 12 sample orders.',
    sourceIds: [experience.id],
    evidence: [
      { sourceId: 'experience:' + experience.id, quote: experience.body },
    ],
    questions: [],
  };
  let calls = 0;
  const source = ts.transpileModule(
    readFileSync('src/lib/grounded-ai.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const deps: Record<string, unknown> = {
    'server-only': {},
    zod: zod,
    '@/lib/ai-contract': contract,
    '@/lib/gemini': {
      ...gemini,
      generateGeminiJSON: async (options: {
        schema: zod.z.ZodType;
        input: Array<{ text: string }>;
      }) => {
        calls++;
        assert.equal(options.schema.safeParse(result).success, true);
        assert.equal(
          options.schema.safeParse({
            ...result,
            sourceIds: ['experience:' + experience.id],
          }).success,
          false,
        );
        assert.equal(
          options.schema.safeParse({
            ...result,
            sourceIds: ['unselected-experience'],
          }).success,
          false,
        );
        assert.equal(
          options.schema.safeParse({
            ...result,
            evidence: [{ sourceId: experience.id, quote: experience.body }],
          }).success,
          false,
        );
        const payload = JSON.parse(options.input[0].text);
        assert.ok(
          payload.sources['experience:' + experience.id].includes(
            experience.body,
          ),
        );
        return result;
      },
    },
  };
  const loaded = {
    exports: {} as {
      generateGroundedAIResult: (
        input: AIRequest,
      ) => Promise<{ result: unknown }>;
    },
  };
  runInNewContext(`(function(require,module,exports){${source}\n})`)(
    (name: string) => {
      assert.ok(name in deps);
      return deps[name];
    },
    loaded,
    loaded.exports,
  );
  const actual = await loaded.exports.generateGroundedAIResult(input);
  assert.deepEqual(actual.result, result);
  assert.equal(calls, 1);
});
