// Select only engines whose native importer validates the selected program.
// A rejected ROM or unavailable WebGPU returns to the general hardware core.
export function executionEngine(game, renderer, preference = 'auto') {
  if (!['auto', 'general'].includes(preference)) throw Error('Unknown emulation engine');
  return preference === 'auto' && renderer === 'webgpu' && game === 'daytona'
    ? 'daytona-compiled' : 'general';
}
