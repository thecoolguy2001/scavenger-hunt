/* ============================================================
   SHOW ME — speed scavenger hunt
   On-device object detection with TensorFlow.js + COCO-SSD.
   No data leaves the browser; the webcam stream is never uploaded.
   ============================================================ */

// COCO-SSD can detect 80 classes. We curate the ones a person can
// plausibly grab and hold up to a webcam in a few seconds, each with
// a friendly call-out name and a difficulty weight (rarity of finding).
const ITEMS = [
  { id: "cell phone", say: "a phone",        tier: 1 },
  { id: "cup",        say: "a cup",          tier: 1 },
  { id: "bottle",     say: "a bottle",       tier: 1 },
  { id: "book",       say: "a book",         tier: 1 },
  { id: "remote",     say: "a remote",       tier: 1 },
  { id: "keyboard",   say: "a keyboard",     tier: 1 },
  { id: "mouse",      say: "a mouse",        tier: 2 },
  { id: "scissors",   say: "scissors",       tier: 2 },
  { id: "spoon",      say: "a spoon",        tier: 2 },
  { id: "fork",       say: "a fork",         tier: 2 },
  { id: "knife",      say: "a knife",        tier: 2 },
  { id: "bowl",       say: "a bowl",         tier: 1 },
  { id: "banana",     say: "a banana",       tier: 2 },
  { id: "apple",      say: "an apple",       tier: 2 },
  { id: "orange",     say: "an orange",      tier: 2 },
  { id: "wine glass", say: "a wine glass",   tier: 3 },
  { id: "clock",      say: "a clock",        tier: 2 },
  { id: "vase",       say: "a vase",         tier: 3 },
  { id: "teddy bear", say: "a teddy bear",   tier: 3 },
  { id: "toothbrush", say: "a toothbrush",   tier: 2 },
  { id: "backpack",   say: "a backpack",     tier: 2 },
  { id: "tie",        say: "a tie",          tier: 3 },
  { id: "handbag",    say: "a bag",          tier: 2 },
  { id: "potted plant", say: "a plant",      tier: 2 },
  { id: "laptop",     say: "a laptop",       tier: 1 },
];

const CONFIG = {
  roundTime: 20,       // seconds per item
  minRound: 9,         // floor as the game speeds up
  speedup: 0.6,        // seconds shaved per item found
  confidence: 0.6,     // detection score required to count
  holdFrames: 2,       // consecutive detections needed (anti-flicker)
  skipPenalty: 4,      // seconds lost on skip
  basePoints: 100,     // points for a find
  timeBonus: 15,       // points per leftover second
};

const RING_LEN = 2 * Math.PI * 54; // circumference of the timer ring

// ---- element refs ----
const $ = (id) => document.getElementById(id);
const screens = {
  start: $("screen-start"),
  game: $("screen-game"),
  over: $("screen-over"),
};
const video = $("video");
const overlay = $("overlay");
const ctx = overlay.getContext("2d");

// ---- game state ----
let model = null;
let stream = null;
let running = false;
let target = null;
let timeLeft = 0;
let roundLength = 0;
let lastTick = 0;
let holdCount = 0;
let recentTargets = [];

let score = 0;
let found = 0;
let streak = 0;
let bestStreak = 0;
const timerRing = document.querySelector(".timer-ring");

const BEST_KEY = "showme.best";
const getBest = () => parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
const setBest = (v) => localStorage.setItem(BEST_KEY, String(v));

// ============================================================
//  Screen management
// ============================================================
function show(name) {
  Object.values(screens).forEach((s) => s.classList.remove("is-active"));
  screens[name].classList.add("is-active");
}

// ============================================================
//  Boot: load model + camera, then start
// ============================================================
async function begin() {
  $("loader").classList.add("show");

  // 1. camera
  $("loader-text").textContent = "Rolling the camera…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    $("loader").classList.remove("show");
    $("start-sub").textContent = "camera blocked — check permissions";
    $("start-sub").style.color = "var(--bad)";
    console.error(err);
    return;
  }

  // size the overlay canvas to the video
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;

  // 2. model (cached after first load)
  if (!model) {
    $("loader-text").textContent = "Warming up the AI…";
    model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  }

  $("loader").classList.remove("show");
  startGame();
}

// ============================================================
//  Game lifecycle
// ============================================================
function startGame() {
  score = 0;
  found = 0;
  streak = 0;
  bestStreak = 0;
  recentTargets = [];
  running = true;
  updateHud();
  show("game");
  nextTarget(true);
  lastTick = performance.now();
  requestAnimationFrame(loop);
  detectLoop();
}

function nextTarget(first = false) {
  // pick something we haven't called recently
  let pick;
  do {
    pick = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  } while (recentTargets.includes(pick.id) && ITEMS.length > 5);
  recentTargets.push(pick.id);
  if (recentTargets.length > 5) recentTargets.shift();

  target = pick;
  holdCount = 0;
  roundLength = Math.max(CONFIG.minRound, CONFIG.roundTime - found * CONFIG.speedup);
  timeLeft = roundLength;

  const el = $("call-target");
  el.textContent = target.say;
  el.style.animation = "none";
  void el.offsetWidth; // reflow to restart animation
  el.style.animation = "";
  hideHint();
}

function endGame() {
  running = false;
  const best = getBest();
  const isRecord = score > best;
  if (isRecord) setBest(score);

  $("over-score").textContent = score;
  $("over-stats").textContent = `${found} object${found === 1 ? "" : "s"} found · best combo ×${bestStreak}`;
  const bestEl = $("over-best");
  if (isRecord) {
    bestEl.textContent = "★ New best score!";
    bestEl.classList.add("is-record");
  } else {
    bestEl.textContent = `Best: ${best}`;
    bestEl.classList.remove("is-record");
  }
  show("over");
}

// ============================================================
//  Timer loop (visual + countdown)
// ============================================================
function loop(now) {
  if (!running) return;
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  timeLeft -= dt;

  if (timeLeft <= 0) {
    timeLeft = 0;
    flash("bad", "TIME!");
    streak = 0;
    updateHud();
    setTimeout(endGame, 650);
    running = false;
    return;
  }

  // ring + number
  const frac = timeLeft / roundLength;
  $("ring-fill").style.strokeDashoffset = RING_LEN * (1 - frac);
  $("timer-num").textContent = Math.ceil(timeLeft);
  timerRing.classList.toggle("is-low", timeLeft <= 5);

  requestAnimationFrame(loop);
}

// ============================================================
//  Detection loop (the actual on-device vision)
// ============================================================
async function detectLoop() {
  if (!running || !model) return;

  let predictions = [];
  try {
    predictions = await model.detect(video);
  } catch (e) {
    /* video not ready yet — skip frame */
  }

  drawBoxes(predictions);

  // is the target on screen with enough confidence?
  const hit = predictions.find(
    (p) => p.class === target.id && p.score >= CONFIG.confidence
  );

  if (hit) {
    holdCount++;
    if (holdCount >= CONFIG.holdFrames) {
      onFound();
    }
  } else {
    holdCount = 0;
    showTopGuess(predictions);
  }

  if (running) requestAnimationFrame(detectLoop);
}

function onFound() {
  const leftover = Math.ceil(timeLeft);
  streak++;
  bestStreak = Math.max(bestStreak, streak);
  const combo = 1 + (streak - 1) * 0.25; // +25% per combo step
  const gain = Math.round(
    (CONFIG.basePoints * target.tier + leftover * CONFIG.timeBonus) * combo
  );
  score += gain;
  found++;
  updateHud();
  flash("good", `+${gain}`);
  nextTarget();
}

// ============================================================
//  Rendering helpers
// ============================================================
function drawBoxes(preds) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  preds.forEach((p) => {
    if (p.score < 0.5) return;
    const [x, y, w, h] = p.bbox;
    const isTarget = p.class === target.id;
    ctx.lineWidth = isTarget ? 5 : 2;
    ctx.strokeStyle = isTarget ? "#38e58a" : "rgba(41,231,205,0.5)";
    ctx.strokeRect(x, y, w, h);
    if (isTarget) {
      ctx.fillStyle = "#38e58a";
      ctx.font = "bold 18px 'Space Grotesk', sans-serif";
      ctx.save();
      // un-mirror the label text (canvas is flipped via CSS)
      ctx.scale(-1, 1);
      ctx.fillText(p.class, -(x + w) + 4, y + 20);
      ctx.restore();
    }
  });
}

function showTopGuess(preds) {
  const top = preds
    .filter((p) => p.score >= 0.55)
    .sort((a, b) => b.score - a.score)[0];
  if (top) {
    showHint(`seeing… ${top.class}`);
  } else {
    hideHint();
  }
}

function showHint(text) {
  const h = $("hint");
  h.textContent = text;
  h.classList.add("show");
}
function hideHint() {
  $("hint").classList.remove("show");
}

function flash(kind, text) {
  const f = $("flash");
  f.textContent = text;
  f.className = "flash " + kind;
  void f.offsetWidth;
  f.style.animation = "none";
  void f.offsetWidth;
  f.style.animation = "";
}

function updateHud() {
  $("hud-score").textContent = score;
  $("hud-streak").textContent = streak;
  $("hud-found").textContent = found;
  $("hud-streak-cell").classList.toggle("is-hot", streak >= 3);
}

// ============================================================
//  Skip
// ============================================================
function skip() {
  if (!running) return;
  streak = 0;
  timeLeft -= CONFIG.skipPenalty;
  updateHud();
  flash("bad", "SKIP");
  if (timeLeft > 0) nextTarget();
}

// ============================================================
//  Wiring
// ============================================================
$("btn-start").addEventListener("click", begin);
$("btn-again").addEventListener("click", begin);
$("btn-skip").addEventListener("click", skip);
$("best-start").textContent = getBest();

// keyboard: space = skip
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && running) {
    e.preventDefault();
    skip();
  }
});
