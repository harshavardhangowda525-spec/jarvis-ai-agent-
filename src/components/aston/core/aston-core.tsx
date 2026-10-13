"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { CoreState } from "@/lib/aston/core-state";
import { coreGeometry, type CoreSignal } from "./geometry";

/**
 * The ASTON Core — a holographic sphere rendered with plain WebGL (no extra
 * libraries): a liquid-glass outer shell, a violet inner sphere, a luminous
 * energy core, tilted orbital light rings with travelling light trails, and
 * particles circling on the rings and around the shell, over a quiet star
 * field. Three passes per frame: sphere (one fragment shader on a quad around
 * the core), rings (thin triangle strips), particles (points). Every state is
 * driven by real application state and live signals (microphone level, spoken
 * words, task progress).
 */

type Vec3 = [number, number, number];
interface Look { core: Vec3; ring: Vec3; violet: Vec3; spin: number; energy: number; converge: number; listen: number; speak: number; exec: number; glow: number }

const CYAN: Vec3 = [0.36, 0.88, 1.0];
const LOOK: Record<CoreState, Look> = {
  idle: { core: [0.55, 0.95, 1.0], ring: CYAN, violet: [0.52, 0.36, 1.0], spin: 1, energy: 0.45, converge: 0, listen: 0, speak: 0, exec: 0, glow: 0.8 },
  listening: { core: [0.6, 1.0, 0.95], ring: [0.4, 1.0, 0.95], violet: [0.45, 0.4, 1.0], spin: 1.15, energy: 0.7, converge: 0, listen: 1, speak: 0, exec: 0, glow: 1 },
  processing: { core: [0.72, 0.88, 1.0], ring: [0.5, 0.8, 1.0], violet: [0.6, 0.38, 1.0], spin: 2.8, energy: 0.95, converge: 1, listen: 0, speak: 0, exec: 0, glow: 1.1 },
  speaking: { core: [0.6, 0.97, 1.0], ring: CYAN, violet: [0.5, 0.38, 1.0], spin: 1.35, energy: 0.85, converge: 0, listen: 0, speak: 1, exec: 0, glow: 1.05 },
  executing: { core: [0.62, 0.95, 1.0], ring: [0.42, 0.92, 1.0], violet: [0.55, 0.38, 1.0], spin: 1.9, energy: 0.8, converge: 0.45, listen: 0, speak: 0, exec: 1, glow: 1 },
  attention: { core: [1.0, 0.76, 0.36], ring: [1.0, 0.62, 0.26], violet: [0.72, 0.26, 0.34], spin: 0.9, energy: 0.7, converge: 0, listen: 0, speak: 0, exec: 0, glow: 0.9 },
  error: { core: [1.0, 0.5, 0.38], ring: [0.95, 0.42, 0.3], violet: [0.5, 0.18, 0.28], spin: 0.35, energy: 0.35, converge: 0, listen: 0, speak: 0, exec: 0, glow: 0.6 },
};

/** Orbital rings: radius (shell units), tilt from face-on, roll, light-trail speed, trail count, brightness. */
const RINGS = [
  { r: 1.7, tilt: 1.46, roll: 0.06, speed: 0.05, heads: 4, alpha: 0.42 },
  { r: 1.52, tilt: 1.3, roll: -0.14, speed: 0.08, heads: 3, alpha: 0.62 },
  { r: 1.34, tilt: 1.16, roll: 0.3, speed: -0.1, heads: 2, alpha: 0.55 },
  { r: 1.16, tilt: 1.38, roll: -0.44, speed: 0.13, heads: 3, alpha: 0.5 },
  { r: 0.88, tilt: 1.06, roll: 0.62, speed: -0.17, heads: 2, alpha: 0.5 },
  { r: 0.76, tilt: 1.42, roll: -0.06, speed: 0.21, heads: 2, alpha: 0.6 },
];

const SNOISE = `
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
}`;

/* ------------------------------------------------------------------ pass 1: sphere */
const QUAD_VS = `attribute vec2 a; uniform vec2 uC; uniform float uU; uniform vec2 uRes;
void main(){ vec2 px = uC + a*uU*1.32; gl_Position = vec4(px/uRes*2.-1., 0., 1.); }`;

const SPHERE_FS = `
precision highp float;
uniform vec2 uC; uniform float uU; uniform float uPx;
uniform float uPh; uniform float uTime;
uniform vec3 uCore; uniform vec3 uRing; uniform vec3 uViolet;
uniform float uEnergy; uniform float uLevel; uniform float uPulse; uniform float uFlash;
uniform float uListen; uniform float uSpeak; uniform float uExec; uniform float uProgress; uniform float uGlow;
uniform float uLite; uniform vec2 uPar; uniform float uBreath;
${SNOISE}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float line(float d, float w){ return exp(-abs(d)/(uPx*w)); }
void main(){
  vec2 p = (gl_FragCoord.xy-uC)/uU;
  float r = length(p);
  float ang = atan(p.y,p.x);
  vec3 col = vec3(0.); float alpha = 0.;

  // ambient bloom around the whole core
  col += (uRing*exp(-max(r-.9,0.)*3.2)*.05 + uViolet*exp(-r*r*2.2)*.05)*uGlow*smoothstep(1.3,1.,r);

  // ---- outer liquid-glass shell (R = 1)
  if (r < 1.02) {
    float rn = min(r, .999);
    float nz = sqrt(1.-rn*rn);
    float fres = pow(1.-nz, 3.);
    vec3 irid = .5+.5*cos(6.2832*(vec3(0.,.33,.67)+ang/6.2832*.5+uPh*.02));
    vec3 rimc = mix(uRing, mix(uViolet, irid, .35), .45+.25*sin(ang*2.+uPh*.3));
    col += rimc*pow(1.-nz, 4.)*.9 + uRing*.006;
    // curved window reflection hugging the upper-left rim, and a specular glint
    float side = max(dot(p/max(r,1e-3), normalize(vec2(-.62,.78))), 0.);
    col += vec3(.75,.93,1.)*line(r-.9, 10.)*pow(side, 3.)*.2*smoothstep(.75,.88,r);
    vec3 n = vec3(p, nz);
    col += vec3(1.)*pow(max(dot(n, normalize(vec3(-.5,.55,.68))),0.),400.)*.4;
    alpha += pow(1.-nz, 3.)*.14 + .012;
  }
  col += uRing*line(r-1., 1.1)*.42 + mix(uRing,uViolet,.5)*line(r-1., 6.)*.12;

  // ---- inner violet sphere (R = .62), drifting nebula inside it
  float R2 = .62;
  vec2 p2 = p - uPar*.025;
  float r2 = length(p2);
  if (r2 < R2) {
    float rn = r2/R2;
    float nz = sqrt(1.-rn*rn);
    float fres = pow(1.-nz, 2.4);
    vec3 neb = uViolet*(.025+.3*fres);
    if (uLite < .5) {
      vec3 q = vec3(p2/R2*1.9, nz*1.6);
      q.xz *= rot(uPh*.06);
      float d = snoise(q+vec3(0.,0.,uPh*.05));
      float dust = snoise(q*5.5-vec3(uPh*.08));
      neb += mix(uViolet, uRing, .35)*smoothstep(.3,1.,d)*.09;
      neb += mix(uViolet, vec3(.85,.9,1.), .4)*smoothstep(.62,.95,dust)*.22*(.4+.6*smoothstep(-.2,.6,d));
    }
    col += neb; alpha += .05+fres*.16;
  }
  col += mix(uViolet,uRing,.3)*line(r2-R2, 1.)*.32;

  // ---- listening: waveform rings that follow the microphone
  if (uListen > .01) {
    for (int k=0;k<3;k++) {
      float fk = float(k);
      float base = .68+.1*fk;
      float w = uLevel*(.05*sin(ang*(6.+2.*fk)+uTime*(3.+fk)) + .03*sin(ang*(11.+fk)-uTime*4.2));
      float rr = base*(1.+uLevel*.13) + w + .006*sin(uTime*1.6+fk);
      col += uRing*line(r-rr, 1.3)*uListen*(.3+uLevel*1.1)*(1.-.25*fk);
    }
  }

  // ---- speaking: ripples leaving the core on spoken words
  if (uSpeak > .01) {
    for (int k=0;k<3;k++) {
      float f = fract(uTime*.55+float(k)/3.);
      float rr = .24+f*.74;
      col += uRing*line(r-rr, 1.6+f*3.)*uSpeak*(1.-f)*(.22+.6*uPulse);
    }
  }

  // ---- the energy core
  vec2 p3 = p - uPar*.045;
  float r3 = length(p3);
  float R3 = .2*(1. + .05*uBreath + .22*uPulse*uSpeak + .1*uLevel*uListen + .04*uEnergy);
  col += uCore*exp(-max(r3-R3,0.)*4.5)*(.3+.5*uEnergy)*uGlow*smoothstep(1.3,1.,r);  // bloom
  col += uCore*exp(-max(r3-R3,0.)*16.)*.7;
  if (r3 < R3*1.05) {
    float rn = min(r3/R3, .999);
    float nz = sqrt(1.-rn*rn);
    vec3 q = vec3(p3/R3, nz);
    q.xz *= rot(uPh*.35); q.xy *= rot(uPh*.12);
    float n1 = snoise(q*2.2+vec3(0.,0.,uPh*.45));
    float n2 = uLite < .5 ? snoise(q*4.3-vec3(uPh*.35)) : n1;
    // electric filaments: the zero-crossings of two drifting noise fields
    float fil = pow(1.-abs(n1), 22.) + (uLite < .5 ? pow(1.-abs(n2), 26.)*.7 : 0.);
    vec3 deep = uCore*.32;
    vec3 c = mix(deep, uCore*.85, smoothstep(-1.,1.,n1*.5+n2*.3)*.8 + (1.-rn)*.35) + uCore*fil*1.3 + vec3(.85,1.,1.)*pow(fil,2.)*.4;
    c += vec3(.85,1.,1.)*pow(1.-rn, 4.)*(.55+.45*uEnergy);                // hot centre
    c += uRing*pow(1.-nz, 2.)*.9;                                          // core rim
    float e = smoothstep(R3*1.05, R3*.97, r3);
    col = mix(col, col*.3 + c, e); alpha = mix(alpha, 1., e);
  }

  // ---- executing: progress arcs (clockwise from the top)
  if (uExec > .01) {
    float f = fract(atan(p.x, p.y)/6.2832 + 1.);
    float on;
    if (uProgress >= 0.) on = step(f, uProgress);
    else { float s = fract(f - uTime*.16); on = smoothstep(.0,.03,s)*smoothstep(.2,.14,s) + smoothstep(.5,.53,s)*smoothstep(.7,.64,s); }
    col += uRing*line(r-1.1, 1.2)*(.1+.85*on)*uExec;
    float tick = step(.8, fract(f*60.))*smoothstep(1.125,1.13,r)*smoothstep(1.16,1.155,r);
    col += uRing*tick*.22*uExec;
    if (uProgress >= 0.) { float head = exp(-abs(f-uProgress)*90.); col += vec3(.9,1.,1.)*head*line(r-1.1, 3.)*.6*uExec; }
  }

  // ---- task complete: one soft ring expanding outwards
  if (uFlash > .01) { float rr = 1.02+(1.-uFlash)*.24; col += uRing*line(r-rr, 2.5+6.*(1.-uFlash))*uFlash*.7; }

  col = 1.-exp(-col*1.35);
  alpha = clamp(max(alpha, max(col.r,max(col.g,col.b))), 0., 1.);
  gl_FragColor = vec4(col, alpha);
}`;

/* ------------------------------------------------------------------ pass 2: rings */
const RING_VS = `
attribute vec2 aP;                 // angle, side (-1..1)
uniform mat3 uM; uniform vec2 uC; uniform float uU; uniform vec2 uRes;
uniform float uR; uniform float uWpx; uniform float uPersp;
varying float vSide; varying float vAng; varying float vZ; varying float vRel;
vec3 at(float a){ return uM*vec3(cos(a)*uR, sin(a)*uR, 0.); }
vec2 scr(vec3 p){ return uC + p.xy*uU/(1.-p.z*uPersp); }
void main(){
  vec3 p0 = at(aP.x); vec3 p1 = at(aP.x+.01);
  vec2 s0 = scr(p0); vec2 s1 = scr(p1);
  vec2 t = s1-s0; t = length(t) > 1e-4 ? normalize(t) : vec2(1.,0.);
  vec2 px = s0 + vec2(-t.y, t.x)*aP.y*uWpx;
  vSide = aP.y; vAng = aP.x; vZ = p0.z; vRel = length((s0-uC)/uU);
  gl_Position = vec4(px/uRes*2.-1., 0., 1.);
}`;

const RING_FS = `
precision mediump float;
uniform vec3 uCol; uniform float uAlpha; uniform float uPh; uniform float uSpeed; uniform float uHeads; uniform float uSharp; uniform float uTrail;
varying float vSide; varying float vAng; varying float vZ; varying float vRel;
void main(){
  float across = exp(-vSide*vSide*uSharp);
  float f = fract(vAng*uHeads/6.2832 - uPh*uSpeed);
  float trail = mix(1., pow(f, 5.)*1.25 + .14, uTrail);
  float back = smoothstep(.04, -.12, vZ);
  float hidden = back*(1.-smoothstep(.58, .66, vRel));        // behind the inner sphere
  float depth = mix(1., .42, back)*(1.-.88*hidden);
  float a = across*trail*depth*uAlpha;
  gl_FragColor = vec4(uCol*a, a);
}`;

/* ------------------------------------------------------------------ pass 3: particles */
const PART_VS = `
attribute vec4 aA;   // radius, angle0, angular speed, height / latitude / screen y
attribute vec4 aB;   // set (0-5 ring, 6 cloud, 7 star), size, brightness, violet mix
uniform mat3 uRingM[6]; uniform mat3 uCloudM;
uniform float uPh; uniform float uTime; uniform float uConv; uniform float uLevel; uniform float uListen;
uniform vec2 uC; uniform float uU; uniform vec2 uRes; uniform float uPersp; uniform float uDpr; uniform vec2 uPar;
varying float vA; varying float vMix;
void main(){
  float set = aB.x;
  vec3 p; float bright = aB.z;
  if (set > 6.5) {
    vec2 px = vec2(aA.x, aA.w)*uRes - uPar*aB.y*6.*uDpr;
    gl_Position = vec4(px/uRes*2.-1., 0., 1.);
    gl_PointSize = aB.y*uDpr;
    vA = bright*(.55+.45*sin(uTime*aA.z+aA.y*7.));
    vMix = aB.w;
    return;
  }
  float th = aA.y + uPh*aA.z;
  float pull = uConv*fract(aA.y*7.31);
  if (set > 5.5) {
    float r = aA.x*mix(1., .5, pull);
    float lat = aA.w;
    p = uCloudM*vec3(cos(lat)*cos(th)*r, sin(lat)*r, cos(lat)*sin(th)*r);
  } else {
    float r = aA.x*mix(1., .62, pull);
    p = uRingM[int(set)]*vec3(cos(th)*r, sin(th)*r, aA.w);
    bright *= 1. + uLevel*uListen*1.4;
  }
  float s = 1./(1.-p.z*uPersp);
  vec2 px = uC + p.xy*uU*s;
  float rel = length(p.xy*s);
  float back = smoothstep(.04, -.12, p.z);
  float hidden = back*(1.-smoothstep(.58, .66, rel));
  vA = bright*mix(1., .45, back)*(1.-.9*hidden);
  vMix = aB.w;
  gl_PointSize = aB.y*uDpr*s;
  gl_Position = vec4(px/uRes*2.-1., 0., 1.);
}`;

const PART_FS = `
precision mediump float;
uniform vec3 uRing; uniform vec3 uViolet;
varying float vA; varying float vMix;
void main(){
  vec2 d = gl_PointCoord-.5;
  float a = exp(-dot(d,d)*18.)*vA;
  vec3 c = mix(mix(uRing, vec3(.9,1.,1.), .25), uViolet, vMix);
  gl_FragColor = vec4(c*a, a);
}`;

/* ------------------------------------------------------------------ helpers */
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

type M3 = number[]; // column-major 3×3
const mul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
};
const rx = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
const ry = (a: number): M3 => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
const rz = (a: number): M3 => [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];

function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** Deterministic pseudo-random numbers, so the particle field is the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function buildParticles(lite: boolean): { data: Float32Array; count: number } {
  const rand = rng(2045);
  const out: number[] = [];
  const perRing = lite ? 70 : 210, cloud = lite ? 160 : 480, stars = lite ? 140 : 260;
  RINGS.forEach((ring, i) => {
    for (let k = 0; k < perRing; k++) {
      const spread = (rand() - 0.5) * (rand() < 0.75 ? 0.035 : 0.14);
      const dir = RINGS[i].speed >= 0 ? 1 : -1;
      out.push(ring.r + spread, rand() * Math.PI * 2, dir * (0.04 + rand() * 0.07), (rand() - 0.5) * 0.02,
        i, 1.2 + rand() * (rand() < 0.1 ? 3.2 : 1.6), 0.35 + rand() * 0.65, rand() < 0.18 ? 0.8 : 0);
    }
  });
  for (let k = 0; k < cloud; k++) {
    const shell = rand() < 0.7;
    const r = shell ? 0.98 + rand() * 0.12 : 0.66 + rand() * 0.3;
    out.push(r, rand() * Math.PI * 2, 0.02 + rand() * 0.05, Math.asin(rand() * 2 - 1),
      6, 1 + rand() * 1.6, 0.18 + rand() * 0.45, rand() < 0.35 ? 0.9 : 0.1);
  }
  for (let k = 0; k < stars; k++) {
    out.push(rand(), rand() * 6.28, 0.4 + rand() * 1.6, rand(), 7, 0.8 + rand() * 1.4, 0.1 + rand() * 0.35, rand() < 0.3 ? 0.7 : 0.15);
  }
  return { data: new Float32Array(out), count: out.length / 8 };
}

export interface RenderInfo { mode: "webgl" | "fallback"; quality: "full" | "lite"; fps: number }

interface Opts {
  state: MutableRefObject<CoreState>;
  signal: MutableRefObject<CoreSignal>;
  paused: MutableRefObject<boolean>;
  parallax: MutableRefObject<boolean>;
  reduce: boolean;
  quality: "auto" | "full" | "lite";
  onInfo: (i: RenderInfo) => void;
}

/** Start the renderer. Returns a stop function, or null when WebGL isn't available. */
function runCore(canvas: HTMLCanvasElement, o: Opts): (() => void) | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let sphere: WebGLProgram, ringP: WebGLProgram, partP: WebGLProgram;
  try {
    sphere = program(gl, QUAD_VS, SPHERE_FS);
    ringP = program(gl, RING_VS, RING_FS);
    partP = program(gl, PART_VS, PART_FS);
  } catch {
    return null;
  }

  let lite = o.quality === "lite";
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const SEG = 320;
  const strip: number[] = [];
  for (let i = 0; i <= SEG; i++) { const a = (i / SEG) * Math.PI * 2; strip.push(a, -1, a, 1); }
  const ringBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);

  const partBuf = gl.createBuffer();
  let parts = buildParticles(lite);
  const uploadParticles = () => { gl.bindBuffer(gl.ARRAY_BUFFER, partBuf); gl.bufferData(gl.ARRAY_BUFFER, parts.data, gl.STATIC_DRAW); };
  uploadParticles();

  const loc = (p: WebGLProgram) => (n: string) => gl.getUniformLocation(p, n);
  const S = loc(sphere), Rg = loc(ringP), P = loc(partP);
  const sU = Object.fromEntries(["uC", "uU", "uRes", "uPx", "uPh", "uTime", "uCore", "uRing", "uViolet", "uEnergy", "uLevel", "uPulse", "uFlash", "uListen", "uSpeak", "uExec", "uProgress", "uGlow", "uLite", "uPar", "uBreath"].map((n) => [n, S(n)]));
  const rU = Object.fromEntries(["uM", "uC", "uU", "uRes", "uR", "uWpx", "uPersp", "uCol", "uAlpha", "uPh", "uSpeed", "uHeads", "uSharp", "uTrail"].map((n) => [n, Rg(n)]));
  const pU = Object.fromEntries(["uRingM", "uCloudM", "uPh", "uTime", "uConv", "uLevel", "uListen", "uC", "uU", "uRes", "uPersp", "uDpr", "uPar", "uRing", "uViolet"].map((n) => [n, P(n)]));
  const aQuad = gl.getAttribLocation(sphere, "a"), aRing = gl.getAttribLocation(ringP, "aP");
  const aA = gl.getAttribLocation(partP, "aA"), aB = gl.getAttribLocation(partP, "aB");

  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(lite ? 1 : 1.5, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(canvas.clientWidth * dpr));
    H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // pointer parallax (desktop mouse, or a finger dragging on a phone)
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e: PointerEvent) => {
    if (!o.parallax.current || o.reduce) return;
    par.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    par.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  const cur: Look = { ...LOOK[o.state.current] };
  let raf = 0, ph = Math.random() * 40, time = 0, last = performance.now(), lost = false, drawn = false;
  let breath = 0;
  // auto quality: watch the first ~2 seconds of real frames
  const samples: number[] = [];
  let measured = o.quality !== "auto", fpsAvg = 60, infoAt = 0;
  const report = () => o.onInfo({ mode: "webgl", quality: lite ? "lite" : "full", fps: Math.round(fpsAvg) });
  report();

  const onLost = (e: Event) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); o.onInfo({ mode: "fallback", quality: "lite", fps: 0 }); };
  canvas.addEventListener("webglcontextlost", onLost);

  const frame = (now: number) => {
    if (lost) return;
    raf = requestAnimationFrame(frame);
    if (o.paused.current && drawn) { last = now; return; }
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, rawDt);
    if (drawn && rawDt > 0 && rawDt < 0.5) {
      fpsAvg = lerp(fpsAvg, 1 / rawDt, 0.05);
      if (!measured) {
        samples.push(rawDt);
        if (samples.length >= 90) {
          measured = true;
          const sorted = [...samples].sort((a, b) => a - b);
          if (sorted[Math.floor(sorted.length / 2)] > 1 / 33 && !lite) {
            lite = true; parts = buildParticles(true); uploadParticles(); resize();
          }
          report();
        }
      }
      if (now - infoAt > 2000) { infoAt = now; report(); }
    }
    drawn = true;

    const sig = o.signal.current;
    const target = LOOK[o.state.current];
    const k = Math.min(1, dt * 4);
    cur.core = lerp3(cur.core, target.core, k);
    cur.ring = lerp3(cur.ring, target.ring, k);
    cur.violet = lerp3(cur.violet, target.violet, k);
    for (const key of ["spin", "energy", "converge", "listen", "speak", "exec", "glow"] as const) cur[key] = lerp(cur[key], target[key], k);
    const motion = o.reduce ? 0.15 : 1;
    ph += dt * cur.spin * motion;
    time += dt * motion;
    breath = o.reduce ? 0 : Math.sin(time * 1.3);
    sig.pulse = Math.max(0, sig.pulse - dt * 3.2);
    sig.flash = Math.max(0, sig.flash - dt * 0.7);
    // without word timings, speech still moves the core — gently, at a speaking rhythm
    const pulse = o.reduce ? 0 : sig.wordSync ? sig.pulse : (0.35 + 0.3 * Math.sin(time * 9.1) * Math.sin(time * 3.7)) * cur.speak;
    par.x = lerp(par.x, o.parallax.current && !o.reduce ? par.tx : 0, Math.min(1, dt * 2));
    par.y = lerp(par.y, o.parallax.current && !o.reduce ? par.ty : 0, Math.min(1, dt * 2));

    const g = coreGeometry(W / dpr, H / dpr);
    const C: [number, number] = [g.cx * dpr, H - g.cy * dpr];
    const U = g.u * dpr;
    const cam = mul(rx(par.y * 0.1), ry(par.x * 0.14));
    const persp = 0.12;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    // ---- sphere
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(sphere);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aQuad);
    gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(sU.uC, C[0], C[1]); gl.uniform1f(sU.uU, U); gl.uniform2f(sU.uRes, W, H); gl.uniform1f(sU.uPx, 1 / U);
    gl.uniform1f(sU.uPh, ph); gl.uniform1f(sU.uTime, time);
    gl.uniform3fv(sU.uCore, cur.core); gl.uniform3fv(sU.uRing, cur.ring); gl.uniform3fv(sU.uViolet, cur.violet);
    gl.uniform1f(sU.uEnergy, cur.energy); gl.uniform1f(sU.uLevel, sig.level); gl.uniform1f(sU.uPulse, pulse); gl.uniform1f(sU.uFlash, sig.flash);
    gl.uniform1f(sU.uListen, cur.listen); gl.uniform1f(sU.uSpeak, cur.speak); gl.uniform1f(sU.uExec, cur.exec);
    gl.uniform1f(sU.uProgress, sig.progress == null ? -1 : sig.progress); gl.uniform1f(sU.uGlow, cur.glow);
    gl.uniform1f(sU.uLite, lite ? 1 : 0); gl.uniform2f(sU.uPar, par.x, -par.y); gl.uniform1f(sU.uBreath, breath);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(aQuad);

    // ---- rings (additive light)
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(ringP);
    gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf);
    gl.enableVertexAttribArray(aRing);
    gl.vertexAttribPointer(aRing, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(rU.uC, C[0], C[1]); gl.uniform1f(rU.uU, U); gl.uniform2f(rU.uRes, W, H); gl.uniform1f(rU.uPersp, persp);
    gl.uniform1f(rU.uPh, ph);
    const ringMs: number[] = [];
    RINGS.forEach((ring, i) => {
      const m = mul(cam, mul(rz(ring.roll + Math.sin(ph * 0.03 + i) * 0.05), rx(-ring.tilt)));
      ringMs.push(...m);
      gl.uniformMatrix3fv(rU.uM, false, m);
      gl.uniform1f(rU.uSpeed, ring.speed * 4); gl.uniform1f(rU.uHeads, ring.heads);
      const bands = lite
        ? [{ dr: 0, w: 7, a: 0.16, sharp: 2.5, col: cur.ring, trail: 0.6 }, { dr: 0, w: 1.5, a: 0.85, sharp: 2.2, col: cur.ring, trail: 1 }]
        : [
          { dr: 0, w: 16, a: 0.16, sharp: 2.8, col: cur.ring, trail: 0.55 },
          { dr: 0, w: 1.8, a: 1.15, sharp: 2.2, col: lerp3(cur.ring, [1, 1, 1], 0.2), trail: 1 },
          { dr: 0.012, w: 1.1, a: 0.45, sharp: 2.2, col: lerp3(cur.ring, cur.violet, 0.45), trail: 0.85 },
          { dr: -0.016, w: 1, a: 0.32, sharp: 2.2, col: cur.ring, trail: 0.6 },
          { dr: 0.028, w: 0.8, a: 0.2, sharp: 2.2, col: cur.ring, trail: 0.3 },
        ];
      for (const b of bands) {
        gl.uniform1f(rU.uR, ring.r + b.dr); gl.uniform1f(rU.uWpx, b.w * dpr * 1.6);
        gl.uniform3fv(rU.uCol, b.col); gl.uniform1f(rU.uAlpha, b.a * ring.alpha * (0.75 + 0.35 * cur.energy));
        gl.uniform1f(rU.uSharp, b.sharp); gl.uniform1f(rU.uTrail, b.trail);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2);
      }
    });
    gl.disableVertexAttribArray(aRing);

    // ---- particles
    gl.useProgram(partP);
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    gl.enableVertexAttribArray(aA); gl.enableVertexAttribArray(aB);
    gl.vertexAttribPointer(aA, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(aB, 4, gl.FLOAT, false, 32, 16);
    gl.uniformMatrix3fv(pU.uRingM, false, ringMs);
    gl.uniformMatrix3fv(pU.uCloudM, false, mul(cam, mul(rx(0.35), ry(ph * 0.05))));
    gl.uniform1f(pU.uPh, ph); gl.uniform1f(pU.uTime, time); gl.uniform1f(pU.uConv, cur.converge);
    gl.uniform1f(pU.uLevel, sig.level); gl.uniform1f(pU.uListen, cur.listen);
    gl.uniform2f(pU.uC, C[0], C[1]); gl.uniform1f(pU.uU, U); gl.uniform2f(pU.uRes, W, H); gl.uniform1f(pU.uPersp, persp);
    gl.uniform1f(pU.uDpr, dpr); gl.uniform2f(pU.uPar, par.x, -par.y);
    gl.uniform3fv(pU.uRing, cur.ring); gl.uniform3fv(pU.uViolet, cur.violet);
    gl.drawArrays(gl.POINTS, 0, parts.count);
    gl.disableVertexAttribArray(aA); gl.disableVertexAttribArray(aB);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("webglcontextlost", onLost);
  };
}

/**
 * Full-viewport canvas behind the interface. Falls back to a still CSS core
 * when WebGL isn't available (or the GPU drops the context).
 */
export function AstonCore({ state, signal, paused = false, quality = "auto", parallax = true, reduceMotion = false, onInfo }: {
  state: CoreState;
  signal: MutableRefObject<CoreSignal>;
  paused?: boolean;
  quality?: "auto" | "full" | "lite";
  parallax?: boolean;
  reduceMotion?: boolean;
  onInfo?: (i: RenderInfo) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const parRef = useRef(parallax);
  parRef.current = parallax;
  const infoRef = useRef(onInfo);
  infoRef.current = onInfo;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = reduceMotion || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const onInfo = (i: RenderInfo) => { if (i.mode === "fallback") setFallback(true); infoRef.current?.(i); };
    const stop = runCore(canvas, { state: stateRef, signal, paused: pausedRef, parallax: parRef, reduce, quality, onInfo });
    if (!stop) { setFallback(true); infoRef.current?.({ mode: "fallback", quality: "lite", fps: 0 }); return; }
    setFallback(false);
    return stop;
  }, [quality, reduceMotion, signal]);

  return (
    <>
      <canvas ref={ref} className="ax-canvas" aria-hidden style={fallback ? { display: "none" } : undefined} />
      {fallback && <div className={`ax-fallback ax-fallback-${state}`} aria-hidden><span /><i /><i /><i /></div>}
    </>
  );
}
