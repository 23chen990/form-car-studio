import { createRoot } from 'react-dom/client';

// Dev/test-only boundary. Product entry points never import this module.
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: '48rem', margin: '3rem auto', padding: '1rem' }}>
    <p>DEV HARNESS · SYNTHETIC ONLY</p>
    <h1>FORM V2 component harness</h1>
    <p>Photo intake is unavailable in this checkout. No upload or model service is connected.</p>
  </main>,
);
