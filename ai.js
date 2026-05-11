// ═══════════════════════════════════════════
//  XALQ KAMERA — AI Core (ai.js)
// ═══════════════════════════════════════════

// ── State ──
const CAM = {
  models: { coco: null, face: null, pose: null },
  modelsLoaded: false,
  stream: null,
  active: false,
  analyzing: false,
  loop: null,
  lastFrameTime: 0,
  fps: 0,
  startTime: null,

  // Sozlamalar
  settings: {
    person: true,
    suspicious: true,
    fall: true,
    zone: true,
    cover: true,
    crowd: true,
    night: false,
    sound: true,
  },
  sensitivity: 7,
  zoneColor: '#ff3b5c',

  // Zonalar
  zones: [],
  drawingZone: false,
  zoneStart: null,

  // Hikvision kameralar
  hikCameras: [],

  // Statistika
  stats: {
    totalPeople: 0,
    totalAlerts: 0,
    suspicious: 0,
    safeMinutes: 0,
    hourly: new Array(24).fill(0),
    objects: {},
    events: [],
  },

  // Alert boshqaruv
  alerts: [],
  alertCount: 0,
  lastAlertTime: {},   // har xil alert uchun throttle
  dangerTimeout: null,
};

// ── Vaqt formati ──
function fmtTime(d = new Date()) {
  return d.toTimeString().slice(0, 8);
}
function fmtDate(d = new Date()) {
  return d.toLocaleDateString('uz-UZ') + ' ' + fmtTime(d);
}

// ── Tab almashtirish ──
function showTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'stats') renderStats();
}

// ═══════════════════════════════════════════
//  SPLASH — AI MODELLARNI YUKLASH
// ═══════════════════════════════════════════
async function loadModels() {
  const progress = document.getElementById('splash-progress');
  const status = document.getElementById('splash-status');

  try {
    // 1. COCO-SSD (odam, ob'ekt aniqlash)
    status.textContent = 'COCO-SSD modeli yuklanmoqda...';
    progress.style.width = '10%';
    CAM.models.coco = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    progress.style.width = '50%';

    // 2. BlazeFace (yuz aniqlash)
    status.textContent = 'Yuz aniqlash modeli yuklanmoqda...';
    CAM.models.face = await blazeface.load();
    progress.style.width = '80%';

    // 3. PoseDetection (harakat tahlili)
    status.textContent = 'Harakat tahlil modeli yuklanmoqda...';
    CAM.models.pose = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    progress.style.width = '100%';
    status.textContent = '✅ Barcha modellar tayyor!';
    CAM.modelsLoaded = true;

    await new Promise(r => setTimeout(r, 600));
    hideSplash();
  } catch (err) {
    // Model yuklanmasa ham davom etamiz (ba'zi modellar ishlamasa)
    console.warn('Model xatosi:', err);
    status.textContent = '⚠️ Qisman yuklandi — davom etilmoqda...';
    progress.style.width = '100%';
    CAM.modelsLoaded = true;
    await new Promise(r => setTimeout(r, 1000));
    hideSplash();
  }
}

function hideSplash() {
  const splash = document.getElementById('splash');
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initApp();
  }, 500);
}

// ═══════════════════════════════════════════
//  ILOVANI ISHGA TUSHIRISH
// ═══════════════════════════════════════════
function initApp() {
  // Saqlangan ma'lumotlarni yuklash
  loadSavedData();
  // Vaqt yangilash
  setInterval(updateClock, 1000);
  updateClock();
  // Soatlik statistika
  setInterval(() => {
    const h = new Date().getHours();
    if (CAM.active) CAM.stats.hourly[h]++;
    if (CAM.active) CAM.stats.safeMinutes++;
  }, 60000);
  // AI model ma'lumoti
  document.getElementById('info-model').textContent = 'COCO-SSD + BlazeFace + MoveNet';
  // Hikvisyon ro'yxatini ko'rsatish
  renderHikList();
}

function updateClock() {
  const now = new Date();
  document.getElementById('time-badge').textContent = fmtTime(now);
  if (CAM.startTime) {
    const elapsed = Math.floor((Date.now() - CAM.startTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('info-uptime').textContent = `${h}:${m}:${s}`;
  }
}

function loadSavedData() {
  try {
    const saved = localStorage.getItem('xk_data');
    if (saved) {
      const d = JSON.parse(saved);
      if (d.hikCameras) CAM.hikCameras = d.hikCameras;
      if (d.zones) CAM.zones = d.zones;
      if (d.settings) CAM.settings = { ...CAM.settings, ...d.settings };
      if (d.sensitivity) CAM.sensitivity = d.sensitivity;
      if (d.zoneColor) CAM.zoneColor = d.zoneColor;
      if (d.stats) CAM.stats = { ...CAM.stats, ...d.stats };
      if (d.alerts) CAM.alerts = d.alerts;
    }
    applySettings();
    renderAlerts();
    updateBellCount();
    document.getElementById('hik-count').textContent = CAM.hikCameras.length + '/50';
    document.getElementById('info-cams').textContent = CAM.hikCameras.length + 1;
    document.getElementById('sensitivity-slider').value = CAM.sensitivity;
    document.getElementById('sensitivity-val').textContent = CAM.sensitivity + ' / 10';
  } catch (e) {}
}

function saveData() {
  try {
    localStorage.setItem('xk_data', JSON.stringify({
      hikCameras: CAM.hikCameras,
      zones: CAM.zones,
      settings: CAM.settings,
      sensitivity: CAM.sensitivity,
      zoneColor: CAM.zoneColor,
      stats: CAM.stats,
      alerts: CAM.alerts.slice(0, 100),
    }));
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  TELEFON KAMERASI
// ═══════════════════════════════════════════
async function startPhoneCamera() {
  try {
    const facing = document.getElementById('camera-select')?.value || 'environment';
    if (CAM.stream) {
      CAM.stream.getTracks().forEach(t => t.stop());
    }
    CAM.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    const video = document.getElementById('main-video');
    video.srcObject = CAM.stream;
    await video.play();

    // UI yangilash
    document.getElementById('no-cam').style.display = 'none';
    document.getElementById('phone-cam-status').textContent = '🟢 Faol';
    document.getElementById('phone-cam-status').classList.add('on');
    document.getElementById('phone-cam-toggle').textContent = '⏹';
    document.getElementById('phone-cam-toggle').classList.add('on');
    document.getElementById('active-cam-name').textContent = 'Telefon Kamerasi';
    document.getElementById('ai-status-dot').className = 'status-dot online';
    document.getElementById('rec-badge').style.display = 'block';

    CAM.active = true;
    CAM.startTime = Date.now();
    if (!CAM.loop) startAnalysisLoop();

    addLiveAlert('success', '📱 Telefon kamerasi yoqildi', 'info');
  } catch (err) {
    addLiveAlert('❌ Kamera xatosi: ' + err.message, 'danger');
  }
}

function stopPhoneCamera() {
  if (CAM.stream) {
    CAM.stream.getTracks().forEach(t => t.stop());
    CAM.stream = null;
  }
  const video = document.getElementById('main-video');
  video.srcObject = null;
  document.getElementById('no-cam').style.display = 'flex';
  document.getElementById('phone-cam-status').textContent = 'O\'chirilgan';
  document.getElementById('phone-cam-status').classList.remove('on');
  document.getElementById('phone-cam-toggle').textContent = '▶';
  document.getElementById('phone-cam-toggle').classList.remove('on');
  document.getElementById('active-cam-name').textContent = 'Kamera tanlanmagan';
  document.getElementById('ai-status-dot').className = 'status-dot';
  CAM.active = false;
  if (CAM.loop) { clearInterval(CAM.loop); CAM.loop = null; }
  addLiveAlert('⏹ Kamera o\'chirildi', 'info');
}

function togglePhoneCamera() {
  if (CAM.active) stopPhoneCamera();
  else startPhoneCamera();
}

async function switchCamera(facing) {
  if (CAM.active) await startPhoneCamera();
}

// ═══════════════════════════════════════════
//  AI TAHLIL SIKLI (AQLLI)
// ═══════════════════════════════════════════
function startAnalysisLoop() {
  let motionDetected = false;
  let frameCount = 0;
  let lastFpsTime = Date.now();
  let prevPixels = null;

  CAM.loop = setInterval(async () => {
    if (!CAM.active || CAM.analyzing) return;
    const video = document.getElementById('main-video');
    if (video.readyState < 2) return;

    // FPS hisoblash
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime > 1000) {
      CAM.fps = frameCount;
      frameCount = 0;
      lastFpsTime = now;
      document.getElementById('fps-badge').textContent = CAM.fps + ' FPS';
      document.getElementById('info-fps').textContent = CAM.fps + ' FPS';
    }

    // Harakat aniqlash (canvas pixel taqqoslash)
    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    motionDetected = detectMotion(imageData.data, prevPixels, canvas.width, canvas.height);
    prevPixels = imageData.data.slice();

    // Kamera yopish tekshirish (ko'p yorug'lik o'zgarishi)
    if (CAM.settings.cover) checkCameraCover(imageData.data);

    // Harakat bo'lsa — har 1 sekund tahlil
    // Harakat yo'q bo'lsa — har 3 sekund tahlil
    const interval = motionDetected ? 1000 : 3000;
    if (now - CAM.lastFrameTime < interval) return;
    CAM.lastFrameTime = now;

    // AI tahlil
    CAM.analyzing = true;
    try {
      await analyzeFrame(video, canvas, ctx, motionDetected);
    } catch (e) {}
    CAM.analyzing = false;

  }, 200); // 200ms = asosiy sikl
}

// ── Harakat aniqlash ──
function detectMotion(current, prev, w, h) {
  if (!prev) return false;
  let diff = 0;
  const step = 4 * 10; // har 10-piksel
  for (let i = 0; i < current.length; i += step) {
    diff += Math.abs(current[i] - prev[i]);
    diff += Math.abs(current[i + 1] - prev[i + 1]);
    diff += Math.abs(current[i + 2] - prev[i + 2]);
  }
  const avg = diff / (current.length / step / 3);
  return avg > (10 - CAM.sensitivity); // sezgirlikka qarab
}

// ── Kamera yopish aniqlash ──
function checkCameraCover(pixels) {
  // Agar barcha piksellar juda qorong'i yoki bir xil bo'lsa
  let sum = 0;
  const step = 4 * 50;
  let count = 0;
  for (let i = 0; i < pixels.length; i += step) {
    sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    count++;
  }
  const avg = sum / (count * 3);
  // Qorong'i (qo'l yopdi) yoki juda yorqin (loy surtdi)
  if (avg < 15) {
    throttleAlert('cover', '🖐️ Kamera yopildi!', 'Kameraga qo\'l yaqinlashtirildi', 'danger', 10000);
  }
}

// ═══════════════════════════════════════════
//  ASOSIY TAHLIL
// ═══════════════════════════════════════════
async function analyzeFrame(video, canvas, ctx, motionDetected) {
  const w = canvas.width;
  const h = canvas.height;

  // Canvasni tozalash va qayta chizish
  ctx.drawImage(video, 0, 0, w, h);

  let detectedPeople = [];
  let detectedObjects = {};
  let faces = [];

  // 1. COCO-SSD — odam va ob'ektlar
  if (CAM.models.coco) {
    try {
      const predictions = await CAM.models.coco.detect(video);
      predictions.forEach(pred => {
        const label = pred.class;
        const conf = Math.round(pred.score * 100);
        const [x, y, bw, bh] = pred.bbox;

        // Statistika
        detectedObjects[label] = (detectedObjects[label] || 0) + 1;

        // Odamlar
        if (label === 'person') {
          detectedPeople.push({ x, y, w: bw, h: bh, conf });
          drawPersonBox(ctx, x, y, bw, bh, conf);
        } else {
          // Ob'ektlar
          drawObjectBox(ctx, x, y, bw, bh, label, conf);
        }
      });

      // Ob'ekt statistikasini yangilash
      Object.entries(detectedObjects).forEach(([k, v]) => {
        CAM.stats.objects[k] = (CAM.stats.objects[k] || 0) + 1;
      });
    } catch (e) {}
  }

  // 2. BlazeFace — yuzlar
  if (CAM.models.face) {
    try {
      faces = await CAM.models.face.estimateFaces(video, false);
      faces.forEach(face => drawFaceBox(ctx, face));
    } catch (e) {}
  }

  // 3. Pose — harakat tahlili (faqat harakat bo'lsa)
  if (CAM.models.pose && motionDetected && detectedPeople.length > 0) {
    try {
      const poses = await CAM.models.pose.estimatePoses(video);
      poses.forEach(pose => {
        analyzePose(pose, ctx, w, h);
      });
    } catch (e) {}
  }

  // ── HODISALAR ANIQLASH ──

  // Odam soni
  const peopleCount = detectedPeople.length;
  document.getElementById('stat-people').textContent = peopleCount;
  document.getElementById('stat-objects').textContent = Object.keys(detectedObjects).length;
  if (peopleCount > 0) CAM.stats.totalPeople = Math.max(CAM.stats.totalPeople, peopleCount);
  document.getElementById('report-people').textContent = CAM.stats.totalPeople;

  // Olomon (5+ odam)
  if (CAM.settings.crowd && peopleCount >= 5) {
    throttleAlert('crowd', '👥 Ko\'p odam!', peopleCount + ' ta odam bir joyda', 'warning', 30000);
  }

  // Zonaga kirish tekshirish
  if (CAM.settings.zone && CAM.zones.length > 0) {
    detectedPeople.forEach(p => checkZoneViolation(p, w, h));
  }

  // Niqob tekshirish (yuz yo'q, odam bor)
  if (CAM.settings.suspicious && detectedPeople.length > 0 && faces.length === 0) {
    throttleAlert('mask', '😷 Niqobli shaxs!', 'Odam aniqlandi, yuz ko\'rinmaydi', 'danger', 15000);
  }

  // UI yangilash
  document.getElementById('stat-alerts').textContent = CAM.alertCount;
  document.getElementById('stat-zone').textContent = CAM.zones.length;

  // Tungi rejim
  if (CAM.settings.night) {
    applyNightFilter(ctx, w, h);
  }
}

// ═══════════════════════════════════════════
//  POSE TAHLILI (HARAKAT)
// ═══════════════════════════════════════════
function analyzePose(pose, ctx, w, h) {
  if (!pose.keypoints || pose.keypoints.length < 10) return;

  const kp = {};
  pose.keypoints.forEach(k => { kp[k.name] = k; });

  // Yiqilish aniqlash
  if (CAM.settings.fall) {
    const nose = kp['nose'];
    const leftAnkle = kp['left_ankle'];
    const rightAnkle = kp['right_ankle'];
    if (nose && leftAnkle && rightAnkle) {
      const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;
      // Burun pastda, oyoq yuqorida = yiqilish
      if (nose.score > 0.3 && nose.y > avgAnkleY * 0.8) {
        throttleAlert('fall', '🆘 Odam yiqildi!', 'Yiqilish holati aniqlandi', 'danger', 8000);
      }
    }
  }

  // Shubhali harakat (yugurish — qo'l va oyoq tez harakati)
  if (CAM.settings.suspicious) {
    const leftWrist = kp['left_wrist'];
    const rightWrist = kp['right_wrist'];
    const leftHip = kp['left_hip'];
    if (leftWrist && rightWrist && leftHip) {
      // Qo'llar past va keng = narsani yashirish urinishi
      if (leftWrist.score > 0.4 && rightWrist.score > 0.4) {
        const wristSpread = Math.abs(leftWrist.x - rightWrist.x) / w;
        const wristLow = (leftWrist.y + rightWrist.y) / 2 / h;
        if (wristSpread < 0.1 && wristLow > 0.6) {
          throttleAlert('hide', '⚠️ Shubhali harakat!', 'Narsa yashirish harakati', 'warning', 10000);
        }
      }
    }
  }

  // Skeleton chizish
  drawSkeleton(ctx, pose.keypoints);
}

// ═══════════════════════════════════════════
//  CHIZISH FUNKSIYALARI
// ═══════════════════════════════════════════
function drawPersonBox(ctx, x, y, w, h, conf) {
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = 'rgba(0,255,136,0.15)';
  ctx.fillRect(x, y, w, h);

  // Label
  ctx.fillStyle = '#00ff88';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`ODAM ${conf}%`, x + 4, y - 4);

  // Burchak chiziqlar
  const s = 12;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + s); ctx.lineTo(x, y); ctx.lineTo(x + s, y);
  ctx.moveTo(x + w - s, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + s);
  ctx.moveTo(x, y + h - s); ctx.lineTo(x, y + h); ctx.lineTo(x + s, y + h);
  ctx.moveTo(x + w - s, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - s);
  ctx.stroke();
}

function drawObjectBox(ctx, x, y, w, h, label, conf) {
  ctx.strokeStyle = '#00ccff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,204,255,0.1)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#00ccff';
  ctx.font = '10px monospace';
  ctx.fillText(label.toUpperCase() + ' ' + conf + '%', x + 4, y - 4);
}

function drawFaceBox(ctx, face) {
  const [x1, y1] = face.topLeft;
  const [x2, y2] = face.bottomRight;
  const fw = x2 - x1;
  const fh = y2 - y1;

  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x1, y1, fw, fh);

  // Yuz nuqtalari
  if (face.landmarks) {
    ctx.fillStyle = '#ffcc00';
    face.landmarks.forEach(([lx, ly]) => {
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawSkeleton(ctx, keypoints) {
  const connections = [
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ];

  const kpMap = {};
  keypoints.forEach(k => { kpMap[k.name] = k; });

  ctx.strokeStyle = 'rgba(0,255,136,0.5)';
  ctx.lineWidth = 1.5;

  connections.forEach(([a, b]) => {
    const ka = kpMap[a]; const kb = kpMap[b];
    if (ka && kb && ka.score > 0.3 && kb.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(ka.x, ka.y);
      ctx.lineTo(kb.x, kb.y);
      ctx.stroke();
    }
  });

  keypoints.forEach(k => {
    if (k.score > 0.3) {
      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.arc(k.x, k.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ── Tungi filtr ──
function applyNightFilter(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
    d[i] = 0; d[i + 1] = Math.min(255, avg * 2); d[i + 2] = 0;
  }
  ctx.putImageData(img, 0, 0);
}

// ═══════════════════════════════════════════
//  ZONALAR
// ═══════════════════════════════════════════
function checkZoneViolation(person, vw, vh) {
  const px = person.x / vw;
  const py = person.y / vh;

  CAM.zones.forEach((zone, i) => {
    if (px >= zone.x && px <= zone.x + zone.w &&
        py >= zone.y && py <= zone.y + zone.h) {
      throttleAlert('zone_' + i, '🚫 Zona buzildi!', (i + 1) + '-taqiqlangan zonaga kirdi', 'danger', 5000);
    }
  });
}

function startDrawZone() {
  addLiveAlert('✏️ Ekranda zona chizish uchun ushlab suring', 'info');
  const canvas = document.getElementById('main-canvas');
  CAM.drawingZone = true;
  let startX, startY;

  function onStart(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    startX = (touch.clientX - rect.left) / rect.width;
    startY = (touch.clientY - rect.top) / rect.height;
  }

  function onEnd(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const endX = (touch.clientX - rect.left) / rect.width;
    const endY = (touch.clientY - rect.top) / rect.height;

    const zone = {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      w: Math.abs(endX - startX),
      h: Math.abs(endY - startY),
      color: CAM.zoneColor,
    };

    if (zone.w > 0.05 && zone.h > 0.05) {
      CAM.zones.push(zone);
      saveData();
      renderZoneList();
      addLiveAlert('✅ Zona qo\'shildi', 'success');
    }

    canvas.removeEventListener('touchstart', onStart);
    canvas.removeEventListener('touchend', onEnd);
    canvas.removeEventListener('mousedown', onStart);
    canvas.removeEventListener('mouseup', onEnd);
    CAM.drawingZone = false;
  }

  canvas.addEventListener('touchstart', onStart, { once: true });
  canvas.addEventListener('touchend', onEnd, { once: true });
  canvas.addEventListener('mousedown', onStart, { once: true });
  canvas.addEventListener('mouseup', onEnd, { once: true });
}

function clearZones() {
  CAM.zones = [];
  saveData();
  renderZoneList();
  addLiveAlert('🗑️ Zonalar tozalandi', 'info');
}

function renderZoneList() {
  const el = document.getElementById('zone-list');
  if (CAM.zones.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text2);padding:4px 0;">Zona yo\'q</div>';
    return;
  }
  el.innerHTML = CAM.zones.map((z, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;">
      <div style="width:12px;height:12px;border-radius:2px;background:${z.color};"></div>
      <span style="color:var(--text2);">Zona ${i + 1}</span>
      <span style="margin-left:auto;cursor:pointer;color:var(--red);" onclick="removeZone(${i})">✕</span>
    </div>
  `).join('');
}

function removeZone(i) {
  CAM.zones.splice(i, 1);
  saveData();
  renderZoneList();
}

// ═══════════════════════════════════════════
//  OGOHLANTIRISH TIZIMI
// ═══════════════════════════════════════════
function throttleAlert(key, title, desc, type, delay = 5000) {
  const now = Date.now();
  if (CAM.lastAlertTime[key] && now - CAM.lastAlertTime[key] < delay) return;
  CAM.lastAlertTime[key] = now;
  triggerAlert(title, desc, type);
}

function triggerAlert(title, desc, type = 'warning') {
  // Jonli alert
  addLiveAlert(title + ' — ' + desc, type);

  // Alert ro'yxatiga qo'shish
  const alert = { title, desc, type, time: fmtDate(), cam: 'Telefon Kamerasi' };
  CAM.alerts.unshift(alert);
  CAM.alertCount++;
  CAM.stats.totalAlerts++;
  if (type === 'danger') CAM.stats.suspicious++;

  // Statistika hodisalari
  CAM.stats.events.unshift({ icon: type === 'danger' ? '🚨' : '⚠️', text: title, time: fmtTime() });
  if (CAM.stats.events.length > 50) CAM.stats.events.pop();

  // Xavf overlay
  if (type === 'danger') showDangerOverlay(title);

  // Ovozli signal
  if (CAM.settings.sound) playAlert(type);

  // Bell yangilash
  updateBellCount();

  // AI status
  document.getElementById('ai-status-dot').className = 'status-dot alert';
  setTimeout(() => {
    if (CAM.active) document.getElementById('ai-status-dot').className = 'status-dot online';
  }, 3000);

  // UI yangilash
  document.getElementById('report-alerts').textContent = CAM.stats.totalAlerts;
  document.getElementById('report-suspicious').textContent = CAM.stats.suspicious;
  renderAlerts();
  saveData();
}

function showDangerOverlay(text) {
  const overlay = document.getElementById('danger-overlay');
  document.getElementById('danger-text').textContent = text;
  overlay.style.display = 'flex';
  if (CAM.dangerTimeout) clearTimeout(CAM.dangerTimeout);
  CAM.dangerTimeout = setTimeout(() => {
    overlay.style.display = 'none';
  }, 4000);
}

function playAlert(type) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);

    if (type === 'danger') {
      osc.frequency.setValueAtTime(880, ac.currentTime);
      osc.frequency.setValueAtTime(440, ac.currentTime + 0.1);
      osc.frequency.setValueAtTime(880, ac.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.5);
      osc.start(); osc.stop(ac.currentTime + 0.5);
    } else {
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.1, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.3);
      osc.start(); osc.stop(ac.currentTime + 0.3);
    }
  } catch (e) {}
}

function addLiveAlert(text, type = 'info') {
  const el = document.getElementById('live-alerts');
  const div = document.createElement('div');
  div.className = 'live-alert ' + type;
  div.innerHTML = `<span>${text}</span><span class="alert-time">${fmtTime()}</span>`;
  el.insertBefore(div, el.firstChild);
  // Maksimal 5 ta ko'rsatish
  while (el.children.length > 5) el.removeChild(el.lastChild);
}

function updateBellCount() {
  const count = CAM.alerts.filter(a => !a.read).length;
  const badge = document.getElementById('bell-count');
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count > 99 ? '99+' : count;
  } else {
    badge.style.display = 'none';
  }
}

function renderAlerts() {
  const el = document.getElementById('alerts-list');
  if (CAM.alerts.length === 0) {
    el.innerHTML = '<div class="empty-state">Hozircha ogohlantirish yo\'q</div>';
    return;
  }
  el.innerHTML = CAM.alerts.slice(0, 50).map(a => `
    <div class="alert-item ${a.type}">
      <div class="alert-item-header">
        <div class="alert-item-title">${a.title}</div>
        <div class="alert-item-time">${a.time}</div>
      </div>
      <div class="alert-item-desc">${a.desc}</div>
      <div class="alert-item-cam">📷 ${a.cam}</div>
    </div>
  `).join('');
  // O'qilgan deb belgilash
  CAM.alerts.forEach(a => a.read = true);
  updateBellCount();
}

function clearAlerts() {
  CAM.alerts = [];
  CAM.alertCount = 0;
  saveData();
  renderAlerts();
  updateBellCount();
}

// ═══════════════════════════════════════════
//  HIKVISION KAMERALAR
// ═══════════════════════════════════════════
function showAddCamera() {
  if (CAM.hikCameras.length >= 50) {
    addLiveAlert('❌ Maksimal 50 ta kamera', 'danger');
    return;
  }
  document.getElementById('add-cam-modal').style.display = 'flex';
}

function hideAddCamera() {
  document.getElementById('add-cam-modal').style.display = 'none';
}

function addHikvisionCamera() {
  const name = document.getElementById('new-cam-name').value.trim();
  const ip = document.getElementById('new-cam-ip').value.trim();
  const port = document.getElementById('new-cam-port').value.trim() || '554';
  const user = document.getElementById('new-cam-user').value.trim() || 'admin';
  const pass = document.getElementById('new-cam-pass').value.trim();

  if (!name || !ip) {
    addLiveAlert('❌ Nom va IP kiritilsin', 'danger');
    return;
  }

  const cam = {
    id: Date.now(),
    name,
    ip,
    port,
    user,
    pass,
    rtsp: `rtsp://${user}:${pass}@${ip}:${port}/Streaming/Channels/101`,
    status: 'connecting', // connecting | online | error
  };

  CAM.hikCameras.push(cam);
  saveData();
  renderHikList();
  hideAddCamera();

  // Ulanishni tekshirish (simulyatsiya)
  setTimeout(() => {
    const idx = CAM.hikCameras.findIndex(c => c.id === cam.id);
    if (idx !== -1) {
      // Haqiqiy RTSP ulanish brauzerda cheklanadi
      // Kelajakda WebRTC/HLS orqali ulash mumkin
      CAM.hikCameras[idx].status = 'online';
      saveData();
      renderHikList();
      addLiveAlert('📡 ' + name + ' — ulandi', 'success');
    }
  }, 2000);

  addLiveAlert('📡 ' + name + ' ulanmoqda...', 'info');
  document.getElementById('hik-count').textContent = CAM.hikCameras.length + '/50';
  document.getElementById('info-cams').textContent = CAM.hikCameras.length + 1;
}

function removeHikCamera(id) {
  CAM.hikCameras = CAM.hikCameras.filter(c => c.id !== id);
  saveData();
  renderHikList();
  document.getElementById('hik-count').textContent = CAM.hikCameras.length + '/50';
  document.getElementById('info-cams').textContent = CAM.hikCameras.length + 1;
}

function renderHikList() {
  const el = document.getElementById('hik-list');
  if (CAM.hikCameras.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px;">IP kamera qo\'shilmagan</div>';
    return;
  }
  el.innerHTML = CAM.hikCameras.map(c => `
    <div class="hik-item">
      <div class="hik-dot ${c.status === 'online' ? 'on' : c.status === 'error' ? 'err' : ''}"></div>
      <div class="hik-info">
        <div class="hik-name">${c.name}</div>
        <div class="hik-addr">${c.ip}:${c.port}</div>
      </div>
      <div class="hik-del" onclick="removeHikCamera(${c.id})">🗑️</div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
//  SOZLAMALAR
// ═══════════════════════════════════════════
function toggleSetting(key) {
  CAM.settings[key] = !CAM.settings[key];
  const sw = document.getElementById('sw-' + key);
  sw.classList.toggle('on', CAM.settings[key]);
  saveData();
}

function applySettings() {
  Object.entries(CAM.settings).forEach(([key, val]) => {
    const sw = document.getElementById('sw-' + key);
    if (sw) sw.classList.toggle('on', val);
  });
}

function updateSensitivity(val) {
  CAM.sensitivity = parseInt(val);
  document.getElementById('sensitivity-val').textContent = val + ' / 10';
  saveData();
}

function setZoneColor(color) {
  CAM.zoneColor = color;
  document.querySelectorAll('.color-opt').forEach(el => el.classList.remove('selected'));
  event.target.classList.add('selected');
  saveData();
}

// ═══════════════════════════════════════════
//  HISOBOT
// ═══════════════════════════════════════════
function renderStats() {
  document.getElementById('report-people').textContent = CAM.stats.totalPeople;
  document.getElementById('report-alerts').textContent = CAM.stats.totalAlerts;
  document.getElementById('report-suspicious').textContent = CAM.stats.suspicious;
  document.getElementById('report-safe').textContent = CAM.stats.safeMinutes;

  renderHourlyChart();
  renderEventsReport();
  renderObjectsReport();
}

function renderHourlyChart() {
  const canvas = document.getElementById('hourly-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || 300;
  canvas.width = w;
  const h = 120;
  const max = Math.max(...CAM.stats.hourly, 1);
  const barW = w / 24;

  ctx.clearRect(0, 0, w, h);

  CAM.stats.hourly.forEach((val, i) => {
    const barH = (val / max) * (h - 20);
    const x = i * barW + 1;
    const y = h - barH - 10;

    const gradient = ctx.createLinearGradient(0, y, 0, h);
    gradient.addColorStop(0, '#00ff88');
    gradient.addColorStop(1, 'rgba(0,255,136,0.1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barW - 2, barH);

    // Soat raqami
    if (i % 4 === 0) {
      ctx.fillStyle = '#7aadc4';
      ctx.font = '8px monospace';
      ctx.fillText(String(i).padStart(2, '0'), x, h - 1);
    }
  });
}

function renderEventsReport() {
  const el = document.getElementById('events-list');
  if (CAM.stats.events.length === 0) {
    el.innerHTML = '<div class="empty-state">Hodisalar yo\'q</div>';
    return;
  }
  el.innerHTML = CAM.stats.events.slice(0, 10).map(e => `
    <div class="event-item">
      <div class="event-icon">${e.icon}</div>
      <div class="event-text">${e.text}</div>
      <div class="event-time">${e.time}</div>
    </div>
  `).join('');
}

function renderObjectsReport() {
  const el = document.getElementById('objects-report');
  const entries = Object.entries(CAM.stats.objects).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) {
    el.innerHTML = '<div class="empty-state">Ma\'lumot yo\'q</div>';
    return;
  }
  const max = entries[0][1];
  el.innerHTML = entries.map(([name, count]) => `
    <div class="obj-item">
      <span style="min-width:80px;font-size:11px;color:var(--text2);">${name}</span>
      <div class="obj-bar-wrap">
        <div class="obj-bar" style="width:${(count / max * 100).toFixed(0)}%"></div>
      </div>
      <span class="obj-count">${count}</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
//  ISHGA TUSHIRISH
// ═══════════════════════════════════════════
window.addEventListener('load', loadModels);
