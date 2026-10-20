import { openDatabase,inTransaction } from "../src/db.mjs";
import { createUser,accessEnabled,withUser } from "../src/access-service.mjs";
import { writeAudit } from "../src/audit-service.mjs";
import { loadEnvFile } from "../src/config.mjs";

loadEnvFile();
const [username, role] = process.argv.slice(2);
if (!username || !role || !process.env.SAQ_USER_PASSWORD) {
  console.error("Usage: set SAQ_USER_PASSWORD, then node scripts/create-user.mjs USERNAME MIO|GASK|LAW_ENFORCEMENT|ADMIN");
  process.exit(1);
}
const db = openDatabase();
try {
  if(!accessEnabled(db) && role!=="ADMIN")throw new Error("First create an ADMIN account.");
  const user=withUser({username:"Local setup"},()=>inTransaction(db,()=>{
    const created=createUser(db,{username,role,password:process.env.SAQ_USER_PASSWORD});
    writeAudit(db,"USER",created.id,"USER_CREATED",{username:created.username,role:created.role,setup:"LOCAL_CLI"});
    return created;
  }));
  console.log("Account created:",user);
}
catch(error) {console.error(error.message);process.exitCode=1;}
finally { db.close(); }
