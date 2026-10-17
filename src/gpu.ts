// One WebGPU device for the page, with the largest buffers the adapter allows.

let device: Promise<{ device: GPUDevice; name: string }> | undefined;

export function gpu() {
  device ??= (async () => {
    if (!navigator.gpu) throw new Error("This browser has no WebGPU. Use a recent Chrome, Edge or Safari.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter found.");
    const device = await adapter.requestDevice({ requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    } });
    device.addEventListener("uncapturederror", (e) => console.error("WebGPU:", (e as GPUUncapturedErrorEvent).error.message));
    const i = adapter.info;
    return { device, name: [i.vendor, i.architecture || i.device].filter(Boolean).join(" ") || "WebGPU" };
  })();
  return device;
}
