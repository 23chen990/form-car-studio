import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
});
await server.listen();

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
