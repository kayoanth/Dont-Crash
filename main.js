import * as THREE from 'three';

// Detecta se o dispositivo é mobile
const isMobile = window.innerWidth <= 768;

// ==========================================
// 1. CONFIGURAÇÕES & CONSTANTES
// ==========================================
const trackRadius = 225;
const trackWidth = 45;

const outerTrackRadius = trackRadius + trackWidth;
const innerTrackRadius = trackRadius - trackWidth;

const arcAngle1 = (1 / 3) * Math.PI;
const deltaY = Math.sin(arcAngle1) * innerTrackRadius;
const arcAngle2 = Math.asin(deltaY / outerTrackRadius);

const arcCenterX =
  (Math.cos(arcAngle1) * innerTrackRadius +
   Math.cos(arcAngle2) * outerTrackRadius) / 2;

const arcAngle3 = Math.acos(arcCenterX / innerTrackRadius);
const arcAngle4 = Math.acos(arcCenterX / outerTrackRadius);

// Lista de cores para os veículos concorrentes (NPCs) - sem o vermelho primário
const vehicleColors = [0x00d2d3, 0x10ac84, 0x54a0ff, 0x9b59b6, 0xf1c40f];
const speed = 0.0017;
const playerAngleInitial = Math.PI;

// ==========================================
// 2. VARIÁVEIS DE ESTADO & ÁUDIO
// ==========================================
let ready = false;
let isPaused = false;
let playerAngledMoved = 0;
let score = 0;
let otherVehicles = [];
let lastTimestamp;
let accelerate = false;
let decelerate = false;
let isGameStarted = false;
let highScore = localStorage.getItem('highScore') ? parseInt(localStorage.getItem('highScore')) : 0;

// Estado de Gráficos Baixos
let isLowGraphics = localStorage.getItem('lowGraphics') === 'true';

// Estados de Mudo
let isEngineMuted = localStorage.getItem('engineMuted') === 'true';
let isMusicMuted = localStorage.getItem('musicMuted') === 'true';

const scoreElement = document.getElementById("score");
const restartContainer = document.getElementById("restart-container");
const pauseContainer = document.getElementById("pause-container");
const startContainer = document.getElementById("start-container");
const btnStartGame = document.getElementById("btn-start-game");

// Referências da UI
const btnEngineList = document.querySelectorAll('.btn-toggle-engine');
const btnMusicList = document.querySelectorAll('.btn-toggle-music');
const btnLowGraphicsList = document.querySelectorAll('.btn-toggle-graphics');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const finalScoreElement = document.getElementById("final-score");
const highScoreElement = document.getElementById("high-score");

// Web Audio API
let audioCtx = null;
let engineOsc = null;
let engineGain = null;
let engineFilter = null;

const MAX_NPC_SOUNDS = 2; 
let npcVoicePool = [];

// Música de Fundo
const bgMusic = new Audio('music.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.25; 

// ==========================================
// CONTROLES DE PAUSA & ÁUDIO & GRÁFICOS
// ==========================================
function updateAudioUI() {
  btnEngineList.forEach(btn => {
    if (isEngineMuted) btn.classList.add('muted');
    else btn.classList.remove('muted');
  });

  btnMusicList.forEach(btn => {
    if (isMusicMuted) btn.classList.add('muted');
    else btn.classList.remove('muted');
  });
}
updateAudioUI();

function updateGraphicsUI() {
  btnLowGraphicsList.forEach(btn => {
    if (isLowGraphics) btn.classList.add('low-graphics-active');
    else btn.classList.remove('low-graphics-active');
  });
}
updateGraphicsUI();

function toggleLowGraphics() {
  isLowGraphics = !isLowGraphics;
  localStorage.setItem('lowGraphics', isLowGraphics);
  updateGraphicsUI();
  applyGraphicsSettings();
}

function applyGraphicsSettings() {
  renderer.shadowMap.enabled = !isLowGraphics;
  dirLight.castShadow = !isLowGraphics;

  scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = !isLowGraphics;
      child.receiveShadow = !isLowGraphics;

      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          mat.needsUpdate = true;
        });
      } else if (child.material) {
        child.material.needsUpdate = true;
      }
    }
  });
}

btnLowGraphicsList.forEach(btn => btn.addEventListener('click', toggleLowGraphics));

function toggleEngineSound() {
  isEngineMuted = !isEngineMuted;
  localStorage.setItem('engineMuted', isEngineMuted);
  updateAudioUI();
  updateEngineSound();
}

function toggleMusic() {
  isMusicMuted = !isMusicMuted;
  localStorage.setItem('musicMuted', isMusicMuted);
  updateAudioUI();
  if (isMusicMuted) pauseMusic();
  else if (!ready && !isPaused && lastTimestamp) playMusic();
}

btnEngineList.forEach(btn => btn.addEventListener('click', toggleEngineSound));
btnMusicList.forEach(btn => btn.addEventListener('click', toggleMusic));

function pauseGame() {
  if (ready || isPaused || (restartContainer && restartContainer.style.display === "flex")) return;

  isPaused = true;
  renderer.setAnimationLoop(null);
  pauseMusic();
  updateEngineSound();
  document.body.classList.add('paused');

  if (pauseContainer) pauseContainer.style.display = "flex";
  updatePauseBtnUI();
}

function resumeGame() {
  if (!isPaused) return;

  isPaused = false;
  lastTimestamp = undefined;
  renderer.setAnimationLoop(animation);
  playMusic();
  document.body.classList.remove('paused');

  if (pauseContainer) pauseContainer.style.display = "none";
  updatePauseBtnUI();
}

function togglePause() {
  if (ready || (restartContainer && restartContainer.style.display === "flex")) return;
  if (isPaused) {
    resumeGame();
  } else {
    pauseGame();
  }
}

function updatePauseBtnUI() {
  if (!btnPause) return;
  const iconPause = btnPause.querySelector('.icon-pause');
  const iconPlay = btnPause.querySelector('.icon-play');
  if (isPaused) {
    if (iconPause) iconPause.style.display = 'none';
    if (iconPlay) iconPlay.style.display = 'block';
  } else {
    if (iconPause) iconPause.style.display = 'block';
    if (iconPlay) iconPlay.style.display = 'none';
  }
}

function initAudio() {
  if (audioCtx) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();

  engineOsc = audioCtx.createOscillator();
  engineGain = audioCtx.createGain();
  engineFilter = audioCtx.createBiquadFilter();

  engineOsc.type = 'sawtooth';
  engineOsc.frequency.setValueAtTime(65, audioCtx.currentTime);
  engineFilter.type = 'lowpass';
  engineFilter.frequency.setValueAtTime(300, audioCtx.currentTime);
  engineGain.gain.setValueAtTime(0, audioCtx.currentTime);

  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(audioCtx.destination);
  engineOsc.start();

  for (let i = 0; i < MAX_NPC_SOUNDS; i++) {
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, audioCtx.currentTime);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, audioCtx.currentTime);
    gain.gain.setValueAtTime(0, audioCtx.currentTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();

    npcVoicePool.push({ osc, filter, gain });
  }
}

function playMusic() {
  if (bgMusic.paused && !isMusicMuted && !isPaused) {
    bgMusic.play().catch(() => {});
  }
}

function pauseMusic() {
  if (!bgMusic.paused) {
    bgMusic.pause();
  }
}

function updateEngineSound() {
  if (!audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  if (!ready && !isPaused && lastTimestamp && !isEngineMuted) {
    engineGain.gain.setTargetAtTime(0.12, now, 0.08);

    if (accelerate) {
      engineOsc.frequency.setTargetAtTime(155, now, 0.12);
      engineFilter.frequency.setTargetAtTime(650, now, 0.12);
    } else if (decelerate) {
      engineOsc.frequency.setTargetAtTime(40, now, 0.1);
      engineFilter.frequency.setTargetAtTime(180, now, 0.1);
    } else {
      engineOsc.frequency.setTargetAtTime(80, now, 0.15);
      engineFilter.frequency.setTargetAtTime(350, now, 0.15);
    }

    const vehiclesWithDistance = otherVehicles.map(v => {
      const dist = getDistance(playerCar.position, v.mesh.position);
      return { vehicle: v, dist };
    });

    vehiclesWithDistance.sort((a, b) => a.dist - b.dist);

    for (let i = 0; i < MAX_NPC_SOUNDS; i++) {
      const voice = npcVoicePool[i];
      const target = vehiclesWithDistance[i];

      if (target && target.dist < 700) {
        const maxNpcVolume = 0.035; 
        const volume = Math.max(0, maxNpcVolume * (1 - target.dist / 700));
        const pitch = 55 + (target.vehicle.speed * 20);

        voice.gain.gain.setTargetAtTime(volume, now, 0.1);
        voice.osc.frequency.setTargetAtTime(pitch, now, 0.1);
        voice.filter.frequency.setTargetAtTime(280, now, 0.1);
      } else {
        voice.gain.gain.setTargetAtTime(0, now, 0.08);
      }
    }

  } else {
    if (engineGain) engineGain.gain.setTargetAtTime(0, now, 0.08);
    npcVoicePool.forEach(v => {
        if (v.gain) v.gain.gain.setTargetAtTime(0, now, 0.08);
    });
  }
}

// Helper para criar materiais respeitando o modo Low Graphics
function createMaterial(config) {
  if (isLowGraphics) {
    return new THREE.MeshBasicMaterial(config);
  }
  return new THREE.MeshLambertMaterial(config);
}

// ==========================================
// 3. CENA, CÂMERA & LUZ
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x23471e); 

const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(300, -600, 800);
dirLight.castShadow = !isLowGraphics;

dirLight.shadow.mapSize.width = isMobile ? 512 : 2048;
dirLight.shadow.mapSize.height = isMobile ? 512 : 2048;
dirLight.shadow.camera.near = 200;
dirLight.shadow.camera.far = 2500;

const d = 1400;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;

scene.add(dirLight);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
camera.position.set(0, -210, 100);
camera.lookAt(0, 0, 0);

function updateCameraFrustum() {
  const aspect = window.innerWidth / window.innerHeight;
  let viewWidth, viewHeight;

  if (aspect < 1) {
    viewWidth = 850;
    viewHeight = viewWidth / aspect;
  } else {
    const minWidth = 820;
    const minHeight = 520;
    if (aspect < minWidth / minHeight) {
      viewWidth = minWidth;
      viewHeight = minWidth / aspect;
    } else {
      viewHeight = minHeight;
      viewWidth = minHeight * aspect;
    }
  }

  camera.left = viewWidth / -2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = viewHeight / -2;
  camera.updateProjectionMatrix();
}

updateCameraFrustum();

const renderer = new THREE.WebGLRenderer({ antialias: !isMobile });
renderer.setSize(window.innerWidth, window.innerHeight);

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = !isLowGraphics;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

document.body.appendChild(renderer.domElement);

// ==========================================
// 4. GERADOR DE FLORESTA DENSA
// ==========================================
function addSceneryDecoration() {
  const forestGreens = [
    0x33691e, 0x4caf50, 0x0b5345, 0x229954
  ];

  function createDenseCanopyTree() {
    const tree = new THREE.Group();

    const trunk = new THREE.Mesh(
      new THREE.BoxGeometry(16, 16, 40),
      createMaterial({ color: 0x3e2723 })
    );
    trunk.position.z = 20;
    
    trunk.castShadow = !isMobile && !isLowGraphics;
    trunk.receiveShadow = !isMobile && !isLowGraphics;
    tree.add(trunk);

    const color = forestGreens[Math.floor(Math.random() * forestGreens.length)];
    const canopy = new THREE.Mesh(
      new THREE.DodecahedronGeometry(50, 1),
      createMaterial({ color: color })
    );
    
    canopy.scale.set(1.2 + Math.random() * 0.4, 1.2 + Math.random() * 0.4, 0.7 + Math.random() * 0.3);
    canopy.position.z = 55 + Math.random() * 20;
    canopy.rotation.z = Math.random() * Math.PI;
    canopy.rotation.x = (Math.random() - 0.5) * 0.2;
    
    canopy.castShadow = !isMobile && !isLowGraphics;
    canopy.receiveShadow = !isMobile && !isLowGraphics;
    tree.add(canopy);

    return tree;
  }

  const mapLimit = 2200;
  const step = isMobile ? 140 : 85; 

  for (let x = -mapLimit; x <= mapLimit; x += step) {
    for (let y = -mapLimit; y <= mapLimit; y += step) {
      
      const offsetX = (Math.random() - 0.5) * 45;
      const offsetY = (Math.random() - 0.5) * 45;
      
      const finalX = x + offsetX;
      const finalY = y + offsetY;

      const distLeft = Math.sqrt((finalX - (-arcCenterX)) ** 2 + finalY ** 2);
      const distRight = Math.sqrt((finalX - arcCenterX) ** 2 + finalY ** 2);

      if (distLeft < 385 || distRight < 385) {
        continue; 
      }

      if (finalY < -260 && finalY > -650 && Math.abs(finalX) < 500) {
        continue; 
      }

      const tree = createDenseCanopyTree();
      tree.position.set(finalX, finalY, 0);
      
      const scale = 0.7 + Math.random() * 0.5;
      tree.scale.set(scale, scale, scale);
      
      scene.add(tree);
    }
  }
}

// ==========================================
// 5. MODELOS 3D (VEÍCULOS & SETA INDICADORA 2D)
// ==========================================
function Wheel() {
  const wheel = new THREE.Mesh(
    new THREE.BoxGeometry(12, 33, 12),
    createMaterial({ color: 0x333333 })
  );
  wheel.position.z = 6;
  wheel.castShadow = !isLowGraphics;
  return wheel;
}

function createPlayerIndicator() {
  const points = [
    new THREE.Vector3(-12, 12, 18), 
    new THREE.Vector3(0, 0, 0),     
    new THREE.Vector3(-12, -12, 18) 
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    linewidth: 5
  });

  const lineV = new THREE.Line(geometry, material);

  lineV.position.set(0, 0, 38); 

  return lineV;
}

function Car(overrideColor, isPlayer = false) {
  const car = new THREE.Group();
  const color = overrideColor || pickRandom(vehicleColors);

  const main = new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 15),
    createMaterial({ color })
  );
  main.position.z = 12;
  main.castShadow = !isLowGraphics;
  main.receiveShadow = !isLowGraphics;
  car.add(main);

  const carFrontTexture = getCarFrontTexture(color);
  carFrontTexture.center = new THREE.Vector2(0.5, 0.5);
  carFrontTexture.rotation = Math.PI / 2;

  const carBackTexture = getCarFrontTexture(color);
  carBackTexture.center = new THREE.Vector2(0.5, 0.5);
  carBackTexture.rotation = Math.PI / 2;

  const carRightSideTexture = getCarSideTexture(color);
  const carLeftSideTexture = getCarSideTexture(color);
  carLeftSideTexture.flipY = false;

  const cabinMat = createMaterial({ color });

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(33, 24, 12), [
    createMaterial({ map: carFrontTexture }),
    createMaterial({ map: carBackTexture }),
    createMaterial({ map: carLeftSideTexture }),
    createMaterial({ map: carRightSideTexture }),
    cabinMat,
    cabinMat,
  ]);
  cabin.position.x = -6;
  cabin.position.z = 25.5;
  cabin.castShadow = !isLowGraphics;
  cabin.receiveShadow = !isLowGraphics;
  car.add(cabin);

  const backWheel = Wheel();
  backWheel.position.x = -18;
  car.add(backWheel);

  const frontWheel = Wheel();
  frontWheel.position.x = 18;
  car.add(frontWheel);

  // Adiciona a seta minimalista 2D em 'V' caso seja o jogador
  if (isPlayer) {
    const indicator = createPlayerIndicator();
    car.add(indicator);
  }

  return car;
}

function Truck() {
  const truck = new THREE.Group();
  const color = pickRandom(vehicleColors);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(100, 25, 5),
    createMaterial({ color: 0x333333 })
  );
  base.position.z = 10;
  base.castShadow = !isLowGraphics;
  truck.add(base);

  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(75, 30, 40),
    createMaterial({ color: 0xf5f6fa })
  );
  cargo.position.x = -15;
  cargo.position.z = 30;
  cargo.castShadow = !isLowGraphics;
  cargo.receiveShadow = !isLowGraphics;
  truck.add(cargo);

  const truckFrontTexture = getTruckFrontTexture(color);
  truckFrontTexture.center = new THREE.Vector2(0.5, 0.5);
  truckFrontTexture.rotation = Math.PI / 2;

  const truckSideTexture = getTruckSideTexture(color);
  const truckSideTextureLeft = getTruckSideTexture(color);
  truckSideTextureLeft.flipY = false;

  const cabinMat = createMaterial({ color });

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(25, 30, 30), [
    createMaterial({ map: truckFrontTexture }),    
    cabinMat,                                                    
    createMaterial({ map: truckSideTextureLeft }), 
    createMaterial({ map: truckSideTexture }),     
    cabinMat,                                                     
    cabinMat                                                      
  ]);
  
  cabin.position.x = 35;
  cabin.position.z = 25;
  cabin.castShadow = !isLowGraphics;
  cabin.receiveShadow = !isLowGraphics;
  truck.add(cabin);

  const wheel1 = Wheel();
  wheel1.position.x = -35;
  truck.add(wheel1);

  const wheel2 = Wheel();
  wheel2.position.x = 0;
  truck.add(wheel2);

  const wheel3 = Wheel();
  wheel3.position.x = 35;
  truck.add(wheel3);

  return truck;
}

// ==========================================
// 6. PISTA E TERRENO 
// ==========================================
function renderMap() {
  const groundGeo = new THREE.PlaneGeometry(20000, 20000);
  const groundMat = createMaterial({ color: 0x2d5a27 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.z = -0.1;
  ground.receiveShadow = !isLowGraphics;
  scene.add(ground);

  const lineMarkingTexture = getLineMarkings(3000, 3000);
  const planeGeometry = new THREE.PlaneGeometry(3000, 3000);
  const planeMaterial = createMaterial({
    color: 0x546e90,
    map: lineMarkingTexture
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.receiveShadow = !isLowGraphics;
  scene.add(plane);

  const islandLeft = getLeftIsland();
  const islandRight = getRightIsland();
  const islandMiddle = getMiddleIsland();
  const outerField = getOuterField(3000, 3000);

  const fieldGeometry = new THREE.ExtrudeGeometry(
    [islandLeft, islandMiddle, islandRight, outerField],
    { depth: 8, bevelEnabled: false }
  );

  const fieldMesh = new THREE.Mesh(fieldGeometry, [
    createMaterial({ color: 0x269E26 }),
    createMaterial({ color: 0x2d1c15 }),
  ]);
  fieldMesh.receiveShadow = !isLowGraphics;
  scene.add(fieldMesh);
}

function getLeftIsland() {
  const islandLeft = new THREE.Shape();
  islandLeft.absarc(-arcCenterX, 0, innerTrackRadius, arcAngle1, -arcAngle1, false);
  islandLeft.absarc(arcCenterX, 0, outerTrackRadius, Math.PI + arcAngle2, Math.PI - arcAngle2, true);
  return islandLeft;
}

function getMiddleIsland() {
  const islandMiddle = new THREE.Shape();
  islandMiddle.absarc(-arcCenterX, 0, innerTrackRadius, arcAngle3, -arcAngle3, true);
  islandMiddle.absarc(arcCenterX, 0, innerTrackRadius, Math.PI + arcAngle3, Math.PI - arcAngle3, true);
  return islandMiddle;
}

function getRightIsland() {
  const islandRight = new THREE.Shape();
  islandRight.absarc(arcCenterX, 0, innerTrackRadius, Math.PI - arcAngle1, Math.PI + arcAngle1, true);
  islandRight.absarc(-arcCenterX, 0, outerTrackRadius, -arcAngle2, arcAngle2, false);
  return islandRight;
}

function getOuterField(mapWidth, mapHeight) {
  const field = new THREE.Shape();
  field.moveTo(-mapWidth / 2, -mapHeight / 2);
  field.lineTo(0, -mapHeight / 2);

  field.absarc(-arcCenterX, 0, outerTrackRadius, -arcAngle4, arcAngle4, true);
  field.absarc(arcCenterX, 0, outerTrackRadius, Math.PI - arcAngle4, Math.PI + arcAngle4, true);

  field.lineTo(0, -mapHeight / 2);
  field.lineTo(mapWidth / 2, -mapHeight / 2);
  field.lineTo(mapWidth / 2, mapHeight / 2);
  field.lineTo(-mapWidth / 2, mapHeight / 2);

  return field;
}

// ==========================================
// 7. INICIALIZAÇÃO DO JOGO
// ==========================================
// Carro Vermelho Fixo (0xff3333) e Seta Minimalista 2D em V ativada
const playerCar = Car(0xff3333, true);
scene.add(playerCar);

renderMap();
addSceneryDecoration(); 
reset();

// ==========================================
// 8. LOOP DE ANIMAÇÃO E INÍCIO
// ==========================================
function animation(timeStamp) {
  if (isPaused) return;

  if (!lastTimestamp) {
    lastTimestamp = timeStamp;
    return;
  }
  const timeDelta = timeStamp - lastTimestamp;

  movePlayerCar(timeDelta);

  const laps = Math.floor(Math.abs(playerAngledMoved) / (Math.PI * 2));

  if (laps !== score) {
    score = laps;
    if (scoreElement) scoreElement.innerText = score;
  }

  if (otherVehicles.length < (laps + 1) / 5) {
    addVehicle();
  }

  moveOtherVehicles(timeDelta);
  hitDetection();

  updateEngineSound();

  renderer.render(scene, camera);
  lastTimestamp = timeStamp;
}

function startGame() {
  initAudio();
  playMusic();
  
  if (startContainer) startContainer.style.display = "none";
  isGameStarted = true;

  if (ready) {
    ready = false;
    isPaused = false;
    if (pauseContainer) pauseContainer.style.display = "none";
    updatePauseBtnUI();
    restartContainer.style.display = "none";
    renderer.setAnimationLoop(animation);
  }
}

if (btnStartGame) {
  btnStartGame.addEventListener("click", startGame);
}

function goToMenu() {
  resetState();
  if (startContainer) startContainer.style.display = "flex";
  ready = true;
  renderer.render(scene, camera);
  updateEngineSound();
}

function restartGame() {
  resetState();
  if (startContainer) startContainer.style.display = "none";
  startGame();
}

function resetState() {
  playerAngledMoved = 0;
  movePlayerCar(0);
  score = 0;
  if (scoreElement) scoreElement.innerText = score;
  lastTimestamp = undefined;
  isPaused = false;

  otherVehicles.forEach((vehicle) => {
    scene.remove(vehicle.mesh);
  });
  otherVehicles = [];

  if (pauseContainer) pauseContainer.style.display = "none";
  if (restartContainer) restartContainer.style.display = "none";
  updatePauseBtnUI();
}

function reset() {
  goToMenu();
}

// ==========================================
// 9. MOVIMENTAÇÃO E COLISÕES
// ==========================================
function movePlayerCar(timeDelta) {
  const playerSpeed = getPlayerSpeed();
  playerAngledMoved -= playerSpeed * timeDelta;

  const totalPlayerAngle = playerAngleInitial + playerAngledMoved;

  const playerX = Math.cos(totalPlayerAngle) * trackRadius - arcCenterX;
  const playerY = Math.sin(totalPlayerAngle) * trackRadius;

  playerCar.position.x = playerX;
  playerCar.position.y = playerY;
  playerCar.rotation.z = totalPlayerAngle - Math.PI / 2;
}

function getPlayerSpeed() {
  if (accelerate) return speed * 2;
  if (decelerate) return speed * 0.5;
  return speed;
}

function addVehicle() {
  const vehicleTypes = ["car", "truck"];
  const type = pickRandom(vehicleTypes);
  const mesh = type === "car" ? Car() : Truck();
  scene.add(mesh);

  const clockwise = Math.random() >= 0.5;
  const angle = clockwise ? Math.PI / 2 : -Math.PI / 2;
  const vehicleSpeed = getVehicleSpeed(type);

  otherVehicles.push({ mesh, type, clockwise, angle, speed: vehicleSpeed });
}

function getVehicleSpeed(type) {
  if (type === "car") return 1 + Math.random() * 0.8;
  if (type === "truck") return 0.6 + Math.random() * 0.6;
}

function moveOtherVehicles(timeDelta) {
  otherVehicles.forEach((vehicle) => {
    if (vehicle.clockwise) {
      vehicle.angle -= speed * timeDelta * vehicle.speed;
    } else {
      vehicle.angle += speed * timeDelta * vehicle.speed;
    }

    const vehicleX = Math.cos(vehicle.angle) * trackRadius + arcCenterX;
    const vehicleY = Math.sin(vehicle.angle) * trackRadius;
    const rotation = vehicle.angle + (vehicle.clockwise ? -Math.PI / 2 : Math.PI / 2);

    vehicle.mesh.position.x = vehicleX;
    vehicle.mesh.position.y = vehicleY;
    vehicle.mesh.rotation.z = rotation;
  });
}

function getHitZonePosition(center, angle, clockwise, distance) {
  const directionAngle = angle + (clockwise ? -Math.PI / 2 : Math.PI / 2);
  return {
    x: center.x + Math.cos(directionAngle) * distance,
    y: center.y + Math.sin(directionAngle) * distance,
  };
}

function hitDetection() {
  const playerHitZone1 = getHitZonePosition(
    playerCar.position,
    playerAngleInitial + playerAngledMoved,
    true,
    15
  );

  const playerHitZone2 = getHitZonePosition(
    playerCar.position,
    playerAngleInitial + playerAngledMoved,
    true,
    -15
  );

  const hit = otherVehicles.some((vehicle) => {
    const vehicleHitZone1 = getHitZonePosition(
      vehicle.mesh.position,
      vehicle.angle,
      vehicle.clockwise,
      15
    );

    const vehicleHitZone2 = getHitZonePosition(
      vehicle.mesh.position,
      vehicle.angle,
      vehicle.clockwise,
      -15
    );

    if (getDistance(playerHitZone1, vehicleHitZone1) < 40) return true;
    if (getDistance(playerHitZone1, vehicleHitZone2) < 40) return true;
    if (getDistance(playerHitZone2, vehicleHitZone2) < 40) return true;

    return false;
  });

  if (hit) {
    renderer.setAnimationLoop(null);

    if (score > highScore) {
      highScore = score;
      localStorage.setItem('highScore', highScore);
    }

    if (finalScoreElement) finalScoreElement.innerText = score;
    if (highScoreElement) highScoreElement.innerText = highScore;

    if (restartContainer) restartContainer.style.display = "flex";
    
    accelerate = false;
    decelerate = false;
    lastTimestamp = undefined; 

    if (audioCtx) {
      const now = audioCtx.currentTime;
      if (engineGain) {
        engineGain.gain.cancelScheduledValues(now);
        engineGain.gain.setValueAtTime(0, now);
      }
      npcVoicePool.forEach(voice => {
        if (voice.gain) {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(0, now);
        }
      });
    }
  }
}

function getDistance(coordinate1, coordinate2) {
  return Math.sqrt(
    (coordinate2.x - coordinate1.x) ** 2 + (coordinate2.y - coordinate1.y) ** 2
  );
}

// ==========================================
// 10. EVENTOS DE CONTROLE (TECLADO & TOUCH)
// ==========================================
window.addEventListener("keydown", function (event) {
  if (event.target.tagName === 'BUTTON') return; 

  const key = event.key.toLowerCase();
  if (key === "c") {
    toggleEngineSound();
    return;
  }
  
  if (key === "v") {
    toggleMusic();
    return;
  }

  if (key === "l") {
    toggleLowGraphics();
    return;
  }

  if (key === "e") {
    togglePause();
    return;
  }

  if (isPaused) return;

  initAudio();

  if (event.key === "ArrowUp") {
    startGame();
    accelerate = true;
    return;
  }

  if (event.key === "ArrowDown") {
    decelerate = true;
    return;
  }

  if (key === "r") {
    restartGame();
    return;
  }
});

window.addEventListener("keyup", function (event) {
  if (event.key === "ArrowUp") {
    accelerate = false;
    return;
  }
  if (event.key === "ArrowDown") {
    decelerate = false;
    return;
  }
});

const btnAccel = document.getElementById("btn-accel");
const btnDecel = document.getElementById("btn-decel");
const btnRestart = document.getElementById("btn-restart");

window.addEventListener("contextmenu", (e) => e.preventDefault());

const handleAccelStart = (e) => {
  if (e.cancelable) e.preventDefault();
  if (isPaused) return;
  startGame();
  accelerate = true;
};
const handleAccelEnd = (e) => {
  if (e.cancelable) e.preventDefault();
  accelerate = false;
};

if (btnAccel) {
  btnAccel.addEventListener("touchstart", handleAccelStart, { passive: false });
  btnAccel.addEventListener("touchend", handleAccelEnd, { passive: false });
  btnAccel.addEventListener("mousedown", handleAccelStart);
  btnAccel.addEventListener("mouseup", handleAccelEnd);
  btnAccel.addEventListener("mouseleave", handleAccelEnd);
}

const handleDecelStart = (e) => {
  if (e.cancelable) e.preventDefault();
  if (isPaused) return;
  initAudio();
  decelerate = true;
};
const handleDecelEnd = (e) => {
  if (e.cancelable) e.preventDefault();
  decelerate = false;
};

if (btnDecel) {
  btnDecel.addEventListener("touchstart", handleDecelStart, { passive: false });
  btnDecel.addEventListener("touchend", handleDecelEnd, { passive: false });
  btnDecel.addEventListener("mousedown", handleDecelStart);
  btnDecel.addEventListener("mouseup", handleDecelEnd);
  btnDecel.addEventListener("mouseleave", handleDecelEnd);
}

const handleRestart = (e) => {
  if (e.cancelable) e.preventDefault();
  reset();
};
if (btnRestart) {
  btnRestart.addEventListener("click", handleRestart);
  btnRestart.addEventListener("touchstart", handleRestart, { passive: false });
}

if (btnPause) btnPause.addEventListener('click', togglePause);
if (btnResume) btnResume.addEventListener('click', resumeGame);

window.addEventListener("resize", function () {
  updateCameraFrustum();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 11. TEXTURAS E UTILITÁRIOS
// ==========================================
function getCarFrontTexture(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d");

  context.fillStyle = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
  context.fillRect(0, 0, 64, 32);

  context.fillStyle = "#444444";
  context.fillRect(8, 8, 48, 24);

  return new THREE.CanvasTexture(canvas);
}

function getCarSideTexture(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext("2d");

  context.fillStyle = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
  context.fillRect(0, 0, 128, 32);

  context.fillStyle = "#444444";
  context.fillRect(10, 8, 38, 24);
  context.fillRect(58, 8, 60, 24);

  return new THREE.CanvasTexture(canvas);
}

function getLineMarkings(mapWidth, mapHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = mapWidth;
  canvas.height = mapHeight;
  const context = canvas.getContext("2d");

  context.fillStyle = "#546E90";
  context.fillRect(0, 0, mapWidth, mapHeight);

  context.lineWidth = 3;
  context.strokeStyle = "#FFFFFF";
  context.setLineDash([12, 16]);

  context.beginPath();
  context.arc(mapWidth / 2 - arcCenterX, mapHeight / 2, trackRadius, 0, Math.PI * 2);
  context.stroke();

  context.beginPath();
  context.arc(mapWidth / 2 + arcCenterX, mapHeight / 2, trackRadius, 0, Math.PI * 2);
  context.stroke();

  return new THREE.CanvasTexture(canvas);
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getTruckFrontTexture(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  context.fillStyle = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
  context.fillRect(0, 0, 64, 64);

  context.fillStyle = "#444444";
  context.fillRect(8, 20, 48, 30);

  return new THREE.CanvasTexture(canvas);
}

function getTruckSideTexture(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  context.fillStyle = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
  context.fillRect(0, 0, 64, 64);

  context.fillStyle = "#444444";
  context.fillRect(15, 20, 32, 28);

  return new THREE.CanvasTexture(canvas);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseMusic();

    if (!ready && !isPaused && lastTimestamp) {
      pauseGame();
    } else {
      if (audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend();
      }
    }
  } else {
    if (!ready && !isPaused && lastTimestamp) {
      playMusic();
    }
  }
});
