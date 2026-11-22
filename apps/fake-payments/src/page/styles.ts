/** The payment page's only stylesheet, served at `/assets/pay.css` (the CSP allows no inline CSS). */
export const PAY_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; background: #f4f5f7; }
body { margin: 0; }
.brand { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; background: #1a1a1a; color: #fff; }
.brand p { margin: 0; font-weight: 600; }
.test-mode { padding: 0 0.5rem; border-radius: 0.25rem; background: #ffd23f; color: #1a1a1a; }
main { max-width: 30rem; margin: 2rem auto; padding: 1.5rem; background: #fff; border-radius: 0.5rem; box-shadow: 0 1px 3px rgb(0 0 0 / 0.15); }
@media (max-width: 32rem) { main { margin: 0; border-radius: 0; } }
h1 { margin-top: 0; font-size: 1.75rem; line-height: 1.2; }
.description { margin-top: -0.5rem; color: #444; }
.field { margin-bottom: 1.25rem; }
.field.has-error { padding-left: 0.75rem; border-left: 4px solid #b3261e; }
.row { display: flex; gap: 1rem; }
.row .field { flex: 1; }
label { display: block; font-weight: 600; }
.hint { margin: 0.125rem 0 0.25rem; color: #4a4a4a; font-size: 0.925rem; }
.error { margin: 0.125rem 0 0.25rem; color: #b3261e; font-weight: 600; }
input { width: 100%; padding: 0.5rem; font: inherit; border: 2px solid #4a4a4a; border-radius: 0.25rem; }
.has-error input { border-color: #b3261e; }
input:focus, button:focus, a:focus, summary:focus, .error-summary:focus { outline: 3px solid #ffbf47; outline-offset: 2px; }
button { width: 100%; padding: 0.75rem; font: inherit; font-weight: 700; color: #fff; background: #1d4ed8; border: 0; border-radius: 0.25rem; cursor: pointer; }
button:hover { background: #1e40af; }
a { color: #1d4ed8; }
.error-summary { margin-bottom: 1.5rem; padding: 1rem; border: 4px solid #b3261e; }
.error-summary h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
.error-summary ul { margin: 0; padding-left: 1.25rem; }
.error-summary a { color: #b3261e; font-weight: 600; }
details { margin-top: 1.5rem; }
summary { cursor: pointer; font-weight: 600; }
table { width: 100%; margin-top: 0.5rem; border-collapse: collapse; font-size: 0.925rem; }
caption { text-align: left; }
th, td { padding: 0.375rem 0.5rem 0.375rem 0; text-align: left; vertical-align: top; border-bottom: 1px solid #ccc; }
td:first-child { white-space: nowrap; font-family: ui-monospace, monospace; }
.visually-hidden { position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`.trimStart();
