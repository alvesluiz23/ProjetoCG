"use strict";

// ===================== PARSER OBJ =====================
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
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

// ===================== COLLIDERS =====================
class CollisionSystem {
  constructor() {
    this.triangles = []; // armazena os triângulos da mesh do labirinto 
    this.boundingBoxes = []; // armazena bouding boxes
    this.debugEnabled = false; // controle do modo debug
    this.debugBufferInfo = null; // buffer para renderizar debug
  }
  
  // processa a mesh do labirinto para criar collision 
  processLabyrinthMesh(positions, indices = null) {
    this.triangles = [];
    this.boundingBoxes = [];
    
    /* cada 9 valores = 1 triangulo = 3 vértices com 3 coord cada  */
    if (!indices) {
      for (let i = 0; i < positions.length; i += 9) {
        if (i + 8 < positions.length) {
          // cria objeto triangulo com 3 vértices
          const triangle = {
            v0: [positions[i], positions[i + 1], positions[i + 2]], // v1
            v1: [positions[i + 3], positions[i + 4], positions[i + 5]], // v2
            v2: [positions[i + 6], positions[i + 7], positions[i + 8]] // v3
          };
          this.triangles.push(triangle);
          
          // encontra valores min e max em cada eixo 
          const minX = Math.min(triangle.v0[0], triangle.v1[0], triangle.v2[0]);
          const maxX = Math.max(triangle.v0[0], triangle.v1[0], triangle.v2[0]);
          const minY = Math.min(triangle.v0[1], triangle.v1[1], triangle.v2[1]);
          const maxY = Math.max(triangle.v0[1], triangle.v1[1], triangle.v2[1]);
          const minZ = Math.min(triangle.v0[2], triangle.v1[2], triangle.v2[2]);
          const maxZ = Math.max(triangle.v0[2], triangle.v1[2], triangle.v2[2]);
          
          // armazena bounding box
          this.boundingBoxes.push({
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
            center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
          });
        }
      }
    }
  }
  
  // verificar colisão do jogador com as paredes
  checkCollision(pos, radius = 0.4) {
    const checkHeight = pos[1] + 0.5; // 0.5 unidade acima do jogador altura do jogador - threshold
    
    // percorre todas boundig boxes do labirinto 
    for (let i = 0; i < this.boundingBoxes.length; i++) {
      const bbox = this.boundingBoxes[i];
      
      // expande a bouding box para verificar ação rápida
      const expandedMin = [bbox.min[0] - radius, bbox.min[1] - 1.0, bbox.min[2] - radius];
      const expandedMax = [bbox.max[0] + radius, bbox.max[1] + 2.0, bbox.max[2] + radius];
      
      if (pos[0] >= expandedMin[0] && pos[0] <= expandedMax[0] &&
          checkHeight >= expandedMin[1] && checkHeight <= expandedMax[1] &&
          pos[2] >= expandedMin[2] && pos[2] <= expandedMax[2]) {
        
        // calcular distância para determinar normal de colisão
        const distancesToMin = [
          Math.abs(pos[0] - bbox.min[0]), // parede esquerda
          Math.abs(checkHeight - bbox.min[1]), // parede direita
          Math.abs(pos[2] - bbox.min[2]) // parede trás
        ];
        
        const distancesToMax = [
          Math.abs(pos[0] - bbox.max[0]),
          Math.abs(checkHeight - bbox.max[1]),
          Math.abs(pos[2] - bbox.max[2])
        ];
        
        // encontra a menor distância - face mais próxima
        const minDistance = Math.min(...distancesToMin, ...distancesToMax);
        
        // determina a normal da colisão baseada na face mais próxima
        let normal = [0, 0, 0];
        if (minDistance === distancesToMin[0]) normal = [1, 0, 0];
        else if (minDistance === distancesToMax[0]) normal = [-1, 0, 0]; // colidiu com parede esquerda
        else if (minDistance === distancesToMin[2]) normal = [0, 0, 1]; // colidiu com parede direita
        else if (minDistance === distancesToMax[2]) normal = [0, 0, -1]; // colidiu com trás
        
        return {
          collides: true,
          normal: normal,
          penetration: radius + minDistance,
          bbox: bbox,
          bboxIndex: i
        };
      }
    }
    
    return { collides: false };
  }
  
  // debug bounding boxes
  createDebugGeometry(gl) {
    if (!this.boundingBoxes.length) return null;
    
    const positions = [];
    const indices = [];
    
    this.boundingBoxes.forEach((bbox, idx) => {
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
    
    this.debugBufferInfo = webglUtils.createBufferInfoFromArrays(gl, arrays);
    return this.debugBufferInfo;
  }
  
  toggleDebug() {
    this.debugEnabled = !this.debugEnabled;
    console.log(`Debug de colisão (paredes): ${this.debugEnabled ? 'ON' : 'OFF'}`);
    return this.debugEnabled;
  }
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

// ===================== MAIN =====================
async function main() {
  const canvas = document.querySelector("#glCanvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    console.error("WebGL não suportado");
    return;
  }

  // ---------- SHADERS ----------
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
      // cálculo de luz difusa - Lambert 
      vec3 normal = normalize(v_normal);
      vec3 lightDir = normalize(u_lightDirection);
      float diff = max(dot(normal, lightDir), 0.0) * 0.7;
      
      // especular (Binn-Phong)
      vec3 viewDir = normalize(u_viewWorldPosition - v_worldPosition);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(normal, halfDir), 0.0), u_shininess * 0.7);

      // combinação das luzes 
      vec3 baseColor = u_diffuse.rgb;
      vec3 litColor = baseColor * (u_ambient * 0.5 + diff * (1.0 - u_ambient * 0.5)) + u_specularColor * spec * 1.5;

      // emission com bordas neon 
      vec3 neonColor = u_emissionColor * 1.2;
      float edgeFactor = 1.0 - abs(dot(normal, viewDir));
      edgeFactor = pow(edgeFactor, 2.0) * 0.5 + 0.5;
      vec3 emission = neonColor * u_emissionStrength * (1.0 + edgeFactor * 0.5);
      vec3 color = litColor + emission * 2.0;

      // fog linear - neblina 
      float dist = length(v_worldPosition - u_viewWorldPosition);
      float fogAmount = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
      vec3 foggedColor = mix(color, u_fogColor, fogAmount * 0.7);

      // cor final 
      gl_FragColor = vec4(foggedColor, u_diffuse.a);
    }
  `;

  const programInfo = webglUtils.createProgramInfo(gl, [vs, fs]);
  const debugProgramInfo = webglUtils.createProgramInfo(gl, [debugVS, debugFS]);

  // ---------- PERSONAGENS ----------
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
      moveSpeed: 4.0,
      pulseSpeed: 2.5,
      radius: 0.4,
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
      isPlayer: false,
      speed: 0.0,
      pulseSpeed: 0.0,
    },
  ];

  // ----------------- FRUTINHAS -----------------
const fruits = [];
let fruitBufferInfo = null;
let fruitsCollected = 0;

const FRUIT_DISAPPEAR_DURATION = 0.4;

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

  // fallback
  return [0, 0, 0];
}

function spawnFruit() {
  const pos = getRandomFruitPosition();
  fruits.push({
    pos,
    collected: false,    
    disappearTimer: 0,     
  });
}

  const player = characters.find((c) => c.isPlayer);
  const collisionSystem = new CollisionSystem();

  // ---------- PARÂMETROS DE CENA ----------
  const worldLimit = 9;
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
      const arrays = {
        position: data.position,
        normal: data.normal,
      };
      ch.bufferInfo = webglUtils.createBufferInfoFromArrays(gl, arrays);
      
      console.log("Carregado:", ch.name, "- vértices:", data.position.length / 3);
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
      
      collisionSystem.processLabyrinthMesh(labData.position);
      collisionSystem.createDebugGeometry(gl);

        for (let i = 0; i < 10; ++i) {
          spawnFruit();
        }
      
      console.log("Labirinto carregado:", labData.position.length / 3, "vértices");
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
      const fruitArrays = {
        position: fruitData.position,
        normal: fruitData.normal,
      };
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
    /*
      frente = +1 . trás = -1 . parado = 0 
      esquerda = +1 , direita = -1 , reto = 0
    */
    let moveForward = 0;
    let turnDirection = 0;
    
    if (keys["w"] || keys["arrowup"]) moveForward += 1;
    if (keys["s"] || keys["arrowdown"]) moveForward -= 1;
    
    if (keys["a"]) turnDirection += 1;
    if (keys["d"]) turnDirection -= 1;
    
    // sistema de rotação 
    if (Math.abs(turnDirection) > 0.001) {
      const curveAmount = turnDirection * player.turnSpeed * dt; // calcula quando virar baseado no tempo e velocidade da curva
      player.facingAngle += curveAmount; // atualizada o ângulo que pac-man está olhando 
    }
    
    // sistema de movimentação 
    if (Math.abs(moveForward) > 0.001) {
      let moveAngle = player.facingAngle; // determina direção do movimento - padrão é direção quje está olhando 
      
      // move para trás 
      if (moveForward < 0) {
        moveAngle = player.facingAngle + Math.PI; // add 180 graus
      }
      
      // converte ângulo para vetor de direção 
      const moveX = Math.sin(moveAngle); // X
      const moveZ = Math.cos(moveAngle); // Z
      
      // calcula nova posição desejada
      const desiredX = player.pos[0] + moveX * player.moveSpeed * dt * Math.abs(moveForward);
      const desiredZ = player.pos[2] + moveZ * player.moveSpeed * dt * Math.abs(moveForward);
      
      // verificar colisão apenas com paredes
      const tempPos = [desiredX, player.pos[1], desiredZ];
      const collision = collisionSystem.checkCollision(tempPos, player.radius);
      
      if (!collision.collides) {
        player.pos[0] = desiredX;
        player.pos[2] = desiredZ;
        
        player.pos[0] = Math.max(-worldLimit, Math.min(worldLimit, player.pos[0]));
        player.pos[2] = Math.max(-worldLimit, Math.min(worldLimit, player.pos[2]));
      } else {
        // colisão com parede - tentar movimento parcial
        const tempPosX = [desiredX, player.pos[1], player.pos[2]];
        const collisionX = collisionSystem.checkCollision(tempPosX, player.radius);
        
        if (!collisionX.collides) {
          player.pos[0] = desiredX;
        } else {
          const tempPosZ = [player.pos[0], player.pos[1], desiredZ];
          const collisionZ = collisionSystem.checkCollision(tempPosZ, player.radius);
          
          if (!collisionZ.collides) {
            player.pos[2] = desiredZ;
          }
        }
      }
    }

    // ---- COLETA DE FRUTAS ----
    const fruitRadius = 0.7;  

    fruits.forEach((fruit) => {
      if (fruit.collected) return; 

      const dx = player.pos[0] - fruit.pos[0];
      const dz = player.pos[2] - fruit.pos[2];
      const dist = Math.hypot(dx, dz);

      if (dist < fruitRadius) {
        fruit.collected = true;     
        fruit.disappearTimer = 0; 
        fruitsCollected++;
        console.log("Fruta coletada! Total:", fruitsCollected);
      }
    });

    // 2) Atualiza animação de desaparecimento e respawna depois
    fruits.forEach((fruit) => {
      if (!fruit.collected) return;

      fruit.disappearTimer += dt;

      if (fruit.disappearTimer >= FRUIT_DISAPPEAR_DURATION) {
        fruit.pos = getRandomFruitPosition();
        fruit.collected = false;
        fruit.disappearTimer = 0;
      }
    });
  }

  function render(timeMs) {
    const time = timeMs * 0.001;
    const dt = Math.min(time - previousTime, 0.05);
    previousTime = time;

    update(dt, time);

    webglUtils.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    gl.clearColor(0.02, 0.02, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---------- CÂMERA ----------
    const camDistance = 8; // distância atrás do pac-man
    const camHeight = 4; // altura da câmera
    
    // câmera fica atrás do pac-man na direção que ele está olhando 
    const offsetX = Math.sin(player.facingAngle) * camDistance;
    const offsetZ = Math.cos(player.facingAngle) * camDistance;
    
    const cameraPosition = [
      player.pos[0] - offsetX, // pos X = atrás
      player.pos[1] + camHeight, // pós Y = acima 
      player.pos[2] - offsetZ // pos Z = atrás
    ];
    
    const target = [player.pos[0], player.pos[1] + 1.0, player.pos[2]];
    const up = [0, 1, 0];

    // projeção perspectiva
    const fieldOfViewRadians = degToRad(60); // campo de visão 60 graus
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);
    
    // view matrix 
    const camera = m4.lookAt(cameraPosition, target, up);
    const view = m4.inverse(camera);

    // luz 
    const lightDirection = m4.normalize([-0.6, 1.0, 0.8]);
    const ambient = [0.15, 0.15, 0.15];
    const viewWorldPos = cameraPosition;

    // fog linear
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
    if (fruitBufferInfo) {
      fruits.forEach((fruit) => {

        let t = 0;
        if (fruit.collected) {
          t = Math.min(fruit.disappearTimer / FRUIT_DISAPPEAR_DURATION, 1.0);
        }

        const baseScale = 0.4;
        const scale = baseScale * (1.0 - t);

        if (scale <= 0.0) return;

        const alpha = 1.0 - t;

        const bob = 0.2 * Math.sin(time * 3.0 + fruit.pos[0] + fruit.pos[2]);

        let worldFruit = m4.translation(
          fruit.pos[0],
          fruit.pos[1] + bob,
          fruit.pos[2]
        );
        worldFruit = m4.multiply(worldFruit, m4.scaling(scale, scale, scale));

        webglUtils.setBuffersAndAttributes(gl, programInfo, fruitBufferInfo);
        webglUtils.setUniforms(programInfo, {
          u_projection: projection,
          u_view: view,
          u_world: worldFruit,
          u_lightDirection: lightDirection,
          u_ambient: ambient,
          u_viewWorldPosition: viewWorldPos,
          u_shininess: 32.0,
          u_specularColor: [1.0, 1.0, 1.0],
          u_diffuse: [1.0, 0.3, 0.1, alpha],
          u_fogNear: fogNear,
          u_fogFar: fogFar,
          u_fogColor: fogColor,
          u_emissionColor: [1.0, 0.5, 0.2],
          u_emissionStrength: 0.6 * (1.0 - t),
        });

        webglUtils.drawBufferInfo(gl, fruitBufferInfo);
      });
    }

    // ---------- Desenha personagens ----------
    characters.forEach((ch) => {
      if (!ch.bufferInfo) return;

      const bob = ch.bobOffset || 0;

      let world = m4.translation(ch.pos[0], ch.pos[1] + bob, ch.pos[2]);
      world = m4.multiply(world, m4.scaling(ch.scale, ch.scale, ch.scale));

      if (ch.isPlayer) {
        world = m4.multiply(world, m4.yRotation(player.facingAngle));
      }

      let currentEmissionStrength = ch.emissionStrength;
      if (ch.isPlayer) {
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
      
      webglUtils.setBuffersAndAttributes(gl, debugProgramInfo, collisionSystem.debugBufferInfo);
      webglUtils.setUniforms(debugProgramInfo, {
        u_projection: projection,
        u_view: view,
        u_world: worldLab,
        u_color: [0.0, 1.0, 0.0]
      });
      
      webglUtils.drawBufferInfo(gl, collisionSystem.debugBufferInfo, gl.LINES);
      
      gl.enable(gl.CULL_FACE);
      gl.useProgram(programInfo.program);
    }

    requestAnimationFrame(render);
  }

  console.log("=== CONTROLES ===");
  console.log("W ou ↑: FRENTE");
  console.log("S ou ↓: TRÁS");
  console.log("A: ESQUERDA");
  console.log("D: DIREITA");
  console.log("B: Debug de colisão");
  
  requestAnimationFrame(render);
}

main();