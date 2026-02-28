const major = Number(process.versions.node.split('.')[0]);

if (major >= 24) {
  console.warn(
    'Warning: Node 24 detected. Node 22 is recommended for local API runtime consistency.',
  );
}