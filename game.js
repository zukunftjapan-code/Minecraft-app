// ブロックワールド - シンプルなボクセル建築ゲーム
// Three.js (グローバル THREE) を使用。ビルド不要、index.html を開くだけで動作します。

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------
  const WORLD_SIZE = 20; // ワールドの一辺のブロック数 (0..WORLD_SIZE-1)
  const MAX_HEIGHT = 20; // 積み上げられる最大の高さ
  const REACH = 6; // ブロックを操作できる距離
  const EYE_HEIGHT = 1.6;
  const MOVE_SPEED = 5.5; // ブロック/秒
  const JUMP_SPEED = 6.5;
  const GRAVITY = 16;
  const STORAGE_KEY = "block-world-save-v1";
  const SEED = 1337;

  const BLOCK_TYPES = [
    { id: "grass", name: "くさ", color: 0x5cb85c, key: "1" },
    { id: "dirt", name: "つち", color: 0x8b5a2b, key: "2" },
    { id: "stone", name: "いし", color: 0x9e9e9e, key: "3" },
    { id: "wood", name: "き", color: 0x6b4423, key: "4" },
    { id: "leaves", name: "は", color: 0x2e8b57, key: "5" },
    { id: "brick", name: "レンガ", color: 0xb22222, key: "6" },
  ];
  const BLOCK_INDEX = Object.fromEntries(BLOCK_TYPES.map((b, i) => [b.id, i]));

  // ---------------------------------------------------------------------
  // かんたんな地形ノイズ (シード固定・決定的)
  // ---------------------------------------------------------------------
  function hash2D(x, z) {
    const h = Math.sin(x * 127.1 + z * 311.7 + SEED * 0.37) * 43758.5453123;
    return h - Math.floor(h);
  }
  function fade(t) {
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function valueNoise(x, z) {
    const cell = 5;
    const x0 = Math.floor(x / cell);
    const z0 = Math.floor(z / cell);
    const sx = fade(x / cell - x0);
    const sz = fade(z / cell - z0);
    const n00 = hash2D(x0, z0);
    const n10 = hash2D(x0 + 1, z0);
    const n01 = hash2D(x0, z0 + 1);
    const n11 = hash2D(x0 + 1, z0 + 1);
    const ix0 = lerp(n00, n10, sx);
    const ix1 = lerp(n01, n11, sx);
    return lerp(ix0, ix1, sz);
  }
  function terrainHeight(x, z) {
    return 2 + Math.floor(valueNoise(x, z) * 5); // 2..6
  }

  // ---------------------------------------------------------------------
  // ワールドデータ: key "x,y,z" -> blockTypeId
  // ---------------------------------------------------------------------
  let world = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;

  function generateWorld() {
    world = new Map();
    const heights = [];
    for (let x = 0; x < WORLD_SIZE; x++) {
      heights[x] = [];
      for (let z = 0; z < WORLD_SIZE; z++) {
        const h = terrainHeight(x, z);
        heights[x][z] = h;
        for (let y = 0; y < h; y++) {
          let type = "dirt";
          if (y === 0) type = "stone";
          if (y === h - 1) type = "grass";
          world.set(key(x, y, z), type);
        }
      }
    }
    // 木をランダムに配置 (境界から少し内側)
    for (let x = 2; x < WORLD_SIZE - 2; x++) {
      for (let z = 2; z < WORLD_SIZE - 2; z++) {
        if (hash2D(x * 3.1, z * 7.7) < 0.03) {
          const h = heights[x][z];
          placeTree(x, h, z);
        }
      }
    }
  }

  function placeTree(x, baseY, z) {
    const trunkHeight = 3 + Math.floor(hash2D(x * 9.3, z * 5.1) * 2);
    for (let i = 0; i < trunkHeight; i++) {
      world.set(key(x, baseY + i, z), "wood");
    }
    const leafY = baseY + trunkHeight;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          if (dx === 0 && dz === 0 && dy === 0) continue;
          const lx = x + dx;
          const lz = z + dz;
          if (lx < 0 || lz < 0 || lx >= WORLD_SIZE || lz >= WORLD_SIZE) continue;
          world.set(key(lx, leafY + dy, lz), "leaves");
        }
      }
    }
    world.set(key(x, leafY + 2, z), "leaves");
  }

  function groundHeightAt(x, z) {
    // 木の葉は当たり判定を持たない(踏み台にならない)ので無視する。
    // 葉は隣の木のトランクの高さを基準に置かれるため、地形の低い場所では
    // 地面から離れた宙に浮いた状態になることがあるため。
    const gx = Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(x)));
    const gz = Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(z)));
    for (let y = MAX_HEIGHT - 1; y >= 0; y--) {
      const type = world.get(key(gx, y, gz));
      if (type && type !== "leaves") return y + 1;
    }
    return 0;
  }

  // ---------------------------------------------------------------------
  // 保存 / 読み込み
  // ---------------------------------------------------------------------
  function saveWorld() {
    const arr = [];
    for (const [k, v] of world.entries()) arr.push(k + ":" + v);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      // 保存に失敗しても遊び続けられるようにする
    }
  }
  function loadWorld() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const arr = JSON.parse(raw);
      world = new Map();
      for (const entry of arr) {
        const idx = entry.lastIndexOf(":");
        world.set(entry.slice(0, idx), entry.slice(idx + 1));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Three.js セットアップ
  // ---------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 18, 34);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.prepend(renderer.domElement);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const meshByType = {};
  const positionsByType = {};
  for (const b of BLOCK_TYPES) {
    const mat = new THREE.MeshLambertMaterial({ color: b.color });
    const mesh = new THREE.InstancedMesh(boxGeo, mat, WORLD_SIZE * WORLD_SIZE * MAX_HEIGHT);
    mesh.count = 0;
    mesh.userData.blockType = b.id;
    scene.add(mesh);
    meshByType[b.id] = mesh;
    positionsByType[b.id] = [];
  }

  const dummy = new THREE.Object3D();
  function rebuildMeshes() {
    for (const b of BLOCK_TYPES) positionsByType[b.id] = [];
    for (const [k, type] of world.entries()) {
      if (!positionsByType[type]) continue;
      const [x, y, z] = k.split(",").map(Number);
      positionsByType[type].push({ x, y, z });
    }
    for (const b of BLOCK_TYPES) {
      const mesh = meshByType[b.id];
      const list = positionsByType[b.id];
      mesh.count = list.length;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        dummy.position.set(p.x, p.y, p.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ターゲットハイライト用のワイヤーフレーム
  const highlightGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  const highlightMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.9,
  });
  const highlightBox = new THREE.Mesh(highlightGeo, highlightMat);
  highlightBox.visible = false;
  scene.add(highlightBox);

  // ---------------------------------------------------------------------
  // プレイヤー
  // ---------------------------------------------------------------------
  const player = {
    x: WORLD_SIZE / 2,
    z: WORLD_SIZE / 2,
    y: EYE_HEIGHT,
    velocityY: 0,
    onGround: true,
    yaw: Math.PI,
    pitch: -0.2,
  };

  function findSpawnPoint() {
    const center = Math.floor(WORLD_SIZE / 2);
    for (let radius = 0; radius < WORLD_SIZE / 2; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const x = center + dx;
          const z = center + dz;
          if (x < 1 || z < 1 || x >= WORLD_SIZE - 1 || z >= WORLD_SIZE - 1) continue;
          const h = groundHeightAt(x, z);
          if (world.get(key(x, h - 1, z)) !== "grass") continue;
          let openArea = true;
          const clearRadius = 2;
          for (let ndx = -clearRadius; ndx <= clearRadius && openArea; ndx++) {
            for (let ndz = -clearRadius; ndz <= clearRadius; ndz++) {
              const nh = groundHeightAt(x + ndx, z + ndz);
              if (world.get(key(x + ndx, nh - 1, z + ndz)) !== "grass") {
                openArea = false;
                break;
              }
            }
          }
          if (openArea) return { x, z };
        }
      }
    }
    return { x: center, z: center };
  }

  function resetPlayerPosition() {
    const spawn = findSpawnPoint();
    player.x = spawn.x;
    player.z = spawn.z;
    player.y = groundHeightAt(player.x, player.z) + EYE_HEIGHT;
    player.velocityY = 0;
    player.onGround = true;
  }

  const keysDown = new Set();
  let selectedIndex = 0;
  let pointerLocked = false;

  // ---------------------------------------------------------------------
  // ホットバー UI
  // ---------------------------------------------------------------------
  const hotbarEl = document.getElementById("hotbar");
  BLOCK_TYPES.forEach((b, i) => {
    const slot = document.createElement("div");
    slot.className = "hotbar-slot";
    slot.style.background = "#" + b.color.toString(16).padStart(6, "0");
    slot.innerHTML = `<span class="key">${b.key}</span><span class="name">${b.name}</span>`;
    slot.addEventListener("click", () => selectSlot(i));
    hotbarEl.appendChild(slot);
  });
  function selectSlot(i) {
    selectedIndex = i;
    document.querySelectorAll(".hotbar-slot").forEach((el, idx) => {
      el.classList.toggle("selected", idx === i);
    });
  }

  // ---------------------------------------------------------------------
  // 入力
  // ---------------------------------------------------------------------
  const canvas = renderer.domElement;

  document.getElementById("start-btn").addEventListener("click", () => {
    document.getElementById("start-overlay").classList.add("hidden");
    canvas.requestPointerLock();
  });

  canvas.addEventListener("click", () => {
    if (!pointerLocked) canvas.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  document.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    keysDown.add(e.code);
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= BLOCK_TYPES.length) selectSlot(num - 1);
  });
  window.addEventListener("keyup", (e) => keysDown.delete(e.code));

  window.addEventListener("mousemove", (e) => {
    if (!pointerLocked) return;
    const sensitivity = 0.0022;
    player.yaw -= e.movementX * sensitivity;
    player.pitch -= e.movementY * sensitivity;
    const limit = Math.PI / 2 - 0.05;
    player.pitch = Math.max(-limit, Math.min(limit, player.pitch));
  });

  window.addEventListener("mousedown", (e) => {
    if (!pointerLocked) return;
    if (e.button === 0) breakBlock();
    if (e.button === 2) placeBlock();
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("ワールドをはじめから作り直します。よろしいですか？")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    generateWorld();
    rebuildMeshes();
    resetPlayerPosition();
  });

  // ---------------------------------------------------------------------
  // レイキャストでブロック操作
  // ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  const centerNDC = new THREE.Vector2(0, 0);

  function raycastBlocks() {
    raycaster.setFromCamera(centerNDC, camera);
    const meshes = BLOCK_TYPES.map((b) => meshByType[b.id]);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const type = hit.object.userData.blockType;
    const pos = positionsByType[type][hit.instanceId];
    if (!pos) return null;
    return { pos, normal: hit.face.normal.clone(), type };
  }

  function isPlayerCell(x, y, z) {
    const feetY = Math.floor(player.y - EYE_HEIGHT);
    const px = Math.round(player.x);
    const pz = Math.round(player.z);
    return x === px && z === pz && (y === feetY || y === feetY + 1);
  }

  function breakBlock() {
    const hit = raycastBlocks();
    if (!hit) return;
    world.delete(key(hit.pos.x, hit.pos.y, hit.pos.z));
    rebuildMeshes();
    saveWorld();
  }

  function placeBlock() {
    const hit = raycastBlocks();
    if (!hit) return;
    const nx = Math.round(hit.pos.x + hit.normal.x);
    const ny = Math.round(hit.pos.y + hit.normal.y);
    const nz = Math.round(hit.pos.z + hit.normal.z);
    if (nx < 0 || nz < 0 || nx >= WORLD_SIZE || nz >= WORLD_SIZE || ny < 0 || ny >= MAX_HEIGHT) return;
    if (world.has(key(nx, ny, nz))) return;
    if (isPlayerCell(nx, ny, nz)) return;
    world.set(key(nx, ny, nz), BLOCK_TYPES[selectedIndex].id);
    rebuildMeshes();
    saveWorld();
  }

  // ---------------------------------------------------------------------
  // メインループ
  // ---------------------------------------------------------------------
  const clock = new THREE.Clock();

  function updatePlayer(dt) {
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (keysDown.has("KeyW")) move.add(forward);
    if (keysDown.has("KeyS")) move.sub(forward);
    if (keysDown.has("KeyD")) move.add(right);
    if (keysDown.has("KeyA")) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt);
      const margin = 0.35;
      const clampCoord = (v) => Math.max(margin, Math.min(WORLD_SIZE - 1 - margin, v));

      // 壁や木の幹に阻まれるように、X軸・Z軸ごとに移動できるか判定する
      // (1段までの段差はそのまま登れる。2段以上高い場所には進めない)
      const groundBefore = groundHeightAt(player.x, player.z);
      const newX = clampCoord(player.x + move.x);
      if (Math.abs(groundHeightAt(newX, player.z) - groundBefore) <= 1) {
        player.x = newX;
      }
      const groundBeforeZ = groundHeightAt(player.x, player.z);
      const newZ = clampCoord(player.z + move.z);
      if (Math.abs(groundHeightAt(player.x, newZ) - groundBeforeZ) <= 1) {
        player.z = newZ;
      }
    }

    const groundY = groundHeightAt(player.x, player.z) + EYE_HEIGHT;

    if (player.onGround) {
      if (keysDown.has("Space")) {
        player.velocityY = JUMP_SPEED;
        player.onGround = false;
      } else {
        player.y = groundY;
      }
    }

    if (!player.onGround) {
      player.velocityY -= GRAVITY * dt;
      player.y += player.velocityY * dt;
      if (player.y <= groundY) {
        player.y = groundY;
        player.velocityY = 0;
        player.onGround = true;
      }
    }

    camera.position.set(player.x, player.y, player.z);
    camera.rotation.order = "YXZ";
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  }

  function updateHighlight() {
    const hit = raycastBlocks();
    if (hit) {
      highlightBox.visible = true;
      highlightBox.position.set(hit.pos.x, hit.pos.y, hit.pos.z);
    } else {
      highlightBox.visible = false;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    updatePlayer(dt);
    updateHighlight();
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------------
  if (!loadWorld()) {
    generateWorld();
  }
  rebuildMeshes();
  resetPlayerPosition();
  selectSlot(0);
  animate();
})();
