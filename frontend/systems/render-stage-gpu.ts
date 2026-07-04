import type { Registry } from '../core';
import { clientPoint } from '../core';
import { buildScene, hitTestNode, type GpuScene, EDGE_FLOATS, NODE_FLOATS } from '../core/gpu-scene';
import { Places } from '../types';

declare module '../types' {
  interface CustomEvents {
    /** Swap the stage painter DOM ⟷ WebGPU. Command + palette entry live here. */
    'render.gpu.toggle': void;
    /** Fact: the GPU painter turned on/off (or refused — `active:false` + reason). */
    'render.gpu.changed': { active: boolean; reason?: string };
  }
  interface CustomExposable {
    /** Devtool/test surface: render one frame and read its pixels back —
     *  `await app.gpuStage.probe()` returns the count of non-transparent
     *  pixels (0 = blank frame ⇒ something is broken upstream of present). */
    gpuStage?: { probe(): Promise<{ nonZero: number; sampled: number }> };
  }
}

/** render.stage.gpu — alternative stage painter for LARGE graphs (10k+ nodes).
 *  Same contract as render.stage: listens `render.stage.draw` / `.camera`,
 *  mounts its output through `render.view.set`. Geometry only — node cards,
 *  type-colored borders, selection/focus rings, kind-colored edges with
 *  arrowheads. No text: this is the zoomed-out navigation mode; toggling back
 *  to the DOM painter restores full cards. Registered but DORMANT until the
 *  `render.gpu.toggle` command — activation stops the `render.stage` flag via
 *  `flag.toggle` (the runtime feature manager hot-swaps the system) so exactly
 *  one painter owns the stage at a time. No `navigator.gpu` → notice + no-op,
 *  so jsdom/CI and non-WebGPU browsers boot unchanged. */

const SHADER = /* wgsl */ `
struct Camera {
  offset: vec2f,   // graph-space coord at the stage's top-left
  scale: f32,
  dpr: f32,
  viewport: vec2f, // css px
  _pad: vec2f,
};
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> inst: array<f32>;

fn toClip(world: vec2f) -> vec4f {
  let screen = (world - cam.offset) * cam.scale;
  let ndc = screen / cam.viewport * 2.0 - vec2f(1.0, 1.0);
  return vec4f(ndc.x, -ndc.y, 0.0, 1.0);
}

const QUAD = array<vec2f, 6>(
  vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
  vec2f(-0.5, -0.5), vec2f(0.5, 0.5), vec2f(-0.5, 0.5),
);

// Node-type accent palette (matches the CSS accents loosely).
const NODE_COLORS = array<vec3f, 12>(
  vec3f(0.55, 0.58, 0.62), // text
  vec3f(0.42, 0.48, 0.55), // square
  vec3f(0.46, 0.52, 0.60), // circle
  vec3f(0.35, 0.55, 0.80), // user-input
  vec3f(0.55, 0.45, 0.78), // gateway
  vec3f(0.25, 0.60, 0.45), // service
  vec3f(0.80, 0.55, 0.25), // database
  vec3f(0.72, 0.35, 0.35), // kafka
  vec3f(0.30, 0.62, 0.65), // index
  vec3f(0.85, 0.68, 0.25), // cache
  vec3f(0.75, 0.42, 0.55), // rate-limit
  vec3f(0.62, 0.32, 0.28), // circuit-breaker
);
const EDGE_COLORS = array<vec3f, 4>(
  vec3f(0.55, 0.58, 0.62), // sync
  vec3f(0.55, 0.45, 0.78), // async
  vec3f(0.25, 0.60, 0.45), // read
  vec3f(0.80, 0.55, 0.25), // write
);
const ACCENT = vec3f(0.15, 0.45, 0.95);

struct NodeOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,   // px from node center
  @location(1) halfPx: vec2f,  // node half-size in screen px
  @location(2) color: vec3f,
  @location(3) flags: f32,
};

@vertex fn nodeVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> NodeOut {
  let base = ii * 8u;
  let center = vec2f(inst[base], inst[base + 1u]);
  let size = vec2f(inst[base + 2u], inst[base + 3u]);
  let corner = QUAD[vi];
  var out: NodeOut;
  out.pos = toClip(center + corner * size);
  out.halfPx = size * 0.5 * cam.scale;
  out.local = corner * size * cam.scale;
  out.color = NODE_COLORS[u32(inst[base + 4u])];
  out.flags = inst[base + 5u];
  return out;
}

fn sdRoundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r, r);
  return length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment fn nodeFrag(in: NodeOut) -> @location(0) vec4f {
  let radius = min(10.0 * cam.scale, min(in.halfPx.x, in.halfPx.y));
  let d = sdRoundBox(in.local, in.halfPx, radius);
  let aa = 1.0;
  let inside = 1.0 - smoothstep(-aa, aa, d);
  if (inside <= 0.0) { discard; }
  let selected = (u32(in.flags) & 1u) != 0u;
  let focused = (u32(in.flags) & 2u) != 0u;
  var borderW = max(1.5, 1.5 * cam.scale);
  if (selected || focused) { borderW = max(3.0, 3.0 * cam.scale); }
  let borderMix = 1.0 - smoothstep(-borderW - aa, -borderW + aa, d);
  var borderColor = in.color;
  if (selected || focused) { borderColor = ACCENT; }
  let fill = vec3f(0.985, 0.985, 0.99);
  let color = mix(fill, borderColor, borderMix);
  return vec4f(color * inside, inside);
}

struct EdgeOut {
  @builtin(position) pos: vec4f,
  @location(0) across: f32,   // -1..1 across the line width
  @location(1) color: vec3f,
};

fn edgeColor(base: u32) -> vec3f {
  var c = EDGE_COLORS[u32(inst[base + 4u])];
  if ((u32(inst[base + 5u]) & 1u) != 0u) { c = ACCENT; }
  return c;
}

// Two triangles along the segment: (a,-1)(b,-1)(b,+1) and (a,-1)(b,+1)(a,+1).
const SEG_T = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
const SEG_S = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);

@vertex fn edgeVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EdgeOut {
  let base = ii * 8u;
  let a = vec2f(inst[base], inst[base + 1u]);
  let b = vec2f(inst[base + 2u], inst[base + 3u]);
  let dir = normalize(b - a + vec2f(1e-6, 0.0));
  let normal = vec2f(-dir.y, dir.x);
  let halfW = max(0.75, 0.75 * cam.scale) / cam.scale; // world units, ≥0.75px on screen
  let t = SEG_T[vi];
  let s = SEG_S[vi];
  var out: EdgeOut;
  out.pos = toClip(mix(a, b, t) + normal * halfW * s);
  out.across = s;
  out.color = edgeColor(base);
  return out;
}

@fragment fn edgeFrag(in: EdgeOut) -> @location(0) vec4f {
  let alpha = (1.0 - smoothstep(0.55, 1.0, abs(in.across))) * 0.9;
  return vec4f(in.color * alpha, alpha);
}

struct ArrowOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
};

@vertex fn arrowVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ArrowOut {
  let base = ii * 8u;
  let a = vec2f(inst[base], inst[base + 1u]);
  let tip = vec2f(inst[base + 2u], inst[base + 3u]);
  let dir = normalize(tip - a + vec2f(1e-6, 0.0));
  let normal = vec2f(-dir.y, dir.x);
  let len = max(9.0, 9.0 * cam.scale) / cam.scale;   // world units, ≥9px
  var p = tip;
  if (vi == 1u) { p = tip - dir * len + normal * len * 0.45; }
  if (vi == 2u) { p = tip - dir * len - normal * len * 0.45; }
  var out: ArrowOut;
  out.pos = toClip(p);
  out.color = edgeColor(base);
  return out;
}

@fragment fn arrowFrag(in: ArrowOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;

export function registerRenderStageGpu(system: Registry) {
  system('render.stage.gpu', ctx => {
    const { on, emit, graphs, contexts, selection, frameLoop } = ctx;

    let active = false;
    let device: GPUDevice | null = null;
    let gpuContext: GPUCanvasContext | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let format: GPUTextureFormat = 'bgra8unorm';
    let nodePipeline: GPURenderPipeline | null = null;
    let edgePipeline: GPURenderPipeline | null = null;
    let arrowPipeline: GPURenderPipeline | null = null;
    let pipelineLayout: GPUPipelineLayout | null = null;
    let bindGroupLayout: GPUBindGroupLayout | null = null;
    let probeNext: ((result: { nonZero: number; sampled: number }) => void) | null = null;
    let cameraBuffer: GPUBuffer | null = null;
    let nodeBuffer: GPUBuffer | null = null;
    let edgeBuffer: GPUBuffer | null = null;
    let nodeBindGroup: GPUBindGroup | null = null;
    let edgeBindGroup: GPUBindGroup | null = null;
    let scene: GpuScene | undefined;
    let sceneDirty = true;
    let resizeObserver: ResizeObserver | null = null;

    contexts.commands.register([
      { id: 'render.gpu.toggle', label: 'Toggle GPU stage painter (geometry-only, for huge graphs)', group: 'view' },
    ]);

    const selectedIds = () => new Set(selection.selectedAll().map(ref => ref.id));
    const focusedNodeId = () => {
      const ref = selection.focused();
      return ref?.kind === 'node' ? ref.id : null;
    };

    const ensureInstanceBuffer = (
      current: GPUBuffer | null,
      data: Float32Array,
      label: string,
    ): GPUBuffer => {
      const bytes = data.byteLength;
      if (current && current.size >= bytes) return current;
      current?.destroy();
      return device!.createBuffer({ label, size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    };

    const rebuildBindGroups = () => {
      nodeBindGroup = device!.createBindGroup({ layout: bindGroupLayout!, entries: [
        { binding: 0, resource: { buffer: cameraBuffer! } },
        { binding: 1, resource: { buffer: nodeBuffer! } },
      ] });
      edgeBindGroup = device!.createBindGroup({ layout: bindGroupLayout!, entries: [
        { binding: 0, resource: { buffer: cameraBuffer! } },
        { binding: 1, resource: { buffer: edgeBuffer! } },
      ] });
    };

    const uploadScene = () => {
      scene = buildScene(graphs.current, selectedIds(), focusedNodeId(), scene);
      const prevNode = nodeBuffer, prevEdge = edgeBuffer;
      nodeBuffer = ensureInstanceBuffer(nodeBuffer, scene.nodeData, 'gpu-stage.nodes');
      edgeBuffer = ensureInstanceBuffer(edgeBuffer, scene.edgeData, 'gpu-stage.edges');
      if (nodeBuffer !== prevNode || edgeBuffer !== prevEdge || !nodeBindGroup) rebuildBindGroups();
      device!.queue.writeBuffer(nodeBuffer, 0, scene.nodeData, 0, scene.nodeCount * NODE_FLOATS);
      device!.queue.writeBuffer(edgeBuffer, 0, scene.edgeData, 0, scene.edgeCount * EDGE_FLOATS);
      sceneDirty = false;
    };

    const writeCamera = () => {
      const view = contexts.view.get();
      const dpr = globalThis.devicePixelRatio || 1;
      const w = canvas!.clientWidth || canvas!.width / dpr;
      const h = canvas!.clientHeight || canvas!.height / dpr;
      device!.queue.writeBuffer(cameraBuffer!, 0, new Float32Array([view.x, view.y, view.scale, dpr, w, h, 0, 0]));
    };

    const renderFrame = () => {
      if (!active || !device || !gpuContext || !canvas) return;
      ctx.perf.measure('Render.gpu.frame', () => {
        if (sceneDirty) uploadScene();
        writeCamera();
        const texture = gpuContext!.getCurrentTexture();
        const encoder = device!.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.setPipeline(edgePipeline!);
        pass.setBindGroup(0, edgeBindGroup!);
        pass.draw(6, scene!.edgeCount);
        pass.setPipeline(arrowPipeline!);
        pass.setBindGroup(0, edgeBindGroup!);
        pass.draw(3, scene!.edgeCount);
        pass.setPipeline(nodePipeline!);
        pass.setBindGroup(0, nodeBindGroup!);
        pass.draw(6, scene!.nodeCount);
        pass.end();
        // probe(): copy a center band of the frame out before presenting, so a
        // verifier can count painted pixels even when the compositor is frozen.
        let probeBuffer: GPUBuffer | null = null;
        let probeRows = 0, probeBpr = 0;
        if (probeNext) {
          probeRows = Math.min(64, texture.height);
          probeBpr = Math.ceil((texture.width * 4) / 256) * 256;
          probeBuffer = device!.createBuffer({ label: 'gpu-stage.probe', size: probeBpr * probeRows, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          encoder.copyTextureToBuffer(
            { texture, origin: { x: 0, y: Math.max(0, Math.floor(texture.height / 2 - probeRows / 2)) } },
            { buffer: probeBuffer, bytesPerRow: probeBpr },
            { width: texture.width, height: probeRows },
          );
        }
        device!.queue.submit([encoder.finish()]);
        if (probeBuffer && probeNext) {
          const resolve = probeNext;
          probeNext = null;
          const buffer = probeBuffer;
          void buffer.mapAsync(GPUMapMode.READ).then(() => {
            const bytes = new Uint8Array(buffer.getMappedRange());
            let nonZero = 0, sampled = 0;
            for (let i = 3; i < bytes.length; i += 16) { sampled++; if (bytes[i] > 0) nonZero++; }
            buffer.unmap();
            buffer.destroy();
            resolve({ nonZero, sampled });
          });
        }
        ctx.perf.count('Render.gpu.frames');
        ctx.perf.sample('Render.gpu.nodes', scene!.nodeCount);
      });
    };
    const scheduleFrame = () => frameLoop.schedule('render.gpu', renderFrame, 30);

    const sizeCanvas = () => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage || !canvas) return;
      const rect = stage.getBoundingClientRect();
      const dpr = globalThis.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      scheduleFrame();
    };

    const makePipeline = (module: GPUShaderModule, vertex: string, fragment: string, label: string) =>
      device!.createRenderPipeline({
        label,
        layout: pipelineLayout!,
        vertex: { module, entryPoint: vertex },
        fragment: { module, entryPoint: fragment, targets: [{
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }] },
        primitive: { topology: 'triangle-list' },
      });

    const bailToDom = (reason: string) => {
      emit('app.notice', { message: 'WebGPU not available — staying on the DOM painter.', level: 'warn' });
      emit('render.gpu.changed', { active: false, reason });
      // Make sure SOMETHING paints the stage (matters on the boot-resume path,
      // where the persisted render.stage flag may still be off).
      if (!ctx.flags.isOn('render.stage')) emit('flag.toggle', { name: 'render.stage', on: true });
    };
    const activate = async () => {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      if (!gpu) { bailToDom('no-webgpu'); return; }
      const adapter = await gpu.requestAdapter();
      if (!adapter) { bailToDom('no-adapter'); return; }
      device = await adapter.requestDevice();
      device.onuncapturederror = event => console.error('[gpu-stage] uncaptured:', (event as GPUUncapturedErrorEvent).error?.message);
      format = gpu.getPreferredCanvasFormat();
      canvas = document.createElement('canvas');
      // `nodes` class ⇒ isStageSurface() accepts it: pan / zoom / marquee /
      // background-cancel keep working over the GPU canvas.
      canvas.className = 'nodes gpu-canvas';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      gpuContext = canvas.getContext('webgpu') as GPUCanvasContext;
      // COPY_SRC so probe() can read the frame back (devtool/verify path).
      gpuContext.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const module = device.createShaderModule({ label: 'gpu-stage', code: SHADER });
      // ONE explicit layout for all three pipelines — `layout:'auto'` layouts
      // are pipeline-private, so sharing bind groups across pipelines (edge +
      // arrow read the same instance buffer) needs this spelled out.
      const bindLayout = device.createBindGroupLayout({ label: 'gpu-stage.bind', entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ] });
      pipelineLayout = device.createPipelineLayout({ label: 'gpu-stage.layout', bindGroupLayouts: [bindLayout] });
      bindGroupLayout = bindLayout;
      nodePipeline = makePipeline(module, 'nodeVert', 'nodeFrag', 'gpu-stage.node');
      edgePipeline = makePipeline(module, 'edgeVert', 'edgeFrag', 'gpu-stage.edge');
      arrowPipeline = makePipeline(module, 'arrowVert', 'arrowFrag', 'gpu-stage.arrow');
      cameraBuffer = device.createBuffer({ label: 'gpu-stage.camera', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      // Click-select: hit-test through the spatial grid (no DOM items to click).
      canvas.addEventListener('click', event => {
        const point = contexts.view.clientToSpace(Places.Stage, clientPoint(event));
        const id = hitTestNode(graphs.current, point);
        if (id) emit('selection.node.select', { id });
      });

      ctx.expose('gpuStage', {
        probe: () => new Promise<{ nonZero: number; sampled: number }>(resolve => {
          if (!active) { resolve({ nonZero: -1, sampled: 0 }); return; }
          probeNext = resolve;
          renderFrame();
        }),
      });
      active = true;
      sceneDirty = true;
      // One painter at a time: hot-stop the DOM stage system, take over its slot.
      emit('flag.toggle', { name: 'render.stage', on: false });
      emit('render.view.clear', { place: Places.Stage, key: 'nodes' });
      emit('render.view.set', { place: Places.Stage, key: 'nodes', view: canvas });
      sizeCanvas();
      resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sizeCanvas);
      const stage = contexts.places.el(Places.Stage);
      if (stage && resizeObserver) resizeObserver.observe(stage);
      emit('render.gpu.changed', { active: true });
      emit('app.notice', { message: 'GPU stage painter on — geometry mode, toggle again for full cards.' });
      scheduleFrame();
    };

    const deactivate = () => {
      active = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      frameLoop.cancel('render.gpu');
      emit('render.view.clear', { place: Places.Stage, key: 'nodes' });
      canvas?.remove();
      nodeBuffer?.destroy(); nodeBuffer = null;
      edgeBuffer?.destroy(); edgeBuffer = null;
      cameraBuffer?.destroy(); cameraBuffer = null;
      device?.destroy(); device = null;
      gpuContext = null; canvas = null; nodeBindGroup = null; edgeBindGroup = null;
      scene = undefined;
      // Hand the stage back to the DOM painter and let it rebuild.
      emit('flag.toggle', { name: 'render.stage', on: true });
      emit('render.gpu.changed', { active: false });
    };

    on('render.gpu.toggle', () => { if (active) deactivate(); else void activate(); });
    // Activation persists `render.stage: false` through the flag store. On the
    // next boot that means NO painter owns the stage — resume GPU mode (or bail
    // back to DOM when WebGPU is gone, e.g. the link got opened in Safari).
    on('app.start', () => { if (!ctx.flags.isOn('render.stage') && !active) void activate(); });
    on('render.stage.draw', () => {
      if (!active) return;
      sceneDirty = true;
      scheduleFrame();
    });
    on('render.stage.camera', () => { if (active) scheduleFrame(); });

    return () => { if (active) deactivate(); };
  }, { requires: ['render'] });
}
