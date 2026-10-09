"use client";

import { useEffect, useRef } from "react";

export type AstonState = "idle" | "listening" | "processing" | "speaking" | "attention";

type Vec3 = [number, number, number];
interface Look { core: Vec3; deep: Vec3; rim: Vec3; speed: number; wave: number; pulse: number; energy: number }

/** Per state: plasma core / deep colour, rim + membrane colour, motion. */
const LOOK: Record<AstonState, Look> = {
  idle: { core: [0.55, 0.95, 1.0], deep: [0.04, 0.18, 0.72], rim: [0.35, 0.85, 1.0], speed: 0.45, wave: 0.07, pulse: 0.012, energy: 0.35 },
  listening: { core: [0.62, 1.0, 0.9], deep: [0.02, 0.32, 0.5], rim: [0.4, 1.0, 0.86], speed: 0.7, wave: 0.09, pulse: 0.03, energy: 0.65 },
  processing: { core: [0.68, 0.82, 1.0], deep: [0.17, 0.1, 0.78], rim: [0.55, 0.62, 1.0], speed: 1.5, wave: 0.11, pulse: 0.018, energy: 0.9 },
  speaking: { core: [0.6, 0.97, 1.0], deep: [0.03, 0.22, 0.78], rim: [0.38, 0.9, 1.0], speed: 0.95, wave: 0.15, pulse: 0.05, energy: 1.0 },
  attention: { core: [1.0, 0.86, 0.52], deep: [0.58, 0.07, 0.04], rim: [1.0, 0.56, 0.3], speed: 0.8, wave: 0.11, pulse: 0.055, energy: 0.85 },
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

/**
 * The orb, rendered per pixel: a glass sphere with volumetric plasma inside
 * (layered 3D noise sampled through the sphere's depth), glowing filaments, a
 * Fresnel rim, specular + soft window highlights and a bounce light, wrapped
 * in translucent, iridescent, noise-displaced membranes and a halo.
 */
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uCore; uniform vec3 uDeep; uniform vec3 uRim;
uniform float uWave; uniform float uPulse; uniform float uEnergy;

// 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT)
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*snoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}

void main(){
  float px2uv = 2./uRes.y;                       // one pixel in uv units
  vec2 p = (gl_FragCoord.xy-.5*uRes)/(.5*uRes.y); // -1..1
  float t = uTime;
  float R = .5*(1.+uPulse*sin(t*2.2));
  float r = length(p);

  // ---- halo
  vec3 outside = uRim*(exp(-max(r-R,0.)*9.)*(.38+.25*uEnergy) + exp(-max(r-R,0.)*3.)*.07)*smoothstep(1.,.8,r);

  // ---- translucent, iridescent membranes
  float ang = atan(p.y,p.x);
  vec2 dir = vec2(cos(ang),sin(ang));
  vec3 mem = vec3(0.);
  for(int k=0;k<4;k++){
    float fk=float(k);
    float n1 = snoise(vec3(dir*(1.1+.35*fk), t*(.32+.1*fk)+fk*7.1));
    float n2 = snoise(vec3(dir*(2.7+.5*fk), -t*(.45+.08*fk)+fk*3.3));
    float rr = R*(1.1+.065*fk)*(1.+uWave*(n1+.4*n2));
    float d = r-rr;
    float pxd = abs(d)/px2uv;
    float line = exp(-pxd*.85)*.85 + exp(-pxd*.11)*.12;
    // depth cue: the near side of each membrane is brighter than the far side
    float facing = .55+.45*sin(ang*(1.+fk)+t*(.6+.2*fk)+fk*2.);
    float fill = smoothstep(0.,-.06,d)*smoothstep(R*.96,rr,r)*.09;
    vec3 irid = .5+.5*cos(6.2832*(vec3(0.,.33,.67)+ang/6.2832+fk*.17+t*.04));
    vec3 c = mix(uRim, uRim*irid*1.5, .38);
    mem += c*(line*(.62-.12*fk)*facing + fill);
  }

  vec3 col = outside + mem;
  float alpha = 0.;

  // ---- the glass sphere
  float edge = smoothstep(R, R-1.6*px2uv, r);
  if (r < R + 2.*px2uv) {
    float rn = min(r/R, .9999);
    vec3 n = vec3(p/R, sqrt(1.-rn*rn));
    // volumetric plasma: sample the noise field through the sphere's depth
    vec3 acc = vec3(0.);
    for(int i=0;i<6;i++){
      float fi=(float(i)+.5)/6.;
      vec3 q = vec3(p/R, mix(n.z,-n.z,fi));
      q.xz *= rot(t*.22); q.xy *= rot(t*.09);
      float dens = fbm(q*1.7+vec3(0.,0.,t*.28));
      float swirl = fbm(q*3.3-vec3(t*.18)+dens*1.3);
      float e = smoothstep(-.25,.85,dens*.7+swirl*.55);
      float core = max(1.-length(q)*.75,.18);
      acc += mix(uDeep*1.6,uCore,e*e)*(.55+1.1*e)*core;
    }
    acc = acc/6.*1.5;
    // subsurface glow: light scattered through the glass, brightest in the middle
    acc += mix(uDeep*1.8, uCore, pow(1.-rn,1.5))*(.45+.25*uEnergy);
    // bright filaments drifting near the surface
    vec3 q0 = vec3(p/R, n.z); q0.xz *= rot(t*.22);
    float vein = pow(1.-abs(snoise(q0*2.6+vec3(t*.35))),14.);
    float vein2 = pow(1.-abs(snoise(q0*5.1-vec3(t*.25))),18.);
    acc += mix(uRim,vec3(1.),.35)*(vein*.4+vein2*.15)*(.5+.5*uEnergy);
    // hot centre
    acc += uCore*pow(max(1.-rn,0.),2.2)*(.35+.4*uEnergy);

    // lighting
    float fres = pow(1.-n.z,2.6);
    vec3 L = normalize(vec3(-.45,.55,.75));
    float spec = pow(max(dot(n,normalize(L+vec3(0.,0.,1.))),0.),70.)*1.2;
    vec2 hp = p/R-vec2(-.36,.42);
    float window = exp(-dot(hp*vec2(1.,1.6),hp*vec2(1.,1.6))*16.)*.32;
    float bounce = pow(max(dot(n,normalize(vec3(.35,-.75,.4))),0.),3.)*.28;
    float shade = .72+.28*n.z;
    vec3 sph = acc*shade + uRim*fres*1.15 + vec3(spec+window) + uRim*bounce;
    // membranes in front of the sphere stay faintly visible
    sph += mem*.28;
    col = mix(col, sph, edge);
    alpha = edge;
  }

  // filmic tone-map + premultiplied alpha
  col = 1.-exp(-col*1.45);
  alpha = max(alpha, clamp(max(col.r,max(col.g,col.b)),0.,1.));
  gl_FragColor = vec4(col, alpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** WebGL renderer. Returns a stop function, or null when WebGL isn't available. */
function runGl(canvas: HTMLCanvasElement, size: number, state: { current: AstonState }, reduce: boolean): (() => void) | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  } catch {
    return null;
  }
  // GPU cost grows with pixels: cap the resolution on dense screens.
  const dpr = Math.min(1.75, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = { res: u("uRes"), time: u("uTime"), core: u("uCore"), deep: u("uDeep"), rim: u("uRim"), wave: u("uWave"), pulse: u("uPulse"), energy: u("uEnergy") };
  gl.uniform2f(U.res, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);

  const cur: Look = { ...LOOK[state.current] };
  let raf = 0, t = Math.random() * 50, last = performance.now(), lost = false;
  const onLost = (e: Event) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); };
  canvas.addEventListener("webglcontextlost", onLost);

  const frame = (now: number) => {
    if (lost) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const target = LOOK[state.current];
    const k = Math.min(1, dt * 2.5);
    cur.core = lerp3(cur.core, target.core, k);
    cur.deep = lerp3(cur.deep, target.deep, k);
    cur.rim = lerp3(cur.rim, target.rim, k);
    cur.speed = lerp(cur.speed, target.speed, k);
    cur.wave = lerp(cur.wave, target.wave, k);
    cur.pulse = lerp(cur.pulse, target.pulse, k);
    cur.energy = lerp(cur.energy, target.energy, k);
    t += dt * (reduce ? 0.12 : cur.speed);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.time, t);
    gl.uniform3fv(U.core, cur.core);
    gl.uniform3fv(U.deep, cur.deep);
    gl.uniform3fv(U.rim, cur.rim);
    gl.uniform1f(U.wave, cur.wave);
    gl.uniform1f(U.pulse, reduce ? 0 : cur.pulse);
    gl.uniform1f(U.energy, cur.energy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener("webglcontextlost", onLost);
  };
}

const rgb = (v: Vec3) => v.map((x) => Math.round(Math.min(1, x) * 255)).join(",");

/** 2D-canvas fallback for devices without WebGL. */
function run2d(canvas: HTMLCanvasElement, size: number, state: { current: AstonState }, reduce: boolean): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);
  const cur: Look = { ...LOOK[state.current] };
  let raf = 0, t = 0, last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const target = LOOK[state.current];
    const k = Math.min(1, dt * 3);
    cur.core = lerp3(cur.core, target.core, k);
    cur.deep = lerp3(cur.deep, target.deep, k);
    cur.rim = lerp3(cur.rim, target.rim, k);
    cur.speed = lerp(cur.speed, target.speed, k);
    cur.wave = lerp(cur.wave, target.wave, k);
    cur.pulse = lerp(cur.pulse, target.pulse, k);
    t += dt * (reduce ? 0.15 : cur.speed);
    const c = size / 2, R = size * 0.25 * (1 + Math.sin(t * 2.2) * cur.pulse);
    const core = rgb(cur.core), deep = rgb(cur.deep), rim = rgb(cur.rim);
    ctx.clearRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(c, c, R * 0.6, c, c, c);
    glow.addColorStop(0, `rgba(${rim},0.35)`);
    glow.addColorStop(1, `rgba(${rim},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    for (let ring = 0; ring < 4; ring++) {
      const base = R * (1.12 + ring * 0.07);
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        const w = Math.sin(a * (3 + ring) + t * (1.3 + ring * 0.4)) * cur.wave + Math.sin(a * (5 + ring * 2) - t * (0.9 + ring * 0.3)) * cur.wave * 0.5;
        const x = c + Math.cos(a) * base * (1 + w), y = c + Math.sin(a) * base * (1 + w);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${rim},${0.55 - ring * 0.1})`;
      ctx.lineWidth = 1.4 - ring * 0.2;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    const g = ctx.createRadialGradient(c - R * 0.25, c - R * 0.3, R * 0.05, c, c, R);
    g.addColorStop(0, `rgba(${core},1)`);
    g.addColorStop(1, `rgba(${deep},0.95)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    const hl = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, 0, c - R * 0.35, c - R * 0.4, R * 0.45);
    hl.addColorStop(0, "rgba(255,255,255,0.45)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/**
 * ASTON's holographic core. WebGL shader when available (realistic glass,
 * plasma and membranes), a lighter 2D canvas otherwise. Colours and motion
 * glide between states.
 */
export function AstonOrb({ state, size = 360 }: { state: AstonState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const stop = runGl(canvas, size, stateRef, reduce) ?? run2d(canvas, size, stateRef, reduce);
    return stop;
  }, [size]);

  return <canvas ref={ref} style={{ width: size, maxWidth: "100%", aspectRatio: "1 / 1", height: "auto" }} className="block" aria-hidden />;
}
