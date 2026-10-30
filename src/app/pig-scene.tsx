'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  GLTFLoader,
  type GLTF,
} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  replaceGuideGesture,
  sampleGuideGesture,
  type ActiveGuideGesture,
  type GuideGesturePose,
} from './pig-guide-motion';
import styles from './pig-scene.module.css';

type SceneMode = 'entrance' | 'loading' | 'wave' | 'idle';

type PigSceneProps = {
  mode?: SceneMode;
  className?: string;
  pageTrigger?: number;
};

function disposeGltf(gltf: GLTF, actor?: THREE.Object3D | null) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const visited = new Set<object>();

  const collectTextures = (value: unknown) => {
    if (value instanceof THREE.Texture) {
      textures.add(value);
      return;
    }

    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);

    for (const child of Object.values(value)) collectTextures(child);
  };

  for (const root of [...gltf.scenes, ...(actor ? [actor] : [])]) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);

      const meshMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of meshMaterials) {
        materials.add(material);
        collectTextures(material);
      }
    });
  }

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();

  const closedImages = new Set<object>();
  for (const texture of textures) {
    texture.dispose();
    const image = texture.image;
    for (const source of Array.isArray(image) ? image : [image]) {
      if (
        source &&
        typeof source === 'object' &&
        'close' in source &&
        typeof source.close === 'function' &&
        !closedImages.has(source)
      ) {
        closedImages.add(source);
        source.close();
      }
    }
  }
}

function reparentAroundBounds(
  actor: THREE.Group,
  model: THREE.Group,
  name: string,
): THREE.Group | null {
  const object = model.getObjectByName(
    THREE.PropertyBinding.sanitizeNodeName(name),
  );
  if (!object || !object.parent) return null;

  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return null;

  const pivotPosition = bounds.getCenter(new THREE.Vector3());
  actor.worldToLocal(pivotPosition);

  const pivot = new THREE.Group();
  pivot.position.copy(pivotPosition);
  pivot.userData.restY = pivot.position.y;
  actor.add(pivot);
  actor.updateWorldMatrix(true, true);
  object.updateWorldMatrix(true, false);
  const objectWorldMatrix = object.matrixWorld.clone();

  object.parent.remove(object);
  pivot.add(object);

  const pivotInverse = pivot.matrixWorld.clone().invert();
  object.matrixAutoUpdate = false;
  object.matrix.copy(pivotInverse.multiply(objectWorldMatrix));

  return pivot;
}

export default function PigScene({
  mode = 'entrance',
  className,
  pageTrigger,
}: PigSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const pageTriggerRef = useRef(pageTrigger);
  const reconfigureRef = useRef<
    ((nextMode: SceneMode, nextPageTrigger?: number) => void) | null
  >(null);
  const [status, setStatus] = useState('돼지 캐릭터를 불러오고 있어요.');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    modeRef.current = mode;
    pageTriggerRef.current = pageTrigger;
    reconfigureRef.current?.(mode, pageTrigger);
  }, [mode, pageTrigger]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let failed = false;
    let animationFrame = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let manager: THREE.LoadingManager | null = null;
    const modelRequest = new AbortController();
    let observer: ResizeObserver | null = null;
    let resizeFallback = false;
    let contextLostListener: ((event: Event) => void) | null = null;
    let gltfResult: GLTF | null = null;
    let actor: THREE.Group | null = null;
    let dimensions: THREE.Vector3 | null = null;
    let fittedWidth = 1;
    let fittedHeight = 1;
    let currentMode = modeRef.current;
    let currentPageTrigger = pageTriggerRef.current;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = mediaQuery.matches;
    let animationStartedAt = 0;
    let activeGuideGesture: ActiveGuideGesture | null = null;
    let appliedGuideGesture: GuideGesturePose = { arm: 0, tilt: 0, nod: 0 };
    let leftFoot: THREE.Group | null = null;
    let rightFoot: THREE.Group | null = null;
    let leftHand: THREE.Group | null = null;
    let rightHand: THREE.Group | null = null;
    let leftSleeve: THREE.Group | null = null;
    let rightSleeve: THREE.Group | null = null;
    let rightArm: THREE.Group | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    const fail = (kind: 'webgl' | 'model' | 'content') => {
      if (disposed || failed) return;
      failed = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;

      const message =
        kind === 'webgl'
          ? '이 브라우저에서 3D 화면(WebGL)을 사용할 수 없어요. WebGL을 지원하는 브라우저에서 다시 열어 주세요.'
          : kind === 'content'
            ? '돼지 캐릭터 파일에 표시할 3D 모델이 없어요. 파일을 확인한 뒤 다시 시도해 주세요.'
            : '돼지 캐릭터를 불러오지 못했어요. 연결 상태를 확인한 뒤 페이지를 새로고침해 주세요.';
      setError(message);
      setStatus(message);
    };

    const draw = () => {
      if (disposed || failed || !renderer) return;
      try {
        renderer.render(scene, camera);
      } catch {
        fail('webgl');
      }
    };

    const setStaticPose = () => {
      if (!actor) return;
      actor.position.set(0, 0, 0);
      actor.rotation.set(0, 0, 0);
      for (const limb of [
        leftFoot,
        rightFoot,
        leftHand,
        rightHand,
        leftSleeve,
        rightSleeve,
        rightArm,
      ]) {
        if (limb) {
          limb.rotation.set(0, 0, 0);
          limb.position.y = limb.userData.restY as number;
        }
      }
      draw();
    };

    const setWalkingPose = (
      leftSwing: number,
      rightSwing: number,
      armSwing: number,
    ) => {
      if (!dimensions) return;
      if (leftFoot) {
        leftFoot.rotation.set(leftSwing * 0.12, 0, leftSwing * 0.3);
        leftFoot.position.y =
          (leftFoot.userData.restY as number) + leftSwing * dimensions.y * 0.06;
      }
      if (rightFoot) {
        rightFoot.rotation.set(-rightSwing * 0.12, 0, -rightSwing * 0.3);
        rightFoot.position.y =
          (rightFoot.userData.restY as number) +
          rightSwing * dimensions.y * 0.06;
      }
      if (leftHand) leftHand.rotation.z = -armSwing;
      if (rightHand) rightHand.rotation.z = armSwing;
      if (leftSleeve) leftSleeve.rotation.z = -armSwing * 0.8;
      if (rightSleeve) rightSleeve.rotation.z = armSwing * 0.8;
    };

    const applyGuideGesture = (now: number) => {
      if (!actor || !activeGuideGesture) return false;
      const sample = sampleGuideGesture(activeGuideGesture, now, reducedMotion);
      appliedGuideGesture = sample.pose;
      actor.rotation.z += sample.pose.tilt;
      actor.rotation.x += sample.pose.nod;
      if (rightArm)
        rightArm.rotation.z +=
          Math.sign(rightArm.position.x || 1) * sample.pose.arm;
      if (!sample.active) {
        activeGuideGesture = null;
        appliedGuideGesture = { arm: 0, tilt: 0, nod: 0 };
      }
      return sample.active;
    };

    const animate = (now: number) => {
      animationFrame = 0;
      if (disposed || failed || !actor || !dimensions || reducedMotion) return;

      const elapsed = Math.max(0, (now - animationStartedAt) / 1000);
      if (currentMode === 'loading') {
        const turn = ((elapsed / 3.6) % 1) * Math.PI * 2;
        const step = elapsed * 2.4;
        const stepIndex = Math.floor(step);
        const stepPhase = step - stepIndex;
        const lift =
          stepPhase < 0.62 ? Math.sin((stepPhase / 0.62) * Math.PI) : 0;
        actor.position.set(0, 0, 0);
        actor.rotation.set(0, turn, 0);
        setWalkingPose(
          stepIndex % 2 === 0 ? lift : 0,
          stepIndex % 2 === 1 ? lift : 0,
          Math.sin(step * Math.PI) * 0.22,
        );
        draw();
        if (!failed) animationFrame = window.requestAnimationFrame(animate);
        return;
      }

      if (currentMode === 'wave') {
        actor.position.set(0, 0, 0);
        actor.rotation.set(0, 0, 0);
        setWalkingPose(0, 0, 0);
        const wave = Math.sin(elapsed * 4.2) * 0.18;
        if (rightArm)
          rightArm.rotation.z =
            Math.sign(rightArm.position.x || 1) * (0.75 + wave);
        applyGuideGesture(now);
        draw();
        if (!failed) animationFrame = window.requestAnimationFrame(animate);
        return;
      }

      if (currentMode === 'idle') {
        actor.position.set(0, 0, 0);
        actor.rotation.set(0, 0, 0);
        setWalkingPose(0, 0, 0);
        if (rightArm) rightArm.rotation.set(0, 0, 0);
        const gestureActive = applyGuideGesture(now);
        draw();
        if (!failed && gestureActive) {
          animationFrame = window.requestAnimationFrame(animate);
        }
        return;
      }

      const walkDuration = 3.5;
      const progress = Math.min(elapsed / walkDuration, 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      const startX = -(fittedWidth / 2 + dimensions.x / 2);
      actor.position.set(startX * (1 - easedProgress), 0, 0);

      const stepPosition = easedProgress * 4;
      const stepIndex = Math.min(Math.floor(stepPosition), 3);
      const stepPhase = stepPosition - stepIndex;
      const isWalking = progress < 1;
      const activeFootSwing =
        isWalking && stepPhase < 0.62
          ? Math.sin((stepPhase / 0.62) * Math.PI)
          : 0;
      const phase = easedProgress * Math.PI * 4;
      actor.rotation.y =
        Math.PI * 0.3 * (1 - THREE.MathUtils.smoothstep(progress, 0.75, 1));
      actor.rotation.z = isWalking ? Math.sin(phase) * 0.018 : 0;
      actor.rotation.x = 0;
      if (rightArm) rightArm.rotation.set(0, 0, 0);
      const leftFootSwing = stepIndex % 2 === 0 ? activeFootSwing : 0;
      const rightFootSwing = stepIndex % 2 === 1 ? activeFootSwing : 0;
      setWalkingPose(
        leftFootSwing,
        rightFootSwing,
        isWalking ? Math.sin(phase) * 0.22 : 0,
      );
      const gestureActive = applyGuideGesture(now);
      draw();

      if (!failed && (progress < 1 || gestureActive)) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    const startMotion = (preserveCurrentPose = false) => {
      if (!actor || !dimensions || failed || disposed) return;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;

      if (!preserveCurrentPose) setStaticPose();
      if (reducedMotion) return;
      if (currentMode === 'idle') {
        if (activeGuideGesture) {
          animationFrame = window.requestAnimationFrame(animate);
        }
        return;
      }
      animationStartedAt = performance.now();
      if (!preserveCurrentPose) {
        actor.position.set(0, 0, 0);
        actor.rotation.set(0, 0, 0);
        if (currentMode === 'entrance') {
          actor.position.x = -(fittedWidth / 2 + dimensions.x / 2);
        }
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const capturePose = () => ({
      arm: rightArm
        ? rightArm.rotation.z * Math.sign(rightArm.position.x || 1)
        : 0,
      tilt: actor?.rotation.z ?? 0,
      nod: actor?.rotation.x ?? 0,
    });

    const setMode = (nextMode: SceneMode, nextPageTrigger?: number) => {
      const modeChanged = nextMode !== currentMode;
      const triggerChanged = nextPageTrigger !== currentPageTrigger;
      if (!modeChanged && !triggerChanged) return;

      if (triggerChanged) {
        if (
          reducedMotion ||
          currentMode === 'loading' ||
          nextMode === 'loading' ||
          !Number.isFinite(nextPageTrigger)
        ) {
          activeGuideGesture = null;
          appliedGuideGesture = { arm: 0, tilt: 0, nod: 0 };
        } else {
          let initialPose: GuideGesturePose;
          if (modeChanged) {
            const current = capturePose();
            const nextWaveArm = nextMode === 'wave' && rightArm ? 0.75 : 0;
            initialPose = {
              arm: current.arm - nextWaveArm,
              tilt: current.tilt,
              nod: current.nod,
            };
          } else {
            initialPose = activeGuideGesture
              ? appliedGuideGesture
              : { arm: 0, tilt: 0, nod: 0 };
          }
          activeGuideGesture = replaceGuideGesture(
            activeGuideGesture,
            nextPageTrigger as number,
            performance.now(),
            initialPose,
            false,
          );
          appliedGuideGesture = activeGuideGesture?.initialPose ?? {
            arm: 0,
            tilt: 0,
            nod: 0,
          };
        }
        currentPageTrigger = nextPageTrigger;
      } else if (modeChanged) {
        activeGuideGesture = null;
        appliedGuideGesture = { arm: 0, tilt: 0, nod: 0 };
      }

      currentMode = nextMode;
      if (modeChanged) {
        startMotion(triggerChanged && activeGuideGesture !== null);
      } else if (activeGuideGesture && !animationFrame) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };
    reconfigureRef.current = setMode;

    const resize = () => {
      if (!renderer) return;
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(bounds.width));
      const height = Math.max(1, Math.floor(bounds.height));
      const aspect = width / height;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);

      if (dimensions) {
        const diagonal = Math.max(
          Math.hypot(dimensions.x, dimensions.y),
          dimensions.z,
          0.1,
        );
        fittedHeight =
          currentMode === 'entrance'
            ? (diagonal * 1.32) / Math.min(aspect, 1)
            : Math.max(
                dimensions.y * 1.18,
                (Math.hypot(dimensions.x, dimensions.z) * 1.15) / aspect,
              );
        fittedWidth = fittedHeight * aspect;
        camera.left = -fittedWidth / 2;
        camera.right = fittedWidth / 2;
        camera.top = fittedHeight / 2;
        camera.bottom = -fittedHeight / 2;
        const distance = Math.max(10, diagonal * 4);
        camera.position.set(0, 0, distance);
        camera.near = 0.01;
        camera.far = distance + diagonal * 4;
      } else {
        camera.left = -aspect;
        camera.right = aspect;
        camera.top = 1;
        camera.bottom = -1;
      }

      camera.updateProjectionMatrix();
      draw();
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      activeGuideGesture = null;
      appliedGuideGesture = { arm: 0, tilt: 0, nod: 0 };
      startMotion();
    };

    const cleanup = () => {
      disposed = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      observer?.disconnect();
      if (resizeFallback) window.removeEventListener('resize', resize);
      mediaQuery.removeEventListener('change', onMotionPreferenceChange);
      if (renderer && contextLostListener) {
        renderer.domElement.removeEventListener(
          'webglcontextlost',
          contextLostListener,
        );
      }
      reconfigureRef.current = null;
      modelRequest.abort();
      manager?.abort();
      if (gltfResult) disposeGltf(gltfResult, actor);
      renderer?.renderLists.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      scene.clear();
      renderer = null;
    };

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.domElement.className = styles.canvas;
      renderer.domElement.setAttribute('aria-hidden', 'true');
      contextLostListener = (event: Event) => {
        event.preventDefault();
        fail('webgl');
      };
      renderer.domElement.addEventListener(
        'webglcontextlost',
        contextLostListener,
      );
      host.appendChild(renderer.domElement);
    } catch {
      fail('webgl');
      return cleanup;
    }

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c1ab, 2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(-3, 5, 8);
    scene.add(keyLight);

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(host);
    } else {
      resizeFallback = true;
      window.addEventListener('resize', resize);
    }
    mediaQuery.addEventListener('change', onMotionPreferenceChange);
    resize();

    manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    // FileLoader shares in-flight URL requests; one scene must not abort another.
    void fetch('/brand/tie-pig.glb', { signal: modelRequest.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Pig model request failed');
        const bytes = await response.arrayBuffer();
        return disposed ? null : loader.parseAsync(bytes, '/brand/');
      })
      .then((gltf) => {
        if (!gltf) return;
        if (disposed || failed) {
          disposeGltf(gltf);
          return;
        }

        gltfResult = gltf;
        try {
          const model = gltf.scene;
          const bounds = new THREE.Box3().setFromObject(model);
          if (bounds.isEmpty()) {
            fail('content');
            return;
          }

          dimensions = bounds.getSize(new THREE.Vector3());
          if (
            !Number.isFinite(dimensions.length()) ||
            dimensions.length() === 0
          ) {
            fail('content');
            return;
          }

          const center = bounds.getCenter(new THREE.Vector3());
          actor = new THREE.Group();
          model.position.sub(center);
          actor.add(model);
          scene.add(actor);
          actor.updateWorldMatrix(true, true);

          leftFoot = reparentAroundBounds(actor, model, 'Left foot_export');
          rightFoot = reparentAroundBounds(actor, model, 'Right foot_export');
          leftHand = reparentAroundBounds(actor, model, 'Left hand_export');
          rightHand = reparentAroundBounds(actor, model, 'Right hand_export');
          leftSleeve = reparentAroundBounds(actor, model, 'Left sleeve_export');
          rightSleeve = reparentAroundBounds(
            actor,
            model,
            'Right sleeve_export',
          );

          if (rightSleeve && rightHand) {
            rightArm = new THREE.Group();
            const sleeveBounds = new THREE.Box3().setFromObject(rightSleeve);
            const shoulder = sleeveBounds.getCenter(new THREE.Vector3());
            shoulder.x =
              rightSleeve.position.x < 0
                ? sleeveBounds.max.x
                : sleeveBounds.min.x;
            shoulder.y = sleeveBounds.max.y;
            actor.worldToLocal(shoulder);
            rightArm.position.copy(shoulder);
            rightArm.userData.restY = rightArm.position.y;
            actor.add(rightArm);
            rightArm.attach(rightSleeve);
            rightArm.attach(rightHand);
            rightSleeve.userData.restY = rightSleeve.position.y;
            rightHand.userData.restY = rightHand.position.y;
          }
          if (activeGuideGesture && !reducedMotion) {
            const current = capturePose();
            const waveArm = currentMode === 'wave' && rightArm ? 0.75 : 0;
            activeGuideGesture = replaceGuideGesture(
              activeGuideGesture,
              activeGuideGesture.pageIndex,
              performance.now(),
              {
                arm: current.arm - waveArm,
                tilt: current.tilt,
                nod: current.nod,
              },
              false,
            );
            appliedGuideGesture = activeGuideGesture?.initialPose ?? {
              arm: 0,
              tilt: 0,
              nod: 0,
            };
          }
          resize();
          setError(null);
          setStatus('돼지 캐릭터가 준비됐어요.');
          startMotion();
        } catch {
          fail('content');
        }
      })
      .catch(() => fail('model'));

    return cleanup;
  }, []);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-mode={mode}
      aria-busy={
        error ? undefined : status === '돼지 캐릭터를 불러오고 있어요.'
      }
    >
      <div ref={hostRef} className={styles.viewport} aria-hidden="true" />
      <p
        className={error ? styles.error : styles.status}
        role={error ? 'alert' : 'status'}
        aria-live={error ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {error ?? status}
      </p>
    </div>
  );
}
