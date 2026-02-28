import { startImportJobWorker } from './lib/import-worker.js';

console.info('[worker] starting import worker loop');
startImportJobWorker();

process.on('SIGTERM', () => {
  console.info('[worker] shutting down');
  process.exit(0);
});
