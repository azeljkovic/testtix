/**
 * Leaves the app for another site (the payment page). An object rather than a bare function, so a
 * component test can replace it with `vi.spyOn(browserLocation, 'assign')`: jsdom can't navigate.
 */
export const browserLocation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
