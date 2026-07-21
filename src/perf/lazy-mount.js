<<<<<<< Updated upstream
=======
/* built by nirholas x.com/nichxbt */
>>>>>>> Stashed changes
/**
 * robinhood-toolkit · viewport-gated chart mounting
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * Build a chart when its container nears the viewport; tear it down when it is
 * far away. Data keeps flowing into the store either way, so a remounted tile
 * repaints instantly with current data.
 *
 * @param {{ mount:(el:HTMLElement)=>object, unmount:(inst:object)=>void, rootMargin?:string }} opts
 */
export function createLazyMounter({ mount, unmount, rootMargin = '200px' }) {
  const instances = new Map();

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target;
      if (entry.isIntersecting && !instances.has(el)) {
        instances.set(el, mount(el));
      } else if (!entry.isIntersecting && instances.has(el)) {
        unmount(instances.get(el));
        instances.delete(el);
      }
    }
  }, { rootMargin });

  return {
    observe(el) { observer.observe(el); },
    unobserve(el) {
      observer.unobserve(el);
      const inst = instances.get(el);
      if (inst) { unmount(inst); instances.delete(el); }
    },
    get mounted() { return instances.size; },
    destroy() {
      observer.disconnect();
      for (const inst of instances.values()) unmount(inst);
      instances.clear();
    },
  };
}
<<<<<<< Updated upstream
=======
/* built by nirholas x.com/nichxbt */
>>>>>>> Stashed changes
