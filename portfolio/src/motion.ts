/** Does the visitor ask for less motion? Read each time, so a change in the system setting is respected. */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
