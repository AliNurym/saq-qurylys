import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { inTransaction } from "./db.mjs";
import { writeAudit } from "./audit-service.mjs";

const context = new AsyncLocalStorage();
export const withUser = (user, action) => context.run(user, action);
export const currentActor = () => context.getStore()?.username ?? "Demo Analyst";
export const currentUser = () => context.getStore();
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const derivePassword = promisify(scrypt);
const ROLES = ["MIO", "GASK", "LAW_ENFORCEMENT", "ADMIN"];
const publicUser = row => ({ id:row.id, username:row.username, role:row.role, enabled:!row.disabled_at,
  mustChangePassword:Boolean(row.must_change_password), createdAt:row.created_at, updatedAt:row.updated_at });
const nextVersion = row => new Date(Math.max(Date.now(),Date.parse(row.updated_at || row.created_at)+1)).toISOString();
const validatePassword = value => {
  if(typeof value!=="string" || value.length<12 || value.length>200)fail(400,"Пароль должен содержать от 12 до 200 символов.");
};
const requireReason = input => {
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<5 || reason.length>1000)fail(400,'Укажите причину изменения доступа (5–1000 символов).');
  return reason;
};
function userForUpdate(db,id,input) {
  const row=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if(!row)fail(404,'Учётная запись не найдена.');
  if(input.expectedUpdatedAt!==row.updated_at)fail(409,'Учётная запись уже изменена. Обновите список сотрудников.');
  return row;
}
function assertActorCurrent(db,actor) {
  if(!actor?.id)return;
  const row=db.prepare('SELECT * FROM users WHERE id=?').get(actor.id);
  if(!row || row.disabled_at || row.updated_at!==actor.updatedAt || row.role!==actor.role || row.username!==actor.username || Boolean(row.must_change_password)!==Boolean(actor.mustChangePassword))fail(401,'Доступ изменён. Войдите в систему повторно.');
  if(actor.sessionTokenHash && !db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(actor.sessionTokenHash,actor.id,new Date().toISOString()))fail(401,'Сеанс завершён. Войдите в систему повторно.');
}
export function validateTransactionActor(db) {assertActorCurrent(db,currentUser());}

export function initializeAccess(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('MIO','GASK','LAW_ENFORCEMENT','ADMIN')),
    salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);`);
  const columns=new Set(db.prepare('PRAGMA table_info(users)').all().map(row=>row.name));
  for(const [name,type] of [['disabled_at','TEXT'],['updated_at','TEXT'],['password_changed_at','TEXT'],['must_change_password','INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))']]) {
    if(!columns.has(name))db.exec('ALTER TABLE users ADD COLUMN '+name+' '+type);
  }
  db.prepare('UPDATE users SET updated_at=created_at WHERE updated_at IS NULL').run();
  db.exec(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_attempts_expiry ON auth_attempts(expires_at);`);
}
export const accessEnabled = (db) => Boolean(db.prepare("SELECT 1 FROM users LIMIT 1").get());
export function readScope(db) {
  const user=currentUser();
  if (!accessEnabled(db) || !user || ["MIO","ADMIN"].includes(user.role)) return null;
  return new Set(db.prepare("SELECT complex_id,routing_json FROM signals WHERE status IN ('CONFIRMED','ARCHIVED')").all()
    .filter(row=>JSON.parse(row.routing_json || "{}").recipient===user.role).map(row=>row.complex_id));
}
export function signalVisible(row) {
  const user=currentUser();
  return !user || ["MIO","ADMIN"].includes(user.role) || (["CONFIRMED","ARCHIVED"].includes(row.status)
    && JSON.parse(row.routing_json || "{}").recipient===user.role);
}

export function createUser(db, { username, role, password, mustChangePassword=false }) {
  if (typeof username!=="string" || !/^[\p{L}\p{N}_.-]{3,80}$/u.test(username)) fail(400, "Имя пользователя: 3–80 букв, цифр или символов _.-");
  if (!ROLES.includes(role)) fail(400, "Недопустимая роль.");
  validatePassword(password);
  if(typeof mustChangePassword!=='boolean')fail(400,'Укажите mustChangePassword: true или false.');
  if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username)) fail(409,"Имя пользователя уже занято.");
  const id = randomBytes(16).toString("hex"), salt = randomBytes(16).toString("hex");
  const now=new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,role,salt,password_hash,created_at,updated_at,must_change_password) VALUES (?,?,?,?,?,?,?,?)").run(id, username, role, salt, scryptSync(password,salt,64).toString("hex"),now,now,Number(mustChangePassword));
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}

export function listUsers(db) {return db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);}

export function updateUserAccess(db,id,input={}) {
  const reason=requireReason(input);
  return inTransaction(db,()=>{
    const row=userForUpdate(db,id,input),role=Object.hasOwn(input,'role')?input.role:row.role;
    if(!ROLES.includes(role))fail(400,'Недопустимая роль.');
    if(input.enabled!==undefined && typeof input.enabled!=='boolean')fail(400,'Укажите enabled: true или false.');
    const enabled=input.enabled??!row.disabled_at;
    if(row.role==='ADMIN' && !row.disabled_at && (role!=='ADMIN'||!enabled)
      && !db.prepare("SELECT 1 FROM users WHERE role='ADMIN' AND disabled_at IS NULL AND id<>? LIMIT 1").get(id))fail(409,'Последний действующий администратор должен сохранить доступ.');
    if(role===row.role && enabled===!row.disabled_at)return publicUser(row);
    const now=nextVersion(row);
    db.prepare('UPDATE users SET role=?,disabled_at=?,updated_at=? WHERE id=?').run(role,enabled?null:now,now,id);
    const revoked=db.prepare('DELETE FROM sessions WHERE user_id=?').run(id).changes;
    writeAudit(db,'USER',id,'USER_ACCESS_UPDATED',{username:row.username,fromRole:row.role,role,enabled,reason,revokedSessions:revoked});
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  });
}

export function revokeUserSessions(db,id,input={}) {
  const reason=requireReason(input);
  return inTransaction(db,()=>{
    const row=userForUpdate(db,id,input),now=nextVersion(row);
    const revoked=db.prepare('DELETE FROM sessions WHERE user_id=?').run(id).changes;
    db.prepare('UPDATE users SET updated_at=? WHERE id=?').run(now,id);
    writeAudit(db,'USER',id,'USER_SESSIONS_REVOKED',{username:row.username,reason,revokedSessions:revoked});
    return {user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)),revokedSessions:revoked};
  });
}

export async function resetUserPassword(db,id,input={}) {
  const actor=currentUser();
  const reason=requireReason(input);validatePassword(input.newPassword);
  const before=userForUpdate(db,id,input),salt=randomBytes(16).toString('hex');
  const [oldDigest,digest]=await Promise.all([derivePassword(input.newPassword,before.salt,64),derivePassword(input.newPassword,salt,64)]);
  if(timingSafeEqual(Buffer.from(before.password_hash,'hex'),oldDigest))fail(400,'Новый пароль должен отличаться от прежнего.');
  return inTransaction(db,()=>{
    assertActorCurrent(db,actor);
    const row=userForUpdate(db,id,input),now=nextVersion(row);
    db.prepare('UPDATE users SET salt=?,password_hash=?,password_changed_at=?,must_change_password=1,updated_at=? WHERE id=?').run(salt,digest.toString('hex'),now,now,id);
    const revoked=db.prepare('DELETE FROM sessions WHERE user_id=?').run(id).changes;
    writeAudit(db,'USER',id,'USER_PASSWORD_RESET',{username:row.username,reason,revokedSessions:revoked});
    return {user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)),revokedSessions:revoked};
  });
}

export function getSessionUser(db, request) {
  const token = (request.headers.cookie ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith("saq_session="))?.slice(12);
  if (!token || !/^[a-f0-9]{64}$/u.test(token)) return null;
  const row=db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL").get(hashToken(token),new Date().toISOString());
  if(!row)return null;
  const user=publicUser(row);
  Object.defineProperty(user,'sessionTokenHash',{value:hashToken(token),enumerable:false});
  return user;
}

function consumeAuthBudget(db,scope,username,address,now) {
  const buckets=[{key:hashToken(scope+'\0'+address+'\0'+username),limit:10},{key:hashToken(scope+'-address\0'+address),limit:100}];
  inTransaction(db,()=>{
    db.prepare('DELETE FROM auth_attempts WHERE expires_at<=?').run(now);
    for(const bucket of buckets) {
      const row=db.prepare('SELECT * FROM auth_attempts WHERE bucket=?').get(bucket.key);
      if(row && row.attempts>=bucket.limit)throw Object.assign(new Error('Слишком много попыток. Повторите позже.'),{statusCode:429,retryAfter:Math.max(1,Math.ceil((row.expires_at-now)/1000))});
    }
    for(const bucket of buckets)db.prepare('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1').run(bucket.key,now+600000);
  });
  return buckets[0].key;
}

export async function login(db, input, address, now=Date.now()) {
  // New credentials establish their own identity; an old cookie must not authorize this flow.
  return withUser(null,()=>loginWithCredentials(db,input,address,now));
}
async function loginWithCredentials(db,input,address,now) {
  const username=String(input.username??'').slice(0,80),bucket=consumeAuthBudget(db,'login',username,String(address),now);
  const row=typeof input.username==='string' && input.username===username ? db.prepare('SELECT * FROM users WHERE username=?').get(username) : null;
  const password=typeof input.password==='string'&&input.password.length<=200?input.password:'';
  const digest=await derivePassword(password,row?.salt??'saq-unknown-user',64);
  let result=null;
  if(row && !row.disabled_at && timingSafeEqual(Buffer.from(row.password_hash,'hex'),digest)) {
    result=inTransaction(db,()=>{
      const current=db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
      if(!current || current.disabled_at || current.updated_at!==row.updated_at || current.password_hash!==row.password_hash)return null;
      const token=randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date(now).toISOString());
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token),row.id,new Date(now+8*3600000).toISOString());
      db.prepare('DELETE FROM auth_attempts WHERE bucket=?').run(bucket);
      writeAudit(db,'USER',row.id,'AUTH_LOGIN_SUCCEEDED',{mustChangePassword:Boolean(current.must_change_password)},current.username);
      return {token,user:publicUser(current)};
    });
  }
  if(!result) {
    writeAudit(db,row?'USER':'SYSTEM',row?.id??'authentication','AUTH_LOGIN_FAILED',{},'Unauthenticated');
    fail(401,'Неверное имя пользователя или пароль.');
  }
  return result;
}

export async function changeOwnPassword(db,input={},address='local') {
  const user=currentUser();if(!user?.id)fail(401,'Войдите в систему.');
  validatePassword(input.newPassword);
  const bucket=consumeAuthBudget(db,'password-change',user.username,String(address),Date.now());
  const row=db.prepare('SELECT * FROM users WHERE id=? AND disabled_at IS NULL').get(user.id);
  if(!row)fail(401,'Войдите в систему.');
  const password=typeof input.currentPassword==='string'&&input.currentPassword.length<=200?input.currentPassword:'';
  const oldDigest=await derivePassword(password,row.salt,64);
  if(!timingSafeEqual(Buffer.from(row.password_hash,'hex'),oldDigest)) {
    writeAudit(db,'USER',row.id,'USER_PASSWORD_CHANGE_FAILED',{});
    fail(401,'Текущий пароль неверен.');
  }
  if(password===input.newPassword)fail(400,'Новый пароль должен отличаться от прежнего.');
  const salt=randomBytes(16).toString('hex'),digest=await derivePassword(input.newPassword,salt,64);
  return inTransaction(db,()=>{
    assertActorCurrent(db,user);
    const current=userForUpdate(db,row.id,{expectedUpdatedAt:row.updated_at});
    if(current.disabled_at)fail(401,'Учётная запись отключена.');
    const now=nextVersion(current);
    db.prepare('UPDATE users SET salt=?,password_hash=?,password_changed_at=?,must_change_password=0,updated_at=? WHERE id=?').run(salt,digest.toString('hex'),now,now,row.id);
    const revoked=db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id).changes;
    db.prepare('DELETE FROM auth_attempts WHERE bucket=?').run(bucket);
    writeAudit(db,'USER',row.id,'USER_PASSWORD_CHANGED',{revokedSessions:revoked});
    return {reauthenticate:true,revokedSessions:revoked};
  });
}

export function logout(db, request) {
  const token = (request.headers.cookie ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith("saq_session="))?.slice(12);
  if(!token || !/^[a-f0-9]{64}$/u.test(token))return;
  // Possession of this token may revoke only this token, including after its owner was disabled.
  withUser(null,()=>inTransaction(db,()=>{
    const hash=hashToken(token),session=db.prepare('SELECT s.user_id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash);
    if(!session)return;
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
    writeAudit(db,'USER',session.user_id,'AUTH_LOGOUT',{},session.username);
  }));
}

export function authorize(db, request, path) {
  if (!accessEnabled(db)) return;
  const user = getSessionUser(db,request);
  if (!user) fail(401,"Войдите в систему.");
  if(currentUser())Object.assign(currentUser(),user);
  if(user.mustChangePassword && path!=="/api/auth/password")fail(403,"Смените временный пароль перед работой с материалами.");
  if(path==="/api/auth/password")return;
  if (path.startsWith("/api/admin/")) {
    if (user.role !== "ADMIN") fail(403,"Настройки доступны администратору.");
    return;
  }
  if (["GET","HEAD"].includes(request.method)) {
    if (!["MIO","ADMIN"].includes(user.role)) {
      const scope=readScope(db);
      let match=path.match(/^\/api\/signals\/([^/]+)(?:\/export)?$/u);
      if(match) {
        const row=db.prepare("SELECT status,routing_json FROM signals WHERE id=?").get(match[1]);
        if(row && (!["CONFIRMED","ARCHIVED"].includes(row.status) || JSON.parse(row.routing_json || "{}").recipient!==user.role)) fail(403,"Материал не назначен вашему органу.");
      }
      match=path.match(/^\/api\/complexes\/([^/]+)(?:\/|$)/u);
      if(match && !scope.has(match[1])) fail(403,"Объект не назначен вашему органу.");
      match=path.match(/^\/api\/ads\/([^/]+)(?:\/archive)?$/u);
      if(match) {
        const ad=db.prepare("SELECT complex_id FROM advertisements WHERE id=?").get(match[1]);
        if(ad && !scope.has(ad.complex_id)) fail(403,"Публикация не относится к назначенному материалу.");
      }
      match=path.match(/^\/api\/evidence\/([^/]+)$/u);
      if(match) {
        const evidence=db.prepare("SELECT a.complex_id FROM evidence_files e JOIN advertisements a ON a.id=e.advertisement_id WHERE e.id=?").get(match[1]);
        if(evidence && !scope.has(evidence.complex_id)) fail(403,"Снимок не относится к назначенному материалу.");
      }
    }
    return;
  }
  const responseMatch = path.match(/^\/api\/signals\/([^/]+)\/response$/u);
  if (responseMatch) {
    const row = db.prepare("SELECT routing_json FROM signals WHERE id=?").get(responseMatch[1]);
    const routing = JSON.parse(row?.routing_json || "{}");
    if (routing.recipient !== user.role) fail(403,"Результат может внести только назначенный орган-получатель.");
    return;
  }
  if (user.role !== "MIO") fail(403,"Это действие доступно ответственному сотруднику МИО.");
}
