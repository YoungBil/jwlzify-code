/**
 * JWLZIFY AR Try-On Pipeline — feature/ar-tryon-v2
 * Three.js PBR + MediaPipe Pose + fal.ai Hunyuan3D
 */

import * as THREE from 'three';
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader }  from 'three/addons/loaders/RGBELoader.js';

// ── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  FAL_KEY:                    '9284ccc4-a0ff-48dc-ad1f-83bf22a7a6cd:040197e513fab8b9333f46bd5bd19f16',
  DEFAULT_PENDANT_SIZE_INCHES: 1.5,
  LERP_FACTOR:                 0.12,
  SHADOW_MAP_SIZE:             2048,
  ENV_MAP_INTENSITY:           1.4,
};

// ── Runtime state ────────────────────────────────────────────────────────────
const AR = {
  renderer:       null,
  scene:          null,
  camera:         null,
  pendantGroup:   null,
  mpPose:         null,
  rafId:          null,
  frameCount:     0,
  poseRunning:    false,
  chestAnchor:    { x: 0, y: 0 },
  shoulderWidthPx: 200,
  active:         false,
  camW:           0,
  camH:           0,
};

// ── fal.ai lazy import ───────────────────────────────────────────────────────
let _fal = null;
async function getFal() {
  if (_fal) return _fal;
  const mod = await import('https://cdn.jsdelivr.net/npm/@fal-ai/client/+esm');
  _fal = mod.fal;
  _fal.config({ credentials: CONFIG.FAL_KEY });
  return _fal;
}

// ── Utilities ────────────────────────────────────────────────────────────────
function setArDetail(text) {
  const el = document.getElementById('arLoadingDetail');
  if (el) el.textContent = text;
}

async function srcToFile(src) {
  const res  = await fetch(src);
  const blob = await res.blob();
  return new File([blob], 'pendant.png', { type: blob.type || 'image/png' });
}

function parseSizeInches() {
  const area  = document.getElementById('promptArea');
  const text  = area ? area.value : '';
  const match = text.match(/(\d+(\.\d+)?)\s*(inch|in|")/i);
  return match ? parseFloat(match[1]) : CONFIG.DEFAULT_PENDANT_SIZE_INCHES;
}

// ── Image-to-3D via fal.ai Hunyuan3D ────────────────────────────────────────
async function convertTo3D(imageFile) {
  const fal = await getFal();

  setArDetail('UPLOADING TO FAL.AI…');
  const uploadedUrl = await fal.storage.upload(imageFile);

  setArDetail('RUNNING HUNYUAN3D…');
  const result = await fal.subscribe('fal-ai/hunyuan3d-v2', {
    input:  { image_url: uploadedUrl },
    logs:   true,
    onQueueUpdate(update) {
      if (update.status === 'IN_PROGRESS' && update.logs?.length) {
        const last = update.logs[update.logs.length - 1].message;
        setArDetail(last.slice(0, 60).toUpperCase());
      }
    },
  });

  const meshUrl = result?.data?.model_mesh?.url;
  if (!meshUrl) throw new Error('Hunyuan3D returned no mesh URL');

  setArDetail('DOWNLOADING MESH…');
  const glbRes = await fetch(meshUrl);
  return glbRes.arrayBuffer();
}

// ── Three.js renderer + scene ────────────────────────────────────────────────
function buildRenderer(camWrap) {
  const W = camWrap.clientWidth;
  const H = camWrap.clientHeight;
  AR.camW = W;
  AR.camH = H;

  const renderer = new THREE.WebGLRenderer({
    alpha: true, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.shadowMap.enabled  = true;
  renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace   = THREE.SRGBColorSpace;
  renderer.toneMapping        = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const canvas = renderer.domElement;
  canvas.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
  camWrap.appendChild(canvas);

  // OrthographicCamera: 1 world unit = 1 screen pixel
  const cam = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, 0.1, 2000);
  cam.position.z = 500;

  const scene = new THREE.Scene();
  scene.background = null;

  // Key light
  const keyLight = new THREE.DirectionalLight(0xfff8e8, 1.2);
  keyLight.position.set(5, 10, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(CONFIG.SHADOW_MAP_SIZE, CONFIG.SHADOW_MAP_SIZE);
  scene.add(keyLight);

  // Fill / ambient
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Shadow-catcher plane (invisible, receives shadows on virtual skin surface)
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.ShadowMaterial({ opacity: 0.28 }),
  );
  shadowCatcher.name = 'shadowCatcher';
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -60;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  return { renderer, scene, camera: cam };
}

// ── HDR environment map ──────────────────────────────────────────────────────
function loadEnvMap(scene) {
  return new Promise((resolve) => {
    new RGBELoader().load(
      'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/royal_esplanade_1k.hdr',
      (tex) => {
        tex.mapping  = THREE.EquirectangularReflectionMapping;
        scene.environment = tex;
        resolve(tex);
      },
      undefined,
      () => resolve(null), // non-fatal — scene already has lights
    );
  });
}

// ── GLB loader ───────────────────────────────────────────────────────────────
function loadGLB(arrayBuffer, scene) {
  return new Promise((resolve, reject) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(
      'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/',
    );

    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.parse(arrayBuffer, '', (gltf) => {
      const group = gltf.scene;
      group.traverse((child) => {
        if (!child.isMesh) return;
        child.material = new THREE.MeshStandardMaterial({
          color:           new THREE.Color(0xc8a84b),
          metalness:       0.95,
          roughness:       0.15,
          envMapIntensity: CONFIG.ENV_MAP_INTENSITY,
        });
        child.castShadow    = true;
        child.receiveShadow = true;
      });
      scene.add(group);
      resolve(group);
    }, reject);
  });
}

// ── MediaPipe Pose ───────────────────────────────────────────────────────────
function buildPose(onResults) {
  if (!window.Pose) {
    throw new Error('MediaPipe Pose not loaded — check CDN script in <head>');
  }
  const pose = new window.Pose({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
  });
  pose.setOptions({
    modelComplexity:        1,
    smoothLandmarks:        true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence:  0.6,
  });
  pose.onResults(onResults);
  return pose;
}

// ── Landmark processing ──────────────────────────────────────────────────────
function processLandmarks(landmarks) {
  if (!landmarks || landmarks.length < 13) return;

  const W = AR.camW;
  const H = AR.camH;

  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];

  // Mirror X — video is CSS scaleX(-1) but MediaPipe sees unmirrored data
  const lPx = { x: (1 - lShoulder.x) * W, y: lShoulder.y * H };
  const rPx = { x: (1 - rShoulder.x) * W, y: rShoulder.y * H };

  const midX = (lPx.x + rPx.x) / 2;
  const midY = (lPx.y + rPx.y) / 2;

  const shoulderWidthPx = Math.hypot(rPx.x - lPx.x, rPx.y - lPx.y);
  const hangOffsetY     = shoulderWidthPx * 0.18;

  const target = { x: midX, y: midY + hangOffsetY };
  const a      = CONFIG.LERP_FACTOR;

  // EMA smoothing
  AR.chestAnchor    = {
    x: AR.chestAnchor.x + (target.x - AR.chestAnchor.x) * a,
    y: AR.chestAnchor.y + (target.y - AR.chestAnchor.y) * a,
  };
  AR.shoulderWidthPx = shoulderWidthPx;
}

// ── Per-frame pendant transform ──────────────────────────────────────────────
function updatePendantTransform() {
  if (!AR.pendantGroup) return;

  const W = AR.camW;
  const H = AR.camH;

  // Pixel → orthographic world space (Y flipped: CSS y-down, Three.js y-up)
  const worldX =  AR.chestAnchor.x - W / 2;
  const worldY = -(AR.chestAnchor.y - H / 2);

  AR.pendantGroup.position.set(worldX, worldY, 0);

  // Sizing: scaleFactor maps real-world inches to screen pixels
  const calibration = 0.18;
  const sizeInches  = parseSizeInches();
  const scale       = (sizeInches * 96) / AR.shoulderWidthPx * calibration;
  AR.pendantGroup.scale.setScalar(scale);

  // Shadow catcher follows pendant
  const sc = AR.scene?.getObjectByName('shadowCatcher');
  if (sc) sc.position.y = worldY - 40;

  // Idle physics swing
  AR.pendantGroup.rotation.z = Math.sin(Date.now() * 0.001) * 0.04;
}

// ── Render loop ──────────────────────────────────────────────────────────────
function startLoop() {
  const video = document.getElementById('camVideo');

  function frame() {
    AR.rafId = requestAnimationFrame(frame);
    AR.frameCount++;

    // Pose estimation every 2nd frame (non-blocking)
    if (AR.frameCount % 2 === 0 && AR.mpPose && !AR.poseRunning &&
        video.readyState >= 2) {
      AR.poseRunning = true;
      AR.mpPose.send({ image: video })
        .finally(() => { AR.poseRunning = false; });
    }

    updatePendantTransform();
    AR.renderer.render(AR.scene, AR.camera);
  }

  frame();
}

// ── Public: init ─────────────────────────────────────────────────────────────
async function initARPipeline() {
  if (window.LAB?.type !== 'pendant') return;
  AR.active = true;

  const camWrap  = document.getElementById('camWrap');
  const arLoad   = document.getElementById('arLoading');

  arLoad?.classList.remove('hidden');
  setArDetail('STARTING CAMERA…');

  try {
    // 1. Camera
    await window.startCamera();

    // 2. Get pendant image src
    setArDetail('READING PENDANT IMAGE…');
    const pendantImg = document.querySelector("img[alt='Your AI jewelry design']");
    if (!pendantImg?.src || pendantImg.src === window.location.href) {
      throw new Error('No pendant image rendered yet');
    }
    const imageFile = await srcToFile(pendantImg.src);

    // 3. fal.ai → GLB
    const glbBuffer = await convertTo3D(imageFile);

    // 4. Three.js scene
    setArDetail('BUILDING 3D SCENE…');
    const { renderer, scene, camera } = buildRenderer(camWrap);
    AR.renderer = renderer;
    AR.scene    = scene;
    AR.camera   = camera;

    // 5. Env map + GLB (parallel)
    const [, pendantGroup] = await Promise.all([
      loadEnvMap(scene),
      loadGLB(glbBuffer, scene),
    ]);
    AR.pendantGroup = pendantGroup;

    // 6. MediaPipe Pose
    setArDetail('LOADING POSE MODEL…');
    AR.mpPose = buildPose(({ poseLandmarks }) => {
      if (AR.active) processLandmarks(poseLandmarks);
    });
    // Warm-up send so WASM is compiled before first frame
    const video = document.getElementById('camVideo');
    if (video.readyState >= 2) await AR.mpPose.send({ image: video });

    // 7. Hide overlay, show guides
    arLoad?.classList.add('hidden');
    setArDetail('');

    document.getElementById('guideText').textContent    = 'CENTER YOUR CHEST IN FRAME';
    document.getElementById('jewBadgeText').textContent = 'PENDANT · 3D AR';
    ['camGuide', 'jewBadge', 'camHint'].forEach(id =>
      document.getElementById(id)?.classList.remove('hidden'));

    // 8. Render loop
    startLoop();

  } catch (err) {
    console.warn('[AR] Pipeline failed — falling back to 2D overlay:', err);
    arLoad?.classList.add('hidden');
    AR.active = false;
    // 2D fallback
    window.activateTryOnOverlay?.(window.LAB?.type, window.LAB?.imageUrl);
    const g = document.getElementById('guideText');
    if (g) g.textContent = 'CENTER YOUR CHEST IN FRAME';
    ['camGuide', 'jewBadge', 'camHint'].forEach(id =>
      document.getElementById(id)?.classList.remove('hidden'));
  }
}

// ── Public: teardown ─────────────────────────────────────────────────────────
async function teardownARPipeline() {
  AR.active = false;

  if (AR.rafId) { cancelAnimationFrame(AR.rafId); AR.rafId = null; }

  if (AR.mpPose) {
    try { await AR.mpPose.close(); } catch { /* ignore */ }
    AR.mpPose = null;
  }

  if (AR.renderer) {
    const canvas = AR.renderer.domElement;
    canvas.parentNode?.removeChild(canvas);
    AR.renderer.dispose();
    AR.renderer = null;
  }

  AR.scene        = null;
  AR.camera       = null;
  AR.pendantGroup = null;
  AR.frameCount   = 0;
  AR.poseRunning  = false;
  AR.chestAnchor  = { x: 0, y: 0 };

  document.getElementById('arLoading')?.classList.add('hidden');
}

// ── Expose to classic scripts ────────────────────────────────────────────────
window.initARPipeline    = initARPipeline;
window.teardownARPipeline = teardownARPipeline;
