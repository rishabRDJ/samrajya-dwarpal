import dataSource from '../data-source.js';

async function main(): Promise<void> {
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });

  await Promise.race([
    dataSource.destroy(),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
