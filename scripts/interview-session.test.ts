import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachInterviewFeedback,
  interviewSessionSchema,
  interviewSessionTitleSchema,
} from '../src/app/interview-session';
function session() {
  return interviewSessionSchema.parse({
    id: 'synthetic-session',
    createdAt: '2026-01-01',
    title: '가상 연습',
    provider: 'openai',
    model: 'synthetic-test-only',
    essaySnapshot: '가상 경험에서 안전 수칙을 관찰한 내용을 정리했습니다.',
    jobSnapshot: null,
    experienceSnapshots: [],
    questions: Array.from({ length: 5 }, (_, i) => ({
      id: 'q' + i,
      question: '가상 질문 ' + i,
      intent: '기록 확인',
      evidence: [{ sourceId: 'essay', quote: '안전 수칙을 관찰한 내용' }],
      answer: '가상 답변에서 질문을 기록했습니다.',
      feedback: null,
      feedbackForAnswer: null,
      followUpAnswer: '',
      history: [],
    })),
    reflection: '',
    completedAt: null,
  });
}
const feedback = {
  followUp: '어떤 질문을 기록했나요?',
  improvements: ['실제 관찰한 내용을 구체화하세요.'],
  evidence: ['질문을 기록했습니다.'],
};
test('면접 질문은 정확히 다섯 개이며 원문과 답변을 다시 읽을 수 있다', () => {
  const source = session();
  const roundTrip = interviewSessionSchema.parse(
    JSON.parse(JSON.stringify(source)),
  );
  assert.equal(roundTrip.essaySnapshot, source.essaySnapshot);
  assert.equal(roundTrip.hospitalName, '');
  assert.equal(roundTrip.questions[0].answer, source.questions[0].answer);
  assert.equal(
    interviewSessionSchema.safeParse({
      ...source,
      questions: source.questions.slice(1),
    }).success,
    false,
  );
});
test('병원이 없는 과거 기록은 빈 병원명으로 다시 읽고 기존 제목을 보존한다', () => {
  const oldRecord = JSON.parse(JSON.stringify(session()));
  delete oldRecord.hospitalName;
  const reopened = interviewSessionSchema.parse(oldRecord);
  assert.equal(reopened.hospitalName, '');
  assert.equal(reopened.title, '가상 연습');
  assert.equal(reopened.provider, 'openai');
});
test('제목과 병원명을 수정해 저장한 기록을 다시 읽는다', () => {
  const source = session();
  const edited = {
    ...source,
    title: interviewSessionTitleSchema.parse('  새 연습 제목  '),
    hospitalName: '서울 가상 병원',
  };
  const reopened = interviewSessionSchema.parse(
    JSON.parse(JSON.stringify(edited)),
  );
  assert.equal(reopened.title, '새 연습 제목');
  assert.equal(reopened.hospitalName, '서울 가상 병원');
  assert.equal(interviewSessionTitleSchema.safeParse('   ').success, false);
  assert.equal(
    interviewSessionTitleSchema.safeParse('가'.repeat(301)).success,
    false,
  );
  assert.equal(
    interviewSessionSchema.safeParse({
      ...source,
      hospitalName: '가'.repeat(301),
    }).success,
    false,
  );
});
test('바뀐 답변에 과거 요청의 피드백을 덮어쓰지 않는다', () => {
  const source = session();
  assert.throws(
    () => attachInterviewFeedback(source, 'q0', '이전 답변', feedback),
    /변경/,
  );
  assert.equal(source.questions[0].feedback, null);
});
test('피드백을 다시 받을 때 이전 질문과 꼬리 답변을 보존한다', () => {
  const first = attachInterviewFeedback(
    session(),
    'q0',
    session().questions[0].answer,
    feedback,
  );
  first.questions[0].followUpAnswer = '기존 꼬리 답변';
  first.questions[0].answer = '새로운 가상 답변을 작성했습니다.';
  const next = attachInterviewFeedback(first, 'q0', first.questions[0].answer, {
    ...feedback,
    followUp: '새로운 꼬리 질문',
  });
  assert.equal(next.questions[0].history[0].followUpAnswer, '기존 꼬리 답변');
  assert.equal(
    next.questions[0].history[0].feedback.followUp,
    feedback.followUp,
  );
  assert.equal(next.questions[0].feedbackForAnswer, first.questions[0].answer);
  assert.equal(next.questions[0].followUpAnswer, '');
  assert.equal(first.questions[0].history.length, 0);
});

test('과거 OpenAI와 새 Gemini 면접 기록의 출처·답변·피드백을 바꾸지 않는다', () => {
  const original = attachInterviewFeedback(
    session(),
    'q0',
    session().questions[0].answer,
    feedback,
  );
  for (const provider of ['openai', 'gemini']) {
    const saved = { ...original, provider };
    const reopened = interviewSessionSchema.parse(
      JSON.parse(JSON.stringify(saved)),
    );
    assert.deepEqual(reopened, saved);
  }
});
