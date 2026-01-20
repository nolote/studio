/**
 * Route notifier helper.
 *
 * This is meant to run inside the PREVIEW iframe (the generated website/app), not in
 * the Studio renderer itself.
 *
 * If you already inject a "design bridge" (like the element inspector), you can
 * import this helper and call `installstudioRouteNotifier()` from that injected code.
 */

export type studioRouteMessage = {
  kind: 'studio:design';
  type: 'route';
  route: string;
};

export function installstudioRouteNotifier(): void {
  const post = () => {
    try {
      const msg: studioRouteMessage = {
        kind: 'studio:design',
        type: 'route',
        route: window.location.pathname + window.location.search + window.location.hash,
      };
      window.parent?.postMessage(msg, '*');
    } catch {
      // ignore
    }
  };

  // Notify immediately.
  post();

  // Hook history API changes.
  const origPushState = window.history.pushState;
  const origReplaceState = window.history.replaceState;

  window.history.pushState = function pushStatePatched(...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    origPushState.apply(this, args as any);
    post();
  } as any;

  window.history.replaceState = function replaceStatePatched(...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    origReplaceState.apply(this, args as any);
    post();
  } as any;

  window.addEventListener('popstate', () => post());
}
