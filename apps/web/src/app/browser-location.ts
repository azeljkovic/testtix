/**
 * Full page loads: leaving the app for another site (the payment page) or reloading it (the error
 * page). An object rather than bare functions, so a component test can replace them with
 * `vi.spyOn(browserLocation, 'assign')`: jsdom can't navigate.
 */
export const browserLocation = {
  assign(url: string): void {
    window.location.assign(url);
  },
  reload(): void {
    window.location.reload();
  },
};
