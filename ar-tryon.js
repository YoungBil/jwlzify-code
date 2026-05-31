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
  renderer.shadowMap.enabled  = false;
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
  scene.add(keyLight);

  // Fill / ambient
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

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

      // ── 1. Collect all meshes with world-space bounding boxes ────────────
      // Force world matrix update so Box3.setFromObject is accurate per-mesh
      group.updateMatrixWorld(true);

      const meshes = [];
      group.traverse((child) => {
        if (!child.isMesh) return;
        const bb = new THREE.Box3().setFromObject(child);
        const sz = new THREE.Vector3();
        bb.getSize(sz);
        const volume = sz.x * sz.y * sz.z;
        meshes.push({ mesh: child, sz, volume });
      });

      console.log('[AR] GLB meshes found:', meshes.length);
      meshes.forEach(({ mesh, sz, volume }) => {
        console.log(`  mesh="${mesh.name || '(unnamed)'}" vol=${volume.toFixed(4)} sz=${sz.x.toFixed(3)}x${sz.y.toFixed(3)}x${sz.z.toFixed(3)}`);
      });

      const toRemove = new Set();

      if (meshes.length > 1) {
        // ── 2. Sort by volume ascending, find the largest ──────────────────
        const sorted = [...meshes].sort((a, b) => a.volume - b.volume);
        const maxVol = sorted[sorted.length - 1].volume;

        // ── 3. Volume + flatness filter ────────────────────────────────────
        // Keep a mesh only if BOTH:
        //   a) its volume is < 30% of the largest mesh's volume, OR it IS the largest
        //   b) it is not flat: height >= 20% of width
        for (const { mesh, sz, volume } of meshes) {
          const volRatio    = maxVol > 0 ? volume / maxVol : 1;
          const maxHoriz    = Math.max(sz.x, sz.z);
          const isFlat      = maxHoriz > 0 && sz.y / maxHoriz < 0.20;
          const isTooLarge  = volRatio >= 0.30 && volume !== maxVol;

          if (isFlat || isTooLarge) {
            toRemove.add(mesh);
          }
        }

        // ── 4. Fallback: if volume filter removed everything, use name filter
        const survivors = meshes.filter(({ mesh }) => !toRemove.has(mesh));
        if (survivors.length === 0) {
          console.warn('[AR] Volume filter removed all meshes — falling back to name filter');
          toRemove.clear();
          const BAD_NAMES = /base|box|plane|floor|ground|background|platform/i;
          for (const { mesh } of meshes) {
            if (BAD_NAMES.test(mesh.name)) toRemove.add(mesh);
          }
        }
      }

      // ── 5. Execute removal ────────────────────────────────────────────────
      for (const { mesh } of meshes) {
        if (toRemove.has(mesh)) {
          console.log(`[AR] REMOVED mesh="${mesh.name || '(unnamed)'}"`);
          mesh.parent?.remove(mesh);
        } else {
          console.log(`[AR] KEPT   mesh="${mesh.name || '(unnamed)'}"`);
        }
      }

      // ── 6. Apply gold PBR material to surviving meshes ───────────────────
      group.traverse((child) => {
        if (!child.isMesh) return;
        child.material = new THREE.MeshStandardMaterial({
          color:           new THREE.Color(0xc8a84b),
          metalness:       0.95,
          roughness:       0.15,
          envMapIntensity: CONFIG.ENV_MAP_INTENSITY,
        });
      });

      // ── 7. Re-center remaining geometry at world origin ───────────────────
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        group.position.sub(center);
      }

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
  // Camera is already running — setupTryOn started it before calling us.
  AR.active = true;

  const camWrap = document.getElementById('camWrap');
  const arLoad  = document.getElementById('arLoading');

  arLoad?.classList.remove('hidden');

  try {
    // 1. Resolve generated pendant image from the AI design step
    setArDetail('READING PENDANT IMAGE…');
    const pendantImg = document.querySelector("img[alt='Your AI jewelry design']");
    const imageSrc   = pendantImg?.src && pendantImg.src !== window.location.href
      ? pendantImg.src
      : null;

    if (!imageSrc) throw new Error('No generated pendant image found');

    const imageFile = await srcToFile(imageSrc);

    // 2. fal.ai → GLB
    const glbBuffer = await convertTo3D(imageFile);

    // 3. Three.js scene
    setArDetail('BUILDING 3D SCENE…');
    const { renderer, scene, camera } = buildRenderer(camWrap);
    AR.renderer = renderer;
    AR.scene    = scene;
    AR.camera   = camera;

    // 4. Env map + GLB (parallel)
    const [, pendantGroup] = await Promise.all([
      loadEnvMap(scene),
      loadGLB(glbBuffer, scene),
    ]);
    AR.pendantGroup = pendantGroup;

    // 5. MediaPipe Pose (camera already streaming)
    setArDetail('LOADING POSE MODEL…');
    AR.mpPose = buildPose(({ poseLandmarks }) => {
      if (AR.active) processLandmarks(poseLandmarks);
    });
    const video = document.getElementById('camVideo');
    if (video.readyState >= 2) await AR.mpPose.send({ image: video });

    // 6. Hide loading overlay, update badge to 3D AR
    arLoad?.classList.add('hidden');
    setArDetail('');
    document.getElementById('jewBadgeText').textContent = 'PENDANT · 3D AR';

    // 7. Render loop
    startLoop();

  } catch (err) {
    // 2D overlay is already visible (set by setupTryOn) — just log and hide spinner
    console.warn('[AR] 3D pipeline failed, 2D overlay remains:', err);
    arLoad?.classList.add('hidden');
    AR.active = false;
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
window.initARPipeline     = initARPipeline;
window.teardownARPipeline = teardownARPipeline;
