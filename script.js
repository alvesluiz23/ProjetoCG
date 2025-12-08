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
  
  // Toggle para debug de bounding boxes
  if (e.key === 'b' || e.key === 'B') {
    if (window.toggleDebug) {
      window.toggleDebug();
    }
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

// ===================== COLISÃO =====================
class CollisionSystem {
  constructor() {
    this.triangles = []; // array de triângulos do labirinto
    this.boundingBoxes = []; // caixas delimitadoras
    this.debugEnabled = false;
    this.debugBufferInfo = null;
  }
  
  // processa os vértices do labirinto para criar triângulos de colisão 
  processLabyrinthMesh(positions, indices = null) {
    this.triangles = [];
    this.boundingBoxes = [];
    
    if (!indices) {
      for (let i = 0; i < positions.length; i += 9) {
        if (i + 8 < positions.length) {
          const triangle = {
            v0: [positions[i], positions[i + 1], positions[i + 2]],
            v1: [positions[i + 3], positions[i + 4], positions[i + 5]],
            v2: [positions[i + 6], positions[i + 7], positions[i + 8]]
          };
          this.triangles.push(triangle);
          
          // calcula bounding box para o triângulo
          const minX = Math.min(triangle.v0[0], triangle.v1[0], triangle.v2[0]);
          const maxX = Math.max(triangle.v0[0], triangle.v1[0], triangle.v2[0]);
          const minY = Math.min(triangle.v0[1], triangle.v1[1], triangle.v2[1]);
          const maxY = Math.max(triangle.v0[1], triangle.v1[1], triangle.v2[1]);
          const minZ = Math.min(triangle.v0[2], triangle.v1[2], triangle.v2[2]);
          const maxZ = Math.max(triangle.v0[2], triangle.v1[2], triangle.v2[2]);
          
          this.boundingBoxes.push({
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
            center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
          });
        }
      }
    }
    
    console.log(`Sistema de colisão: ${this.triangles.length} triângulos processados`);
  }
  
  // cria geometry para debug das bounding boxes
  createDebugGeometry(gl) {
    if (!this.boundingBoxes.length) return null;
    
    const positions = [];
    const indices = [];
    
    // cria wireframe para cada bounding box
    this.boundingBoxes.forEach((bbox, idx) => {
      const baseIdx = idx * 8; // 8 vértices por cubo
      
      // 8 vértices do cubo
      const vertices = [
        [bbox.min[0], bbox.min[1], bbox.min[2]], // 0
        [bbox.max[0], bbox.min[1], bbox.min[2]], // 1
        [bbox.max[0], bbox.min[1], bbox.max[2]], // 2
        [bbox.min[0], bbox.min[1], bbox.max[2]], // 3
        [bbox.min[0], bbox.max[1], bbox.min[2]], // 4
        [bbox.max[0], bbox.max[1], bbox.min[2]], // 5
        [bbox.max[0], bbox.max[1], bbox.max[2]], // 6
        [bbox.min[0], bbox.max[1], bbox.max[2]]  // 7
      ];
      
      // adiciona vértices ao array
      vertices.forEach(vertex => {
        positions.push(...vertex);
      });
      
      // índices para as 12 arestas do cubo
      const cubeEdges = [
        // base inferior
        0, 1, 1, 2, 2, 3, 3, 0,
        // base superior
        4, 5, 5, 6, 6, 7, 7, 4,
        // arestas verticais
        0, 4, 1, 5, 2, 6, 3, 7
      ];
      
      // adiciona índices com offset
      cubeEdges.forEach(edgeIdx => {
        indices.push(baseIdx + edgeIdx);
      });
    });
    
    // cria buffer info para wireframe
    const arrays = {
      position: new Float32Array(positions),
      indices: new Uint16Array(indices)
    };
    
    this.debugBufferInfo = webglUtils.createBufferInfoFromArrays(gl, arrays);
    return this.debugBufferInfo;
  }
  
  // toggle para debug
  toggleDebug() {
    this.debugEnabled = !this.debugEnabled;
    console.log(`Debug de bounding boxes: ${this.debugEnabled ? 'ON' : 'OFF'}`);
    return this.debugEnabled;
  }
  
  // Método simplificado: verifica se posição está dentro de paredes (bounding boxes)
  checkSimpleCollision(pos, radius = 0.4) {
    const checkHeight = pos[1] + 0.5; // Verificar na altura do meio do corpo
    
    for (let i = 0; i < this.boundingBoxes.length; i++) {
      const bbox = this.boundingBoxes[i];
      
      // Expandir bounding box pelo raio do jogador
      const expandedMin = [bbox.min[0] - radius, bbox.min[1] - 1.0, bbox.min[2] - radius];
      const expandedMax = [bbox.max[0] + radius, bbox.max[1] + 2.0, bbox.max[2] + radius];
      
      // Verificar se posição está dentro da bounding box expandida
      if (pos[0] >= expandedMin[0] && pos[0] <= expandedMax[0] &&
          checkHeight >= expandedMin[1] && checkHeight <= expandedMax[1] &&
          pos[2] >= expandedMin[2] && pos[2] <= expandedMax[2]) {
        
        // Encontrar a direção de saída mais curta
        const distancesToMin = [
          Math.abs(pos[0] - bbox.min[0]),
          Math.abs(checkHeight - bbox.min[1]),
          Math.abs(pos[2] - bbox.min[2])
        ];
        
        const distancesToMax = [
          Math.abs(pos[0] - bbox.max[0]),
          Math.abs(checkHeight - bbox.max[1]),
          Math.abs(pos[2] - bbox.max[2])
        ];
        
        const minDistance = Math.min(
          ...distancesToMin,
          ...distancesToMax
        );
        
        // Determinar normal baseada na face mais próxima
        let normal = [0, 0, 0];
        if (minDistance === distancesToMin[0]) normal = [1, 0, 0];  // Face X min
        else if (minDistance === distancesToMax[0]) normal = [-1, 0, 0]; // Face X max
        else if (minDistance === distancesToMin[2]) normal = [0, 0, 1];  // Face Z min
        else if (minDistance === distancesToMax[2]) normal = [0, 0, -1]; // Face Z max
        
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
}

// ===================== SHADER PARA DEBUG (WIREFRAME) =====================
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

  // ---------- SHADERS PRINCIPAIS ----------
  const vs = `
    attribute vec4 a_position;
    attribute vec3 a_normal;

    uniform mat4 u_projection;
    uniform mat4 u_view;
    uniform mat4 u_world;

    varying vec3 v_normal;
    varying vec3 v_worldPosition;

    void main() {
      vec4 worldPosition = u_world * a_position;
      gl_Position = u_projection * u_view * worldPosition;
      
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
      vec3 normal = normalize(v_normal);
      vec3 lightDir = normalize(u_lightDirection);
      float diff = max(dot(normal, lightDir), 0.0) * 0.7;
      
      vec3 viewDir = normalize(u_viewWorldPosition - v_worldPosition);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(normal, halfDir), 0.0), u_shininess * 0.7);

      vec3 baseColor = u_diffuse.rgb;
      vec3 litColor = baseColor * (u_ambient * 0.5 + diff * (1.0 - u_ambient * 0.5)) + u_specularColor * spec * 1.5;

      vec3 neonColor = u_emissionColor * 1.2;
      float edgeFactor = 1.0 - abs(dot(normal, viewDir));
      edgeFactor = pow(edgeFactor, 2.0) * 0.5 + 0.5;
      vec3 emission = neonColor * u_emissionStrength * (1.0 + edgeFactor * 0.5);
      vec3 color = litColor + emission * 2.0;

      float dist = length(v_worldPosition - u_viewWorldPosition);
      float fogAmount = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
      vec3 foggedColor = mix(color, u_fogColor, fogAmount * 0.7);

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
      speed: 4.0,
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
      radius: 0.4,
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
      radius: 0.4,
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
      radius: 0.4,
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
      radius: 0.4,
    },
  ];

  const player = characters.find((c) => c.isPlayer);
  const collisionSystem = new CollisionSystem();

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
      
      // carrega mesh para colisão
      collisionSystem.processLabyrinthMesh(labData.position);
      
      // cria geometry de debug
      collisionSystem.createDebugGeometry(gl);
      
      console.log("Labirinto carregado:", labData.position.length / 3, "vértices");
      console.log("Sistema de colisão inicializado");
    } else {
      console.error("Erro ao carregar modelo/labirinth.obj");
    }
  } catch (e) {
    console.error("Falha ao carregar labirinto:", e);
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

  // ---------- PARÂMETROS DE CENA ----------
  const worldLimit = 9;
  const zNear = 0.1;
  const zFar = 80;

  function degToRad(d) {
    return d * Math.PI / 180;
  }

  let previousTime = 0;
  
  // Expor função de toggle para o evento de tecla
  window.toggleDebug = () => collisionSystem.toggleDebug();

  function update(dt, totalTime) {
    if (!player) return;

    // MOVIMENTO DO PAC-MAN
    let moveX = 0;
    let moveZ = 0;

    if (keys["w"] || keys["arrowup"]) moveZ -= 1;
    if (keys["s"] || keys["arrowdown"]) moveZ += 1;
    if (keys["a"] || keys["arrowleft"]) moveX -= 1;
    if (keys["d"] || keys["arrowright"]) moveX += 1;

    const len = Math.hypot(moveX, moveZ);
    if (len > 0.001) {
      moveX /= len;
      moveZ /= len;

      // calcular nova posição pretendida
      const desiredX = player.pos[0] + moveX * player.speed * dt;
      const desiredZ = player.pos[2] + moveZ * player.speed * dt;

      // verificar colisão na nova posição
      const tempPos = [desiredX, player.pos[1], desiredZ];
      const collision = collisionSystem.checkSimpleCollision(tempPos, player.radius);

      if (!collision.collides) {
        // sem colisão = mover 
        player.pos[0] = desiredX;
        player.pos[2] = desiredZ;
        
        player.pos[0] = Math.max(-worldLimit, Math.min(worldLimit, player.pos[0]));
        player.pos[2] = Math.max(-worldLimit, Math.min(worldLimit, player.pos[2]));
      } else {
        // tentar mover apenas em X
        const tempPosX = [desiredX, player.pos[1], player.pos[2]];
        const collisionX = collisionSystem.checkSimpleCollision(tempPosX, player.radius);
        
        if (!collisionX.collides) {
          player.pos[0] = desiredX;
        } else {
          // tentar mover apenas em Z
          const tempPosZ = [player.pos[0], player.pos[1], desiredZ];
          const collisionZ = collisionSystem.checkSimpleCollision(tempPosZ, player.radius);
          
          if (!collisionZ.collides) {
            player.pos[2] = desiredZ;
          }
        }
      }

      player.facingAngle = Math.atan2(-moveX, moveZ);
    }

    player.bobOffset = 0;
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
    const camDistance = 10;
    const camHeight = 4;
    
    const offsetX = Math.sin(player.facingAngle) * camDistance;
    const offsetZ = Math.cos(player.facingAngle) * camDistance;
    
    const cameraPosition = [
      player.pos[0] - offsetX,
      player.pos[1] + camHeight,
      player.pos[2] - offsetZ
    ];
    
    const target = [player.pos[0], player.pos[1] + 1.0, player.pos[2]];
    const up = [0, 1, 0];

    const fieldOfViewRadians = degToRad(60);
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);
    const camera = m4.lookAt(cameraPosition, target, up);
    const view = m4.inverse(camera);

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

    // ---------- Desenha personagens ----------
    characters.forEach((ch) => {
      if (!ch.bufferInfo) return;

      const bob = ch.bobOffset || 0;

      let world = m4.translation(ch.pos[0], ch.pos[1] + bob, ch.pos[2]);
      world = m4.multiply(world, m4.scaling(ch.scale, ch.scale, ch.scale));

      if (ch.isPlayer) {
        world = m4.multiply(world, m4.yRotation(player.facingAngle + Math.PI));
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

    // ---------- DEBUG: Desenha bounding boxes ----------
    if (collisionSystem.debugEnabled && collisionSystem.debugBufferInfo) {
      // Mudar para shader de debug
      gl.useProgram(debugProgramInfo.program);
      
      // Configurar para wireframe (desenhar linhas)
      gl.disable(gl.CULL_FACE); // Desabilitar cull face para ver todas as faces
      
      // Desenhar cada bounding box como wireframe
      const worldLab = m4.translation(0, -1.0, 0);
      
      webglUtils.setBuffersAndAttributes(gl, debugProgramInfo, collisionSystem.debugBufferInfo);
      webglUtils.setUniforms(debugProgramInfo, {
        u_projection: projection,
        u_view: view,
        u_world: worldLab,
        u_color: [0.0, 1.0, 0.0] // Verde para bounding boxes
      });
      
      // Desenhar como wireframe (LINES)
      webglUtils.drawBufferInfo(gl, collisionSystem.debugBufferInfo, gl.LINES);
      
      // Reabilitar cull face e voltar ao shader principal
      gl.enable(gl.CULL_FACE);
      gl.useProgram(programInfo.program);
    }

    // ---------- DEBUG: Mostrar colisão atual ----------
    if (collisionSystem.debugEnabled) {
      const collision = collisionSystem.checkSimpleCollision(player.pos, player.radius);
      if (collision.collides) {
        // Desenhar bounding box da colisão atual
        gl.useProgram(debugProgramInfo.program);
        gl.disable(gl.CULL_FACE);
        
        // Criar wireframe para a bounding box específica
        const bbox = collision.bbox;
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
        
        const indices = [
          0,1,1,2,2,3,3,0, // base inferior
          4,5,5,6,6,7,7,4, // base superior
          0,4,1,5,2,6,3,7  // arestas verticais
        ];
        
        const debugArrays = {
          position: new Float32Array(vertices.flat()),
          indices: new Uint16Array(indices)
        };
        
        const singleBboxBufferInfo = webglUtils.createBufferInfoFromArrays(gl, debugArrays);
        
        webglUtils.setBuffersAndAttributes(gl, debugProgramInfo, singleBboxBufferInfo);
        webglUtils.setUniforms(debugProgramInfo, {
          u_projection: projection,
          u_view: view,
          u_world: m4.translation(0, -1.0, 0),
          u_color: [1.0, 0.0, 0.0] // Vermelho para colisão ativa
        });
        
        webglUtils.drawBufferInfo(gl, singleBboxBufferInfo, gl.LINES);
        
        gl.enable(gl.CULL_FACE);
        gl.useProgram(programInfo.program);
      }
    }

    requestAnimationFrame(render);
  }

  console.log("=== CONTROLES ===");
  console.log("WASD/setas: Mover Pac-Man");
  console.log("B: Liga/desliga debug de bounding boxes");
  console.log("=================");
  
  requestAnimationFrame(render);
}

main();