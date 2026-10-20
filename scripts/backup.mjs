import { loadEnvFile,getDatabasePath } from '../src/config.mjs';
import { createBackup,verifyBackup,restoreBackup } from '../src/backup-service.mjs';

loadEnvFile();
const [operation,first,second,...extra]=process.argv.slice(2);
try {
  if(extra.length||!first||!['create','verify','restore'].includes(operation)||((operation==='restore')!==Boolean(second)))throw new Error('Usage: node scripts/backup.mjs create NEW_DIRECTORY | verify DIRECTORY | restore DIRECTORY NEW_DB_PATH');
  const result=operation==='create'?await createBackup(getDatabasePath(),first):operation==='verify'?await verifyBackup(first):await restoreBackup(first,second);
  console.log(JSON.stringify(operation==='verify'?{directory:result.directory,status:'verified',sha256:result.manifest.sha256,datasetMode:result.manifest.datasetMode,tables:result.manifest.tables}:result,null,2));
  if(operation==='restore')console.log('All restored accounts and sources are disabled, active jobs cancelled, sessions cleared. Create a new local ADMIN before startup, then review access and sources.');
}catch(reason){console.error('Backup operation failed:',reason.message);process.exitCode=1;}
