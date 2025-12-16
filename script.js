"use strict";
let fruitCounterEl = null;

// Variáveis de utilidade para dimensões de objetos
const FRUIT_RADIUS = 0.18;

// Funções para obter o raio de colisão dos objetos
function getPlayerRadius(player) {
  return player.radius * player.scale;
}

function getFruitRadius() {
  return FRUIT_RADIUS * 0.4; // Mesma escala usada no render da fruta
}

function getGhostRadius(ghost) {
  return ghost.radius * ghost.scale;
}

// Inicialização após o DOM carregar 
window.addEventListener("DOMContentLoaded", () => {
  fruitCounterEl = document.getElementById("fruitCount");
});

// ===================== PARSER OBJ =====================

function computeCenterXZ(positions) {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  return [
    (minX + maxX) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
}


function parseOBJ(text) {
  const objPositions = [[0, 0, 0]];
  const objTexcoords = [[0, 0]];
  const objNormals = [[0, 0, 0]];
  
  const objVertexData = [objPositions, objTexcoords, objNormals];
  const webglVertexData = [[], [], []];

  function addVertex(vert) {
    const ptn = vert.split("/");
    ptn.forEach((objIndexStr, i) => {
      if (!objIndexStr) return;
      const objIndex = parseInt(objIndexStr);
      // Ajusta para índices negativos (relativos)
      const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
      webglVertexData[i].push(...objVertexData[i][index]);
    });
  }

  const keywords = {
    v(parts) {
      objPositions.push(parts.map(parseFloat));
    },
    vn(parts) {
      objNormals.push(parts.map(parseFloat));
    },
    vt(parts) {
      objTexcoords.push(parts.map(parseFloat));
    },
    // Processa faces, triangulando polígonos com mais de 3 vértices
    f(parts) {
      const n = parts.length - 2;
      for (let i = 0; i < n; ++i) {
        addVertex(parts[0]);
        addVertex(parts[i + 1]);
        addVertex(parts[i + 2]);
      }
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split("\n");
  for (const line of lines) {
    const m = keywordRE.exec(line);
    if (!m) continue;
    const [, keyword] = m;
    if (keyword === "" || keyword.startsWith("#")) continue;
    const parts = line.trim().split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (handler) handler(parts);
  }

  return {
    position: webglVertexData[0],
    normal: webglVertexData[2],
    // 'texcoord': webglVertexData[1] // Descomentar se texturas fossem usadas
  };
}

// ===================== CONTROLES =====================
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  
  // debug colliders
  if (e.key === 'b' || e.key === 'B') {
    if (window.toggleDebug) {
      window.toggleDebug();
    }
  }
  
  // debug collider do Pac-Man
  if (e.key === 'p' || e.key === 'P') {
    if (window.togglePlayerDebug) {
      window.togglePlayerDebug();
    }
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

// ===================== COLLIDERS =====================

class CollisionSystem {
  constructor() {
    this.triangles = []; // Armazena os triângulos da mesh do labirinto 
    this.boundingBoxes = []; // Armazena Bounding Boxes (AABBs) das paredes
    this.debugEnabled = false; // Controle do modo debug
    this.debugBufferInfo = null; // Buffer para renderizar debug
    this.playerColliders = []; // Bounding boxes do jogador
  }
  
  processLabyrinthMesh(positions, yOffset = 0) {
    this.triangles = [];
    this.boundingBoxes = [];
    
    /* cada 9 valores = 1 triangulo = 3 vértices com 3 coord cada  */
      for (let i = 0; i < positions.length; i += 9) {
        if (i + 8 < positions.length) {
          // Cria objeto triângulo (principalmente para referência, não usado na colisão AABB)
          const triangle = {
            v0: [positions[i], positions[i + 1] + yOffset, positions[i + 2]],
            v1: [positions[i + 3], positions[i + 4] + yOffset, positions[i + 5]],
            v2: [positions[i + 6], positions[i + 7] + yOffset, positions[i + 8]]
          };
          this.triangles.push(triangle);
          
          // Encontra valores min e max em cada eixo (Bounding Box)
          const minX = Math.min(triangle.v0[0], triangle.v1[0], triangle.v2[0]);
          const maxX = Math.max(triangle.v0[0], triangle.v1[0], triangle.v2[0]);
          const minY = Math.min(triangle.v0[1], triangle.v1[1], triangle.v2[1]);
          const maxY = Math.max(triangle.v0[1], triangle.v1[1], triangle.v2[1]);
          const minZ = Math.min(triangle.v0[2], triangle.v1[2], triangle.v2[2]);
          const maxZ = Math.max(triangle.v0[2], triangle.v1[2], triangle.v2[2]);
          
          // Armazena Bounding Box (AABB)
          this.boundingBoxes.push({
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
            center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
          });
        }
      }
  }
  
  // Processa a mesh do jogador para criar colliders
  processPlayerMesh(positions, scale = 1.0) {
    this.playerColliders = [];
    
    for (let i = 0; i < positions.length; i += 9) {
      if (i + 8 < positions.length) {
        // Aplica escala aos vértices
        const v0 = [positions[i] * scale, positions[i + 1] * scale, positions[i + 2] * scale];
        const v1 = [positions[i + 3] * scale, positions[i + 4] * scale, positions[i + 5] * scale];
        const v2 = [positions[i + 6] * scale, positions[i + 7] * scale, positions[i + 8] * scale];
        
        // Encontra valores min e max em cada eixo (Bounding Box)
        const minX = Math.min(v0[0], v1[0], v2[0]);
        const maxX = Math.max(v0[0], v1[0], v2[0]);
        const minY = Math.min(v0[1], v1[1], v2[1]);
        const maxY = Math.max(v0[1], v1[1], v2[1]);
        const minZ = Math.min(v0[2], v1[2], v2[2]);
        const maxZ = Math.max(v0[2], v1[2], v2[2]);
        
        // Armazena Bounding Box (AABB) do jogador
        this.playerColliders.push({
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
          center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
        });
      }
    }
  }
  
  // Verifica colisão entre jogador e paredes
  checkCollision(pos, radius = 0.4) {
    for (let i = 0; i < this.boundingBoxes.length; i++) {
      const b = this.boundingBoxes[i];

      // Clamp (ponto mais próximo da caixa no plano XZ)
      const closestX = Math.max(b.min[0], Math.min(pos[0], b.max[0]));
      const closestZ = Math.max(b.min[2], Math.min(pos[2], b.max[2]));

      // Distância do centro do jogador ao ponto mais próximo da caixa
      const dx = pos[0] - closestX;
      const dz = pos[2] - closestZ;

      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        // Colisão! Calcula a normal e a penetração para resposta (escorregar na parede)
        const dist = Math.sqrt(distSq) || 0.0001;

        return {
          collides: true,
          normal: [dx / dist, 0, dz / dist], // Normal de repulsão no plano XZ
          penetration: radius - dist,
          bboxIndex: i
        };
      }
    }
    
    return { collides: false };
  }
  
  // Verifica colisão baseada na mesh do jogador (mais precisa)
  checkPlayerCollision(playerPos, playerFacingAngle, playerColliders) {
    // Transforma as bounding boxes do jogador para a posição e rotação atual
    for (let i = 0; i < this.boundingBoxes.length; i++) {
      const wallBox = this.boundingBoxes[i];
      
      // Para cada bounding box do jogador
      for (let j = 0; j < playerColliders.length; j++) {
        const playerBox = playerColliders[j];
        
        // Calcula a posição transformada da bounding box do jogador
        const sinAngle = Math.sin(playerFacingAngle);
        const cosAngle = Math.cos(playerFacingAngle);
        
        // Transforma os pontos da bounding box do jogador
        const playerMin = [
          playerPos[0] + (playerBox.min[0] * cosAngle - playerBox.min[2] * sinAngle),
          playerPos[1] + playerBox.min[1],
          playerPos[2] + (playerBox.min[0] * sinAngle + playerBox.min[2] * cosAngle)
        ];
        
        const playerMax = [
          playerPos[0] + (playerBox.max[0] * cosAngle - playerBox.max[2] * sinAngle),
          playerPos[1] + playerBox.max[1],
          playerPos[2] + (playerBox.max[0] * sinAngle + playerBox.max[2] * cosAngle)
        ];
        
        // Verifica colisão AABB-AABB (apenas no plano XZ)
        const collisionX = playerMax[0] >= wallBox.min[0] && playerMin[0] <= wallBox.max[0];
        const collisionZ = playerMax[2] >= wallBox.min[2] && playerMin[2] <= wallBox.max[2];
        
        if (collisionX && collisionZ) {
          // Colisão detectada! Calcula a direção de repulsão
          const wallCenter = [
            (wallBox.min[0] + wallBox.max[0]) / 2,
            0,
            (wallBox.min[2] + wallBox.max[2]) / 2
          ];
          
          const playerCenter = [
            (playerMin[0] + playerMax[0]) / 2,
            0,
            (playerMin[2] + playerMax[2]) / 2
          ];
          
          const dx = playerCenter[0] - wallCenter[0];
          const dz = playerCenter[2] - wallCenter[2];
          const dist = Math.sqrt(dx * dx + dz * dz) || 0.0001;
          
          return {
            collides: true,
            normal: [dx / dist, 0, dz / dist],
            penetration: 0.1, // Penetração fixa para simplificar
            wallIndex: i,
            playerBoxIndex: j
          };
        }
      }
    }
    
    return { collides: false };
  }
  
  // Código para criar a geometria de debug (linhas) para as Bounding Boxes
  createDebugGeometry(gl, boundingBoxes, color = [0.0, 1.0, 0.0]) {
    if (!boundingBoxes.length) return null;
    
    const positions = [];
    const indices = [];
    
    boundingBoxes.forEach((bbox, idx) => {
      const baseIdx = idx * 8;
      
      const vertices = [
        [bbox.min[0], bbox.min[1], bbox.min[2]],
        [bbox.max[0], bbox.min[1], bbox.min[2]],
        [bbox.max[0], bbox.min[1], bbox.max[2]],
        [bbox.min[0], bbox.min[1], bbox.max[2]],
        [bbox.min[0], bbox.max[1], bbox.min[2]],
        [bbox.max[0], bbox.max[1], bbox.min[2]],
        [bbox.max[0], bbox.max[1], bbox.max[2]],
        [bbox.min[0], bbox.max[1], bbox.max[2]]
      ];
      
      vertices.forEach(vertex => {
        positions.push(...vertex);
      });
      
      const cubeEdges = [
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7
      ];
      
      cubeEdges.forEach(edgeIdx => {
        indices.push(baseIdx + edgeIdx);
      });
    });
    
    const arrays = {
      position: new Float32Array(positions),
      indices: new Uint16Array(indices)
    };
    
    const bufferInfo = webglUtils.createBufferInfoFromArrays(gl, arrays);
    return { bufferInfo, color };
  }
  
  toggleDebug() {
    this.debugEnabled = !this.debugEnabled;
    console.log(`Debug de colisão (paredes): ${this.debugEnabled ? 'ON' : 'OFF'}`);
    return this.debugEnabled;
  }
}

function checkCircleCollision(posA, radiusA, posB, radiusB) {
  const dx = posA[0] - posB[0];
  const dz = posA[2] - posB[2];
  const r = radiusA + radiusB;
  return (dx * dx + dz * dz) <= (r * r);
}

// ===================== SHADER PARA DEBUG =====================
const debugVS = `
  attribute vec4 a_position;
  
  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;
  
  void main() {
    gl_Position = u_projection * u_view * u_world * a_position;
  }
`;
const debugFS = `
  precision mediump float;
  
  uniform vec3 u_color;
  
  void main() {
    gl_FragColor = vec4(u_color, 1.0);
  }
`;

// ===================== SHADERS PRINCIPAIS (BINN-PHONG + NEON + FOG) =====================
const vs = `
  attribute vec4 a_position;
  attribute vec3 a_normal;

  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;

  varying vec3 v_normal;
  varying vec3 v_worldPosition;

  void main() {
    // posição final da geometria na tela
    vec4 worldPosition = u_world * a_position;
    gl_Position = u_projection * u_view * worldPosition;
    
    // exporta para fragment shader
    v_worldPosition = worldPosition.xyz;
    // Normal em coordenadas de mundo (apenas rotação, sem translação)
    v_normal = mat3(u_world) * a_normal;
  }
`;
const fs = `
  precision mediump float;

  varying vec3 v_normal;
  varying vec3 v_worldPosition;

  uniform vec4 u_diffuse;
  uniform vec3 u_lightDirection;
  uniform vec3 u_ambient;
  uniform vec3 u_viewWorldPosition;
  uniform float u_shininess;
  uniform vec3 u_specularColor;
  uniform float u_fogNear;
  uniform float u_fogFar;
  uniform vec3 u_fogColor;
  uniform vec3 u_emissionColor;
  uniform float u_emissionStrength;

  void main() {
    // Cálculo de luz difusa - Lambert 
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(u_lightDirection);
    float diff = max(dot(normal, lightDir), 0.0) * 0.7;
    
    // Especular (Binn-Phong)
    vec3 viewDir = normalize(u_viewWorldPosition - v_worldPosition);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), u_shininess * 0.7);

    // Combinação das luzes 
    vec3 baseColor = u_diffuse.rgb;
    vec3 litColor = baseColor * (u_ambient * 0.5 + diff * (1.0 - u_ambient * 0.5)) + u_specularColor * spec * 1.5;

    // Emission com bordas neon (efeito fresnel modificado)
    vec3 neonColor = u_emissionColor * 1.2;
    float edgeFactor = 1.0 - abs(dot(normal, viewDir));
    edgeFactor = pow(edgeFactor, 2.0) * 0.5 + 0.5;
    vec3 emission = neonColor * u_emissionStrength * (1.0 + edgeFactor * 0.5);
    vec3 color = litColor + emission * 2.0;

    // Fog linear - neblina 
    float dist = length(v_worldPosition - u_viewWorldPosition);
    float fogAmount = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
    vec3 foggedColor = mix(color, u_fogColor, fogAmount * 0.7);

    // Cor final 
    gl_FragColor = vec4(foggedColor, u_diffuse.a);
  }
`;

// ===================== MAIN =====================
async function main() {
  const canvas = document.querySelector("#glCanvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    console.error("WebGL não suportado");
    return;
  }

  // ---------- Inicialização de Shaders ----------
  // Assume que webglUtils.createProgramInfo está disponível
  const programInfo = webglUtils.createProgramInfo(gl, [vs, fs]);
  const debugProgramInfo = webglUtils.createProgramInfo(gl, [debugVS, debugFS]);

  // ---------- DADOS DE PERSONAGENS ----------
  const characters = [
    {
      name: "pacman",
      url: "pac_man.obj",
      color: [1.0, 1.0, 0.0, 1.0],
      emissionColor: [1.0, 1.0, 0.3],
      emissionStrength: 0.8,
      pos: [0, 0, 0],
      scale: 0.8,
      bobAmplitude: 0.0,
      isPlayer: true,
      facingAngle: 0,
      turnSpeed: 3.0,
      moveSpeed: 10.0,
      pulseSpeed: 2.5,
      radius: 0.08,
      meshData: null, // Para armazenar os dados da mesh
      debugColliders: null, // Buffer de debug para os colliders
    },
    {
      name: "ghost_red",
      url: "ghost_red.obj",
      color: [1.0, 0.0, 0.1, 1.0],
      emissionColor: [1.0, 0.2, 0.2],
      emissionStrength: 0.7,
      pos: [-4, 0, -2],
      scale: 0.8,
      bobAmplitude: 0.0,
      radius: 0.1,
      isPlayer: false,
      speed: 0.0,
      pulseSpeed: 0.0,
    },
    {
      name: "ghost_pink",
      url: "ghost_pink.obj",
      color: [1.0, 0.4, 0.8, 1.0],
      emissionColor: [1.0, 0.4, 0.9],
      emissionStrength: 0.7,
      pos: [4, 0, -2],
      scale: 0.8,
      bobAmplitude: 0.0,
      radius: 0.1,
      isPlayer: false,
      speed: 0.0,
      pulseSpeed: 0.0,
    },
    {
      name: "ghost_blue",
      url: "ghost_blue.obj",
      color: [0.3, 0.5, 1.0, 1.0],
      emissionColor: [0.3, 0.6, 1.0],
      emissionStrength: 0.7,
      pos: [-2, 0, -5],
      scale: 0.8,
      bobAmplitude: 0.0,
      radius: 0.1,
      isPlayer: false,
      speed: 0.0,
      pulseSpeed: 0.0,
    },
    {
      name: "ghost_yellow",
      url: "ghost_yellow.obj",
      color: [1.0, 0.85, 0.2, 1.0],
      emissionColor: [1.0, 0.9, 0.3],
      emissionStrength: 0.7,
      pos: [2, 0, -5],
      scale: 0.8,
      bobAmplitude: 0.0,
      radius: 0.1,
      isPlayer: false,
      speed: 0.0,
      pulseSpeed: 0.0,
    },
  ];

  // ----------------- FRUTINHAS -----------------
  const fruits = [];
  let fruitBufferInfo = null;
  let fruitsCollected = 0;

  const worldLimit = 25;

  /**
   * Encontra uma posição aleatória para uma fruta que não colida com as paredes.
   */
  function getRandomFruitPosition() {
    const margin = 1.0;
    const maxTries = 50;

    for (let i = 0; i < maxTries; ++i) {
      const x = (Math.random() * 2 - 1) * (worldLimit - margin);
      const z = (Math.random() * 2 - 1) * (worldLimit - margin);
      const pos = [x, 0, z];

      const col = collisionSystem.checkCollision(pos, 0.5);
      if (!col.collides) {
        return pos;
      }
    }
    return [0, 0, 0];
  }

  function spawnFruit() {
    const pos = getRandomFruitPosition();

    fruits.push({
      pos: [pos[0], -0.3, pos[2]],
      collected: false,
    });
  }

  const player = characters.find((c) => c.isPlayer);
  const collisionSystem = new CollisionSystem();

  // ---------- DEBUG: Controles ----------
  let playerDebugEnabled = false;
  
  window.togglePlayerDebug = function() {
    playerDebugEnabled = !playerDebugEnabled;
    console.log(`Debug dos colliders do Pac-Man: ${playerDebugEnabled ? 'ON' : 'OFF'}`);
    return playerDebugEnabled;
  };

  // ---------- PARÂMETROS DE CENA ----------
  const zNear = 0.1;
  const zFar = 80;

  // ---------- LOAD MODELS ----------
  await Promise.all(
    characters.map(async (ch) => {
      const resp = await fetch(ch.url);
      if (!resp.ok) {
        console.error("Erro ao carregar", ch.url);
        return;
      }
      const text = await resp.text();
      const data = parseOBJ(text);
      ch.meshData = data; // Salva os dados da mesh
      
      const arrays = {
        position: data.position,
        normal: data.normal,
      };
      // Assume que webglUtils.createBufferInfoFromArrays está disponível
      ch.bufferInfo = webglUtils.createBufferInfoFromArrays(gl, arrays);
      
      console.log("Carregado:", ch.name, "- vértices:", data.position.length / 3);
      
      // Se for o jogador, processa a mesh para criar colliders
      if (ch.isPlayer) {
        collisionSystem.processPlayerMesh(data.position, ch.scale);
        console.log(`Colliders do Pac-Man criados: ${collisionSystem.playerColliders.length} bounding boxes`);
        
        // Cria buffer de debug para os colliders do jogador
        ch.debugColliders = collisionSystem.createDebugGeometry(
          gl, 
          collisionSystem.playerColliders, 
          [1.0, 0.5, 0.0] // Laranja
        );
      }
    })
  );

  // Carrega labirinto
  let labyrinthBufferInfo = null;
  try {
    const labResp = await fetch("modelo/labirinth.obj");
    if (labResp.ok) {
      const labText = await labResp.text();
      const labData = parseOBJ(labText);
      const labArrays = {
        position: labData.position,
        normal: labData.normal,
      };
      labyrinthBufferInfo = webglUtils.createBufferInfoFromArrays(gl, labArrays);
      
      // Processa a colisão do labirinto
      collisionSystem.processLabyrinthMesh(labData.position, 0);
      collisionSystem.createDebugGeometry(gl, collisionSystem.boundingBoxes);

      for (let i = 0; i < 60; ++i) {
        spawnFruit();
      }
      console.log("Quantidade de frutas:", fruits.length);

      console.log("Labirinto carregado:", labData.position.length / 3, "vértices");
      console.log("Bounding boxes do labirinto:", collisionSystem.boundingBoxes.length);
    } else {
      console.error("Erro ao carregar modelo/labirinth.obj");
    }
  } catch (e) {
    console.error("Falha ao carregar labirinto:", e);
  }

  // --------- CARREGA MODELO DA FRUTINHA ---------
  try {
    const fruitResp = await fetch("modelo/fruit.obj");
    if (fruitResp.ok) {
      const fruitText = await fruitResp.text();
      const fruitData = parseOBJ(fruitText);
      const fruitCenter = computeCenterXZ(fruitData.position);
      const fruitArrays = {
        position: fruitData.position,
        normal: fruitData.normal,
      };
      window.FRUIT_CENTER_OFFSET = fruitCenter; // Guarda o offset do centro para correção de pivot
      fruitBufferInfo = webglUtils.createBufferInfoFromArrays(gl, fruitArrays);
      console.log("Modelo de fruta carregado:", fruitData.position.length / 3, "vértices");
    } else {
      console.error("Erro ao carregar modelo/fruit.obj");
    }
  } catch (e) {
    console.error("Falha ao carregar a frutinha:", e);
  }

  // ---------- CHÃO ----------
  const groundSize = 22;
  const groundY = -1.2;

  const groundArrays = {
    position: new Float32Array([
      -groundSize, groundY, -groundSize,
       groundSize, groundY, -groundSize,
      -groundSize, groundY,  groundSize,
       groundSize, groundY,  groundSize,
    ]),
    normal: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    indices: new Uint16Array([
      0, 1, 2,
      2, 1, 3,
    ]),
  };
  const groundBufferInfo = webglUtils.createBufferInfoFromArrays(gl, groundArrays);

  // ---------- FUNÇÕES DE UTILIDADE MATEMÁTICA ----------
  function degToRad(d) {
    return d * Math.PI / 180;
  }

  function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  let previousTime = 0;
  let cameraAngle = 0;
  
  window.toggleDebug = () => collisionSystem.toggleDebug();

  // ===================== GAME LOOP - UPDATE =====================
  function update(dt, totalTime) {
    if (!player) return;

    // CONTROLES DE ROTAÇÃO DA CÂMERA (opcional)
    let rotateCamera = 0;
    if (keys["q"]) rotateCamera += 1;
    if (keys["e"]) rotateCamera -= 1;
    if (rotateCamera !== 0) {
      cameraAngle += rotateCamera * 2.0 * dt;
    }
    
    //  ===================== CONTROLES DO PAC-MAN  =====================
    let moveForward = 0;
    let turnDirection = 0;
    
    if (keys["w"] || keys["arrowup"]) moveForward += 1; 
    if (keys["s"] || keys["arrowdown"]) moveForward -= 1; 
    
    if (keys["a"]) turnDirection += 1;
    if (keys["d"]) turnDirection -= 1;
    
    // Rotação
    if (Math.abs(turnDirection) > 0.001) {
      const curveAmount = turnDirection * player.turnSpeed * dt; 
      player.facingAngle += curveAmount; 
      player.facingAngle = normalizeAngle(player.facingAngle);
    }
    
    // Movimentação 
    if (Math.abs(moveForward) > 0.001) {
      let moveAngle = player.facingAngle; 
      
      // Move para trás
      if (moveForward < 0) {
        moveAngle = player.facingAngle + Math.PI; // Adiciona 180 graus (pi radianos)
      }
      
      // Converte ângulo para vetor de direção (sin para X, cos para Z)
      const moveX = Math.sin(moveAngle); 
      const moveZ = Math.cos(moveAngle); 
      
      // Calcula nova posição desejada
      const desiredX = player.pos[0] + moveX * player.moveSpeed * dt * Math.abs(moveForward);
      const desiredZ = player.pos[2] + moveZ * player.moveSpeed * dt * Math.abs(moveForward);
      
      // Verifica colisão com paredes usando a mesh do jogador
      const tempPos = [desiredX, player.pos[1], desiredZ];
      
      // Usa colisão baseada na mesh (mais precisa)
      const collision = collisionSystem.checkPlayerCollision(
        tempPos, 
        player.facingAngle, 
        collisionSystem.playerColliders
      );
      
      if (!collision.collides) {
        player.pos[0] = desiredX;
        player.pos[2] = desiredZ;
      } else {
        // Tenta movimento apenas no eixo X
        const tempPosX = [desiredX, player.pos[1], player.pos[2]];
        const collisionX = collisionSystem.checkPlayerCollision(
          tempPosX, 
          player.facingAngle, 
          collisionSystem.playerColliders
        );
        
        if (!collisionX.collides) {
          player.pos[0] = desiredX;
        }
        
        // Tenta movimento apenas no eixo Z
        const tempPosZ = [player.pos[0], player.pos[1], desiredZ];
        const collisionZ = collisionSystem.checkPlayerCollision(
          tempPosZ, 
          player.facingAngle, 
          collisionSystem.playerColliders
        );
        
        if (!collisionZ.collides) {
          player.pos[2] = desiredZ;
        }
      }
    }

    // ---- COLETA DE FRUTAS ----
    const px = player.pos[0];
    const pz = player.pos[2];

    // Raio de coleta
    const collectRadius = getPlayerRadius(player) + getFruitRadius() + 0.35;
    const collectRadiusSq = collectRadius * collectRadius;

    for (let i = fruits.length - 1; i >= 0; i--) {
      const fruit = fruits[i];

      const dx = px - fruit.pos[0];
      const dz = pz - fruit.pos[2];

      if (dx * dx + dz * dz <= collectRadiusSq) {
        fruits.splice(i, 1); // Remove a fruta
        fruitsCollected++;

        if (fruitCounterEl) {
          fruitCounterEl.textContent = fruitsCollected; // Atualiza o contador no DOM
        }
      }
    }

    // ===================== COLISÃO COM FANTASMAS =====================
    for (const ghost of characters) {
      if (ghost.isPlayer) continue;

      const dx = player.pos[0] - ghost.pos[0];
      const dz = player.pos[2] - ghost.pos[2];

      const r =
        getPlayerRadius(player) +
        getGhostRadius(ghost) +
        0.15; // ajuste visual só para fantasmas

      if (dx * dx + dz * dz <= r * r) {
        player.pos[0] = 0;
        player.pos[2] = 0;
        break;
      }
    }
  }

  // ===================== GAME LOOP - RENDER =====================
  function render(timeMs) {
    const time = timeMs * 0.001;
    const dt = Math.min(time - previousTime, 0.05);
    previousTime = time;

    update(dt, time); // Chama a lógica de atualização

    webglUtils.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    gl.clearColor(0.02, 0.02, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---------- CÂMERA (Visão em Terceira Pessoa) ----------
    const camDistance = 3; 
    const camHeight = 2; 
    
    // Posição da Câmera: Atrás do Pac-Man (ângulo oposto ao facingAngle)
    const offsetX = Math.sin(player.facingAngle) * camDistance;
    const offsetZ = Math.cos(player.facingAngle) * camDistance;
    
    const cameraPosition = [
      player.pos[0] - offsetX, // Pos X: Subtrai o offset para ficar atrás
      player.pos[1] + camHeight, 
      player.pos[2] - offsetZ // Pos Z: Subtrai o offset para ficar atrás
    ];
    
    const target = [player.pos[0], player.pos[1] + 1.0, player.pos[2]];
    const up = [0, 1, 0];

    // Projeção e View Matrix
    const fieldOfViewRadians = degToRad(60); 
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);
    
    const camera = m4.lookAt(cameraPosition, target, up);
    const view = m4.inverse(camera); // View Matrix é a inversa da Camera Matrix

    // Parâmetros de Iluminação e Fog
    const lightDirection = m4.normalize([-0.6, 1.0, 0.8]);
    const ambient = [0.15, 0.15, 0.15];
    const viewWorldPos = cameraPosition;

    const fogNear = 20.0;
    const fogFar = 60.0;
    const fogColor = [0.02, 0.02, 0.05];

    gl.useProgram(programInfo.program);
    
    // ---------- Desenha chão ----------
    webglUtils.setBuffersAndAttributes(gl, programInfo, groundBufferInfo);

    let worldGround = m4.identity();
    webglUtils.setUniforms(programInfo, {
        u_projection: projection,
        u_view: view,
        u_world: worldGround,
        u_lightDirection: lightDirection,
        u_ambient: ambient,
        u_viewWorldPosition: viewWorldPos,
        u_shininess: 8.0,
        u_specularColor: [0.05, 0.05, 0.07],
        u_diffuse: [0.08, 0.10, 0.15, 1.0],
        u_fogNear: fogNear,
        u_fogFar: fogFar,
        u_fogColor: fogColor,
        u_emissionColor: [0.0, 0.0, 0.0],
        u_emissionStrength: 0.0,
    });
    webglUtils.drawBufferInfo(gl, groundBufferInfo);

    // ---------- Desenha labirinto ----------
    if (labyrinthBufferInfo) {
        webglUtils.setBuffersAndAttributes(gl, programInfo, labyrinthBufferInfo);

        let worldLab = m4.translation(0, -1.0, 0);
        worldLab = m4.multiply(worldLab, m4.scaling(1.0, 1.0, 1.0));

        webglUtils.setUniforms(programInfo, {
            u_projection: projection,
            u_view: view,
            u_world: worldLab,
            u_lightDirection: lightDirection,
            u_ambient: ambient,
            u_viewWorldPosition: viewWorldPos,
            u_shininess: 12.0,
            u_specularColor: [0.3, 0.3, 0.5],
            u_diffuse: [0.03, 0.15, 0.35, 1.0],
            u_fogNear: fogNear,
            u_fogFar: fogFar,
            u_fogColor: fogColor,
            u_emissionColor: [0.0, 0.0, 0.0],
            u_emissionStrength: 0.0,
        });

        webglUtils.drawBufferInfo(gl, labyrinthBufferInfo);
    }

    // ---------- DESENHA FRUTINHAS ----------
    if (fruitBufferInfo && fruits.length > 0) {
      fruits.forEach((fruit) => {
        if (fruit.collected) return;

        let worldFruit = m4.translation(
          fruit.pos[0],
          fruit.pos[1], // Corrigido para a posição inicial em -0.3
          fruit.pos[2]
        );

        // CORREÇÃO DO PIVOT DO OBJ
        worldFruit = m4.multiply(
          worldFruit,
          m4.translation(
            -window.FRUIT_CENTER_OFFSET[0] * 0.4,
            0,
            -window.FRUIT_CENTER_OFFSET[1] * 0.4
          )
        );

        worldFruit = m4.multiply(worldFruit, m4.scaling(0.4, 0.4, 0.4));
        
        // BOB DA FRUTA (do Código B, adaptado)
        const bob = 0.2 * Math.sin(time * 3.0 + fruit.pos[0] + fruit.pos[2]);
        worldFruit = m4.multiply(worldFruit, m4.translation(0, bob, 0));

        webglUtils.setBuffersAndAttributes(gl, programInfo, fruitBufferInfo);
        webglUtils.setUniforms(programInfo, {
          u_projection: projection,
          u_view: view,
          u_world: worldFruit,
          u_shininess: 16.0,
          u_specularColor: [1, 1, 1],
          u_diffuse: [1, 0.3, 0.1, 1],
          u_fogNear: fogNear,
          u_fogFar: fogFar,
          u_fogColor: fogColor,
          u_emissionColor: [1, 0.5, 0.2],
          u_emissionStrength: 0.6,
          u_lightDirection: lightDirection,
          u_ambient: ambient,
          u_viewWorldPosition: viewWorldPos,
        });

        webglUtils.drawBufferInfo(gl, fruitBufferInfo);
      });
    }

    // ---------- Desenha personagens (Pac-Man e Fantasmas) ----------
    characters.forEach((ch) => {
      if (!ch.bufferInfo) return;

      const bob = ch.bobOffset || 0;

      let world = m4.translation(ch.pos[0], ch.pos[1] + bob, ch.pos[2]);
      world = m4.multiply(world, m4.scaling(ch.scale, ch.scale, ch.scale));

      if (ch.isPlayer) {
        // Rotação do Pac-Man baseada no ângulo de direção
        world = m4.multiply(world, m4.yRotation(player.facingAngle));
      }

      let currentEmissionStrength = ch.emissionStrength;
      if (ch.isPlayer) {
        // Efeito de pulsação (emission)
        const pulse = 0.1 * Math.sin(time * ch.pulseSpeed) + 1.0;
        currentEmissionStrength = ch.emissionStrength * pulse;
      }

      webglUtils.setBuffersAndAttributes(gl, programInfo, ch.bufferInfo);
      webglUtils.setUniforms(programInfo, {
        u_projection: projection,
        u_view: view,
        u_world: world,
        u_lightDirection: lightDirection,
        u_ambient: ambient,
        u_viewWorldPosition: viewWorldPos,
        u_shininess: 32.0,
        u_specularColor: [1.0, 1.0, 1.0],
        u_diffuse: ch.color,
        u_fogNear: fogNear,
        u_fogFar: fogFar,
        u_fogColor: fogColor,
        u_emissionColor: ch.emissionColor,
        u_emissionStrength: currentEmissionStrength,
      });

      webglUtils.drawBufferInfo(gl, ch.bufferInfo);
    });

    // ---------- DEBUG: bounding boxes das paredes ----------
    if (collisionSystem.debugEnabled && collisionSystem.debugBufferInfo) {
      gl.useProgram(debugProgramInfo.program);
      gl.disable(gl.CULL_FACE);
      
      const worldLab = m4.translation(0, -1.0, 0);
      
      webglUtils.setBuffersAndAttributes(gl, debugProgramInfo, collisionSystem.debugBufferInfo.bufferInfo);
      webglUtils.setUniforms(debugProgramInfo, {
        u_projection: projection,
        u_view: view,
        u_world: worldLab,
        u_color: collisionSystem.debugBufferInfo.color
      });
      
      webglUtils.drawBufferInfo(gl, collisionSystem.debugBufferInfo.bufferInfo, gl.LINES);
      
      gl.enable(gl.CULL_FACE);
      gl.useProgram(programInfo.program);
    }

    // ---------- DEBUG: bounding boxes do Pac-Man ----------
    if (playerDebugEnabled && player.debugColliders && player.debugColliders.bufferInfo) {
      gl.useProgram(debugProgramInfo.program);
      gl.disable(gl.CULL_FACE);
      
      // Posição e rotação do Pac-Man
      let worldPlayer = m4.translation(
        player.pos[0],
        player.pos[1] + (player.bobOffset || 0),
        player.pos[2]
      );
      worldPlayer = m4.multiply(worldPlayer, m4.yRotation(player.facingAngle));
      
      webglUtils.setBuffersAndAttributes(gl, debugProgramInfo, player.debugColliders.bufferInfo);
      webglUtils.setUniforms(debugProgramInfo, {
        u_projection: projection,
        u_view: view,
        u_world: worldPlayer,
        u_color: player.debugColliders.color
      });
      
      webglUtils.drawBufferInfo(gl, player.debugColliders.bufferInfo, gl.LINES);
      
      gl.enable(gl.CULL_FACE);
      gl.useProgram(programInfo.program);
    }

    requestAnimationFrame(render);
  }

  // ---------- Mensagens de Controle ----------
  console.log("=== CONTROLES ===");
  console.log("W ou ↑: FRENTE");
  console.log("S ou ↓: TRÁS");
  console.log("A: ESQUERDA");
  console.log("D: DIREITA");
  console.log("B: Debug de colisão (paredes)");
  console.log("P: Debug de colisão (Pac-Man)");
  
  requestAnimationFrame(render);
}

main().catch((e) => {
  console.error("Erro em main():", e);
});