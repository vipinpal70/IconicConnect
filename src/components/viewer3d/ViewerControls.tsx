'use client';

import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { useFrame, useThree } from '@react-three/fiber';
import type { ModelFrame } from './ModelMesh';

export type CameraView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'reset';

export interface ViewerControlsHandle {
  setView: (view: CameraView) => void;
}

interface ViewerControlsProps {
  frame: ModelFrame | null;
  /** Orbit/select mode: left-drag rotates. Drawing tools keep the left button and rotate with right-drag. */
  leftButtonRotates: boolean;
  /** Camera started / stopped moving (labels hide and resolution drops while it moves). */
  onMotionChange?: (moving: boolean) => void;
  /** The user started a drag or scroll (presets and automatic framing don't count). */
  onUserInteraction?: () => void;
  apiRef?: React.Ref<ViewerControlsHandle>;
}

/** Highest resolution used at rest; while moving the canvas renders at 1× for smooth rotation. */
const RESTING_MAX_DPR = 1.5;
/** How long after the last camera change the view counts as "at rest". */
const SETTLE_MS = 180;
const DISTANCE_FACTOR = 2.2;

const NAVIGATE_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const DRAWING_BUTTONS = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

/** Clear TrackballControls' inertia so a preset view does not keep drifting. */
function stopMomentum(controls: TrackballControls) {
  const internals = controls as unknown as {
    _lastAngle: number;
    _lastRollAngle: number;
    _zoomStart: THREE.Vector2;
    _zoomEnd: THREE.Vector2;
    _panStart: THREE.Vector2;
    _panEnd: THREE.Vector2;
  };
  internals._lastAngle = 0;
  internals._lastRollAngle = 0;
  internals._zoomStart?.copy(internals._zoomEnd);
  internals._panStart?.copy(internals._panEnd);
}

function viewBasis(frame: ModelFrame) {
  const up = new THREE.Vector3(...frame.up).normalize();
  // Presets keep the original Y-up convention (front = +Z), rotated onto the model's up axis
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up));
  const right = new THREE.Vector3().crossVectors(up, front);
  return { up, front, right };
}

/**
 * Free 360° camera: trackball rotation (no pole limits, the model can be turned over completely),
 * right-drag pan, wheel / middle-drag zoom. Renders on demand: frames are only drawn while the camera
 * moves or damping settles.
 */
/** Point the camera at a preset view around the model (mutates the camera and controls). */
function placeCamera(camera: THREE.Camera, controls: TrackballControls, frame: ModelFrame, view: CameraView) {
  const { up, front, right } = viewBasis(frame);
  const center = new THREE.Vector3(frame.center.x, frame.center.y, frame.center.z);
  const tilt = up.clone().multiplyScalar(0.15);
  let direction: THREE.Vector3;
  let cameraUp = up;
  switch (view) {
    case 'top':
      direction = up.clone();
      cameraUp = front.clone().negate();
      break;
    case 'bottom':
      direction = up.clone().negate();
      cameraUp = front.clone();
      break;
    case 'front':
      direction = front.clone().add(tilt);
      break;
    case 'back':
      direction = front.clone().negate().add(tilt);
      break;
    case 'left':
      direction = right.clone().negate().add(tilt);
      break;
    case 'right':
      direction = right.clone().add(tilt);
      break;
    case 'reset':
    default:
      direction = right.clone().multiplyScalar(0.16).addScaledVector(up, 0.38).add(front);
      break;
  }
  const distance = Math.max(frame.radius * DISTANCE_FACTOR, 2);
  stopMomentum(controls);
  controls.target.copy(center);
  camera.up.copy(cameraUp);
  camera.position.copy(center).addScaledVector(direction.normalize(), distance);
  camera.lookAt(center);
  controls.update();
}

/** Zoom limits and clipping planes sized to the model (mutates the camera and controls). */
function fitLimits(camera: THREE.PerspectiveCamera, controls: TrackballControls, frame: ModelFrame) {
  controls.minDistance = Math.max(frame.radius * 0.08, 0.2);
  controls.maxDistance = Math.max(frame.radius * 12, 100);
  camera.near = Math.max(0.05, frame.radius / 400);
  camera.far = Math.max(2000, frame.radius * 60);
  camera.updateProjectionMatrix();
}

export function ViewerControls({ frame, leftButtonRotates, onMotionChange, onUserInteraction, apiRef }: ViewerControlsProps) {
  const get = useThree((s) => s.get);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const setDpr = useThree((s) => s.setDpr);

  const controlsRef = useRef<TrackballControls | null>(null);
  const frameRef = useRef<ModelFrame | null>(null);
  const leftRotatesRef = useRef(leftButtonRotates);
  const interactingRef = useRef(false);
  const movingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMotionChangeRef = useRef(onMotionChange);
  const onUserInteractionRef = useRef(onUserInteraction);

  useEffect(() => {
    onMotionChangeRef.current = onMotionChange;
    onUserInteractionRef.current = onUserInteraction;
  }, [onMotionChange, onUserInteraction]);

  // Create / dispose the controls
  useEffect(() => {
    const controls = new TrackballControls(camera, gl.domElement);
    controls.rotateSpeed = 2.4;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.6;
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.15;
    // Its default A/S/D hold-to-rotate keys clash with the markup tool shortcuts
    controls.keys = ['', '', ''];
    controls.mouseButtons = leftRotatesRef.current ? NAVIGATE_BUTTONS : DRAWING_BUTTONS;
    controls.handleResize();
    controlsRef.current = controls;

    const restingDpr = Math.min(window.devicePixelRatio || 1, RESTING_MAX_DPR);
    const setMoving = (moving: boolean) => {
      if (movingRef.current === moving) return;
      movingRef.current = moving;
      setDpr(moving ? Math.min(restingDpr, 1) : restingDpr);
      onMotionChangeRef.current?.(moving);
    };
    const scheduleSettle = () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        if (!interactingRef.current) setMoving(false);
      }, SETTLE_MS);
    };
    const onStart = () => {
      interactingRef.current = true;
      onUserInteractionRef.current?.();
      invalidate();
    };
    const onChange = () => {
      setMoving(true);
      scheduleSettle();
      invalidate();
    };
    const onEnd = () => {
      interactingRef.current = false;
      scheduleSettle();
      invalidate();
    };
    // Before the controls' own pointerdown: page layout may have moved the canvas, and a single
    // touch must draw (not rotate) while a drawing tool is active
    const onPointerDownCapture = (event: PointerEvent) => {
      controls.handleResize();
      controls.noRotate = !leftRotatesRef.current && event.pointerType === 'touch' && event.isPrimary;
    };

    controls.addEventListener('start', onStart);
    controls.addEventListener('change', onChange);
    controls.addEventListener('end', onEnd);
    gl.domElement.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('end', onEnd);
      gl.domElement.removeEventListener('pointerdown', onPointerDownCapture, true);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate, setDpr]);

  useEffect(() => {
    leftRotatesRef.current = leftButtonRotates;
    if (controlsRef.current) controlsRef.current.mouseButtons = leftButtonRotates ? NAVIGATE_BUTTONS : DRAWING_BUTTONS;
  }, [leftButtonRotates]);

  useEffect(() => {
    controlsRef.current?.handleResize();
  }, [size]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.update();
    // Keep frames coming while a button is held; damping keeps them coming via 'change' after release
    if (interactingRef.current) invalidate();
  }, -1);

  const applyView = useCallback(
    (view: CameraView) => {
      const controls = controlsRef.current;
      if (!controls || !frameRef.current) return;
      placeCamera(get().camera, controls, frameRef.current, view);
      invalidate();
    },
    [get, invalidate],
  );

  useImperativeHandle(apiRef, () => ({ setView: applyView }), [applyView]);

  // Frame a newly loaded model; on visibility changes only adjust the zoom limits
  useEffect(() => {
    const controls = controlsRef.current;
    const previousKey = frameRef.current?.key ?? null;
    frameRef.current = frame;
    if (!controls || !frame) return;
    fitLimits(get().camera as THREE.PerspectiveCamera, controls, frame);
    if (previousKey !== frame.key) applyView('reset');
    invalidate();
  }, [frame, get, applyView, invalidate]);

  return null;
}
