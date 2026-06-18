const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const highScoreElement = document.getElementById('highScore');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const gameOverlay = document.getElementById('gameOverlay');
const muteBtn = document.getElementById('muteBtn');
const themeBtn = document.getElementById('themeBtn');
const volumeSlider = document.getElementById('volumeSlider');
const instructionsElement = document.getElementById('instructions');
const controlRadios = document.querySelectorAll('input[name="controlMode"]');
const gameOverInfo = document.getElementById('gameOverInfo');
const finalScoreElement = document.getElementById('finalScore');
const newRecordElement = document.getElementById('newRecord');
const wallsToggle = document.getElementById('wallsToggle');

// Game settings
const gridSize = 20; // Diameter of snake body
let score = 0;
let highScore = localStorage.getItem('snakeHighScore') || 0;
highScoreElement.innerText = highScore;

// Expose state
window.gameState = {
    running: false, // Initially false
    paused: false,
    score: 0,
    gameOver: false
};

let snake = []; // Array of {x, y} (pixels)
let history = []; // Trail of points for Smooth mode
let velocity = { x: 20, y: 0 }; // Grid mode velocity (px per tick)
let speed = 3; // Smooth mode speed (px per frame)
let food = { x: 0, y: 0 };
let isPaused = false;
let isDarkMode = localStorage.getItem('snakeDarkMode') === 'true';
let controlMode = localStorage.getItem('snakeControlMode') || 'mouse'; // 'keyboard' or 'mouse'
let mousePos = { x: 0, y: 0 };

// Power-up system
let powerUp = null; // { type: 'slow'|'double'|'magnet', x, y }
let activeEffects = []; // [{type, expiresAt, data}]
let scoreMultiplier = 1;
const POWERUP_TYPES = ['slow','double','magnet'];
const POWERUP_DURATIONS = { slow: 6000, double: 6000, magnet: 6000 };
const POWERUP_SPAWN_LIFETIME = 9000; // ms an uncollected power-up stays on the board

// Hazards & bonus
let obstacles = []; // [{x, y}] lethal rocks
let goldenFood = null; // { x, y, expiresAt } high-value bonus apple
let wallsMode = localStorage.getItem('snakeWalls') === 'true';
const GOLDEN_VALUE = 5;
const GOLDEN_LIFETIME = 6000;
const MAX_OBSTACLES = 14;

// Grid Mode timing
let lastTime = 0;
let moveInterval = 100;
let timeAccumulator = 0;
let inputQueue = []; // For Grid mode

// Visual effects
let particles = [];
let floatTexts = [];

// Audio
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isMuted = localStorage.getItem('snakeMuted') === 'true';
let volume = parseFloat(localStorage.getItem('snakeVolume'));
if (isNaN(volume)) volume = 0.3;

// --- Functions ---

function showMenu() {
    window.gameState.running = false;
    window.gameState.gameOver = false;
    isPaused = false;
    powerUp = null;
    activeEffects = [];
    particles = [];
    floatTexts = [];
    obstacles = [];
    goldenFood = null;
    resetEntities();
    gameOverlay.classList.remove('hidden');
    startBtn.style.display = 'inline-block';
    restartBtn.style.display = 'none';
    gameOverInfo.classList.add('hidden');
    draw(); // Draw the idle board behind the overlay
}

function showGameOver(isNewRecord) {
    gameOverlay.classList.remove('hidden');
    startBtn.style.display = 'none';
    restartBtn.style.display = 'inline-block';
    finalScoreElement.innerText = score;
    newRecordElement.classList.toggle('hidden', !isNewRecord);
    gameOverInfo.classList.remove('hidden');
}

function resetEntities() {
    snake = [];
    history = [];

    const cols = Math.floor(canvas.width / gridSize);
    const rows = Math.floor(canvas.height / gridSize);
    const startX_grid = Math.floor(cols / 2);
    const startY_grid = Math.floor(rows / 2);

    for (let i = 0; i < 3; i++) {
        snake.push({
            x: (startX_grid - i) * gridSize + gridSize / 2,
            y: startY_grid * gridSize + gridSize / 2
        });
    }

    const startX = snake[0].x;
    const startY = snake[0].y;
    for (let i = 0; i < 100; i++) {
        history.push({ x: startX - (i * speed), y: startY });
    }

    velocity = { x: gridSize, y: 0 };
    placeFood();
}

function startGame() {
    // Hide overlay
    gameOverlay.classList.add('hidden');
    gameOverInfo.classList.add('hidden');

    speed = 3;
    powerUp = null;
    activeEffects = [];
    scoreMultiplier = 1;
    particles = [];
    floatTexts = [];
    obstacles = [];
    goldenFood = null;
    resetEntities();

    inputQueue = [];
    score = 0;
    moveInterval = 100;
    timeAccumulator = 0;
    isPaused = false;

    window.gameState.score = 0;
    window.gameState.gameOver = false;
    window.gameState.running = true;
    window.gameState.paused = false;
    
    scoreElement.innerText = score;
    
    placeFood();
    placePowerUp();
    draw(); // Draw immediately after initialization
    
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    lastTime = 0;
    requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp) {
    if (!window.gameState.running) return;
    
    if (!lastTime) lastTime = timestamp;
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    if (!isPaused) {
        updatePowerUpTimers(timestamp);

        if (controlMode === 'keyboard') {
            updateGridMode(deltaTime);
        } else {
            updateSmoothMode(deltaTime);
        }

        updateEffects(deltaTime);
    }

    draw();

    requestAnimationFrame(gameLoop);
}

// --- Power-up: spawn, apply, timers ---
function placePowerUp(chance = 0.18) {
    if (powerUp) return;
    if (Math.random() > chance) return;
    const c = randomFreeCell();
    if (!c) return;
    powerUp = {
        x: c.x,
        y: c.y,
        type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
        expiresAt: Date.now() + POWERUP_SPAWN_LIFETIME
    };
}

function eatPowerUp() {
    if (!powerUp) return;
    const type = powerUp.type;
    const px = powerUp.x, py = powerUp.y;
    powerUp = null;

    const glow = ({ slow: '#4fc3f7', double: '#ffd54f', magnet: '#b388ff' })[type] || '#ffffff';
    spawnBurst(px, py, glow, 18);

    // prevent stacking duplicates: refresh if already active
    const existing = activeEffects.find(e => e.type === type);
    const now = Date.now();

    if (type === 'slow') {
        if (existing) { existing.expiresAt = now + POWERUP_DURATIONS.slow; return; }
        const prev = { moveInterval, speed };
        moveInterval = Math.floor(moveInterval * 1.6);
        speed = Math.max(0.8, speed * 0.6);
        activeEffects.push({ type: 'slow', expiresAt: now + POWERUP_DURATIONS.slow, data: { prev } });
    } else if (type === 'double') {
        if (existing) { existing.expiresAt = now + POWERUP_DURATIONS.double; return; }
        scoreMultiplier = 2;
        activeEffects.push({ type: 'double', expiresAt: now + POWERUP_DURATIONS.double, data: {} });
    } else if (type === 'magnet') {
        if (existing) { existing.expiresAt = now + POWERUP_DURATIONS.magnet; return; }
        // reduced radius: only attract apples that are relatively close to the head
        activeEffects.push({ type: 'magnet', expiresAt: now + POWERUP_DURATIONS.magnet, data: { strength: 0.06, radius: gridSize * 5 } });
    }
}

function updatePowerUpTimers(timestamp) {
    const now = Date.now();

    // Magnet behavior: gently bend nearby food toward the head (no auto-eat — you still intercept it)
    const magnet = activeEffects.find(e => e.type === 'magnet');
    if (magnet && snake.length > 0) {
        const head = snake[0];
        const radius = magnet.data.radius || gridSize * 5;
        const strength = magnet.data.strength || 0.06;
        for (const target of [food, goldenFood]) {
            if (!target) continue;
            const dx = head.x - target.x;
            const dy = head.y - target.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= radius && dist > 1) {
                target.x += dx * strength;
                target.y += dy * strength;
            }
        }
    }

    // Despawn an uncollected power-up after its lifetime
    if (powerUp && now >= powerUp.expiresAt) {
        powerUp = null;
    }

    // Despawn the golden bonus apple after its lifetime
    if (goldenFood && now >= goldenFood.expiresAt) {
        goldenFood = null;
    }

    // expire effects
    for (let i = activeEffects.length - 1; i >= 0; i--) {
        const eff = activeEffects[i];
        if (now >= eff.expiresAt) {
            // revert state if needed
            if (eff.type === 'slow' && eff.data && eff.data.prev) {
                moveInterval = eff.data.prev.moveInterval;
                speed = eff.data.prev.speed;
            } else if (eff.type === 'double') {
                scoreMultiplier = 1;
            }
            activeEffects.splice(i, 1);
        }
    }
}

function updateGridMode(deltaTime) {
    timeAccumulator += deltaTime;
    if (timeAccumulator < moveInterval) return;
    timeAccumulator -= moveInterval;

    if (inputQueue.length > 0) {
        const nextVel = inputQueue.shift();
        if (nextVel.x !== -velocity.x || nextVel.y !== -velocity.y) {
            velocity = nextVel;
        }
    }

    const oldHead = snake[0];
    const newHead = { 
        x: oldHead.x + velocity.x, 
        y: oldHead.y + velocity.y 
    };

    if (handleBoundaries(newHead)) {
        gameOver();
        return;
    }

    // Check Self Collision
    for (let i = 1; i < snake.length; i++) {
        const dx = Math.abs(newHead.x - snake[i].x);
        const dy = Math.abs(newHead.y - snake[i].y);
        if (dx < 5 && dy < 5) {
            gameOver();
            return;
        }
    }

    // Check obstacle collision
    for (const o of obstacles) {
        if (Math.hypot(newHead.x - o.x, newHead.y - o.y) < gridSize * 0.85) {
            gameOver();
            return;
        }
    }

    snake.unshift(newHead);

    const dist = Math.hypot(newHead.x - food.x, newHead.y - food.y);
    if (dist < gridSize / 2) {
        eatFood();
    } else {
        snake.pop();
    }

    if (goldenFood) {
        const gd = Math.hypot(newHead.x - goldenFood.x, newHead.y - goldenFood.y);
        if (gd < gridSize / 2) eatGolden();
    }

    // Check power-up pickup
    if (powerUp) {
        const pd = Math.hypot(newHead.x - powerUp.x, newHead.y - powerUp.y);
        if (pd < gridSize / 1.5) {
            eatPowerUp();
        }
    }
}

function updateSmoothMode(deltaTime) {
    const head = snake[0];
    
    const dx = mousePos.x - head.x;
    const dy = mousePos.y - head.y;
    
    // Deadzone to prevent jitter/knotting
    if (Math.hypot(dx, dy) < speed) return;

    const angle = Math.atan2(dy, dx);
    
    const moveX = Math.cos(angle) * speed;
    const moveY = Math.sin(angle) * speed;
    
    const newHead = {
        x: head.x + moveX,
        y: head.y + moveY
    };
    
    if (handleBoundaries(newHead)) {
        gameOver();
        return;
    }

    history.unshift(newHead);
    if (history.length > snake.length * 20) {
        history.pop();
    }

    snake[0] = history[0];
    
    const segmentDist = 10; 
    
    for (let i = 1; i < snake.length; i++) {
        const indexStep = Math.floor(segmentDist / speed);
        let targetIndex = i * indexStep;
        
        if (targetIndex < history.length) {
            snake[i] = history[targetIndex];
        } else {
            snake[i] = history[history.length - 1];
        }
    }

    // Check Self Collision
    for (let i = 10; i < snake.length; i++) {
        const dist = Math.hypot(snake[0].x - snake[i].x, snake[0].y - snake[i].y);
        if (dist < gridSize - 5) { 
            gameOver();
            return;
        }
    }
    
    // Check obstacle collision
    for (const o of obstacles) {
        if (Math.hypot(snake[0].x - o.x, snake[0].y - o.y) < gridSize * 0.85) {
            gameOver();
            return;
        }
    }

    const distFood = Math.hypot(snake[0].x - food.x, snake[0].y - food.y);
    if (distFood < gridSize) {
        eatFood();
    }

    if (goldenFood && Math.hypot(snake[0].x - goldenFood.x, snake[0].y - goldenFood.y) < gridSize) {
        eatGolden();
    }

    // power-up pickup for smooth mode
    if (powerUp) {
        const pd = Math.hypot(snake[0].x - powerUp.x, snake[0].y - powerUp.y);
        if (pd < gridSize) {
            eatPowerUp();
        }
    }
}

function handleBoundaries(pos) {
    if (controlMode === 'mouse') {
        // Clamp: keep the head within the canvas (mouse mode never dies on edges)
        pos.x = Math.max(gridSize / 2, Math.min(canvas.width - gridSize / 2, pos.x));
        pos.y = Math.max(gridSize / 2, Math.min(canvas.height - gridSize / 2, pos.y));
        return false;
    }

    if (wallsMode) {
        // Lethal walls: touching an edge ends the run
        return pos.x < gridSize / 2 - 1 || pos.x > canvas.width - gridSize / 2 + 1
            || pos.y < gridSize / 2 - 1 || pos.y > canvas.height - gridSize / 2 + 1;
    }

    // Wrap around when the head leaves the canvas
    if (pos.x < 0 - gridSize / 2) pos.x = canvas.width + gridSize / 2;
    else if (pos.x > canvas.width + gridSize / 2) pos.x = 0 - gridSize / 2;
    if (pos.y < 0 - gridSize / 2) pos.y = canvas.height + gridSize / 2;
    else if (pos.y > canvas.height + gridSize / 2) pos.y = 0 - gridSize / 2;
    return false;
}

function eatFood() {
    const fx = food.x, fy = food.y;
    const head = snake[0];

    score += scoreMultiplier;
    window.gameState.score = score;
    scoreElement.innerText = score;
    bumpScore();
    playEatSound();

    const colors = getThemeColors();
    spawnBurst(fx, fy, colors.foodLight, 14);
    if (head) spawnFloatText(head.x, head.y - gridSize, '+' + scoreMultiplier, colors.pop);

    if (controlMode === 'keyboard' && score % 5 === 0 && moveInterval > 50) {
        moveInterval -= 5;
    }
    if (controlMode === 'mouse' && score % 10 === 0 && speed < 6) {
        speed += 0.2;
    }

    snake.push({ ...snake[snake.length - 1] });
    placeFood();
    // small chance to spawn a power-up / golden apple when new food is placed
    placePowerUp(0.18);
    placeGolden(0.15);
    updateObstacles();
}

function draw() {
    const colors = getThemeColors();
    drawBackground(colors);

    drawObstacles(colors);

    if (snake.length > 0) {
        drawSnake(colors);
    }

    drawFood(colors);

    if (goldenFood) {
        drawGolden(colors);
    }

    if (powerUp) {
        drawPowerUp(colors);
    }

    drawEffects();

    if (isPaused) {
        ctx.fillStyle = 'rgba(8, 24, 20, 0.55)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '700 32px "Baloo 2", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
        ctx.textBaseline = 'alphabetic';
    }

    if (activeEffects.length > 0) {
        drawHud(colors);
    }
}

function drawBackground(colors) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, colors.bgTop);
    g.addColorStop(1, colors.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = gridSize; x < canvas.width; x += gridSize) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, canvas.height);
    }
    for (let y = gridSize; y < canvas.height; y += gridSize) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(canvas.width, y + 0.5);
    }
    ctx.stroke();

    const v = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.width * 0.32,
        canvas.width / 2, canvas.height / 2, canvas.width * 0.72
    );
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, colors.vignette);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function strokePolyline(points) {
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (i > 0) {
            const prev = points[i - 1];
            // break the tube where the snake wraps across an edge
            if (Math.hypot(p.x - prev.x, p.y - prev.y) > gridSize * 2) drawing = false;
        }
        if (!drawing) { ctx.moveTo(p.x, p.y); drawing = true; }
        else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
}

function drawSnake(colors) {
    const head = snake[0];
    const tail = snake[snake.length - 1];

    // body tube with a soft drop shadow
    ctx.save();
    ctx.shadowColor = colors.shadow;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = gridSize;
    const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    grad.addColorStop(0, colors.bodyTop);
    grad.addColorStop(1, colors.bodyBottom);
    ctx.strokeStyle = grad;
    strokePolyline(snake);
    ctx.restore();

    // glossy lighter core
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = gridSize * 0.42;
    ctx.strokeStyle = colors.gloss;
    strokePolyline(snake);
    ctx.restore();

    drawHead(colors);
}

function drawHead(colors) {
    const head = snake[0];
    let angle = 0;
    if (controlMode === 'mouse') {
        angle = Math.atan2(mousePos.y - head.y, mousePos.x - head.x);
    } else {
        if (velocity.x > 0) angle = 0;
        else if (velocity.x < 0) angle = Math.PI;
        else if (velocity.y > 0) angle = Math.PI / 2;
        else angle = -Math.PI / 2;
    }

    const hr = gridSize / 2 + 1;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);

    const hg = ctx.createRadialGradient(-hr * 0.3, -hr * 0.3, hr * 0.2, 0, 0, hr);
    hg.addColorStop(0, colors.headTop);
    hg.addColorStop(1, colors.headBottom);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, hr, 0, Math.PI * 2);
    ctx.fill();

    // rosy cheeks
    ctx.fillStyle = colors.cheek;
    ctx.beginPath(); ctx.arc(hr * 0.1, hr * 0.6, hr * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hr * 0.1, -hr * 0.6, hr * 0.2, 0, Math.PI * 2); ctx.fill();

    drawCuteEye(hr * 0.38, -hr * 0.4, hr);
    drawCuteEye(hr * 0.38, hr * 0.4, hr);

    ctx.restore();
}

function drawCuteEye(ex, ey, hr) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex, ey, hr * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath(); ctx.arc(ex + hr * 0.07, ey, hr * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(ex + hr * 0.02, ey - hr * 0.07, hr * 0.06, 0, Math.PI * 2); ctx.fill();
}

function drawFood(colors) {
    const fr = gridSize / 2 - 1;
    const t = performance.now();
    const fx = food.x;
    const fy = food.y + Math.sin(t * 0.003) * 1.2;

    ctx.save();
    ctx.shadowColor = colors.shadow;
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    const fg = ctx.createRadialGradient(fx - fr * 0.35, fy - fr * 0.35, fr * 0.2, fx, fy, fr);
    fg.addColorStop(0, colors.foodLight);
    fg.addColorStop(1, colors.food);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = colors.stem;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx, fy - fr + 2);
    ctx.lineTo(fx + 1, fy - fr - 4);
    ctx.stroke();

    ctx.fillStyle = colors.leaf;
    ctx.beginPath();
    ctx.ellipse(fx + 6, fy - fr - 1, 4.5, 2.2, -Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(fx - fr * 0.32, fy - fr * 0.32, fr * 0.24, fr * 0.12, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
}

function drawObstacles(colors) {
    for (const o of obstacles) {
        const s = gridSize - 4;
        ctx.save();
        ctx.shadowColor = colors.shadow;
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        const g = ctx.createLinearGradient(o.x, o.y - s / 2, o.x, o.y + s / 2);
        g.addColorStop(0, colors.obstacleTop);
        g.addColorStop(1, colors.obstacleBottom);
        ctx.fillStyle = g;
        roundRect(o.x - s / 2, o.y - s / 2, s, s, 6);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        roundRect(o.x - s / 2 + 2, o.y - s / 2 + 2, s - 4, (s - 4) * 0.4, 4);
        ctx.fill();
    }
}

function drawGolden(colors) {
    const t = performance.now();
    const fr = gridSize / 2 - 1;
    const gx = goldenFood.x;
    const gy = goldenFood.y + Math.sin(t * 0.004) * 1.5;
    const pulse = 0.5 + 0.25 * Math.sin(t * 0.008);

    const glow = ctx.createRadialGradient(gx, gy, 2, gx, gy, gridSize * 1.2);
    glow.addColorStop(0, hexA('#ffd54f', pulse));
    glow.addColorStop(1, hexA('#ffd54f', 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(gx, gy, gridSize * 1.2, 0, Math.PI * 2);
    ctx.fill();

    const fg = ctx.createRadialGradient(gx - fr * 0.35, gy - fr * 0.35, fr * 0.2, gx, gy, fr);
    fg.addColorStop(0, '#fff3c4');
    fg.addColorStop(1, '#f4b400');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(gx, gy, fr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = colors.stem;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gx, gy - fr + 2);
    ctx.lineTo(gx + 1, gy - fr - 4);
    ctx.stroke();

    ctx.fillStyle = colors.leaf;
    ctx.beginPath();
    ctx.ellipse(gx + 6, gy - fr - 1, 4.5, 2.2, -Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(gx - fr * 0.32, gy - fr * 0.32, fr * 0.24, fr * 0.12, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
}

function drawPowerUp(colors) {
    const glow = ({ slow: '#4fc3f7', double: '#ffd54f', magnet: '#b388ff' })[powerUp.type] || '#ffffff';
    const glyph = ({ slow: '🐢', double: '✨', magnet: '🧲' })[powerUp.type] || '?';
    const t = performance.now();
    const px = powerUp.x;
    const py = powerUp.y + Math.sin(t * 0.004) * 2.5;
    const pulse = 0.55 + 0.2 * Math.sin(t * 0.006);

    const g = ctx.createRadialGradient(px, py, 2, px, py, gridSize);
    g.addColorStop(0, hexA(glow, pulse));
    g.addColorStop(1, hexA(glow, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, gridSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${gridSize - 1}px "Baloo 2", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, px, py + 1);
    ctx.textBaseline = 'alphabetic';
}

function drawHud(colors) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px "Baloo 2", sans-serif';
    let y = 16;
    for (const eff of activeEffects) {
        const remaining = Math.max(0, Math.ceil((eff.expiresAt - Date.now()) / 1000));
        const icon = ({ slow: '🐢', double: '✨', magnet: '🧲' })[eff.type] || '';
        const label = `${icon} ${remaining}s`;
        const w = ctx.measureText(label).width + 16;
        ctx.fillStyle = colors.hudPill;
        roundRect(8, y - 9, w, 18, 9);
        ctx.fill();
        ctx.fillStyle = colors.hud;
        ctx.fillText(label, 16, y + 1);
        y += 24;
    }
    ctx.textBaseline = 'alphabetic';
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 3.2;
        particles.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 1,
            life: 1,
            decay: 0.02 + Math.random() * 0.025,
            size: 2 + Math.random() * 3,
            color
        });
    }
}

function spawnFloatText(x, y, text, color) {
    floatTexts.push({ x, y, text, color, life: 1 });
}

function updateEffects(deltaTime) {
    const f = deltaTime ? Math.min(deltaTime / 16.67, 3) : 1;
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * f;
        p.y += p.vy * f;
        p.vy += 0.12 * f;
        p.vx *= 0.98;
        p.life -= p.decay * f;
        if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const tx = floatTexts[i];
        tx.y -= 0.7 * f;
        tx.life -= 0.02 * f;
        if (tx.life <= 0) floatTexts.splice(i, 1);
    }
}

function drawEffects() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * Math.max(0.2, p.life), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = '700 18px "Baloo 2", sans-serif';
    for (const tx of floatTexts) {
        ctx.globalAlpha = Math.max(0, tx.life);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
}

function bumpScore() {
    scoreElement.classList.remove('bump');
    void scoreElement.offsetWidth;
    scoreElement.classList.add('bump');
}

function triggerDeath() {
    const area = document.querySelector('.game-area');
    const flash = document.getElementById('boardFlash');
    if (area) {
        area.classList.remove('shake');
        void area.offsetWidth;
        area.classList.add('shake');
    }
    if (flash) {
        flash.classList.remove('flash');
        void flash.offsetWidth;
        flash.classList.add('flash');
    }
}

function playEatSound() {
    if (isMuted || volume <= 0) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playGameOverSound() {
    if (isMuted || volume <= 0) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.5);
    
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

function applyPersistedSettings() {
    const modeRadio = document.querySelector(`input[name="controlMode"][value="${controlMode}"]`);
    if (modeRadio) modeRadio.checked = true;
    instructionsElement.innerText = controlMode === 'mouse'
        ? 'Move Mouse to Guide Snake | Space to Pause'
        : 'Use Arrow Keys/WASD to Move | Space to Pause';
    muteBtn.innerText = isMuted ? '🔇' : '🔊';
    volumeSlider.value = volume;
    if (wallsToggle) wallsToggle.checked = wallsMode;
}

function applyTheme() {
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        themeBtn.innerText = '☀️';
    } else {
        document.body.classList.remove('dark-mode');
        themeBtn.innerText = '🌓';
    }
    if (window.gameState && !window.gameState.running) draw();
}

function getThemeColors() {
    if (isDarkMode) {
        return {
            bgTop: '#0c3a45', bgBottom: '#052730',
            grid: 'rgba(150,220,200,0.06)', vignette: 'rgba(0,0,0,0.38)',
            bodyTop: '#b6e892', bodyBottom: '#79c24a',
            headTop: '#d2f0a8', headBottom: '#8ed25e',
            gloss: 'rgba(255,255,255,0.22)',
            cheek: 'rgba(255,150,170,0.40)',
            food: '#ec5a86', foodLight: '#ff9bbb',
            stem: '#a06a52', leaf: '#8ed25e',
            shadow: 'rgba(0,0,0,0.45)',
            hud: '#d7efe6', hudPill: 'rgba(6,40,46,0.6)',
            gold: '#ffd54f', obstacleTop: '#43616b', obstacleBottom: '#2a444d',
            pop: '#ffe082'
        };
    }
    return {
        bgTop: '#ecfaf1', bgBottom: '#d6f1e5',
        grid: 'rgba(70,160,110,0.09)', vignette: 'rgba(40,90,70,0.10)',
        bodyTop: '#7bd389', bodyBottom: '#46af72',
        headTop: '#92e3a4', headBottom: '#5cc47f',
        gloss: 'rgba(255,255,255,0.38)',
        cheek: 'rgba(255,140,160,0.50)',
        food: '#ef5b5b', foodLight: '#ffb3a7',
        stem: '#9c6b4f', leaf: '#5cc47f',
        shadow: 'rgba(50,110,80,0.28)',
        hud: '#3a7a55', hudPill: 'rgba(255,255,255,0.78)',
        gold: '#f4b400', obstacleTop: '#c2ad8f', obstacleBottom: '#9a8467',
        pop: '#ff5d6c'
    };
}

function cellFree(x, y, opts) {
    opts = opts || {};
    for (const part of snake) if (Math.hypot(part.x - x, part.y - y) < gridSize) return false;
    for (const o of obstacles) if (Math.hypot(o.x - x, o.y - y) < gridSize) return false;
    if (powerUp && Math.hypot(powerUp.x - x, powerUp.y - y) < gridSize) return false;
    if (!opts.ignoreFood && food && Math.hypot(food.x - x, food.y - y) < gridSize) return false;
    if (goldenFood && Math.hypot(goldenFood.x - x, goldenFood.y - y) < gridSize) return false;
    if (opts.minHeadDist && snake[0] && Math.hypot(snake[0].x - x, snake[0].y - y) < opts.minHeadDist) return false;
    return true;
}

function randomFreeCell(opts) {
    const cols = canvas.width / gridSize;
    const rows = canvas.height / gridSize;
    let tries = 0;
    while (tries < 300) {
        const x = Math.floor(Math.random() * cols) * gridSize + gridSize / 2;
        const y = Math.floor(Math.random() * rows) * gridSize + gridSize / 2;
        if (cellFree(x, y, opts)) return { x, y };
        tries++;
    }
    return null;
}

function placeGolden(chance = 0.15) {
    if (goldenFood) return;
    if (Math.random() > chance) return;
    const c = randomFreeCell();
    if (c) goldenFood = { x: c.x, y: c.y, expiresAt: Date.now() + GOLDEN_LIFETIME };
}

function updateObstacles() {
    const target = Math.min(Math.floor(score / 5), MAX_OBSTACLES);
    while (obstacles.length < target) {
        const c = randomFreeCell({ minHeadDist: gridSize * 4 });
        if (!c) break;
        obstacles.push(c);
    }
}

function eatGolden() {
    if (!goldenFood) return;
    const gx = goldenFood.x, gy = goldenFood.y;
    goldenFood = null;

    const pts = GOLDEN_VALUE * scoreMultiplier;
    score += pts;
    window.gameState.score = score;
    scoreElement.innerText = score;
    bumpScore();
    playEatSound();

    const colors = getThemeColors();
    spawnBurst(gx, gy, colors.gold, 22);
    spawnFloatText(gx, gy - gridSize, '+' + pts, colors.gold);

    snake.push({ ...snake[snake.length - 1] });
    updateObstacles();
}

function placeFood() {
    const c = randomFreeCell({ ignoreFood: true });
    if (c) { food = c; return; }
    const cols = canvas.width / gridSize;
    const rows = canvas.height / gridSize;
    food = {
        x: Math.floor(Math.random() * cols) * gridSize + gridSize / 2,
        y: Math.floor(Math.random() * rows) * gridSize + gridSize / 2
    };
}

function gameOver() {
    window.gameState.gameOver = true;
    window.gameState.running = false;
    triggerDeath();

    const isNewRecord = score > highScore;
    if (isNewRecord) {
        highScore = score;
        localStorage.setItem('snakeHighScore', highScore);
        highScoreElement.innerText = highScore;
    }

    showGameOver(isNewRecord);
    playGameOverSound();
}

function togglePause() {
    if (!window.gameState.running || window.gameState.gameOver) return;
    isPaused = !isPaused;
    window.gameState.paused = isPaused;
    if (!isPaused) {
        // Resume
    } else {
        draw();
    }
}

// --- Input & Listeners ---

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        togglePause();
        return;
    }
    if (controlMode === 'mouse') return;
    if (isPaused || !window.gameState.running) return;
    
    let newVel = null;
    const speed = gridSize; 

    switch(e.key.toLowerCase()) {
        case 'arrowup': case 'w': newVel = {x: 0, y: -speed}; break;
        case 'arrowdown': case 's': newVel = {x: 0, y: speed}; break;
        case 'arrowleft': case 'a': newVel = {x: -speed, y: 0}; break;
        case 'arrowright': case 'd': newVel = {x: speed, y: 0}; break;
    }
    
    if (newVel) {
        const lastVel = inputQueue.length > 0 ? inputQueue[inputQueue.length-1] : velocity;
        if (newVel.x !== -lastVel.x || newVel.y !== -lastVel.y) {
            if (inputQueue.length < 3) inputQueue.push(newVel);
        }
    }
});

controlRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        controlMode = e.target.value;
        localStorage.setItem('snakeControlMode', controlMode);
        showMenu(); // Reset to menu on mode switch
        
        if (controlMode === 'mouse') {
            instructionsElement.innerText = 'Move Mouse to Guide Snake | Space to Pause';
        } else {
            instructionsElement.innerText = 'Use Arrow Keys/WASD to Move | Space to Pause';
        }
    });
});

if (wallsToggle) {
    wallsToggle.addEventListener('change', (e) => {
        wallsMode = e.target.checked;
        localStorage.setItem('snakeWalls', wallsMode);
        showMenu();
    });
}

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

themeBtn.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    localStorage.setItem('snakeDarkMode', isDarkMode);
    applyTheme();
});

muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem('snakeMuted', isMuted);
    muteBtn.innerText = isMuted ? '🔇' : '🔊';
});

volumeSlider.addEventListener('input', (e) => {
    volume = parseFloat(e.target.value);
    localStorage.setItem('snakeVolume', volume);
});

// Init
applyPersistedSettings();
applyTheme();
showMenu(); // Show menu initially instead of auto-start
