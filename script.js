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
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

// ===================== MAIN =====================
async function main() {
  const canvas = document.querySelector("#glCanvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    console.error("WebGL não suportado");
    return;
  }

  // ---------- SHADERS COM ILUMINAÇÃO + FOG ----------
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

    void main() {
      vec3 normal = normalize(v_normal);
      vec3 lightDir = normalize(u_lightDirection);

      float diff = max(dot(normal, lightDir), 0.0);

      vec3 viewDir = normalize(u_viewWorldPosition - v_worldPosition);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(normal, halfDir), 0.0), u_shininess);

      vec3 baseColor = u_diffuse.rgb;
      vec3 color = baseColor * (u_ambient + diff * (1.0 - u_ambient)) +
                   u_specularColor * spec;

      float dist = length(v_worldPosition - u_viewWorldPosition);
      float fogAmount = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
      vec3 finalColor = mix(color, u_fogColor, fogAmount);

      gl_FragColor = vec4(finalColor, u_diffuse.a);
    }
  `;

  const programInfo = webglUtils.createProgramInfo(gl, [vs, fs]);

  // ---------- PERSONAGENS ----------
  const characters = [
    {
      name: "pacman",
      url: "pac_man.obj",
      color: [1.0, 1.0, 0.0, 1.0],   // amarelo
      pos: [0, 0, 0],
      scale: 0.8,
      bobAmplitude: 0.0,
      isPlayer: true,
      facingAngle: 0,
      speed: 4.0,
    },
    {
      name: "ghost_red",
      url: "ghost_red.obj",
      color: [1.0, 0.0, 0.1, 1.0],
      pos: [-4, 0, -2],
      scale: 0.8,
      bobAmplitude: 0.25,
      isPlayer: false,
      speed: 2.0,
    },
    {
      name: "ghost_pink",
      url: "ghost_pink.obj",
      color: [1.0, 0.4, 0.8, 1.0],
      pos: [4, 0, -2],
      scale: 0.8,
      bobAmplitude: 0.25,
      isPlayer: false,
      speed: 2.0,
    },
    {
      name: "ghost_blue",
      url: "ghost_blue.obj",
      color: [0.3, 0.5, 1.0, 1.0],
      pos: [-2, 0, -5],
      scale: 0.8,
      bobAmplitude: 0.25,
      isPlayer: false,
      speed: 2.2,
    },
    {
      name: "ghost_yellow",
      url: "ghost_yellow.obj",
      color: [1.0, 0.85, 0.2, 1.0],
      pos: [2, 0, -5],
      scale: 0.8,
      bobAmplitude: 0.25,
      isPlayer: false,
      speed: 2.2,
    },
  ];

  const player = characters.find((c) => c.isPlayer);

  // ---------- LOAD MODELS (personagens + labirinto) ----------

  // Carrega personagens
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

  // Carrega labirinto (pasta modelo/)
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
      console.log("Labirinto carregado:", labData.position.length / 3, "vértices");
    } else {
      console.error("Erro ao carregar modelo/labirinth.obj");
    }
  } catch (e) {
    console.error("Falha ao carregar labirinto:", e);
  }

  // ---------- CHÃO (opcional, bem discreto) ----------
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
  const worldLimit = 9; // limite geral de movimentação em X/Z
  const zNear = 0.1;
  const zFar = 80;

  function degToRad(d) {
    return d * Math.PI / 180;
  }

  let previousTime = 0;

  function update(dt, totalTime) {
    if (!player) return;

    // ---- MOVIMENTO DO PAC-MAN ----
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

      player.pos[0] += moveX * player.speed * dt;
      player.pos[2] += moveZ * player.speed * dt;

      // Limite grosso de mundo (não é colisão por parede ainda)
      player.pos[0] = Math.max(-worldLimit, Math.min(worldLimit, player.pos[0]));
      player.pos[2] = Math.max(-worldLimit, Math.min(worldLimit, player.pos[2]));

      // Atualiza direção olhando para frente do movimento
      player.facingAngle = Math.atan2(moveX, -moveZ);
    }

    // ---- MOVIMENTO DOS FANTASMAS (perseguindo) ----
    characters.forEach((ch, index) => {
      if (ch.isPlayer) return;

      const dx = player.pos[0] - ch.pos[0];
      const dz = player.pos[2] - ch.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 0.1) {
        const dirX = dx / dist;
        const dirZ = dz / dist;

        ch.pos[0] += dirX * ch.speed * dt;
        ch.pos[2] += dirZ * ch.speed * dt;

        ch.pos[0] = Math.max(-worldLimit, Math.min(worldLimit, ch.pos[0]));
        ch.pos[2] = Math.max(-worldLimit, Math.min(worldLimit, ch.pos[2]));
      }

      ch.bobOffset = ch.bobAmplitude * Math.sin(totalTime * 2.0 + index);
    });

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

    gl.clearColor(0.03, 0.03, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- CÂMERA 3ª PESSOA SEGINDO PAC-MAN ----
    const camDistance = 10;
    const camHeight = 6;

    const backX = Math.sin(player.facingAngle);
    const backZ = -Math.cos(player.facingAngle);

    const cameraPosition = [
      player.pos[0] - backX * camDistance,
      camHeight,
      player.pos[2] - backZ * camDistance,
    ];
    const target = [player.pos[0], player.pos[1], player.pos[2]];
    const up = [0, 1, 0];

    const fieldOfViewRadians = degToRad(60);
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);
    const camera = m4.lookAt(cameraPosition, target, up);
    const view = m4.inverse(camera);

    const lightDirection = m4.normalize([-0.6, 1.0, 0.8]);
    const ambient = [0.25, 0.25, 0.25];
    const viewWorldPos = cameraPosition;

    const fogNear = 20.0;
    const fogFar = 60.0;
    const fogColor = [0.02, 0.02, 0.05];

    gl.useProgram(programInfo.program);

    // ---------- Desenha chão discreto ----------
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
      u_diffuse: [0.12, 0.14, 0.20, 1.0],
      u_fogNear: fogNear,
      u_fogFar: fogFar,
      u_fogColor: fogColor,
    });
    webglUtils.drawBufferInfo(gl, groundBufferInfo);

    // ---------- Desenha labirinto (fixo) ----------
    if (labyrinthBufferInfo) {
      webglUtils.setBuffersAndAttributes(gl, programInfo, labyrinthBufferInfo);

      // se precisar ajustar tamanho/altura do labirinto, mexe aqui:
      let worldLab = m4.translation(0, -1.0, 0);
      worldLab = m4.multiply(worldLab, m4.scaling(1.0, 1.0, 1.0));

      webglUtils.setUniforms(programInfo, {
        u_projection: projection,
        u_view: view,
        u_world: worldLab,
        u_lightDirection: lightDirection,
        u_ambient: ambient,
        u_viewWorldPosition: viewWorldPos,
        u_shininess: 16.0,
        u_specularColor: [0.5, 0.5, 0.7],
        u_diffuse: [0.05, 0.25, 0.55, 1.0],   // azulzinho de parede
        u_fogNear: fogNear,
        u_fogFar: fogFar,
        u_fogColor: fogColor,
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
        world = m4.multiply(world, m4.yRotation(ch.facingAngle));
      } else {
        world = m4.multiply(world, m4.yRotation(time * 0.8));
      }

      webglUtils.setBuffersAndAttributes(gl, programInfo, ch.bufferInfo);
      webglUtils.setUniforms(programInfo, {
        u_projection: projection,
        u_view: view,
        u_world: world,
        u_lightDirection: lightDirection,
        u_ambient: ambient,
        u_viewWorldPosition: viewWorldPos,
        u_shininess: 24.0,
        u_specularColor: [0.9, 0.9, 0.9],
        u_diffuse: ch.color,
        u_fogNear: fogNear,
        u_fogFar: fogFar,
        u_fogColor: fogColor,
      });

      webglUtils.drawBufferInfo(gl, ch.bufferInfo);
    });

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

main();
