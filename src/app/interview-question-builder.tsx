'use client';
import { useEffect, useRef, useState } from 'react';
import {
  feedbackResultSchema,
  interviewResultSchema,
  type AIExperience,
  type AIJob,
} from '@/lib/ai-contract';
import { requestAIResponse, useAIAvailability } from './ai-client';
import {
  attachInterviewFeedback,
  interviewSessionSchema,
  interviewSessionTitleSchema,
  type InterviewSession,
  type PracticeQuestion,
} from './interview-session';
import PigScene from './pig-scene';

type Essay = {
  demo: boolean;
  id: string;
  jobId: string;
  question: string;
  draft: string;
  revised: string;
  experienceIds: string[];
  submissions: { id: string; content: string; savedAt: string }[];
};
type LegacyQuestion = {
  id: string;
  question: string;
  answer: string;
  improvement: string;
  reflection: string;
  source: string;
};
function matchesHospitalFilter(hospitalName: string, filter: string) {
  if (filter === 'all') return true;
  if (filter === 'unspecified') return !hospitalName.trim();
  return (
    filter.startsWith('hospital:') &&
    hospitalName === filter.slice('hospital:'.length)
  );
}
export default function InterviewQuestionBuilder({
  essays,
  jobs,
  experiences,
  sessions,
  onSave,
  onDirtyChange,
  legacyQuestions,
}: {
  essays: Essay[];
  jobs: AIJob[];
  experiences: AIExperience[];
  sessions: InterviewSession[];
  onSave: (session: InterviewSession) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  legacyQuestions: LegacyQuestion[];
}) {
  const availability = useAIAvailability();
  const request = useRef<AbortController | null>(null);
  const [activeId, setActiveId] = useState(sessions[0]?.id || '');
  const [local, setLocal] = useState<InterviewSession | null>(null);
  const [dirty, setDirty] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [essayId, setEssayId] = useState('');
  const [variant, setVariant] = useState('draft');
  const [pasted, setPasted] = useState('');
  const [pastedDemo, setPastedDemo] = useState(false);
  const [jobId, setJobId] = useState('');
  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newHospitalName, setNewHospitalName] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');
  const selectedExperiences = experiences.filter((item) =>
    experienceIds.includes(item.id),
  );
  const active = local || sessions.find((item) => item.id === activeId);
  const hospitalNames = [
    ...new Set(
      sessions
        .map((item) => item.hospitalName ?? '')
        .filter((name) => name.trim()),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ko'));
  const visibleSessions = sessions.filter((item) =>
    matchesHospitalFilter(item.hospitalName ?? '', hospitalFilter),
  );
  const question = active?.questions[index];
  const essay = essays.find((item) => item.id === essayId);
  const essayText = essay
    ? variant === 'draft'
      ? essay.draft
      : variant === 'revised'
        ? essay.revised
        : essay.submissions.find((item) => `submission:${item.id}` === variant)
            ?.content || ''
    : pasted;
  useEffect(() => () => request.current?.abort(), []);
  function markDirty(value: boolean) {
    setDirty(value);
    onDirtyChange(value);
  }
  async function save(next = active) {
    if (!next) return false;
    const title = interviewSessionTitleSchema.safeParse(next.title);
    if (!title.success) {
      setMessage(
        title.error.issues[0]?.message || '연습 제목을 확인해 주세요.',
      );
      return false;
    }
    const normalized = {
      ...next,
      title: title.data,
      hospitalName: (next.hospitalName ?? '').trim(),
    };
    if (!(await onSave(normalized))) {
      setLocal(normalized);
      markDirty(true);
      setMessage(
        '브라우저에 저장하지 못했습니다. 입력은 화면에 유지됩니다. 저장소 경고를 확인하고 다시 저장해 주세요.',
      );
      return false;
    }
    setLocal(null);
    markDirty(false);
    setMessage('연습 기록을 저장했습니다.');
    return true;
  }
  function chooseSession(value: string) {
    if (
      busy ||
      (dirty && !window.confirm('저장하지 않은 입력을 버리고 이동할까요?'))
    )
      return;
    setActiveId(value);
    setLocal(null);
    setIndex(0);
    setNewTitle('');
    setNewHospitalName('');
    markDirty(false);
    setMessage('');
  }
  function editQuestion(
    patch: Partial<Pick<PracticeQuestion, 'answer' | 'followUpAnswer'>>,
  ) {
    if (!active || !question || busy) return;
    setLocal({
      ...active,
      questions: active.questions.map((item) =>
        item.id === question.id ? { ...item, ...patch } : item,
      ),
    });
    markDirty(true);
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setMessage('요청을 취소했습니다. 작성한 내용은 유지됩니다.');
  }
  async function generate() {
    if (busy) return;
    const title = interviewSessionTitleSchema.safeParse(newTitle);
    if (!title.success) {
      setMessage(
        title.error.issues[0]?.message || '연습 제목을 입력해 주세요.',
      );
      return;
    }
    const selected = selectedExperiences;
    if (essayText.trim().length < 20 && selected.length === 0) {
      setMessage(
        experiences.length
          ? '자기소개서를 20자 이상 선택하거나 저장된 경험을 하나 이상 선택해 주세요.'
          : '자기소개서를 20자 이상 선택하거나 붙여넣어 주세요.',
      );
      return;
    }
    const selectedJob = jobs.find((item) => item.id === jobId) || null;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const response = await requestAIResponse(
        {
          action: 'interview',
          essay: essayText.trim(),
          job: selectedJob,
          experiences: selected,
        },
        interviewResultSchema,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const session = interviewSessionSchema.parse({
        id: crypto.randomUUID(),
        demo: Boolean(
          (essay ? essay.demo : pastedDemo) ||
          selected.some((item) => item.demo),
        ),
        createdAt: new Date().toISOString(),
        title: title.data,
        hospitalName: newHospitalName.trim(),
        provider: response.provider,
        model: response.model,
        essaySnapshot: essayText.trim(),
        jobSnapshot: selectedJob,
        experienceSnapshots: selected,
        questions: response.result.questions.map((item) => ({
          ...item,
          id: crypto.randomUUID(),
          answer: '',
          feedback: null,
          feedbackForAnswer: null,
          followUpAnswer: '',
          history: [],
        })),
        reflection: '',
        completedAt: null,
      });
      setActiveId(session.id);
      setIndex(0);
      setHospitalFilter('all');
      setNewTitle('');
      setNewHospitalName('');
      setLocal(session);
      await save(session);
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : '질문 생성에 실패했습니다. 입력은 유지됩니다.',
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function feedback() {
    if (!active || !question || busy) return;
    if (question.answer.trim().length < 10) {
      setMessage('피드백을 받을 답변을 10자 이상 입력해 주세요.');
      return;
    }
    if (question.history.length >= 20) {
      setMessage('피드백 보관 한도에 도달했습니다. 새 연습을 시작해 주세요.');
      return;
    }
    if (!(await save(active))) return;
    const source = active;
    const answer = question.answer;
    const questionId = question.id;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const response = await requestAIResponse(
        {
          action: 'feedback',
          question: {
            question: question.question,
            intent: question.intent,
            evidence: question.evidence,
          },
          answer,
        },
        feedbackResultSchema,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const next = attachInterviewFeedback(
        source,
        questionId,
        answer,
        response.result,
      );
      setLocal(next);
      await save(next);
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : '피드백 생성에 실패했습니다. 저장한 답변은 유지됩니다. 다시 시도해 주세요.',
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function chooseHospitalFilter(value: string) {
    if (busy) return;
    if (active && !matchesHospitalFilter(active.hospitalName ?? '', value)) {
      if (dirty && !window.confirm('저장하지 않은 입력을 버리고 이동할까요?'))
        return;
      setActiveId('');
      setLocal(null);
      setIndex(0);
      setNewTitle('');
      setNewHospitalName('');
      markDirty(false);
      setMessage('');
    }
    setHospitalFilter(value);
  }
  function sourceLabel(sourceId: string) {
    if (sourceId === 'essay') return '자기소개서';
    if (sourceId === 'job') return '지원 공고';
    return (
      active?.experienceSnapshots.find(
        (item) => `experience:${item.id}` === sourceId,
      )?.title || '연결 경험'
    );
  }
  return (
    <section
      className="panel interview-practice"
      aria-labelledby="interview-practice-title"
    >
      <h2 id="interview-practice-title">면접 연습</h2>
      {availability.state !== 'ready' && (
        <div className="notice">
          <p>
            {availability.state === 'checking'
              ? 'AI 연결 설정 확인 중…'
              : availability.state === 'missing'
                ? '서버 BAZE_API_KEY에 학교 BAZE 키를 설정하고 서버를 재시작하세요. 키는 채팅이나 브라우저에 입력하지 마세요. 고정 질문을 AI 결과로 대신 표시하지 않습니다.'
                : 'AI 연결 설정을 확인하지 못했습니다. 로그인과 연결 상태를 확인해 주세요.'}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => void availability.check()}
          >
            설정 다시 확인
          </button>
        </div>
      )}
      <div className="actions">
        <label className="form-field">
          병원 필터
          <select
            value={hospitalFilter}
            disabled={busy}
            onChange={(event) => chooseHospitalFilter(event.target.value)}
          >
            <option value="all">전체</option>
            <option value="unspecified">병원 미지정</option>
            {hospitalNames.map((name) => (
              <option key={name} value={`hospital:${name}`}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          연습 기록
          <select
            value={activeId}
            disabled={busy}
            onChange={(event) => chooseSession(event.target.value)}
          >
            <option value="">새 연습 만들기</option>
            {visibleSessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.completedAt ? '완료' : '진행 중'}
              </option>
            ))}
            {local &&
              !sessions.some((item) => item.id === local.id) &&
              matchesHospitalFilter(
                local.hospitalName ?? '',
                hospitalFilter,
              ) && <option value={local.id}>아직 저장되지 않은 연습</option>}
          </select>
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => chooseSession('')}
        >
          새 연습
        </button>
      </div>
      {!active ? (
        <div className="interview-source-form">
          <label className="form-field">
            연습 제목
            <input
              type="text"
              maxLength={300}
              value={newTitle}
              disabled={busy}
              onChange={(event) => {
                setNewTitle(event.target.value);
                markDirty(true);
              }}
              placeholder="○○병원 신입 물리치료사 면접 연습"
            />
          </label>
          <label className="form-field">
            병원명 · 선택 사항
            <input
              type="text"
              maxLength={300}
              value={newHospitalName}
              disabled={busy}
              onChange={(event) => {
                setNewHospitalName(event.target.value);
                markDirty(true);
              }}
              placeholder="병원명을 직접 입력해 주세요"
            />
          </label>
          <label className="form-field">
            자기소개서 선택
            <select
              value={essayId}
              disabled={busy}
              onChange={(event) => {
                const item = essays.find(
                  (value) => value.id === event.target.value,
                );
                setEssayId(event.target.value);
                setVariant(
                  item?.revised.trim()
                    ? 'revised'
                    : item?.draft.trim()
                      ? 'draft'
                      : item?.submissions[0]
                        ? `submission:${item.submissions[0].id}`
                        : 'draft',
                );
                setJobId(
                  jobs.some((job) => job.id === item?.jobId) ? item!.jobId : '',
                );
                setExperienceIds(
                  item?.experienceIds
                    .filter((id) =>
                      experiences.some((experience) => experience.id === id),
                    )
                    .slice(0, 10) || [],
                );
                markDirty(true);
              }}
            >
              <option value="">직접 붙여넣기</option>
              {essays.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.question || '제목 없는 자소서'}
                </option>
              ))}
            </select>
          </label>
          {essay ? (
            <>
              <label className="form-field">
                사용할 작성본
                <select
                  value={variant}
                  disabled={busy}
                  onChange={(event) => {
                    setVariant(event.target.value);
                    markDirty(true);
                  }}
                >
                  <option value="draft">초안</option>
                  <option value="revised">수정본</option>
                  {essay.submissions.map((item, i) => (
                    <option value={`submission:${item.id}`} key={item.id}>
                      제출본 {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <details>
                <summary>선택한 자기소개서 확인</summary>
                <p className="preserve">
                  {essayText || '선택한 작성본에 내용이 없습니다.'}
                </p>
              </details>
            </>
          ) : (
            <label className="form-field">
              자기소개서 붙여넣기
              <textarea
                value={pasted}
                maxLength={12000}
                rows={7}
                disabled={busy}
                onChange={(event) => {
                  setPasted(event.target.value);
                  markDirty(true);
                }}
                placeholder="공고나 저장한 자소서가 없어도 여기에서 시작할 수 있어요."
              />
            </label>
          )}
          {!essay && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={pastedDemo}
                disabled={busy}
                onChange={(event) => {
                  setPastedDemo(event.target.checked);
                  markDirty(true);
                }}
              />
              붙여넣은 자소서는 시연용 가상 자료입니다.
            </label>
          )}
          <label className="form-field">
            지원 공고 · 선택 사항
            <select
              value={jobId}
              disabled={busy}
              onChange={(event) => {
                setJobId(event.target.value);
                markDirty(true);
              }}
            >
              <option value="">공고 없이 연습</option>
              {jobs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.organization} · {item.title}
                </option>
              ))}
            </select>
          </label>
          {essayText.trim().length < 20 && selectedExperiences.length === 0 && (
            <p className="notice">
              자기소개서 20자 이상 또는 저장된 경험이 필요합니다.{' '}
              {experiences.length ? (
                <a href="#interview-experience-sources">저장된 경험 선택</a>
              ) : (
                '선택할 저장 경험이 없습니다.'
              )}
            </p>
          )}
          {!!experiences.length && (
            <fieldset id="interview-experience-sources">
              <legend>포트폴리오 경험 선택 · 최대 10개</legend>
              {experiences.map((item) => (
                <label key={item.id} className="check-line">
                  <input
                    type="checkbox"
                    checked={experienceIds.includes(item.id)}
                    disabled={
                      busy ||
                      (!experienceIds.includes(item.id) &&
                        experienceIds.length >= 10)
                    }
                    onChange={(event) => {
                      setExperienceIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      );
                      markDirty(true);
                    }}
                  />
                  {item.title}
                  {item.demo ? ' · 시연용 가상 데이터' : ''}
                </label>
              ))}
            </fieldset>
          )}
          <p className="fine-print">
            질문 생성 시 선택한 자기소개서·경험·공고가 Google Gemini로
            전송됩니다. 민감한 정보는 입력하지 마세요.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy || availability.state !== 'ready'}
            onClick={() => void generate()}
          >
            {busy ? 'AI 질문 생성 중…' : '예상 질문 5개 생성'}
          </button>
        </div>
      ) : (
        <>
          <label className="form-field">
            연습 제목
            <input
              type="text"
              maxLength={300}
              value={active.title}
              disabled={busy}
              onChange={(event) => {
                setLocal({ ...active, title: event.target.value });
                markDirty(true);
              }}
            />
          </label>
          <label className="form-field">
            병원명 · 선택 사항
            <input
              type="text"
              maxLength={300}
              value={active.hospitalName ?? ''}
              disabled={busy}
              onChange={(event) => {
                const hospitalName = event.target.value;
                setLocal({ ...active, hospitalName });
                if (!matchesHospitalFilter(hospitalName, hospitalFilter))
                  setHospitalFilter('all');
                markDirty(true);
              }}
            />
          </label>
          <p className="fine-print">
            {active.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}
            {' · '}
            {active.model} · 생성 당시 원문을 보관합니다.
          </p>
          {(active.demo ||
            active.experienceSnapshots.some((item) => item.demo)) && (
            <p className="notice">
              시연용 가상 경험이 포함된 연습입니다. 실제 본인의 경험으로
              사용하지 마세요.
            </p>
          )}
          <details>
            <summary>생성에 사용한 원문과 경험</summary>
            <h3>자기소개서</h3>
            <p className="preserve">{active.essaySnapshot}</p>
            {active.jobSnapshot && (
              <p>
                {active.jobSnapshot.organization} · {active.jobSnapshot.title}
              </p>
            )}
            {active.experienceSnapshots.map((item) => (
              <div key={item.id}>
                <h4>
                  {item.title}
                  {item.demo ? ' · 시연용 가상 데이터' : ''}
                </h4>
                <p className="preserve">{item.body}</p>
              </div>
            ))}
          </details>
          <nav className="question-tabs" aria-label="면접 질문 선택">
            {active.questions.map((item, i) => (
              <button
                type="button"
                key={item.id}
                className={`button ${index === i ? '' : 'secondary'}`}
                disabled={busy}
                aria-current={index === i ? 'step' : undefined}
                onClick={() => setIndex(i)}
              >
                질문 {i + 1}
                {item.answer.trim() ? ' · 답변 있음' : ''}
              </button>
            ))}
          </nav>
          {question && (
            <article className="practice-question">
              <h3>
                {index + 1}. {question.question}
              </h3>
              <p>
                <strong>질문 의도:</strong> {question.intent}
              </p>
              <ul>
                {question.evidence.map((item, i) => (
                  <li key={i}>
                    <strong>{sourceLabel(item.sourceId)}</strong>
                    <blockquote>{item.quote}</blockquote>
                  </li>
                ))}
              </ul>
              <label className="form-field">
                내 답변
                <textarea
                  value={question.answer}
                  maxLength={12000}
                  rows={6}
                  disabled={busy}
                  onChange={(event) =>
                    editQuestion({ answer: event.target.value })
                  }
                />
              </label>
              <p className="fine-print">
                답변 피드백 요청 시 현재 질문과 답변이 Google Gemini로
                전송됩니다. 민감한 정보는 입력하지 마세요.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => await save()}
                >
                  답변 저장
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || availability.state !== 'ready'}
                  onClick={() => void feedback()}
                >
                  AI 꼬리 질문·보완점 받기
                </button>
              </div>
              {question.feedback && (
                <div className="feedback-panel">
                  {question.feedbackForAnswer !== question.answer && (
                    <p className="notice">
                      현재 답변이 변경됐습니다. 아래 내용은 이전 답변에 대한
                      피드백입니다.
                    </p>
                  )}
                  <h4>꼬리 질문</h4>
                  <p>{question.feedback.followUp}</p>
                  <h4>보완할 점</h4>
                  <ul>
                    {question.feedback.improvements.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                  <details>
                    <summary>피드백의 답변 근거</summary>
                    <p className="preserve">{question.feedbackForAnswer}</p>
                    {question.feedback.evidence.map((item, i) => (
                      <blockquote key={i}>{item}</blockquote>
                    ))}
                  </details>
                  <label className="form-field">
                    꼬리 질문에 대한 내 답변
                    <textarea
                      value={question.followUpAnswer}
                      maxLength={12000}
                      rows={4}
                      disabled={busy}
                      onChange={(event) =>
                        editQuestion({ followUpAnswer: event.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              {!!question.history.length && (
                <details>
                  <summary>
                    이전 피드백과 답변 {question.history.length}회
                  </summary>
                  {question.history.map((item, i) => (
                    <article key={i}>
                      <p className="preserve">{item.answer}</p>
                      <p>{item.feedback.followUp}</p>
                      <p className="preserve">
                        {item.followUpAnswer || '미답변'}
                      </p>
                      <ul>
                        {item.feedback.improvements.map((point, j) => (
                          <li key={j}>{point}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </details>
              )}
            </article>
          )}
          <label className="form-field">
            사용자 복기
            <textarea
              value={active.reflection}
              maxLength={12000}
              rows={4}
              disabled={busy}
              onChange={(event) => {
                setLocal({ ...active, reflection: event.target.value });
                markDirty(true);
              }}
              placeholder="막혔던 질문, 다음에 더 구체적으로 설명할 내용 등을 기록하세요."
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => await save()}
            >
              전체 기록 저장
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={async () =>
                await save({ ...active, completedAt: new Date().toISOString() })
              }
            >
              연습 종료·저장
            </button>
          </div>
          {active.completedAt && (
            <section className="interview-review">
              <h3>연습 모아보기</h3>
              {active.questions.map((item, i) => (
                <article key={item.id}>
                  <h4>
                    {i + 1}. {item.question}
                  </h4>
                  <p className="preserve">{item.answer || '미답변'}</p>
                  {item.feedback && (
                    <>
                      <p>꼬리 질문: {item.feedback.followUp}</p>
                      <p className="preserve">
                        {item.followUpAnswer || '미답변'}
                      </p>
                      <ul>
                        {item.feedback.improvements.map((point, j) => (
                          <li key={j}>{point}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </article>
              ))}
              <h4>내 복기</h4>
              <p className="preserve">
                {active.reflection || '아직 작성하지 않았습니다.'}
              </p>
            </section>
          )}
        </>
      )}
      {busy && (
        <>
          <PigScene mode="loading" className="capture-pig-loading" />
          <p role="status">
            AI가 생성하고 있습니다. 작성한 내용은 지우지 않습니다.
          </p>
          <button type="button" className="text-button" onClick={cancel}>
            생성 취소
          </button>
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!!legacyQuestions.length && (
        <details>
          <summary>기존 면접 기록 {legacyQuestions.length}개</summary>
          {legacyQuestions.map((item) => (
            <article key={item.id}>
              <h3>{item.question}</h3>
              <p className="fine-print preserve">{item.source}</p>
              <p className="preserve">{item.answer || '미답변'}</p>
              <p className="preserve">{item.improvement}</p>
              <p className="preserve">{item.reflection}</p>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
