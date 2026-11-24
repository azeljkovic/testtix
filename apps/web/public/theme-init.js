// Applies the stored colour theme before the first paint, so a page doesn't flash light before
// switching to dark (or the other way round). A classic script in <head>, not part of the bundle:
// module scripts run after parsing. Keep it in step with src/theme/theme.ts (storage key, values).
try {
  const theme = localStorage.getItem('testtix-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage blocked: follow the device setting.
}
