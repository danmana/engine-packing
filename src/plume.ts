import * as THREE from 'three';

/** Plume cone grows from radius 1 at the nozzle exit to 1 + FLARE at its end. */
export const PLUME_FLARE = 0.6;

/**
 * Closed cone, y from 0 (nozzle exit) down to -1. Scaled per instance in the
 * vertex shader; the fragment shader ray-marches the gas inside it.
 */
export function plumeGeometry() {
  const g = new THREE.CylinderGeometry(1, 1 + PLUME_FLARE, 1, 28, 1, false);
  g.translate(0, -0.5, 0);
  return g;
}

const vertexShader = /* glsl */ `
  attribute vec4 aPlume;   // exit radius, length, power, seed
  attribute float aKind;   // 0 = engine plume, 1 = merged column
  varying vec3 vLocal;
  varying vec3 vCam;
  varying vec4 vPlume;
  varying float vKind;

  void main() {
    vPlume = aPlume;
    vKind = aKind;
    if (aPlume.z < 0.002) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 local = vec3(position.x * aPlume.x * 1.04, position.y * aPlume.y, position.z * aPlume.x * 1.04);
    mat4 m = modelMatrix * instanceMatrix;
    mat3 rot = mat3(m);
    vCam = transpose(rot) * (cameraPosition - m[3].xyz);
    vLocal = local;
    gl_Position = projectionMatrix * viewMatrix * (m * vec4(local, 1.0));
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform sampler2D uNoise;
  varying vec3 vLocal;
  varying vec3 vCam;
  varying vec4 vPlume;
  varying float vKind;

  const float FLARE = ${PLUME_FLARE.toFixed(3)};
  const int STEPS = 12;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    float R = vPlume.x;
    float L = vPlume.y;
    float power = vPlume.z;
    float seed = vPlume.w;
    bool column = vKind > 0.5;

    vec3 ro = vCam;
    vec3 rd = normalize(vLocal - vCam);
    float Rb = R * (1.0 + FLARE) * 1.04;

    // Clip the ray to a bounding cylinder and the y slab [-L, 0].
    float a = dot(rd.xz, rd.xz);
    float b = dot(ro.xz, rd.xz);
    float c = dot(ro.xz, ro.xz) - Rb * Rb;
    float t0 = -1e6;
    float t1 = 1e6;
    if (a > 1e-8) {
      float h = b * b - a * c;
      if (h <= 0.0) discard;
      h = sqrt(h);
      t0 = (-b - h) / a;
      t1 = (-b + h) / a;
    } else if (c > 0.0) discard;
    if (abs(rd.y) > 1e-8) {
      float ya = -ro.y / rd.y;
      float yb = (-L - ro.y) / rd.y;
      t0 = max(t0, min(ya, yb));
      t1 = min(t1, max(ya, yb));
    }
    t0 = max(t0, 0.0);
    t1 = min(t1, length(vLocal - vCam));
    if (t1 <= t0) discard;

    float dt = (t1 - t0) / float(STEPS);
    float jitter = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0);
    vec3 acc = vec3(0.0);

    vec3 hot = vec3(1.0, 0.86, 0.72);
    vec3 rose = vec3(1.0, 0.36, 0.48);
    vec3 lilac = vec3(0.52, 0.4, 1.0);
    vec3 haze = vec3(0.36, 0.36, 1.0);

    for (int i = 0; i < STEPS; i++) {
      float t = t0 + (float(i) + jitter) * dt;
      vec3 p = ro + rd * t;
      // Thin out gas right in front of the camera so a view up the exhaust stays readable.
      float near = smoothstep(2.0, 14.0, t);
      float x = -p.y;
      float s = clamp(x / L, 0.0, 1.0);
      float Rs = R * (1.0 + FLARE * s);
      float rho = length(p.xz) / Rs;
      if (rho > 1.0) continue;
      float ang = atan(p.z, p.x) * 0.159155 + 0.5;

      if (column) {
        float n1 = texture2D(uNoise, vec2(ang * 2.0 + seed, x * 0.018 - uTime * 0.55)).r;
        float n2 = texture2D(uNoise, vec2(ang * 5.0 - seed, x * 0.05 - uTime * 1.3)).g;
        float turb = 0.25 + 1.5 * (n1 * 0.6 + n2 * 0.4);
        float env = exp(-rho * rho * 1.8) * smoothstep(0.0, 0.18, s) * pow(1.0 - s, 1.6);
        vec3 col = mix(lilac, haze, s) + rose * 0.35 * exp(-rho * rho * 6.0) * (1.0 - s);
        acc += col * env * turb * dt * 0.06 * near;
      } else {
        // Long streaks: noise varies around the plume but slowly along it.
        float n1 = texture2D(uNoise, vec2(ang * 5.0 + seed, x / (R * 30.0) - uTime * 1.3 + seed)).r;
        float n2 = texture2D(uNoise, vec2(ang * 11.0 - seed * 1.7 + rho * 0.4, x / (R * 14.0) - uTime * 2.9)).g;
        float turb = 0.2 + 1.6 * (n1 * 0.55 + n2 * 0.45);

        // broad lilac envelope, fading downstream
        float env = exp(-rho * rho * 1.8) * pow(1.0 - s, 1.3) * smoothstep(0.0, R * 1.4, x);
        // rose core that survives further than the white-hot one
        float rosy = exp(-rho * rho * 5.0) * exp(-x / (R * 10.0)) * smoothstep(R * 0.2, R * 1.6, x);
        // hot core with shock diamonds near the exit
        float diamonds = pow(0.5 + 0.5 * cos(6.2832 * x / (R * 2.2)), 8.0);
        float core = exp(-rho * rho * 16.0) * exp(-x / (R * 5.0)) * (0.15 + 1.3 * diamonds);
        // bright sheet right at the lip
        float lip = exp(-x / (R * 0.25)) * smoothstep(1.0, 0.7, rho);

        vec3 envCol = mix(lilac, haze, clamp(s * 1.5 + rho * 0.3, 0.0, 1.0));
        // Optically thin gas: glow grows with the path length through it (metres).
        acc += (envCol * env * turb * 0.8 + rose * rosy * turb * 1.1 + hot * core * 1.1 + hot * lip * 0.3)
          * (dt / 0.65) * near;
      }
    }
    // Soft per-plume saturation: side views stay linear, end-on views don't blow out.
    vec3 outCol = acc * power * uIntensity;
    outCol /= 1.0 + dot(outCol, vec3(0.333)) * 0.9;
    gl_FragColor = vec4(outCol, 1.0);
  }
`;

export function plumeMaterial(noise: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.15 },
      uNoise: { value: noise },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
