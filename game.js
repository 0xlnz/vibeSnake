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
let controlMode = 'keyboard'; // 'keyboard' or 'mouse'
let mousePos = { x: 0, y: 0 };

// Power-up system
let powerUp = null; // { type: 'slow'|'double'|'magnet', x, y }
let activeEffects = []; // [{type, expiresAt, data}]
let scoreMultiplier = 1;
const POWERUP_TYPES = ['slow','double','magnet'];
const POWERUP_DURATIONS = { slow: 6000, double: 6000, magnet: 6000 };

// Grid Mode timing
let lastTime = 0;
let moveInterval = 100;
let timeAccumulator = 0;
let inputQueue = []; // For Grid mode

// Audio
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isMuted = false;
let volume = 0.3;

// --- Functions ---

function showMenu() {
    window.gameState.running = false;
    window.gameState.gameOver = false;
    isPaused = false;
    gameOverlay.classList.remove('hidden');
    startBtn.style.display = 'inline-block';
    restartBtn.style.display = 'none';
    draw(); // Draw static background/snake
}

function showGameOver() {
    gameOverlay.classList.remove('hidden');
    startBtn.style.display = 'none';
    restartBtn.style.display = 'inline-block';
}

function startGame() {
    // Hide overlay
    gameOverlay.classList.add('hidden');

    // Initialize Snake
    snake = [];
    history = [];
    
    // Start in middle, adjust for cell center
    const cols = Math.floor(canvas.width / gridSize);
    const rows = Math.floor(canvas.height / gridSize);
    const startX_grid = Math.floor(cols / 2); // Center grid column
    const startY_grid = Math.floor(rows / 2); // Center grid row
    
    for(let i = 0; i < 3; i++) {
        snake.push({ 
            x: (startX_grid - i) * gridSize + gridSize/2, 
            y: startY_grid * gridSize + gridSize/2 
        });
    }
    
    // Pre-fill history for smooth mode using the starting head position
    const startX = snake[0].x;
    const startY = snake[0].y;
    for (let i = 0; i < 100; i++) {
        history.push({ x: startX - (i * speed), y: startY });
    }

    velocity = { x: gridSize, y: 0 }; // Default right
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
    }

    draw();

    requestAnimationFrame(gameLoop);
}

// --- Power-up: spawn, apply, timers ---
function placePowerUp(chance = 0.18) {
    // Do not replace an existing power-up
    if (powerUp) return;

    // small chance to spawn a power-up at a free cell
    if (Math.random() > chance) {
        return;
    }

    const cols = canvas.width / gridSize;
    const rows = canvas.height / gridSize;

    let tries = 0;
    while (tries < 200) {
        const candidate = {
            x: Math.floor(Math.random() * cols) * gridSize + gridSize/2,
            y: Math.floor(Math.random() * rows) * gridSize + gridSize/2,
            type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
        };

        // avoid overlapping snake or food
        let ok = true;
        if (Math.hypot(candidate.x - food.x, candidate.y - food.y) < gridSize) ok = false;
        for (let part of snake) {
            if (Math.hypot(part.x - candidate.x, part.y - candidate.y) < gridSize) { ok = false; break; }
        }

        if (ok) { powerUp = candidate; return; }
        tries++;
    }

    powerUp = null;
}

function eatPowerUp() {
    if (!powerUp) return;
    const type = powerUp.type;
    powerUp = null;

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
        activeEffects.push({ type: 'magnet', expiresAt: now + POWERUP_DURATIONS.magnet, data: { strength: 0.12, radius: 60 } });
    }
}

function updatePowerUpTimers(timestamp) {
    const now = Date.now();

    // Magnet behavior: attract food slightly towards head
    const magnet = activeEffects.find(e => e.type === 'magnet');
    if (magnet && snake.length > 0) {
        const head = snake[0];
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const dist = Math.hypot(dx, dy);
        const radius = magnet.data.radius || 60;
        const strength = magnet.data.strength || 0.12;

        // Only attract if the food is within the magnet radius
        if (dist <= radius) {
            // If very close, snap to head and eat immediately to avoid trailing behavior
            if (dist < gridSize * 0.9) {
                food.x = head.x;
                food.y = head.y;
                eatFood();
            } else {
                food.x += dx * strength;
                food.y += dy * strength;
            }
        }
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

    handleBoundaries(newHead);
    
    // Check Self Collision
    for (let i = 1; i < snake.length; i++) {
        const dx = Math.abs(newHead.x - snake[i].x);
        const dy = Math.abs(newHead.y - snake[i].y);
        if (dx < 5 && dy < 5) {
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
    
    handleBoundaries(newHead);
    
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
    
    const distFood = Math.hypot(snake[0].x - food.x, snake[0].y - food.y);
    if (distFood < gridSize) { 
        eatFood();
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
        // Clamp logic for Mouse Mode: Ensure snake head center stays within canvas boundaries
        pos.x = Math.max(gridSize / 2, Math.min(canvas.width - gridSize / 2, pos.x));
        pos.y = Math.max(gridSize / 2, Math.min(canvas.height - gridSize / 2, pos.y));
    } else {
        // Wrap logic for Keyboard Mode: Wrap around when the entire snake segment leaves the canvas
        if (pos.x < 0 - gridSize / 2) pos.x = canvas.width + gridSize / 2;
        else if (pos.x > canvas.width + gridSize / 2) pos.x = 0 - gridSize / 2;
        
        if (pos.y < 0 - gridSize / 2) pos.y = canvas.height + gridSize / 2;
        else if (pos.y > canvas.height + gridSize / 2) pos.y = 0 - gridSize / 2;
    }
}

function eatFood() {
    score += scoreMultiplier;
    window.gameState.score = score;
    scoreElement.innerText = score;
    playEatSound();
    
    if (controlMode === 'keyboard' && score % 5 === 0 && moveInterval > 50) {
        moveInterval -= 5;
    }
    if (controlMode === 'mouse' && score % 10 === 0 && speed < 6) {
        speed += 0.2;
    }

    snake.push({ ...snake[snake.length - 1] });
    placeFood();
    // small chance to spawn a power-up when new food is placed
    placePowerUp(0.18);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const colors = getThemeColors();

    // If snake is empty (initially), draw a static placeholder snake?
    // Or just clear is fine.
    if (snake.length === 0) {
        // Optional: Draw a start screen snake?
        return;
    }

    for (let i = snake.length - 1; i >= 0; i--) {
        const part = snake[i];
        ctx.fillStyle = i === 0 ? colors.head : colors.body;
        
        ctx.beginPath();
        const radius = gridSize / 2 - 1;
        ctx.arc(part.x, part.y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        if (i === 0) {
            let angle = 0;
            if (controlMode === 'mouse') {
                const dx = mousePos.x - part.x;
                const dy = mousePos.y - part.y;
                angle = Math.atan2(dy, dx);
            } else {
                if (velocity.x > 0) angle = 0;
                else if (velocity.x < 0) angle = Math.PI;
                else if (velocity.y > 0) angle = Math.PI / 2;
                else angle = -Math.PI / 2;
            }
            drawEye(ctx, part.x, part.y, angle, -4, -4);
            drawEye(ctx, part.x, part.y, angle, 4, -4);
        }
    }
    // Draw power-up if present
    if (powerUp) {
        const pColor = ({ slow: '#0277bd', double: '#ffb300', magnet: '#6d4c41' })[powerUp.type] || '#000';
        ctx.fillStyle = pColor;
        ctx.beginPath();
        ctx.rect(powerUp.x - gridSize/2 + 4, powerUp.y - gridSize/2 + 4, gridSize - 8, gridSize - 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '12px Fredoka One, sans-serif';
        ctx.textAlign = 'center';
        const label = ({ slow: 'Z', double: '2x', magnet: 'M' })[powerUp.type] || '?';
        ctx.fillText(label, powerUp.x, powerUp.y + 4);
    }

    ctx.fillStyle = colors.food;
    ctx.beginPath();
    ctx.arc(food.x, food.y, gridSize/2 - 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = colors.leaf;
    ctx.beginPath();
    ctx.ellipse(food.x + 2, food.y - 8, 4, 2, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();

    if (isPaused) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '30px "Fredoka One", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
    }

    // Draw active effects HUD
    if (activeEffects.length > 0) {
        ctx.font = '12px Fredoka One, sans-serif';
        ctx.textAlign = 'left';
        let x = 10;
        let y = 18;
        for (const eff of activeEffects) {
            const remaining = Math.max(0, Math.ceil((eff.expiresAt - Date.now()) / 1000));
            ctx.fillStyle = '#000';
            ctx.fillText(`${eff.type} (${remaining}s)`, x, y);
            y += 16;
        }
    }
}

function drawEye(ctx, cx, cy, angle, offsetX, offsetY) {
    const rotX = offsetX * Math.cos(angle) - offsetY * Math.sin(angle);
    const rotY = offsetX * Math.sin(angle) + offsetY * Math.cos(angle);
    
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(cx + rotX, cy + rotY, 3, 0, Math.PI*2);
    ctx.fill();
    
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(cx + rotX, cy + rotY, 1.5, 0, Math.PI*2);
    ctx.fill();
}

function playEatSound() {
    if (isMuted) return;
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
    if (isMuted) return;
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
            head: '#859900', // Green
            body: '#586e75', // Grey-ish
            food: '#d33682', // Magenta
            leaf: '#859900'
        };
    } else {
        return {
            head: '#81c784',
            body: '#a5d6a7',
            food: '#ff8a80',
            leaf: '#81c784'
        };
    }
}

function placeFood() {
    const cols = canvas.width / gridSize;
    const rows = canvas.height / gridSize;
    
    food = {
        x: Math.floor(Math.random() * cols) * gridSize + gridSize/2,
        y: Math.floor(Math.random() * rows) * gridSize + gridSize/2
    };
    
    for(let part of snake) {
        if (Math.hypot(part.x - food.x, part.y - food.y) < gridSize) {
            placeFood();
            return;
        }
    }
}

function gameOver() {
    window.gameState.gameOver = true;
    window.gameState.running = false;
    showGameOver();
    playGameOverSound();
    
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('snakeHighScore', highScore);
        highScoreElement.innerText = highScore;
    }
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
        showMenu(); // Reset to menu on mode switch
        
        if (controlMode === 'mouse') {
            instructionsElement.innerText = 'Move Mouse to Guide Snake | Space to Pause';
        } else {
            instructionsElement.innerText = 'Use Arrow Keys/WASD to Move | Space to Pause';
        }
    });
});

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
    muteBtn.innerText = isMuted ? '🔇' : '🔊';
});

volumeSlider.addEventListener('input', (e) => {
    volume = parseFloat(e.target.value);
});

// Init
applyTheme();
showMenu(); // Show menu initially instead of auto-start
