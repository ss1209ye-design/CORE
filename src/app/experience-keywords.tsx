'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  keywordResultSchema,
  type AIExperience,
  type AIKeywordResult,
} from '@/lib/ai-contract';
import { requestAI, useAIAvailability } from './ai-client';
import PigScene from './pig-scene';

export default function ExperienceKeywords({
  initialKeywords,
  experienceId,
  demo,
  onChange,
}: {
  initialKeywords: string[];
  experienceId: string;
  demo: boolean;
  onChange: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const uploadVersion = useRef(0);
  const [tags, setTags] = useState(initialKeywords);
  const [evidence, setEvidence] = useState<AIKeywordResult['keywords']>([]);
  const [clarificationQuestions, setClarificationQuestions] = useState<
    string[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const availability = useAIAvailability();
  useEffect(
    () => () => {
      request.current?.abort();
      uploadVersion.current++;
    },
    [],
  );
  function getExperience(form: HTMLFormElement): AIExperience {
    const values = new FormData(form);
    const value = (name: string) => String(values.get(name) || '').trim();
    return {
      id: experienceId,
      title: value('title'),
      category: value('category'),
      period: value('period'),
      level: value('level'),
      body: value('body'),
      demo: demo || values.has('demo'),
      keywords: values
        .getAll('experienceKeyword')
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  async function generate() {
    const form = root.current?.closest('form');
    if (!form || busy) return;
    const source = getExperience(form);
    if (!source.title || !source.body) {
      setMessage('제목과 경험 내용을 먼저 입력해 주세요.');
      return;
    }
    const fingerprint = JSON.stringify(source);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const result = await requestAI(
        { action: 'keywords', experience: source },
        keywordResultSchema,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (JSON.stringify(getExperience(form)) !== fingerprint) {
        setMessage(
          '입력이 바뀌어 이전 결과를 반영하지 않았습니다. 현재 내용으로 다시 추출해 주세요.',
        );
        return;
      }
      setClarificationQuestions(result.questions);
      if (result.keywords.length === 0) {
        setMessage(
          result.questions.length
            ? '근거가 부족해 기존 키워드를 유지했습니다. 아래 확인 질문에 답한 뒤 다시 추출해 주세요.'
            : '키워드를 추출하지 못했습니다. 기존 키워드는 유지됩니다.',
        );
        return;
      }
      setTags(result.keywords.map((item) => item.label));
      setEvidence(result.keywords);
      onChange();
      setMessage(
        'AI가 추출한 키워드와 근거를 확인하고 경험 저장을 눌러 주세요.',
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : 'AI 키워드 추출에 실패했습니다. 입력은 유지됩니다.',
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++uploadVersion.current;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 128000) {
      setMessage('128KB 이하의 UTF-8 .txt 또는 .md 자료를 선택해 주세요.');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(await file.arrayBuffer())
        .replace(/^\uFEFF/, '');
      if (version !== uploadVersion.current) return;
      if (
        !text.trim() ||
        text.length > 12000 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text)
      )
        throw new Error('12,000자 이내의 일반 텍스트 자료가 필요합니다.');
      const form = root.current?.closest('form');
      if (!form) return;
      const body = form.elements.namedItem('body');
      if (!(body instanceof HTMLTextAreaElement)) return;
      if (
        body.value.trim() &&
        !window.confirm(
          '현재 경험 내용을 업로드한 자료로 바꿀까요? 저장 전까지 기존 저장 기록은 유지됩니다.',
        )
      )
        return;
      const detail = text.match(
        /(?:^|\n)(?:상세\s*내용|경험\s*내용)\s*[:：]?\s*\n([\s\S]*)$/u,
      )?.[1];
      body.value = (detail || text).trim();
      for (const [field, pattern] of [
        ['title', /(?:^|\n)제목\s*[:：]\s*([^\n]+)/u],
        ['period', /(?:^|\n)기간\s*[:：]\s*([^\n]+)/u],
        ['category', /(?:^|\n)(?:활동\s*유형|유형)\s*[:：]\s*([^\n]+)/u],
      ] as const) {
        const value = text.match(pattern)?.[1]?.trim();
        const input = form.elements.namedItem(field);
        if (value && input instanceof HTMLInputElement) input.value = value;
        if (
          value &&
          input instanceof HTMLSelectElement &&
          [...input.options].some((option) => option.value === value)
        )
          input.value = value;
      }
      setEvidence([]);
      onChange();
      setMessage(
        '자료는 이 브라우저에서만 읽었습니다. 실제 경험인지 확인하고 필요한 내용을 보완해 주세요.',
      );
    } catch (error) {
      if (version === uploadVersion.current)
        setMessage(
          error instanceof Error
            ? error.message
            : '자료를 읽지 못했습니다. UTF-8 텍스트 파일을 확인해 주세요.',
        );
    }
  }
  return (
    <div className="experience-keywords" ref={root}>
      <label className="form-field">
        <span>경험 자료 불러오기 · .txt / .md</span>
        <input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={upload}
          disabled={busy}
        />
      </label>
      {availability.state !== 'ready' && (
        <div className="notice">
          <p>
            {availability.state === 'checking'
              ? 'AI 설정 확인 중…'
              : availability.state === 'missing'
                ? '결제가 연결되지 않은 Free 프로젝트인지 확인한 뒤 서버 .env.local에 GEMINI_API_KEY와 GEMINI_FREE_TIER_CONFIRMED=true를 설정하고 서버를 재시작하세요.'
                : 'AI 설정을 확인하지 못했습니다. 로그인과 연결 상태를 확인해 주세요.'}
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
      <p className="fine-print">
        선택한 자료 파일은 서버에 업로드되지 않습니다. 내용을 불러온 뒤 AI
        키워드 추출을 누르면 경험 입력이 Google Gemini로 전송됩니다. Free 등급
        입력·출력은 Google 제품 개선에 사용될 수 있으니 개인정보·환자 정보 대신
        가상·비민감 정보만 사용하세요.
      </p>
      <div className="actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy || availability.state !== 'ready'}
          onClick={() => void generate()}
        >
          {busy ? 'AI 키워드 추출 중…' : 'AI 키워드 추출'}
        </button>
        {busy && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              request.current?.abort();
              request.current = null;
              setBusy(false);
              setMessage('추출을 취소했습니다. 입력은 유지됩니다.');
            }}
          >
            취소
          </button>
        )}
      </div>
      {busy && <PigScene mode="loading" className="capture-pig-loading" />}
      <div className="keyword-tags" aria-label="수정 가능한 경험 키워드">
        {tags.map((tag, index) => (
          <span className="keyword-tag" key={index}>
            <input
              aria-label={`키워드 ${index + 1}`}
              name="experienceKeyword"
              value={tag}
              maxLength={80}
              onChange={(event) => {
                setTags((current) =>
                  current.map((value, i) =>
                    i === index ? event.target.value : value,
                  ),
                );
                setEvidence([]);
                onChange();
              }}
            />
            <button
              type="button"
              aria-label={`키워드 ${index + 1} 삭제`}
              onClick={() => {
                setTags((current) => current.filter((_, i) => i !== index));
                setEvidence([]);
                onChange();
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        className="text-button"
        disabled={tags.length >= 20}
        onClick={() => {
          setTags((current) => [...current, '']);
          onChange();
        }}
      >
        키워드 직접 추가
      </button>
      {!!evidence.length && (
        <details>
          <summary>AI 키워드의 원문 근거</summary>
          <ul>
            {evidence.map((item) => (
              <li key={item.label}>
                <strong>
                  {item.label} · {item.category}
                </strong>
                <p>{item.evidence}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!clarificationQuestions.length && (
        <div className="fine-print">
          <p>키워드 추출을 위해 확인이 필요한 내용</p>
          <ul>
            {clarificationQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      {message && (
        <p role="status" className="fine-print">
          {message}
        </p>
      )}
    </div>
  );
}
