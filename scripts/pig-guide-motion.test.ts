import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUIDE_GESTURE_DURATION_MS,
  replaceGuideGesture,
  sampleGuideGesture,
  type GuideGesturePose,
} from '../src/app/pig-guide-motion';

const rest: GuideGesturePose = { arm: 0, tilt: 0, nod: 0 };

test('guide gesture stays within its short return-to-rest timing', () => {
  assert.ok(GUIDE_GESTURE_DURATION_MS >= 700);
  assert.ok(GUIDE_GESTURE_DURATION_MS <= 1200);
  const gesture = replaceGuideGesture(null, 0, 100, rest, false);
  assert.ok(gesture);

  assert.deepEqual(sampleGuideGesture(gesture, 100, false), {
    pose: rest,
    active: true,
  });
  const middle = sampleGuideGesture(
    gesture,
    100 + GUIDE_GESTURE_DURATION_MS / 2,
    false,
  );
  assert.equal(middle.active, true);
  assert.ok(middle.pose.arm > 0.5);

  assert.deepEqual(
    sampleGuideGesture(gesture, 100 + GUIDE_GESTURE_DURATION_MS, false),
    { pose: rest, active: false },
  );
});

test('latest page trigger replaces and blends from the in-flight pose', () => {
  const first = replaceGuideGesture(null, 2, 500, rest, false);
  assert.ok(first);
  const inFlightPose = sampleGuideGesture(first, 820, false).pose;
  const latest = replaceGuideGesture(first, 3, 820, inFlightPose, false);
  assert.ok(latest);
  assert.notEqual(latest, first);
  assert.equal(latest.pageIndex, 3);
  assert.equal(latest.startedAt, 820);
  assert.deepEqual(sampleGuideGesture(latest, 820, false).pose, inFlightPose);
  assert.equal(
    sampleGuideGesture(latest, 820 + GUIDE_GESTURE_DURATION_MS, false).active,
    false,
  );
});

test('reduced motion rejects and neutralizes gestures', () => {
  assert.equal(replaceGuideGesture(null, 1, 0, rest, true), null);
  const gesture = replaceGuideGesture(null, 1, 0, rest, false);
  assert.ok(gesture);
  assert.deepEqual(sampleGuideGesture(gesture, 300, true), {
    pose: rest,
    active: false,
  });
});

test('all sampled transforms stay finite for unusual indices and elapsed values', () => {
  const gesture = replaceGuideGesture(
    null,
    -7,
    50,
    { arm: Number.NaN, tilt: Number.POSITIVE_INFINITY, nod: -0.2 },
    false,
  );
  assert.ok(gesture);
  for (const now of [-100, 50, 51, 510, 969, 970, 5000]) {
    const sample = sampleGuideGesture(gesture, now, false);
    assert.ok(Object.values(sample.pose).every(Number.isFinite));
  }
  assert.equal(replaceGuideGesture(null, Number.NaN, 0, rest, false), null);
  assert.deepEqual(
    sampleGuideGesture(gesture, Number.POSITIVE_INFINITY, false),
    {
      pose: rest,
      active: false,
    },
  );
});
