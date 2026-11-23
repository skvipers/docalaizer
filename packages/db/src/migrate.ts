import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_FOLDER = path.resolve(__dirname, '../drizzle');

export async function runMigrations(
  connectionString: string,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://docalaizer:docalaizer_dev@localhost:5439/docalaizer';
  runMigrations(databaseUrl)
    .then(() => {
      console.log('Database migrations applied successfully.');
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
