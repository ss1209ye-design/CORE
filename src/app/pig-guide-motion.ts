export type GuideGesturePose = Readonly<{
  arm: number;
  tilt: number;
  nod: number;
}>;

export type ActiveGuideGesture = Readonly<{
  pageIndex: number;
  startedAt: number;
  initialPose: GuideGesturePose;
}>;

export const GUIDE_GESTURE_DURATION_MS = 920;
const GUIDE_GESTURE_BLEND_MS = 180;
const REST_POSE: GuideGesturePose = { arm: 0, tilt: 0, nod: 0 };

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function normalizePose(pose: GuideGesturePose): GuideGesturePose {
  return {
    arm: finiteOrZero(pose.arm),
    tilt: finiteOrZero(pose.tilt),
    nod: finiteOrZero(pose.nod),
  };
}

export function replaceGuideGesture(
  active: ActiveGuideGesture | null,
  pageIndex: number,
  startedAt: number,
  initialPose: GuideGesturePose,
  reducedMotion: boolean,
): ActiveGuideGesture | null {
  if (
    reducedMotion ||
    !Number.isFinite(pageIndex) ||
    !Number.isFinite(startedAt)
  ) {
    return null;
  }

  const normalizedPage = Math.trunc(pageIndex);
  if (active?.pageIndex === normalizedPage && active.startedAt === startedAt) {
    return active;
  }

  return {
    pageIndex: normalizedPage,
    startedAt,
    initialPose: normalizePose(initialPose),
  };
}

export function sampleGuideGesture(
  gesture: ActiveGuideGesture,
  now: number,
  reducedMotion: boolean,
): { pose: GuideGesturePose; active: boolean } {
  if (reducedMotion || !Number.isFinite(now)) {
    return { pose: REST_POSE, active: false };
  }

  const elapsed = Math.max(0, now - gesture.startedAt);
  if (elapsed >= GUIDE_GESTURE_DURATION_MS) {
    return { pose: REST_POSE, active: false };
  }

  const progress = elapsed / GUIDE_GESTURE_DURATION_MS;
  const phase = (((gesture.pageIndex % 3) + 3) % 3) * ((Math.PI * 2) / 3);
  const envelope = Math.sin(Math.PI * progress) ** 2;
  const blend = Math.min(1, elapsed / GUIDE_GESTURE_BLEND_MS);
  const easedBlend = blend * blend * (3 - 2 * blend);
  const initialWeight = 1 - easedBlend;
  const initial = gesture.initialPose;

  return {
    pose: {
      arm:
        initial.arm * initialWeight +
        envelope * (0.72 + 0.12 * Math.sin(6 * Math.PI * progress + phase)),
      tilt:
        initial.tilt * initialWeight +
        envelope * 0.035 * Math.sin(2 * Math.PI * progress + phase),
      nod:
        initial.nod * initialWeight +
        envelope * 0.025 * Math.sin(4 * Math.PI * progress + phase),
    },
    active: true,
  };
}
