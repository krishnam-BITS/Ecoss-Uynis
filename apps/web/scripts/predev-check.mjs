import net from 'node:net';

const major = Number(process.versions.node.split('.')[0]);
if (major >= 24) {
  console.warn(
    'Warning: Node 24 detected. Node 22 is recommended for apps/web dev because Next.js 14 can be unstable on Windows with Node 24.',
  );
}

const port = 3000;
const probe = net.createServer();

probe.once('error', (error) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. Stop the running web dev server before starting another instance.`,
    );
    process.exit(1);
  }
  console.error('Unable to validate dev port availability.', error);
  process.exit(1);
});

probe.once('listening', () => {
  probe.close(() => {
    process.exit(0);
  });
});

probe.listen(port);

