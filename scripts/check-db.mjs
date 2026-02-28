import { prisma } from '../packages/db/dist/client.js';

async function main() {
  const requiredTables = ['RepoImportJob', 'UploadToken', 'Workspace'];
  const rows = await Promise.all(
    requiredTables.map(async (table) => {
      const [result] = await prisma.$queryRawUnsafe(
        `SELECT to_regclass('"public"."${table}"')::text AS value`,
      );
      return {
        table,
        exists: Boolean(result?.value),
        value: result?.value ?? null,
      };
    }),
  );

  console.log('Database table checks:');
  for (const row of rows) {
    console.log(`- ${row.table}: ${row.exists ? 'present' : 'missing'} (${row.value})`);
  }

  const missing = rows.filter((row) => !row.exists).map((row) => row.table);
  if (missing.length) {
    console.error(
      `Missing required tables: ${missing.join(', ')}. Apply non-destructive migrations before starting the API.`,
    );
    process.exitCode = 1;
    return;
  }

  const deprecatedTables = ['Workspace', 'WorkspaceMember'];
  const deprecatedRows = await Promise.all(
    deprecatedTables.map(async (table) => {
      const [result] = await prisma.$queryRawUnsafe(
        `SELECT to_regclass('"public"."${table}"')::text AS value`,
      );
      return {
        table,
        exists: Boolean(result?.value),
      };
    }),
  );

  const stillPresent = deprecatedRows.filter((row) => row.exists).map((row) => row.table);
  if (stillPresent.length) {
    console.warn(
      `Deprecated tables still present: ${stillPresent.join(', ')}. Workspace rename migration may be incomplete.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    if (error instanceof Error) {
      console.error(`Database check failed: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
