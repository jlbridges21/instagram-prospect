import * as THREE from "three";
import {
  DECORATIVE_SURFACE_LIGHTS,
  EARTH_LAND_RINGS,
  GLOBE_RESUME_IDLE_MS,
  arcSamples,
  avatarMark,
  createFrameLoop,
  globeArcCap,
  globeArcs,
  globeMotion,
  hashUsername,
  placeProspects,
  sampleArc,
  surfaceVector,
  type GlobeProspect,
} from "@/lib/visual/globe";

const STATUS_COLOR: Record<string, string> = {
  discovered: "#3B82F6",
  qualified: "#3B82F6",
  review: "#F59E0B",
  approved: "#A78BFA",
  contacted: "#22D3EE",
  replied: "#22D3EE",
  follow_up: "#22D3EE",
  demo_booked: "#22D3EE",
  converted: "#22C55E",
  skipped: "#94A3B8",
  disqualified: "#EF4444",
};

const MIN_DISTANCE = 1.85;
const MAX_DISTANCE = 4.6;

function textureX(lon: number, width: number) {
  const shifted = (((lon + 90) % 360) + 360) % 360;
  return (shifted / 360) * width;
}

function textureY(lat: number, height: number) {
  return ((90 - lat) / 180) * height;
}

function paintEarth() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.fillStyle = "#070b16";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(148, 180, 220, 0.07)";
  context.lineWidth = 1;
  for (let lon = -180; lon < 180; lon += 30) {
    const x = textureX(lon, canvas.width);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = textureY(lat, canvas.height);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  context.fillStyle = "#162033";
  context.strokeStyle = "rgba(140, 176, 214, 0.32)";
  for (const ring of EARTH_LAND_RINGS) {
    context.beginPath();
    ring.forEach(([lat, lon], index) => {
      const x = textureX(lon, canvas.width);
      const y = textureY(lat, canvas.height);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
    context.stroke();
  }
  for (const light of DECORATIVE_SURFACE_LIGHTS) {
    const x = textureX(light.lon, canvas.width);
    const y = textureY(light.lat, canvas.height);
    const glow = context.createRadialGradient(x, y, 0, x, y, 2.4);
    glow.addColorStop(0, "rgba(198, 220, 255, 0.5)");
    glow.addColorStop(1, "rgba(198, 220, 255, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, 2.4, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
}

function paintStars() {
  const positions = new Float32Array(180 * 3);
  let seed = 17;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let index = 0; index < 180; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 7 + random() * 5;
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  return positions;
}

export function mountGlobe(
  root: HTMLElement,
  markerLayer: HTMLElement,
  prospects: GlobeProspect[],
  onSelect: (id: string) => void,
) {
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reducedQuery.matches;
  let hidden = document.visibilityState === "hidden";
  let dragging = false;
  let lastInteraction = performance.now() - GLOBE_RESUME_IDLE_MS;
  let velocityX = 0;
  let velocityY = 0;
  let previous = performance.now();
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance: number | null = null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, root.clientWidth < 720 ? 1.5 : 2));
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "h-full w-full";
  renderer.domElement.setAttribute("aria-hidden", "true");
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, Math.max(root.clientWidth, 1) / Math.max(root.clientHeight, 1), 0.1, 40);
  camera.position.z = 2.85;

  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.AmbientLight(0x9eb4d4, 0.62));
  const key = new THREE.DirectionalLight(0xd6e6ff, 1.15);
  key.position.set(-2.6, 1.3, 2.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c6bff, 0.38);
  rim.position.set(2.2, -0.8, -2);
  scene.add(rim);

  const texture = new THREE.CanvasTexture(paintEarth());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshPhongMaterial({
      map: texture,
      specular: new THREE.Color("#1b2740"),
      shininess: 14,
      emissive: new THREE.Color("#c5d7ef"),
      emissiveMap: texture,
      emissiveIntensity: 0.38,
    }),
  );
  group.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.14, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {},
      vertexShader: "varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec3 vNormal; void main(){float intensity=pow(0.62-dot(vNormal, vec3(0.0,0.0,1.0)),2.2); gl_FragColor=vec4(0.45,0.62,1.0,1.0)*intensity;}",
    }),
  );
  group.add(atmosphere);

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(paintStars(), 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: "#9db4d8", size: 0.018, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

  const placed = placeProspects(prospects.map((prospect) => prospect.username));
  const nodes = prospects.map((prospect, index) => {
    const spot = placed[index] ?? { lat: 0, lon: 0 };
    return { ...prospect, lat: spot.lat, lon: spot.lon };
  });
  const arcs = globeArcs(nodes, globeArcCap(root.clientWidth));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pulses: { points: { x: number; y: number; z: number }[]; mesh: THREE.Mesh; meshB: THREE.Mesh; offset: number; hue: number }[] = [];

  for (const arc of arcs) {
    const from = byId.get(arc.from);
    const to = byId.get(arc.to);
    if (!from || !to) continue;
    const points = arcSamples(from, to, 1, 40);
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
    const color = new THREE.Color().setHSL(arc.hue / 360, 0.72, 0.46);
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
    const bright = new THREE.Color().setHSL(arc.hue / 360, 0.9, 0.68);
    const pulseGeometry = new THREE.SphereGeometry(0.018, 8, 8);
    const pulseMaterial = new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(pulseGeometry, pulseMaterial);
    const meshB = new THREE.Mesh(pulseGeometry, pulseMaterial.clone());
    group.add(mesh, meshB);
    pulses.push({ points, mesh, meshB, offset: (hashUsername(from.username) % 1000) / 1000, hue: arc.hue });
  }

  const anchors: { id: string; object: THREE.Object3D; button: HTMLButtonElement }[] = [];
  const world = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const towardCamera = new THREE.Vector3();

  for (const node of nodes) {
    const vector = surfaceVector(node.lat, node.lon, 1);
    const object = new THREE.Object3D();
    object.position.set(vector.x, vector.y, vector.z);
    group.add(object);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.globeNode = node.id;
    button.className = "globe-node pointer-events-auto absolute h-7 w-7 overflow-visible rounded-full border border-white/30 sm:h-8 sm:w-8";
    button.style.marginLeft = "-14px";
    button.style.marginTop = "-14px";
    button.style.boxShadow = `0 0 0 2px ${STATUS_COLOR[node.status] ?? "#94A3B8"}, 0 0 14px ${STATUS_COLOR[node.status] ?? "#94A3B8"}`;
    button.setAttribute("aria-label", `${node.name}, @${node.username}`);
    const face = document.createElement("span");
    face.className = "block h-full w-full overflow-hidden rounded-full bg-slate-800 transition-transform duration-150";
    if (node.pictureUrl) {
      const image = document.createElement("img");
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.className = "h-full w-full object-cover";
      image.src = node.pictureUrl;
      image.addEventListener("error", () => {
        image.remove();
        face.textContent = avatarMark(node.name, node.username);
        face.className = "flex h-full w-full items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-100";
      });
      face.append(image);
    } else {
      face.textContent = avatarMark(node.name, node.username);
      face.className = "flex h-full w-full items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-100";
    }
    const tip = document.createElement("span");
    tip.textContent = `@${node.username}`;
    tip.className = "pointer-events-none absolute left-1/2 top-[-1.35rem] hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#0b1020]/95 px-1.5 py-0.5 text-[10px] text-slate-100";
    button.append(face, tip);
    button.addEventListener("mouseenter", () => {
      tip.classList.remove("hidden");
      face.style.transform = "scale(1.16)";
    });
    button.addEventListener("mouseleave", () => {
      tip.classList.add("hidden");
      face.style.transform = "scale(1)";
    });
    button.addEventListener("focus", () => tip.classList.remove("hidden"));
    button.addEventListener("blur", () => tip.classList.add("hidden"));
    button.addEventListener("click", () => onSelect(node.id));
    markerLayer.append(button);
    anchors.push({ id: node.id, object, button });
  }

  function resize() {
    const width = Math.max(root.clientWidth, 1);
    const height = Math.max(root.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 720 ? 1.5 : 2));
    renderer.setSize(width, height);
  }

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(root);

  function onPointerDown(event: PointerEvent) {
    if (event.target instanceof Element && event.target.closest("[data-globe-node]")) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) dragging = true;
    lastInteraction = performance.now();
  }

  function onPointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const previousPoint = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinchDistance != null && pinchDistance > 0) {
        camera.position.z = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, camera.position.z * (pinchDistance / distance)));
      }
      pinchDistance = distance;
      dragging = false;
      return;
    }
    if (!dragging || !previousPoint) return;
    const dx = event.clientX - previousPoint.x;
    const dy = event.clientY - previousPoint.y;
    velocityY = dx * 0.005;
    velocityX = dy * 0.005;
    group.rotation.y += velocityY;
    group.rotation.x = Math.max(-1.05, Math.min(1.05, group.rotation.x + velocityX));
    lastInteraction = performance.now();
  }

  function onPointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = null;
    if (pointers.size === 0) {
      dragging = false;
      lastInteraction = performance.now();
    }
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.06 : 0.94;
    camera.position.z = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, camera.position.z * factor));
  }

  function onVisibility() {
    hidden = document.visibilityState === "hidden";
    if (!hidden) loop.start(tick);
  }

  function onMotionChange() {
    reducedMotion = reducedQuery.matches;
  }

  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("visibilitychange", onVisibility);
  reducedQuery.addEventListener("change", onMotionChange);

  function tick() {
    const now = performance.now();
    const delta = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    const motion = globeMotion({
      reducedMotion,
      hidden,
      dragging,
      idleMs: now - lastInteraction,
    });
    if (!motion.render) return false;
    velocityX *= 0.92;
    velocityY *= 0.92;
    if (!dragging) {
      group.rotation.y += velocityY;
      group.rotation.x = Math.max(-1.05, Math.min(1.05, group.rotation.x + velocityX));
    }
    if (motion.autoRotate && Math.abs(velocityY) < 0.0004) group.rotation.y += delta * 0.09;
    if (motion.pulses) {
      const elapsed = now / 1000;
      for (const pulse of pulses) {
        const first = sampleArc(pulse.points, pulse.offset + elapsed * 0.08);
        const second = sampleArc(pulse.points, pulse.offset + 0.5 + elapsed * 0.08);
        pulse.mesh.position.set(first.x, first.y, first.z);
        pulse.meshB.position.set(second.x, second.y, second.z);
      }
    }
    group.updateMatrixWorld();
    const width = root.clientWidth;
    const height = root.clientHeight;
    for (const anchor of anchors) {
      anchor.object.getWorldPosition(world);
      normal.copy(anchor.object.position).transformDirection(group.matrixWorld);
      towardCamera.copy(camera.position).sub(world).normalize();
      const facing = normal.dot(towardCamera);
      if (facing < 0.08) {
        anchor.button.style.display = "none";
        continue;
      }
      const projected = world.clone().project(camera);
      anchor.button.style.display = "block";
      anchor.button.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
      anchor.button.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
      anchor.button.style.opacity = String(Math.min(1, facing + 0.25));
    }
    renderer.render(scene, camera);
    return true;
  }

  const loop = createFrameLoop(
    (callback) => window.requestAnimationFrame(callback),
    (id) => window.cancelAnimationFrame(id),
  );
  loop.start(tick);

  return () => {
    loop.stop();
    resizeObserver.disconnect();
    root.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("wheel", onWheel);
    document.removeEventListener("visibilitychange", onVisibility);
    reducedQuery.removeEventListener("change", onMotionChange);
    markerLayer.replaceChildren();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
