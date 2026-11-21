"use client";
import { useEffect, useRef } from "react";
import { moonPhase } from "@/lib/moon";

// The planner's backdrop: a sky that keeps the viewer's local time. The amber sun (the logo's dot) rises on
// the left at 6, peaks at noon and sets on the right at 18; then stars come out and the moon crosses, showing
// tonight's real phase, over mountain ranges, with clouds, birds by day and shooting stars by night. Colours stay close to the theme background so text contrast is unaffected.
// Purely decorative, so it is hidden from assistive tech. Without WebGL the plain background shows.

const FPS = 10; // clouds and twinkle are slow; this is indistinguishable from 60 and far cheaper

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;    // canvas size in pixels
uniform float uTime;  // seconds, for cloud drift and twinkle
uniform float uHour;  // local time of day, 0..24
uniform float uPhase; // moon phase, 0 new .. 0.5 full .. 1 new
uniform float uDark;  // 1 for the dark theme, 0 for light

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 x){
  vec2 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// Ridged noise for mountain skylines, roughly 0..1.
float ridge(float x, float seed){ float a = .5, s = 0.; vec2 q = vec2(x, seed); for (int i = 0; i < 4; i++) { s += a * (1. - abs(2. * noise(q) - 1.)); q = q * 2.07 + vec2(13.1, 0.); a *= .5; } return s; }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.02 + 17.3; a *= .5; } return s; }

// Where a body is on its arc: t = 0 rising on the left, .5 overhead, 1 setting on the right.
vec2 arc(float t, float halfW){ return vec2(mix(-halfW, halfW, t), -.5 + sin(3.14159 * t) * .82); }

void main(){
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y; // y from -.5 (bottom) to .5 (top)
  float gy = gl_FragCoord.y / uRes.y;
  float W = .5 * uRes.x / uRes.y;                // half the screen width in the same units
  float halfW = W * .82;

  float sunT = (uHour - 6.) / 12.;
  float el = sin(3.14159 * sunT);                 // sun height: 1 at noon, 0 at the horizon, negative at night
  float day = smoothstep(-.15, .25, el);
  float night = 1. - smoothstep(-.3, .02, el);
  float tw = exp(-pow(el / .3, 2.));              // twilight, strongest as the sun crosses the horizon
  vec2 sun = arc(sunT, halfW);

  // Palettes sit near each theme's background: deep in dark, pale in light.
  vec3 nightZ = mix(vec3(.890, .880, .960), vec3(.016, .015, .034), uDark);
  vec3 nightH = mix(vec3(.935, .925, .975), vec3(.055, .045, .110), uDark);
  vec3 dayZ   = mix(vec3(.860, .905, .985), vec3(.030, .062, .165), uDark);
  vec3 dayH   = mix(vec3(.950, .962, .990), vec3(.075, .135, .285), uDark);
  vec3 twH    = mix(vec3(1.00, .880, .800), vec3(.420, .170, .110), uDark);
  vec3 twZ    = mix(vec3(.915, .870, .965), vec3(.075, .035, .140), uDark);

  vec3 sky = mix(mix(nightH, dayH, day), mix(nightZ, dayZ, day), pow(gy, .75));
  float side = exp(-pow((p.x - sun.x) / .9, 2.)); // the glow gathers on the sun's side of the sky
  sky = mix(sky, twZ, tw * .55 * gy);
  sky = mix(sky, twH, tw * (1. - gy) * (1. - gy) * (.4 + .6 * side));

  // A faint band of galaxy light across the night sky.
  float band = exp(-pow((p.y - p.x * .38 - .08) / .16, 2.)) * night;
  sky += mix(vec3(-.012, -.016, .004), vec3(.030, .022, .060), uDark) * band * fbm(p * 3.5 + 4.);

  // Stars: one candidate per cell, a third of them lit, each twinkling at its own pace.
  if (night > 0.) {
    vec2 cell = floor(gl_FragCoord.xy / 26.);
    float h = hash(cell);
    if (h > .66 - .22 * band) {
      vec2 sp = (cell + .15 + .7 * vec2(hash(cell + 3.), hash(cell + 7.))) * 26.;
      float size = mix(.6, 1.6, pow(hash(cell + 11.), 3.)); // mostly faint, a few bright
      float s = smoothstep(size, 0., length(gl_FragCoord.xy - sp));
      s *= .55 + .45 * sin(uTime * (.4 + 1.6 * hash(cell + 5.)) + h * 40.);
      s *= night * smoothstep(.05, .45, gy);      // fewer through the haze near the horizon
      sky = mix(sky + s * .85, mix(sky, vec3(.42, .28, 1.), s * .5), 1. - uDark);
    }
  }

  // Sun: a warm glow and a soft disc, redder when low.
  float ds = length(p - sun);
  vec3 sunCol = mix(vec3(1., .48, .22), vec3(1., .80, .52), smoothstep(0., .5, el));
  float up = smoothstep(-.62, -.5, sun.y);
  float glow = (exp(-ds * 3.5) * .30 + exp(-ds * 14.) * .55 + exp(-ds * 60.) * .8) * up;
  float disc = smoothstep(.026, .017, ds) * up;
  sky = mix(sky + sunCol * glow * .6, mix(sky, sunCol, min(glow * .5, 1.)), 1. - uDark);
  sky = mix(sky, mix(vec3(1., .76, .42), vec3(1., .88, .66), uDark), disc * .9);

  // Moon: rises at 18, sets at 6, lit according to tonight's phase.
  float moonT = mod(uHour + 6., 24.) / 12.;
  vec2 mo = arc(moonT, halfW);
  vec2 md = p - mo;
  float mr = length(md);
  const float MR = .04;
  float moonUp = (1. - day * .85) * smoothstep(-.56, -.48, mo.y);
  sky += vec3(.10, .10, .13) * exp(-mr * 16.) * moonUp * uDark * smoothstep(.0, .5, 1. - abs(2. * uPhase - 1.)); // moonlight halo, brighter near full
  if (mr < MR) {
    vec3 N = vec3(md, sqrt(MR * MR - mr * mr)) / MR;
    float ang = uPhase * 6.28318;
    float lit = smoothstep(-.03, .08, dot(N, vec3(sin(ang), 0., -cos(ang))));
    float maria = fbm(N.xy * 3.2 + 9.);
    vec3 surf = mix(vec3(.72, .72, .76), vec3(.97, .96, .92), smoothstep(.35, .7, maria));
    vec3 moonDark = surf * (lit * (.55 + .45 * N.z) + .035) ;
    vec3 moonLight = mix(sky, vec3(.74, .73, .86) * (.9 + .1 * maria), lit * .85);
    float vis = smoothstep(MR, MR - .003, mr) * moonUp;
    sky = mix(sky, mix(moonLight, max(sky, moonDark), uDark), vis);
  }

  // Shooting star: one streak every eleven seconds or so, from a random spot.
  if (night > 0.) {
    float k = floor(uTime / 11.), f = fract(uTime / 11.) / .09;
    if (f < 1.) {
      vec2 dir = normalize(vec2(hash(vec2(k, 3.)) > .5 ? .8 : -.8, -.45));
      vec2 head = vec2((hash(vec2(k, 1.)) - .5) * 1.4 * W, .1 + .3 * hash(vec2(k, 2.))) + dir * f * .3;
      vec2 q = p - head;
      float along = dot(q, -dir);
      float m = step(0., along) * smoothstep(.14, 0., along) * smoothstep(.003, .0005, length(q + dir * along)) * sin(3.14159 * f) * night;
      sky = mix(sky + m * .9, mix(sky, vec3(.42, .28, 1.), m * .6), 1. - uDark);
    }
  }

  // Clouds with a bright edge on the side facing the sun (or the moon, once the sun is down).
  vec2 cp = vec2(p.x * 1.1 + uTime * .006, p.y * 2.6 + 2.);
  float c = fbm(cp);
  float cover = smoothstep(.5, .66, c) * smoothstep(.16, .42, gy);
  if (cover > 0.) {
    vec2 toLight = normalize((sun.y > -.5 ? sun : mo) - p + 1e-4);
    float rim = clamp((c - fbm(cp + toLight * vec2(.05, .12))) * 7. + .45, 0., 1.);
    vec3 litD = mix(mix(vec3(.085, .085, .130), vec3(.200, .270, .430), day), twH * 1.25, tw * .75);
    vec3 shD  = mix(mix(vec3(.030, .030, .060), vec3(.070, .100, .190), day), twZ * 1.1, tw * .5);
    vec3 litL = mix(vec3(1.), vec3(1., .87, .78), tw * .8);
    vec3 shL  = mix(vec3(.870, .880, .955), vec3(.900, .840, .930), tw);
    sky = mix(sky, mix(mix(shL, litL, rim), mix(shD, litD, rim), uDark), cover * .85);
  }

  // A few birds crossing in daylight.
  float birds = 0.;
  for (int i = 0; i < 5; i++) {
    float fi = float(i), h = hash(vec2(fi, 3.7));
    vec2 b = vec2(mod(uTime * (.010 + .006 * h) + h * 5., 2. * W + .2) - W - .1, .12 + .22 * hash(vec2(fi, 9.1)) + .01 * sin(uTime * .5 + fi));
    vec2 d = p - b;
    float span = .011 * (.7 + .6 * h), flap = .4 + .3 * sin(uTime * 5. + fi * 2.);
    birds += smoothstep(.0022, .0008, abs(d.y - abs(d.x) * flap)) * smoothstep(span, span * .8, abs(d.x));
  }
  sky = mix(sky, mix(vec3(.38, .38, .55), vec3(.42, .48, .66), uDark), min(birds, 1.) * day * .4); // faint, so they never fight with text

  // Three mountain ranges along the bottom, hazier with distance; the sun and moon set behind them.
  float gh = p.y + .5;
  if (gh < .36) {
    vec3 haze = mix(mix(nightH, dayH, day), twH, tw * .45);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float h = .15 - .055 * fi + (.15 - .04 * fi) * (ridge(p.x * (1.5 + 1.1 * fi) + fi * 31.7, fi * 7.3) - .35);
      if (i == 2) h += .012 * noise(vec2(p.x * 60., 1.)) * (1. - abs(2. * fract(p.x * 95.) - 1.)); // a pine treeline on the nearest ridge
      float depth = .42 + .27 * fi;
      vec3 mc = mix(mix(haze, vec3(.74, .73, .90), depth * .75), mix(haze, vec3(.010, .009, .024), depth), uDark);
      if (i == 0) { // snow on the highest far peaks
        float snow = smoothstep(.185, .215, gh + .02 * noise(vec2(p.x * 40., gh * 60.)));
        mc = mix(mc, mix(vec3(.985), vec3(.150, .160, .250) + twH * tw * .35, uDark), snow * .85);
      }
      sky = mix(sky, mc, smoothstep(h, h - 1.5 / uRes.y, gh));
    }
  }

  sky += (hash(gl_FragCoord.xy + fract(uTime)) - .5) / 255.; // dither, so dark gradients do not band
  gl_FragColor = vec4(sky, 1.);
}`;

export default function Sky() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!canvas || !gl) return;

    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return console.warn("Sky shader:", gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.bindAttribLocation(prog, 0, "p"); // must precede linking
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covering the canvas
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = u("uRes"), uTime = u("uTime"), uHour = u("uHour"), uPhase = u("uPhase"), uDark = u("uDark");

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;

    const draw = () => {
      // One canvas pixel per CSS pixel: the sky is soft, so extra density would only cost battery.
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const now = new Date();
      // The theme can change at any time (system or Settings), so read it from the resolved background.
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!.map(Number);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, still ? 0 : performance.now() / 1000);
      gl.uniform1f(uHour, now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
      gl.uniform1f(uPhase, moonPhase(now));
      gl.uniform1f(uDark, r + g + b < 384 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = () => {
      draw();
      if (document.hidden) return;
      // With reduced motion nothing drifts, but the sun still has to move: redraw once a minute.
      timer = window.setTimeout(() => requestAnimationFrame(loop), still ? 60000 : 1000 / FPS);
    };
    const wake = () => { clearTimeout(timer); loop(); }; // resume after a hidden tab, and redraw on resize
    loop();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("resize", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("resize", wake);
    };
  }, []);

  return <canvas ref={ref} className="sky" aria-hidden />;
}
