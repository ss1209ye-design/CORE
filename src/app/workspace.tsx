'use client';

import BrandLogo from './brand-logo';
import PigScene from './pig-scene';
import { signOutAction, completeGuideAction } from './auth/actions';
import PiggyGuide from './piggy-guide';
import { keepDialogFocus } from './dialog-focus';
import type { GuideTarget } from './piggy-guide-content';
import InterviewQuestionBuilder from './interview-question-builder';
import { getRecruitmentDateErrors } from './recruitment-date';
import ExperienceKeywords from './experience-keywords';
import { demoExperiences } from './demo-experiences';
import { requestAIResponse, useAIAvailability } from './ai-client';
import { draftResultSchema, type AIJob } from '@/lib/ai-contract';
import {
  experienceSchema,
  essaySchema,
  statuses,
  experienceTypes,
  performanceLevels,
  jobSchema,
  type Workspace,
  type Job,
  type Experience,
  type Essay,
  type DraftProvenance,
} from './workspace-schema';
import { createWorkspaceStore } from './workspace-store';
import RecruitmentCalendar from './recruitment-calendar';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { z } from 'zod';

type Section =
  'dashboard' | 'profile' | 'experiences' | 'prepare' | 'essays' | 'interview';
type Editor = { kind: 'job' | 'experience' | 'task' | 'link'; id?: string };
const navigation: { id: Section; label: string; icon: string }[] = [
  { id: 'experiences', label: '포트폴리오', icon: 'book' },
  { id: 'essays', label: '자기소개서', icon: 'edit' },
  { id: 'interview', label: '면접 연습', icon: 'chat' },
];

const id = () => crypto.randomUUID();

function daysUntil(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const now = new Date();
  return Math.round(
    (Date.UTC(year, month - 1, day) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000,
  );
}
function isLinkOnlyJob(job: Job) {
  return (
    Boolean(job.source) &&
    ![
      job.organization,
      job.role,
      job.field,
      job.rawText,
      job.duties,
      job.workConditions,
      job.applicationPeriod,
      job.applicationStart,
      job.deadline,
      job.documents,
    ].some((value) => value.trim()) &&
    job.conditions.length === 0
  );
}
function dueLabel(job: Job) {
  const days = job.dateConfirmed ? daysUntil(job.deadline) : null;
  return days === null
    ? '마감 미확인'
    : days < 0
      ? '마감 지남'
      : days === 0
        ? '오늘 마감'
        : `D-${days}`;
}
function sourceURL(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3" />
      </>
    ),
    book: (
      <>
        <path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" />
      </>
    ),
    check: (
      <>
        <rect x="4" y="4" width="16" height="17" rx="2" />
        <path d="M8 3h8v4H8zM8 13l3 3 5-6" />
      </>
    ),
    edit: (
      <>
        <path d="m5 16 11-11 3 3L8 19H5zM13 8l3 3M4 22h16" />
      </>
    ),
    chat: <path d="M20 4H4v13h5l3 4 3-4h5zM8 9h8M8 13h5" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  small = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`button${secondary ? ' secondary' : ''}${small ? ' small' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`form-field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name="book" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">{description}</p>
      </div>
      {children}
    </div>
  );
}

function JobCard({
  job,
  experiences,
  openJob,
}: {
  job: Job;
  experiences: Experience[];
  openJob: (job: Job) => void;
}) {
  return (
    <article className="job-card">
      <div className="card-top">
        <div className="hospital">
          <span className="hospital-icon">
            <Icon name="briefcase" />
          </span>
          <div>
            <p className="organization">
              {job.organization || '기관 미확인'}
              {job.demo && ' · 가상 예시'}
            </p>
            <h3>{job.title}</h3>
            {isLinkOnlyJob(job) && (
              <span className="badge gray">정보 미확인</span>
            )}
          </div>
        </div>
        <span
          className={`badge ${job.dateConfirmed && (daysUntil(job.deadline) ?? 99) <= 7 ? 'warm' : 'gray'}`}
        >
          {dueLabel(job)}
        </span>
      </div>
      <div className="tags">
        {job.field && <span>{job.field}</span>}
        <span>{job.status}</span>
      </div>
      <div className="card-bottom">
        <span>
          준비 {job.tasks.filter((task) => task.done).length}/{job.tasks.length}{' '}
          · 경험 연결{' '}
          {
            job.conditions.filter((condition) =>
              experiences.some(
                (experience) => experience.id === condition.experienceId,
              ),
            ).length
          }
          건
        </span>
        <button className="text-button" onClick={() => openJob(job)}>
          지원 준비 <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

function ExperienceCard({
  experience,
  jobs,
  openEditor,
}: {
  experience: Experience;
  jobs: Job[];
  openEditor: (editor: Editor) => void;
}) {
  const count = jobs.filter((job) =>
    job.conditions.some(
      (condition) => condition.experienceId === experience.id,
    ),
  ).length;
  return (
    <article className="experience-card">
      <span className="badge">{experience.category}</span>
      {experience.demo && <span className="badge gray">가상 예시</span>}
      <h3>{experience.title}</h3>
      <div className="keyword-tags">
        {experience.keywords.map((keyword) => (
          <span className="badge gray" key={keyword}>
            {keyword}
          </span>
        ))}
      </div>
      <p>
        {experience.period || '기간 미입력'} · {experience.level}
      </p>
      <div className="card-bottom">
        <span>
          {count ? `${count}개 공고에 연결` : '나의 다음 지원을 위한 기록'}
        </span>
        <button
          className="text-button"
          onClick={() => openEditor({ kind: 'experience', id: experience.id })}
        >
          기록 보기 →
        </button>
      </div>
    </article>
  );
}

function TaskRow({
  job,
  task,
  toggleTask,
}: {
  job: Job;
  task: Job['tasks'][number];
  toggleTask: (job: Job, taskId: string) => void;
}) {
  return (
    <label className={`task${task.done ? ' done' : ''}`}>
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => toggleTask(job, task.id)}
      />
      <span>
        <span>{task.title}</span>
        <small>
          {job.organization || '기관 미확인'} · {task.due || '기한 미정'}
        </small>
        <small>이유: {task.reason}</small>
      </span>
    </label>
  );
}

function JobPicker({
  current,
  jobs,
  onSelect,
  allowNoPosting = false,
}: {
  current?: Job;
  jobs: Job[];
  onSelect: (id: string) => void;
  allowNoPosting?: boolean;
}) {
  return (
    <label className="job-picker">
      {allowNoPosting ? '작성 기준 공고' : '준비할 공고'}
      <select
        value={current?.id || ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        {allowNoPosting && <option value="">공고 없이 작성</option>}
        {jobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.organization || '기관 미확인'} · {job.title}
            {job.demo ? ' (가상 예시)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function WorkspaceScreen({
  userId,
  guideCompleted,
  initialAction,
}: {
  userId: string;
  guideCompleted: boolean;
  initialAction: GuideTarget | null;
}) {
  const [guideOpen, setGuideOpen] = useState(!guideCompleted);
  const [initialGuide, setInitialGuide] = useState(!guideCompleted);
  const store = useMemo(() => createWorkspaceStore(userId), [userId]);
  const data = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.serverSnapshot,
  );
  const [section, setSection] = useState<Section>('dashboard');
  const [selectedJob, setSelectedJob] = useState('');
  const [essayNoPosting, setEssayNoPosting] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(
    guideCompleted && initialAction ? { kind: initialAction } : null,
  );
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [dateErrors, setDateErrors] = useState<{
    applicationStart?: string;
    deadline?: string;
  }>({});

  const [essayId, setEssayId] = useState('');
  const [dirty, setDirty] = useState(false);
  const essayForm = useRef<HTMLFormElement>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const draftRequest = useRef<AbortController | null>(null);
  const [draftAI, setDraftAI] = useState<{
    essayId: string;
    jobId: string;
    provenance: DraftProvenance;
  } | null>(null);
  const aiAvailability = useAIAvailability('/api/ai', section === 'essays');
  useEffect(() => () => draftRequest.current?.abort(), []);
  const dialog = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);

  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (editor && data && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (editor && data && initialAction && guideCompleted) {
      const url = new URL(window.location.href);
      if (url.searchParams.get('start') === initialAction) {
        url.searchParams.delete('start');
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
  }, [editor, data, initialAction, guideCompleted]);
  useEffect(() => {
    if (!dirty && !editorDirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, editorDirty]);

  if (!data)
    return (
      <main className="app-loading">
        <PigScene mode="loading" />
        <p role="status">내 기록을 불러오고 있습니다.</p>
      </main>
    );
  const current =
    data.jobs.find((job) => job.id === selectedJob) || data.jobs[0];
  const activeJobs = data.jobs.filter((job) => job.status !== '종료');
  const unconfirmed = activeJobs.reduce(
    (sum, job) =>
      sum + job.conditions.filter((condition) => !condition.verified).length,
    0,
  );
  const essayJob = essayNoPosting ? undefined : current;
  const essayPostingId = essayJob?.id || '';
  const chosenEssay =
    data.essays.find(
      (essay) => essay.id === essayId && essay.jobId === essayPostingId,
    ) || data.essays.find((essay) => essay.jobId === essayPostingId);
  const currentDraftAI =
    draftAI?.essayId === (chosenEssay?.id || '') &&
    draftAI.jobId === essayPostingId
      ? draftAI.provenance
      : chosenEssay?.ai || null;
  function aiJob(job: Job): AIJob {
    return {
      id: job.id,
      title: job.title,
      organization: job.organization,
      duties: [job.role ? `모집 직무: ${job.role}` : '', job.duties]
        .filter(Boolean)
        .join('\n'),
      qualifications: job.conditions.map((item) => item.text).join('\n'),
      documents: job.documents,
    };
  }
  async function update(next: Workspace) {
    const result = await store.persist(next);
    setMessage(result.message);
    return result.saved;
  }
  function allowLeave() {
    return (
      !dirty ||
      window.confirm('저장하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?')
    );
  }
  function cancelDraftRequest() {
    draftRequest.current?.abort();
    draftRequest.current = null;
    setDraftBusy(false);
  }
  function navigate(next: Section) {
    if (!allowLeave()) return;
    setDirty(false);
    setFormError('');
    cancelDraftRequest();
    setSection(next);
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
    window.scrollTo({ top: 0 });
  }
  function changeRecruitmentDate(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const confirmation = input.form?.elements.namedItem(
      input.name === 'applicationStart'
        ? 'startDateConfirmed'
        : 'dateConfirmed',
    );
    if (confirmation instanceof HTMLInputElement) confirmation.checked = false;
    setDateErrors({});
  }
  function openEditor(next: Editor) {
    setEditorDirty(false);
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setFormError('');
    setDateErrors({});
    setEditor(next);
  }
  async function finishGuide(
    target?: GuideTarget,
    reason: 'close' | 'skip' = 'close',
  ) {
    if ((target || reason === 'skip') && !allowLeave()) return;
    if (!guideCompleted) await completeGuideAction();
    setInitialGuide(false);
    setGuideOpen(false);
    if (!target && reason === 'close') return;
    setDirty(false);
    setSection(target === 'experience' ? 'experiences' : 'dashboard');
    if (target) requestAnimationFrame(() => openEditor({ kind: target }));
  }
  function closeEditor(saved = false) {
    if (
      !saved &&
      editorDirty &&
      !window.confirm('저장하지 않은 입력을 버리고 닫을까요?')
    )
      return;
    setEditorDirty(false);
    dialog.current?.close();
    setEditor(null);
    setFormError('');
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus();
      else main.current?.focus({ preventScroll: true });
    });
  }
  async function updateJob(job: Job) {
    return await update({
      ...data!,
      jobs: data!.jobs.map((item) => (item.id === job.id ? job : item)),
    });
  }
  function openJob(job: Job) {
    if (!allowLeave()) return;
    setDirty(false);
    setSelectedJob(job.id);
    setSection('prepare');
  }
  async function toggleTask(job: Job, taskId: string) {
    await updateJob({
      ...job,
      tasks: job.tasks.map((task) =>
        task.id === taskId ? { ...task, done: !task.done } : task,
      ),
    });
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || '').trim();
    const saved = await update({
      ...data!,
      profile: {
        profession: value('profession'),
        career: value('career'),
        education: value('education'),
        license: value('license'),
        goals: value('goals'),
        field: value('field'),
        environment: value('environment'),
        institution: value('institution'),
        attributes: value('attributes'),
      },
    });
    if (saved) setDirty(false);
  }

  async function confirmApplication() {
    if (!current || current.confirmed) return;
    if (
      !window.confirm(
        '검토한 공고로 지원 준비를 시작할까요? 미확인 조건은 확인 과제로 만들고, 확인된 마감일만 일정에 반영합니다.',
      )
    )
      return;
    const tasks = [...current.tasks];
    current.conditions
      .filter((condition) => !condition.verified)
      .forEach((condition) => {
        const taskId = `verify-${condition.id}`;
        if (!tasks.some((task) => task.id === taskId))
          tasks.push({
            id: taskId,
            title: `조건 확인: ${condition.text}`,
            due: '',
            reason: '지원 확정 시 원문 대조가 완료되지 않은 조건',
            done: false,
          });
      });
    await updateJob({ ...current, confirmed: true, status: '준비 중', tasks });
  }
  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    let saved = false;
    const value = (name: string) => String(form.get(name) || '').trim();
    if (editor.kind === 'experience') {
      if (!value('title') || !value('body')) {
        setFormError(
          '경험 제목과 실제로 한 일을 입력해 주세요. 공백만 저장할 수 없습니다.',
        );
        return;
      }
      const old = data!.experiences.find((item) => item.id === editor.id);
      const parsed = experienceSchema.safeParse({
        id: old?.id || id(),
        title: value('title'),
        body: value('body'),
        category: value('category'),
        level: value('level'),
        period: value('period'),
        demo: old?.demo || form.has('demo'),
        keywords: [
          ...new Set(
            form
              .getAll('experienceKeyword')
              .map(String)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
      });
      if (!parsed.success) {
        setFormError('입력 형식과 길이를 확인해 주세요.');
        return;
      }
      saved = await update({
        ...data!,
        experiences: old
          ? data!.experiences.map((item) =>
              item.id === old.id ? parsed.data : item,
            )
          : [parsed.data, ...data!.experiences],
      });
    } else if (editor.kind === 'job') {
      if (
        ![
          'organization',
          'role',
          'rawText',
          'source',
          'duties',
          'workConditions',
          'conditions',
          'documents',
          'field',
          'applicationPeriod',
          'applicationStart',
          'deadline',
        ].some((name) => value(name))
      ) {
        setFormError(
          '공고 원문이나 확인한 정보를 한 가지 이상 입력해 주세요. 없는 항목은 미확인으로 보관합니다.',
        );
        return;
      }
      if (value('source') && !sourceURL(value('source'))) {
        setFormError(
          '공고 출처는 아이디·비밀번호가 포함되지 않은 http 또는 https 주소를 입력해 주세요.',
        );
        return;
      }
      const errors = getRecruitmentDateErrors({
        applicationStart: value('applicationStart'),
        deadline: value('deadline'),
        startDateConfirmed: form.has('startDateConfirmed'),
        dateConfirmed: form.has('dateConfirmed'),
      });
      setDateErrors(errors);
      if (errors.applicationStart || errors.deadline) {
        setFormError('입력한 날짜를 확인해 주세요.');
        const field = event.currentTarget.elements.namedItem(
          errors.applicationStart ? 'applicationStart' : 'deadline',
        );
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      const old = data!.jobs.find((item) => item.id === editor.id);
      const lines = [
        ...new Set(
          value('conditions')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ];
      if (lines.length > 40) {
        setFormError('공고 조건은 최대 40개까지 입력할 수 있습니다.');
        return;
      }
      const parsed = jobSchema.safeParse({
        documents: value('documents'),
        rawText: value('rawText'),
        duties: value('duties'),
        workConditions: value('workConditions'),
        applicationPeriod: value('applicationPeriod'),
        applicationStart: value('applicationStart'),
        id: old?.id || id(),
        title:
          value('title') ||
          (value('organization') || value('role')
            ? `${[value('organization'), value('role')].filter(Boolean).join(' ')} 채용 공고`
            : '링크로 저장한 공고'),
        role: value('role'),
        organization: value('organization'),
        type: old?.type || '기타·미확인',
        attributes: old?.attributes || '',
        field: value('field'),
        source: value('source'),
        deadline: value('deadline'),
        dateConfirmed: form.has('dateConfirmed'),
        startDateConfirmed: form.has('startDateConfirmed'),
        status: old?.status || '관심',
        confirmed: old?.confirmed || false,
        demo: old?.demo || false,
        conditions: lines.map(
          (line) =>
            old?.conditions.find((condition) => condition.text === line) || {
              id: id(),
              text: line,
              evidence: '',
              verified: false,
              experienceId: '',
              reason: '',
            },
        ),
        tasks: old?.tasks || [],
      });
      if (!parsed.success) {
        setFormError('공고 입력 형식을 확인해 주세요.');
        return;
      }
      saved = await update({
        ...data!,
        jobs: old
          ? data!.jobs.map((item) => (item.id === old.id ? parsed.data : item))
          : [parsed.data, ...data!.jobs],
      });
      if (saved) setSelectedJob(parsed.data.id);
    } else if (editor.kind === 'task' && current) {
      if (!value('title') || !value('reason')) {
        setFormError('할 일과 생성 이유를 입력해 주세요.');
        return;
      }
      if (value('due') && !form.has('dueConfirmed')) {
        setFormError('기한을 사용하려면 직접 확인한 날짜임을 체크해 주세요.');
        return;
      }
      saved = await updateJob({
        ...current,
        tasks: [
          ...current.tasks,
          {
            id: id(),
            title: value('title'),
            reason: value('reason'),
            due: value('due'),
            done: false,
          },
        ],
      });
    } else if (editor.kind === 'link' && current) {
      if (value('experienceId') && !value('reason')) {
        setFormError('경험을 선택했다면 연결 이유도 입력해 주세요.');
        return;
      }
      if (form.has('verified') && !value('evidence')) {
        setFormError(
          '본인 확인 표시에는 원문 근거 또는 확인한 위치가 필요합니다.',
        );
        return;
      }
      saved = await updateJob({
        ...current,
        conditions: current.conditions.map((condition) =>
          condition.id === editor.id
            ? {
                ...condition,
                experienceId: value('experienceId'),
                reason: value('experienceId') ? value('reason') : '',
                evidence: value('evidence'),
                verified: form.has('verified'),
              }
            : condition,
        ),
      });
    }
    if (!saved) {
      setFormError(
        '저장하지 못했습니다. 입력은 유지됩니다. 저장소 경고를 확인해 주세요.',
      );
      return;
    }
    closeEditor(true);
  }
  async function deleteExperience(experience: Experience) {
    const count = data!.jobs.reduce(
      (sum, job) =>
        sum +
        job.conditions.filter(
          (condition) => condition.experienceId === experience.id,
        ).length,
      0,
    );
    if (
      !window.confirm(
        `이 경험을 삭제할까요? ${count}개 공고 조건과 자소서의 경험 선택에서 연결이 해제됩니다. 이미 저장된 글과 제출본은 보존됩니다.`,
      )
    )
      return;
    const saved = await update({
      ...data!,
      experiences: data!.experiences.filter(
        (item) => item.id !== experience.id,
      ),
      jobs: data!.jobs.map((job) => ({
        ...job,
        conditions: job.conditions.map((condition) =>
          condition.experienceId === experience.id
            ? { ...condition, experienceId: '', reason: '' }
            : condition,
        ),
      })),
      essays: data!.essays.map((essay) => ({
        ...essay,
        experienceIds: essay.experienceIds.filter(
          (item) => item !== experience.id,
        ),
      })),
    });
    if (saved) closeEditor(true);
  }
  async function generateExperienceDraft() {
    const form = essayForm.current;
    if (!form || !data || draftBusy) return;
    const values = new FormData(form);
    const selectedIds = values.getAll('experienceIds').map(String);
    const selected = data.experiences.filter((item) =>
      selectedIds.includes(item.id),
    );
    const question = String(values.get('question') || '').trim();
    const targetRole = String(values.get('targetRole') || '').trim();
    if (!question || !selected.length || selected.length > 10) {
      setFormError(
        '문항을 입력하고 실제 근거가 있는 경험을 1~10개 선택해 주세요.',
      );
      return;
    }
    const draft = form.elements.namedItem('draft');
    if (!(draft instanceof HTMLTextAreaElement)) return;
    if (
      draft.value.trim() &&
      !window.confirm(
        '현재 초안을 새 AI 결과로 바꿀까요? 수정본과 제출본은 유지됩니다.',
      )
    )
      return;
    const fingerprint = JSON.stringify({
      postingId: essayPostingId,
      values: [...values.entries()],
    });
    const controller = new AbortController();
    draftRequest.current = controller;
    setDraftBusy(true);
    setFormError('');
    try {
      const job = essayJob ? aiJob(essayJob) : null;
      const response = await requestAIResponse(
        { action: 'draft', question, targetRole, job, experiences: selected },
        draftResultSchema,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !form.isConnected ||
        essayForm.current !== form
      )
        return;
      const currentFingerprint = JSON.stringify({
        postingId: essayPostingId,
        values: [...new FormData(form).entries()],
      });
      if (currentFingerprint !== fingerprint) {
        setFormError(
          '작성 내용이 바뀌어 이전 결과를 반영하지 않았습니다. 현재 내용으로 다시 생성해 주세요.',
        );
        return;
      }
      if (response.result.draft.trim()) draft.value = response.result.draft;
      setDraftAI({
        essayId: chosenEssay?.id || '',
        jobId: essayPostingId,
        provenance: {
          result: response.result,
          provider: response.provider,
          model: response.model,
          question,
          targetRole,
          jobSnapshot: job,
          experienceSnapshots: selected,
          generatedAt: new Date().toISOString(),
        },
      });
      setDirty(true);
      setMessage(
        response.result.draft.trim()
          ? '실제 AI 초안을 만들었습니다. 원문 근거와 추가 질문을 검토한 뒤 작성 내용을 저장해 주세요.'
          : '초안을 쓰기에 정보가 부족합니다. AI의 추가 확인 질문을 확인하고 경험을 보완해 주세요. 기존 글은 유지됩니다.',
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setFormError(
          error instanceof Error
            ? error.message
            : 'AI 초안 생성에 실패했습니다. 입력은 유지됩니다.',
        );
    } finally {
      if (draftRequest.current === controller) {
        draftRequest.current = null;
        setDraftBusy(false);
      }
    }
  }
  async function saveEssay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || '').trim();
    if (!value('question')) {
      setFormError('자소서 문항을 입력해 주세요.');
      return;
    }
    const next: Essay = {
      id: chosenEssay?.id || id(),
      jobId: essayPostingId,
      question: value('question'),
      targetRole: value('targetRole'),
      experienceIds: form.getAll('experienceIds').map(String),
      outline: value('outline'),
      draft: value('draft'),
      revised: value('revised'),
      submissions: chosenEssay?.submissions || [],
      keywords: value('keywords'),
      ai: currentDraftAI,
      demo: Boolean(
        chosenEssay?.demo ||
        currentDraftAI?.experienceSnapshots.some((item) => item.demo),
      ),
    };
    const saved = await update({
      ...data!,
      essays: chosenEssay
        ? data!.essays.map((item) => (item.id === chosenEssay.id ? next : item))
        : [...data!.essays, next],
    });
    if (!saved) {
      setFormError('브라우저 저장에 실패했습니다. 작성 내용은 유지됩니다.');
      return;
    }
    if (draftAI?.essayId === '') setDraftAI({ ...draftAI, essayId: next.id });
    setEssayId(next.id);
    setDirty(false);
    setFormError('');
  }
  async function freezeSubmission() {
    if (dirty) {
      setFormError('현재 편집 내용을 먼저 저장해 주세요.');
      return;
    }
    if (!chosenEssay?.revised.trim()) {
      setFormError('수정본을 작성하고 저장한 뒤 제출본으로 보관해 주세요.');
      return;
    }
    if (
      !window.confirm(
        '저장된 수정본을 제출본으로 보관할까요? 이후 수정본을 바꿔도 이 제출본은 유지됩니다. 실제 지원처에 전송하지는 않습니다.',
      )
    )
      return;
    const submission = {
      id: id(),
      content: chosenEssay.revised,
      savedAt: new Date().toISOString(),
    };
    await update({
      ...data!,
      essays: data!.essays.map((essay) =>
        essay.id === chosenEssay.id
          ? { ...essay, submissions: [...essay.submissions, submission] }
          : essay,
      ),
    });
    setFormError('');
  }
  async function newWriting() {
    if (!allowLeave()) return;
    const next = essaySchema.parse({
      id: id(),
      jobId: essayPostingId,
      question: '',
      keywords: '',
      experienceIds: [],
      outline: '',
      draft: '',
      revised: '',
      submissions: [],
    });
    if (!(await update({ ...data!, essays: [...data!.essays, next] }))) return;
    setDirty(false);
    setFormError('');
    setEssayId(next.id);
  }
  async function addDemoExperience(index: number) {
    const sample = demoExperiences[index];
    if (!sample) return;
    const existing = data!.experiences.find(
      (item) =>
        item.demo &&
        item.title === sample.title &&
        item.period === sample.period,
    );
    if (existing) {
      openEditor({ kind: 'experience', id: existing.id });
      return;
    }
    const experience = experienceSchema.parse({
      ...sample,
      id: id(),
      demo: true,
      keywords: [],
    });
    if (
      await update({
        ...data!,
        experiences: [experience, ...data!.experiences],
      })
    )
      openEditor({ kind: 'experience', id: experience.id });
  }

  const editingExperience =
    editor?.kind === 'experience'
      ? data.experiences.find((item) => item.id === editor.id)
      : undefined;
  const editingJob =
    editor?.kind === 'job'
      ? data.jobs.find((item) => item.id === editor.id)
      : undefined;
  const editingCondition =
    editor?.kind === 'link'
      ? current?.conditions.find((item) => item.id === editor.id)
      : undefined;

  return (
    <div className={`eeum-app view-${section}`}>
      {guideOpen && (
        <PiggyGuide
          initialOnboarding={initialGuide}
          onClose={(reason) => finishGuide(undefined, reason)}
          onStart={finishGuide}
        />
      )}
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <div className="app-shell">
        <>
          {section !== 'profile' && (
            <div className="announcement">
              <span>
                계정별 기기 저장 · 준비 기록은 이 브라우저에 보관하며 다른
                기기로 동기화하지 않습니다.
              </span>
            </div>
          )}
          <header className="topbar">
            <button
              type="button"
              className="text-button guide-launcher"
              onClick={() => {
                setGuideOpen(true);
              }}
            >
              서비스 안내
            </button>
            <nav className="desktop-navigation" aria-label="주 메뉴">
              {navigation.map((item) => (
                <div
                  className={`desktop-nav-item ${section === item.id ? 'active' : ''}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    aria-current={section === item.id ? 'page' : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    {item.label}
                  </button>
                </div>
              ))}
            </nav>
            <div className="header-actions">
              <button
                type="button"
                className={`button secondary mypage-button ${section === 'profile' ? 'active' : ''}`}
                aria-current={section === 'profile' ? 'page' : undefined}
                onClick={() => navigate('profile')}
              >
                마이페이지
              </button>

              <BrandLogo onClick={() => navigate('dashboard')} />
            </div>
          </header>
        </>
        <main id="main" className="content" tabIndex={-1} ref={main}>
          {store.warning && (
            <div className="notice warning" role="alert">
              {store.warning}
            </div>
          )}
          {section === 'dashboard' && (
            <>
              <Heading
                title="공고 현황"
                description="피기캘린더에서 확인한 지원 기간과 공고 상태를 확인하세요."
              />
              <RecruitmentCalendar
                onAdd={() => openEditor({ kind: 'job' })}
                jobs={data.jobs.map((job) =>
                  isLinkOnlyJob(job)
                    ? { ...job, title: `${job.title} · 정보 미확인` }
                    : job,
                )}
                onOpen={(id) => {
                  const job = data.jobs.find((item) => item.id === id);
                  if (job) openJob(job);
                }}
              />
              <section className="dashboard-jobs">
                <div className="section-heading">
                  <h2>
                    등록한 공고 <small>{data.jobs.length}</small>
                  </h2>
                </div>
                <div className="cards">
                  {data.jobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      experiences={data.experiences}
                      openJob={openJob}
                    />
                  ))}
                </div>
                {!data.jobs.length && (
                  <Empty title="등록된 공고가 없습니다">
                    공고 추가에서 지원하려는 채용 정보를 입력해 주세요.
                  </Empty>
                )}
                <p className="job-summary">
                  관심 공고{' '}
                  {data.jobs.filter((job) => job.status === '관심').length}개 ·
                  준비 중{' '}
                  {data.jobs.filter((job) => job.status === '준비 중').length}개
                  · 확인할 조건 {unconfirmed}건
                </p>
              </section>
            </>
          )}
          {section === 'profile' && (
            <>
              <>
                <Heading
                  title="마이페이지"
                  description="희망 조건은 나의 방향입니다. 실제 지원 조건은 개별 공고를 우선합니다."
                />
              </>
              <form
                className="panel profile-form"
                onSubmit={saveProfile}
                onChange={() => setDirty(true)}
              >
                <div className="form-grid">
                  <Field label="지원 직군">
                    <select
                      name="profession"
                      defaultValue={data.profile.profession}
                    >
                      <option>물리치료</option>
                      <option disabled>작업치료 · 지원 예정 / 미검증</option>
                      <option disabled>
                        기타 보건의료 · 지원 예정 / 미검증
                      </option>
                    </select>
                  </Field>
                  <Field label="현재 상태 · 경력 단계">
                    <select name="career" defaultValue={data.profile.career}>
                      <option value="">선택하지 않음</option>
                      {['졸업예정', '신입', '경력'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="학력 (경력 단계와 별도)">
                    <input
                      name="education"
                      maxLength={150}
                      defaultValue={data.profile.education}
                      placeholder="예: 전문학사 졸업예정"
                    />
                  </Field>
                  <Field label="면허 상태 (면허번호 입력 금지)">
                    <input
                      name="license"
                      maxLength={150}
                      defaultValue={data.profile.license}
                      placeholder="예: 물리치료사 면허 취득 예정"
                    />
                  </Field>
                  <Field label="희망 분야">
                    <input
                      name="field"
                      maxLength={300}
                      defaultValue={data.profile.field}
                      placeholder="예: 신경계, 근골격계"
                    />
                  </Field>
                  <Field label="희망 근무 환경">
                    <input
                      name="environment"
                      maxLength={300}
                      defaultValue={data.profile.environment}
                      placeholder="예: 외래, 입원, 지역사회"
                    />
                  </Field>
                  <Field label="희망 기관 유형">
                    <input
                      name="institution"
                      maxLength={300}
                      defaultValue={data.profile.institution}
                      placeholder="예: 병원, 종합병원 (복수 입력 가능)"
                    />
                  </Field>
                  <Field label="기관의 별도 속성">
                    <input
                      name="attributes"
                      maxLength={300}
                      defaultValue={data.profile.attributes}
                      placeholder="재활 중심, 재활의료기관 지정, 공공기관 등"
                    />
                  </Field>
                  <Field label="나의 목표 · 복수 목표를 줄별로 작성" full>
                    <textarea
                      name="goals"
                      rows={5}
                      maxLength={4000}
                      defaultValue={data.profile.goals}
                      placeholder="어떤 환경에서 무엇을 배우며 일하고 싶은가요?"
                    />
                  </Field>
                </div>
                <div className="form-footer">
                  <span>
                    {dirty
                      ? '저장하지 않은 변경이 있습니다.'
                      : '최소한의 정보만 기록해도 괜찮아요.'}
                  </span>
                  <button className="button" type="submit">
                    목표 저장
                  </button>
                </div>
              </form>
              <div className="profile-account-actions">
                <form
                  action={signOutAction}
                  onSubmit={(event) => {
                    if (!allowLeave()) event.preventDefault();
                  }}
                >
                  <button type="submit" className="text-button logout-button">
                    로그아웃
                  </button>
                </form>
              </div>
            </>
          )}

          {section === 'experiences' && (
            <>
              <Heading
                title="포트폴리오"
                description="작은 관찰도 좋은 근거가 됩니다. 실제로 한 일과 수행 수준을 기록하세요."
              >
                <Button onClick={() => openEditor({ kind: 'experience' })}>
                  ＋ 경험 추가
                </Button>
              </Heading>
              <details className="demo-library">
                <summary>시연용 가상 경험 5개 살펴보기</summary>
                <p className="fine-print">
                  실제 사용자 경력이나 성과가 아닌 가상 자료입니다. 추가한
                  예시에는 가상 표시가 유지됩니다.
                </p>
                <div className="demo-experience-list">
                  {demoExperiences.map((item, index) => (
                    <button
                      type="button"
                      className="button secondary"
                      key={item.title}
                      onClick={() => addDemoExperience(index)}
                    >
                      {item.title} · 가상 예시 추가
                    </button>
                  ))}
                </div>
              </details>
              <div className="experience-grid">
                {data.experiences.map((experience) => (
                  <ExperienceCard
                    key={experience.id}
                    experience={experience}
                    jobs={data.jobs}
                    openEditor={openEditor}
                  />
                ))}
              </div>
              {!data.experiences.length && (
                <Empty title="나의 첫 경험을 남겨 보세요">
                  기존 메모를 붙여넣거나, 실습에서 배운 한 가지부터 시작해요.
                </Empty>
              )}
            </>
          )}
          {section === 'prepare' && (
            <>
              <Heading
                title="지원 준비"
                description="공고 조건, 나의 근거, 다음 행동을 한곳에서 연결해요."
              />
              {!current ? (
                <Empty title="공고를 먼저 추가해 주세요">
                  홈 캘린더의 + 버튼에서 준비할 기회를 등록할 수 있어요.
                </Empty>
              ) : (
                <>
                  <JobPicker
                    current={current}
                    jobs={data.jobs}
                    onSelect={(next) => {
                      if (!allowLeave()) return;
                      setDirty(false);
                      setSelectedJob(next);
                      setFormError('');
                    }}
                  />
                  <div className="prepare-layout">
                    <div>
                      <section className="panel">
                        <div className="card-top">
                          <div>
                            <p className="organization">
                              {current.organization || '기관 미확인'}
                              {current.demo && ' · 가상 예시'}
                            </p>
                            <h2>{current.title}</h2>
                          </div>
                          <span className="badge warm">
                            {dueLabel(current)}
                          </span>
                        </div>
                        <div className="facts">
                          <div>
                            <small>기관 유형 / 별도 속성</small>
                            <p>
                              {current.type} / {current.attributes || '미확인'}
                            </p>
                          </div>
                          <div>
                            <small>분야 · 경력 조건</small>
                            <p>{current.field || '미확인'}</p>
                          </div>
                          <div>
                            <small>확인된 마감 일정</small>
                            <p>
                              {current.dateConfirmed && current.deadline
                                ? current.deadline
                                : '미확인 · 일정에 반영하지 않음'}
                            </p>
                          </div>
                          <div>
                            <small>공고 출처</small>
                            <p>
                              {sourceURL(current.source) ? (
                                <a
                                  href={sourceURL(current.source)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  공고 원문 열기 ↗
                                </a>
                              ) : (
                                '출처 미등록'
                              )}
                            </p>
                          </div>
                          {current.duties && (
                            <div>
                              <small>업무내용</small>
                              <p className="preserve">{current.duties}</p>
                            </div>
                          )}
                          {current.workConditions && (
                            <div>
                              <small>근무 조건</small>
                              <p className="preserve">
                                {current.workConditions}
                              </p>
                            </div>
                          )}
                          {current.applicationPeriod && (
                            <div>
                              <small>서류 접수 기간 · 원문</small>
                              <p className="preserve">
                                {current.applicationPeriod}
                              </p>
                            </div>
                          )}
                        </div>
                        <p className="fine-print">
                          마감 시간은 원문에서 별도로 확인하세요. 날짜만으로
                          접수 가능 여부를 보장하지 않습니다.
                        </p>
                        <div className="actions">
                          <Button
                            onClick={confirmApplication}
                            disabled={current.confirmed}
                          >
                            {current.confirmed
                              ? '지원 준비 확정됨'
                              : '지원 준비 확정'}
                          </Button>
                          <Button
                            secondary
                            onClick={() =>
                              openEditor({ kind: 'job', id: current.id })
                            }
                          >
                            공고 수정
                          </Button>
                          <button
                            className="danger-button"
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  '공고와 연결된 할 일·자소서·제출본·면접 기록을 모두 삭제할까요? 경험 원본은 남으며 삭제는 되돌릴 수 없습니다.',
                                )
                              )
                                return;
                              if (
                                !(await update({
                                  ...data,
                                  jobs: data.jobs.filter(
                                    (job) => job.id !== current.id,
                                  ),
                                  essays: data.essays.filter(
                                    (essay) => essay.jobId !== current.id,
                                  ),
                                  interviews: data.interviews.filter(
                                    (item) => item.jobId !== current.id,
                                  ),
                                }))
                              )
                                return;
                              setSelectedJob('');
                            }}
                          >
                            공고 삭제
                          </button>
                        </div>
                        <label className="status-field">
                          실제 지원 진행 상태
                          <select
                            value={current.status}
                            onChange={async (event) => {
                              const status = z
                                .enum(statuses)
                                .parse(event.target.value);
                              await updateJob({ ...current, status });
                            }}
                          >
                            {statuses.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                      </section>
                      <section className="panel">
                        <h2>조건별 근거 연결</h2>
                        <p className="fine-print">
                          본인 확인은 원문과 직접 대조했다는 뜻입니다. 경험
                          연결은 자격 충족 판정이나 합격 예측이 아닙니다.
                        </p>
                        {current.conditions.map((condition) => {
                          const experience = data.experiences.find(
                            (item) => item.id === condition.experienceId,
                          );
                          return (
                            <article className="condition" key={condition.id}>
                              <div className="card-top">
                                <h3>{condition.text}</h3>
                                <span
                                  className={`badge ${condition.verified ? '' : 'warm'}`}
                                >
                                  {condition.verified ? '본인 확인' : '미확인'}
                                </span>
                              </div>
                              <p className="evidence">
                                원문 근거:{' '}
                                {condition.evidence ||
                                  '아직 기록하지 않았습니다.'}
                              </p>
                              {experience ? (
                                <div className="connection">
                                  <b>{experience.title}</b>
                                  <small>
                                    {experience.category} · {experience.level} ·
                                    본인 작성
                                  </small>
                                  <p>{condition.reason}</p>
                                </div>
                              ) : (
                                <p className="fine-print">
                                  연결된 경험·자격이 없습니다.
                                </p>
                              )}
                              <button
                                className="text-button"
                                onClick={() =>
                                  openEditor({ kind: 'link', id: condition.id })
                                }
                              >
                                근거 확인 ·{' '}
                                {experience ? '연결 수정' : '경험 연결'} →
                              </button>
                            </article>
                          );
                        })}
                        {!current.conditions.length && (
                          <Empty title="등록된 조건이 없어요">
                            공고 수정에서 확인할 조건을 추가해 주세요.
                          </Empty>
                        )}
                      </section>
                    </div>
                    <aside>
                      <section className="panel">
                        <div className="section-heading">
                          <h2>준비할 일</h2>
                          <button
                            className="text-button"
                            onClick={() => openEditor({ kind: 'task' })}
                          >
                            ＋ 추가
                          </button>
                        </div>
                        {current.tasks.map((task) => (
                          <div className="task-with-action" key={task.id}>
                            <TaskRow
                              job={current}
                              task={task}
                              toggleTask={toggleTask}
                            />
                            <button
                              className="icon-button"
                              aria-label={`${task.title} 삭제`}
                              onClick={async () => {
                                if (
                                  window.confirm('이 준비 항목을 삭제할까요?')
                                )
                                  await updateJob({
                                    ...current,
                                    tasks: current.tasks.filter(
                                      (item) => item.id !== task.id,
                                    ),
                                  });
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {!current.tasks.length && (
                          <Empty title="다음 행동을 정해 보세요">
                            무엇을 왜 준비해야 하는지 함께 기록해요.
                          </Empty>
                        )}
                        <p className="fine-print">
                          항목 완료와 지원 완료는 별도입니다.
                        </p>
                      </section>
                      <div className="actions">
                        <Button secondary onClick={() => navigate('essays')}>
                          자기소개서 열기 →
                        </Button>
                      </div>
                    </aside>
                  </div>
                </>
              )}
            </>
          )}
          {section === 'essays' && (
            <>
              <Heading
                title="자기소개서"
                description="없는 이야기를 만들지 않고, 나의 경험을 나의 문장으로 정리해요."
              />
              {data.jobs.length > 0 ? (
                <JobPicker
                  current={essayNoPosting ? undefined : current}
                  jobs={data.jobs}
                  allowNoPosting
                  onSelect={(next) => {
                    if (!allowLeave()) return;
                    cancelDraftRequest();
                    setDirty(false);
                    setEssayNoPosting(!next);
                    if (next) setSelectedJob(next);
                    setFormError('');
                  }}
                />
              ) : (
                <p className="notice">
                  등록된 공고가 없습니다. 공고 없이 자기소개서를 작성할 수
                  있습니다.
                </p>
              )}
              <div className="notice">
                선택한 경험과 문항을 BAZE를 통해 Gemini에 전달해 초안을
                제안합니다. 공고를 선택하면 공고 자료도 함께 전달하고, 공고 없이
                작성하면 선택한 경험만 사용합니다. 기록에 없는 성과나 사실은
                추가하지 않습니다. 학교 지원 크레딧이 사용되므로 필요한 요청만
                실행하고 시연에는 가상의 비민감 정보만 사용하세요. 개인정보·환자
                식별 정보·연락처·비밀값은 입력하지 마세요. AI 준비 상태는 서버
                설정값이 존재한다는 뜻일 뿐, 키 유효성이나 학교 계정의 남은
                크레딧을 확인한 것은 아닙니다.
              </div>
              <div className="toolbar">
                <select
                  aria-label="자소서 문항 선택"
                  value={chosenEssay?.id || ''}
                  onChange={(event) => {
                    if (allowLeave()) {
                      cancelDraftRequest();
                      setEssayId(event.target.value);
                      setDirty(false);
                      setFormError('');
                    }
                  }}
                >
                  <option value="" disabled>
                    새 문항을 작성하세요
                  </option>
                  {data.essays
                    .filter((essay) => essay.jobId === essayPostingId)
                    .map((essay, index) => (
                      <option key={essay.id} value={essay.id}>
                        {essay.question || `새 문항 ${index + 1}`}
                      </option>
                    ))}
                </select>
                <Button secondary onClick={() => newWriting()}>
                  ＋ 문항 추가
                </Button>
              </div>
              <div className="writing-layout">
                <form
                  className="panel"
                  key={JSON.stringify([
                    essayPostingId,
                    chosenEssay?.id || 'new',
                  ])}
                  onSubmit={saveEssay}
                  ref={essayForm}
                  onChange={() => setDirty(true)}
                >
                  {!essayJob && <p className="fine-print">일반 지원용 초안</p>}
                  <Field label="희망 직무 · 선택" full>
                    <input
                      name="targetRole"
                      maxLength={300}
                      defaultValue={chosenEssay?.targetRole || ''}
                      placeholder="예: 신입 물리치료사"
                    />
                  </Field>
                  <Field label="자소서 문항 *" full>
                    <textarea
                      name="question"
                      required
                      maxLength={2000}
                      rows={2}
                      defaultValue={chosenEssay?.question || ''}
                      placeholder="지원 동기와 해당 직무를 위해 준비한 경험을 작성해 주세요."
                    />
                  </Field>
                  <fieldset className="experience-selection">
                    <legend>활용할 경험 · 실제 기록만 선택하세요</legend>
                    {data.experiences.map((experience) => (
                      <label key={experience.id}>
                        <input
                          type="checkbox"
                          name="experienceIds"
                          value={experience.id}
                          defaultChecked={chosenEssay?.experienceIds.includes(
                            experience.id,
                          )}
                        />
                        {experience.title}
                        {experience.demo && ' (가상 예시)'}
                      </label>
                    ))}
                    {!data.experiences.length && (
                      <p>포트폴리오에 먼저 기록을 추가해 주세요.</p>
                    )}
                  </fieldset>
                  <div className="draft-builder">
                    <input
                      type="hidden"
                      name="keywords"
                      value={chosenEssay?.keywords || ''}
                    />
                    <p id="draft-help" className="fine-print">
                      선택한 경험의 저장된 키워드·수행 수준을 공고와 문항에
                      연결합니다. 자료가 Google Gemini로 전송되며, 확인되지 않은
                      성과는 만들어 넣지 않고 추가 정보를 질문합니다.
                    </p>
                    {aiAvailability.state !== 'ready' && (
                      <p className="notice">
                        {aiAvailability.state === 'missing'
                          ? '서버 BAZE_API_KEY에 학교 BAZE 키를 설정하고 서버를 재시작하세요. 키는 채팅이나 브라우저에 입력하지 마세요.'
                          : aiAvailability.state === 'checking'
                            ? 'AI 설정 확인 중…'
                            : 'AI 설정을 확인하지 못했습니다.'}{' '}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void aiAvailability.check()}
                        >
                          설정 다시 확인
                        </button>
                      </p>
                    )}
                    <Button
                      disabled={draftBusy || aiAvailability.state !== 'ready'}
                      onClick={() => void generateExperienceDraft()}
                    >
                      {draftBusy
                        ? 'AI 초안 생성 중…'
                        : '경험·키워드로 AI 초안 만들기'}
                    </Button>
                    {draftBusy && (
                      <>
                        <PigScene
                          mode="loading"
                          className="capture-pig-loading"
                        />
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            draftRequest.current?.abort();
                            draftRequest.current = null;
                            setDraftBusy(false);
                            setMessage(
                              '생성을 취소했습니다. 작성 내용은 유지됩니다.',
                            );
                          }}
                        >
                          생성 취소
                        </button>
                      </>
                    )}
                  </div>
                  <Field label="개요 · 구성 근거 확인 / 직접 수정" full>
                    <textarea
                      name="outline"
                      maxLength={10000}
                      rows={4}
                      defaultValue={chosenEssay?.outline || ''}
                      placeholder="핵심 메시지 → 실제 경험 → 배운 점 → 지원 직무와의 관련성"
                    />
                  </Field>
                  <Field label="초안 · 원문 근거 검토 / 직접 수정" full>
                    <textarea
                      name="draft"
                      maxLength={10000}
                      rows={7}
                      defaultValue={chosenEssay?.draft || ''}
                      placeholder="선택한 경험에서 실제로 한 일을 중심으로 작성해 주세요."
                    />
                  </Field>
                  <Field label="수정본" full>
                    <textarea
                      name="revised"
                      maxLength={10000}
                      rows={7}
                      defaultValue={chosenEssay?.revised || ''}
                      placeholder="검토를 마친 문장을 입력하세요. 저장 후 제출본으로 별도 보관할 수 있습니다."
                    />
                  </Field>
                  {formError && (
                    <p className="form-error" role="alert">
                      {formError}
                    </p>
                  )}
                  <div className="form-footer">
                    <span>
                      {dirty
                        ? '저장하지 않은 변경이 있습니다.'
                        : '제출본은 수정본과 별도로 보관됩니다.'}
                    </span>
                    <button type="submit" className="button">
                      작성 내용 저장
                    </button>
                  </div>
                  <div className="actions">
                    <Button secondary onClick={freezeSubmission}>
                      저장된 수정본을 제출본으로 보관
                    </Button>
                    {chosenEssay && (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              '이 문항의 초안·수정본·제출본을 모두 삭제할까요?',
                            )
                          )
                            return;
                          if (
                            !(await update({
                              ...data,
                              essays: data.essays.filter(
                                (essay) => essay.id !== chosenEssay.id,
                              ),
                            }))
                          )
                            return;
                          setEssayId('');
                          setDirty(false);
                        }}
                      >
                        문항 삭제
                      </button>
                    )}
                  </div>
                </form>
                <aside>
                  {currentDraftAI && (
                    <section className="panel ai-draft-evidence">
                      <h2>최근 AI 생성 근거</h2>
                      <p className="fine-print">
                        {currentDraftAI.provider === 'gemini'
                          ? 'Google Gemini'
                          : 'OpenAI'}{' '}
                        · {currentDraftAI.model} · 생성 시점 자료를 보관합니다.
                        수정한 글은 직접 다시 검토하세요.
                      </p>
                      <p className="fine-print">
                        작성 문항: {currentDraftAI.question}
                      </p>
                      <p className="fine-print">
                        자료 범위:{' '}
                        {currentDraftAI.jobSnapshot
                          ? `공고: ${currentDraftAI.jobSnapshot.organization || '기관 미확인'} · ${currentDraftAI.jobSnapshot.title}`
                          : '공고 없이 선택한 경험'}
                      </p>
                      {currentDraftAI.experienceSnapshots.some(
                        (item) => item.demo,
                      ) && (
                        <p className="notice">
                          시연용 가상 경험이 포함되어 있습니다. 실제 지원에
                          본인의 경험으로 사용하지 마세요.
                        </p>
                      )}
                      <h3>사용한 경험</h3>
                      <ul>
                        {currentDraftAI.result.sourceIds.map((sourceId) => (
                          <li key={sourceId}>
                            {currentDraftAI.experienceSnapshots.find(
                              (item) => item.id === sourceId,
                            )?.title || sourceId}
                          </li>
                        ))}
                      </ul>
                      {currentDraftAI.result.evidence.map((item, index) => (
                        <blockquote key={index}>
                          <strong>
                            {item.sourceId === 'job'
                              ? '지원 공고'
                              : currentDraftAI.experienceSnapshots.find(
                                  (experience) =>
                                    'experience:' + experience.id ===
                                    item.sourceId,
                                )?.title || item.sourceId}
                          </strong>
                          <p className="preserve">{item.quote}</p>
                        </blockquote>
                      ))}
                      {!!currentDraftAI.result.questions.length && (
                        <>
                          <h3>추가로 확인할 정보</h3>
                          <ul>
                            {currentDraftAI.result.questions.map(
                              (question, index) => (
                                <li key={index}>{question}</li>
                              ),
                            )}
                          </ul>
                        </>
                      )}
                      <details>
                        <summary>생성 당시 경험·키워드 확인</summary>
                        {currentDraftAI.experienceSnapshots.map((item) => (
                          <article key={item.id}>
                            <h4>{item.title}</h4>
                            <p>{item.keywords.join(' · ')}</p>
                            <p className="preserve">{item.body}</p>
                          </article>
                        ))}
                      </details>
                    </section>
                  )}
                  <section className="panel">
                    <h2>작성 전 확인할 질문</h2>
                    <p className="fine-print">
                      AI 분석이 아닌 공통 점검 질문입니다.
                    </p>
                    <ul className="prompt-list">
                      <li>이 경험에서 내가 직접 한 일은 무엇인가요?</li>
                      <li>관찰·보조와 독립 수행을 구분했나요?</li>
                      <li>성과를 보여줄 실제 근거가 있나요?</li>
                      <li>공고의 어떤 조건과 관련되나요?</li>
                    </ul>
                  </section>
                  <section className="panel">
                    <h2>제출본 보관함</h2>
                    <p className="fine-print">
                      실제 지원처로 전송하지 않습니다. 이후 수정과 독립적으로
                      유지됩니다.
                    </p>
                    {chosenEssay?.submissions.map((submission, index) => (
                      <details className="submission" key={submission.id}>
                        <summary>
                          제출본 {index + 1} ·{' '}
                          {new Date(submission.savedAt).toLocaleString('ko-KR')}
                        </summary>
                        <p className="preserve">{submission.content}</p>
                        <button
                          className="danger-button"
                          onClick={async () => {
                            if (window.confirm('이 제출본을 삭제할까요?'))
                              await update({
                                ...data,
                                essays: data.essays.map((essay) =>
                                  essay.id === chosenEssay.id
                                    ? {
                                        ...essay,
                                        submissions: essay.submissions.filter(
                                          (item) => item.id !== submission.id,
                                        ),
                                      }
                                    : essay,
                                ),
                              });
                          }}
                        >
                          이 제출본 삭제
                        </button>
                      </details>
                    ))}
                    {!chosenEssay?.submissions.length && (
                      <p className="fine-print">
                        아직 보관한 제출본이 없습니다.
                      </p>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
          {section === 'interview' && (
            <>
              <Heading
                title="면접 연습"
                description="나의 기록을 말로 풀어보고, 다음 면접을 위한 배움을 남겨요."
              />
              <InterviewQuestionBuilder
                essays={data.essays}
                jobs={data.jobs.map(aiJob)}
                experiences={data.experiences}
                sessions={data.interviewSessions}
                legacyQuestions={data.interviews}
                onDirtyChange={setDirty}
                onSave={async (session) =>
                  await update({
                    ...data,
                    interviewSessions: data.interviewSessions.some(
                      (item) => item.id === session.id,
                    )
                      ? data.interviewSessions.map((item) =>
                          item.id === session.id ? session : item,
                        )
                      : [session, ...data.interviewSessions],
                  })
                }
              />
            </>
          )}

          <footer className="footer">
            <span>꿀잡 · 취업 준비 워크스페이스</span>
            <span>
              브라우저 데이터 삭제 시 기록 소실 · 기기 간 동기화 없음 · 민감정보
              입력 금지
            </span>
            <a href="/welcome">시작 화면 미리보기</a>
          </footer>
        </main>
      </div>
      <div className="save-status" role="status" aria-live="polite">
        {message && (
          <>
            <span>{message}</span>
            <button aria-label="저장 안내 닫기" onClick={() => setMessage('')}>
              ×
            </button>
          </>
        )}
      </div>
      {editor && (
        <dialog
          className="editor-dialog"
          ref={dialog}
          aria-labelledby="editor-title"
          onKeyDown={keepDialogFocus}
          onCancel={(event) => {
            event.preventDefault();
            closeEditor();
          }}
        >
          <form onSubmit={saveEditor} onChange={() => setEditorDirty(true)}>
            <div className="dialog-header">
              <h2 id="editor-title">
                {
                  {
                    job: editingJob ? '공고 수정' : '공고 등록',
                    experience: editingExperience
                      ? '경험 기록 수정'
                      : '나의 경험 기록',
                    task: '다음 행동 추가',
                    link: '원문 확인과 경험 연결',
                  }[editor.kind]
                }
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="닫기"
                onClick={() => closeEditor()}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-grid">
                {editor.kind === 'job' && (
                  <>
                    <Field label="공고 원문 · 직접 입력 또는 붙여넣기" full>
                      <textarea
                        name="rawText"
                        rows={4}
                        maxLength={40000}
                        defaultValue={editingJob?.rawText}
                        placeholder="공고 원문을 직접 입력하거나 붙여넣으세요."
                      />
                    </Field>

                    <Field label="공고 제목 · 선택" full>
                      <input
                        name="title"
                        maxLength={300}
                        defaultValue={editingJob?.title}
                        placeholder="링크만 저장하면 임시 제목을 붙입니다."
                      />
                    </Field>
                    <Field label="병원명 · 선택">
                      <input
                        name="organization"
                        placeholder="미확인"
                        maxLength={150}
                        defaultValue={editingJob?.organization}
                      />
                    </Field>

                    <Field label="모집 직무 · 선택">
                      <input
                        name="role"
                        maxLength={300}
                        defaultValue={editingJob?.role}
                        placeholder="예: 물리치료사"
                      />
                    </Field>
                    <Field label="분야 · 경력 조건">
                      <input
                        name="field"
                        maxLength={300}
                        defaultValue={editingJob?.field}
                        placeholder="미확인"
                      />
                    </Field>
                    <>
                      <Field label="업무내용" full>
                        <textarea
                          name="duties"
                          rows={2}
                          maxLength={10000}
                          defaultValue={editingJob?.duties}
                          placeholder="미확인"
                        />
                      </Field>
                      <Field label="근무 조건" full>
                        <textarea
                          name="workConditions"
                          rows={2}
                          maxLength={10000}
                          defaultValue={editingJob?.workConditions}
                          placeholder="미확인"
                        />
                      </Field>
                      <Field label="접수 기간 원문 · 없으면 미확인" full>
                        <input
                          name="applicationPeriod"
                          maxLength={10000}
                          defaultValue={editingJob?.applicationPeriod}
                          placeholder="미확인"
                        />
                      </Field>
                      <Field label="제출 서류 · 없으면 미확인" full>
                        <textarea
                          name="documents"
                          rows={3}
                          maxLength={10000}
                          defaultValue={editingJob?.documents}
                          placeholder="미확인"
                        />
                      </Field>

                      <Field label="서류 접수 시작일 · 없으면 미확인">
                        <input
                          type="date"
                          name="applicationStart"
                          min="2000-01-01"
                          max="2100-12-31"
                          defaultValue={editingJob?.applicationStart}
                          onChange={changeRecruitmentDate}
                          aria-invalid={Boolean(dateErrors.applicationStart)}
                          aria-describedby={
                            dateErrors.applicationStart
                              ? 'application-start-error'
                              : undefined
                          }
                        />
                        {dateErrors.applicationStart && (
                          <small id="application-start-error" role="alert">
                            {dateErrors.applicationStart}
                          </small>
                        )}
                      </Field>
                      <Field label="서류지원 마감일 · 없으면 미확인">
                        <input
                          name="deadline"
                          type="date"
                          min="2000-01-01"
                          max="2100-12-31"
                          defaultValue={editingJob?.deadline}
                          onChange={changeRecruitmentDate}
                          aria-invalid={Boolean(dateErrors.deadline)}
                          aria-describedby={
                            dateErrors.deadline
                              ? 'application-deadline-error'
                              : undefined
                          }
                        />
                        {dateErrors.deadline && (
                          <small id="application-deadline-error" role="alert">
                            {dateErrors.deadline}
                          </small>
                        )}
                      </Field>
                    </>
                    <label className="checkbox-label full">
                      <input
                        name="startDateConfirmed"
                        type="checkbox"
                        defaultChecked={editingJob?.startDateConfirmed}
                      />
                      원문에서 지원 시작일을 직접 확인했습니다. 확인한 날짜만
                      피기캘린더에 반영합니다.
                    </label>
                    <label className="checkbox-label full">
                      <input
                        name="dateConfirmed"
                        type="checkbox"
                        defaultChecked={editingJob?.dateConfirmed}
                      />
                      원문에서 마감일을 직접 확인했습니다. 확인한 날짜만
                      피기캘린더에 반영합니다.
                    </label>
                    <Field label="공고 출처 URL" full>
                      <input
                        name="source"
                        type="url"
                        maxLength={2000}
                        defaultValue={editingJob?.source}
                        placeholder="https://…"
                      />
                    </Field>
                    <Field
                      label="필수·우대 조건과 미확인 정보 · 한 줄에 한 항목"
                      full
                    >
                      <textarea
                        name="conditions"
                        rows={2}
                        maxLength={10000}
                        defaultValue={editingJob?.conditions
                          .map((condition) => condition.text)
                          .join('\n')}
                        placeholder="[필수] 물리치료사 면허\n[우대] 신경계 실습 경험\n[미확인] 취득 예정자 지원 가능 여부"
                      />
                    </Field>
                    <p className="fine-print full">
                      조건 문구를 바꾸면 해당 조건의 근거·확인 상태·경험 연결은
                      초기화됩니다. 기존 할 일은 별도로 검토하세요.
                    </p>
                  </>
                )}
                {editor.kind === 'experience' && (
                  <>
                    <Field label="경험 제목 *" full>
                      <input
                        name="title"
                        required
                        maxLength={150}
                        defaultValue={editingExperience?.title}
                      />
                    </Field>
                    <Field label="경험 분류">
                      <select
                        name="category"
                        defaultValue={editingExperience?.category || '실습'}
                      >
                        {experienceTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="실제 수행 수준">
                      <select
                        name="level"
                        defaultValue={editingExperience?.level || '관찰'}
                      >
                        {performanceLevels.map((level) => (
                          <option key={level}>{level}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="경험 기간" full>
                      <input
                        name="period"
                        maxLength={150}
                        defaultValue={editingExperience?.period}
                        placeholder="예: 2026.03–2026.04, 4주"
                      />
                    </Field>
                    <Field label="실제로 한 일 · 배운 점 *" full>
                      <textarea
                        name="body"
                        required
                        rows={8}
                        maxLength={12000}
                        defaultValue={editingExperience?.body}
                        placeholder="기존 기록을 붙여넣을 수 있어요. 본인의 역할과 관찰·보조·수행 범위를 구분해 주세요."
                      />
                    </Field>
                    {editingExperience?.demo ? (
                      <p className="notice full">
                        시연용 가상 데이터입니다. 실제 본인의 경력으로 사용하지
                        마세요.
                      </p>
                    ) : (
                      <label className="checkbox-label full">
                        <input type="checkbox" name="demo" />
                        시연용 가상 자료로 표시
                      </label>
                    )}
                    <div className="full">
                      <ExperienceKeywords
                        initialKeywords={editingExperience?.keywords || []}
                        experienceId={
                          editingExperience?.id || 'unsaved-experience'
                        }
                        demo={editingExperience?.demo || false}
                        onChange={() => setEditorDirty(true)}
                      />
                    </div>
                  </>
                )}
                {editor.kind === 'task' && (
                  <>
                    <Field label="할 일 · 필요한 서류 *" full>
                      <input
                        name="title"
                        required
                        maxLength={300}
                        placeholder="예: 면허 취득 예정자의 제출 서류 확인"
                      />
                    </Field>
                    <Field label="이 일이 필요한 이유 *" full>
                      <textarea
                        name="reason"
                        required
                        rows={3}
                        maxLength={2000}
                        placeholder="공고 조건이나 현재 미확인 정보와 연결해 주세요."
                      />
                    </Field>
                    <Field label="직접 정하거나 확인한 기한">
                      <input
                        name="due"
                        type="date"
                        min="2000-01-01"
                        max="2100-12-31"
                      />
                    </Field>
                    <label className="checkbox-label full">
                      <input name="dueConfirmed" type="checkbox" />
                      입력한 기한을 직접 확인했습니다.
                    </label>
                  </>
                )}
                {editor.kind === 'link' && (
                  <>
                    <div className="full">
                      <h3>{editingCondition?.text}</h3>
                      <p className="fine-print">
                        원문 근거와 경험의 관련성을 구분해 기록하세요.
                      </p>
                    </div>
                    <Field
                      label="원문 근거 · 이미지 번호 / 위치 / 인용 문구"
                      full
                    >
                      <textarea
                        name="evidence"
                        maxLength={4000}
                        rows={3}
                        defaultValue={editingCondition?.evidence}
                        placeholder="예: 이미지 2, 지원 자격 항목: …"
                      />
                    </Field>
                    <label className="checkbox-label full">
                      <input
                        name="verified"
                        type="checkbox"
                        defaultChecked={editingCondition?.verified}
                      />
                      원문과 직접 대조했습니다. 서비스가 검증한 정보는 아닙니다.
                    </label>
                    <Field label="연결할 경험·자격" full>
                      <select
                        name="experienceId"
                        defaultValue={editingCondition?.experienceId || ''}
                      >
                        <option value="">연결하지 않음 / 기존 연결 해제</option>
                        {data.experiences.map((experience) => (
                          <option key={experience.id} value={experience.id}>
                            {experience.title} · {experience.level}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="선택한 경험을 연결하는 이유" full>
                      <textarea
                        name="reason"
                        maxLength={4000}
                        rows={4}
                        defaultValue={editingCondition?.reason}
                      />
                    </Field>
                  </>
                )}
              </div>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <p className="fine-print">
                민감정보·환자 식별 정보를 입력하지 마세요. 이 브라우저에만
                저장됩니다.
              </p>
            </div>
            <div className="dialog-footer">
              {editingExperience && (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => deleteExperience(editingExperience)}
                >
                  경험 삭제
                </button>
              )}
              <Button secondary onClick={() => closeEditor()}>
                취소
              </Button>
              <button type="submit" className="button">
                저장하기
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
