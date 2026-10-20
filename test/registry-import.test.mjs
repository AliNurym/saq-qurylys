import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { configureDataset, getDataset, assertDatasetReady } from "../src/dataset-service.mjs";
import { parseRegistryCsv, previewRegistryImport, commitRegistryImport } from "../src/registry-import.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { createComplex, savePassport } from "../src/passport-service.mjs";
import { createUser, withUser } from "../src/access-service.mjs";
import { createAdvertisement, addManualFactor, setLegalBasisStatus } from "../src/advertisement-service.mjs";
import { createSignal } from "../src/signal-service.mjs";
import { renderSignalExport } from "../src/signal-export.mjs";
import { getComplexDetails } from "../src/complex-service.mjs";
import { createHttpServer } from "../src/server.mjs";

const headers="name;city;address;developerName;developerBin;latitude;longitude;district";
const line='Учебный объект;Усть-Каменогорск;Тестовая улица 1;Учебная компания;000000000099;49.95;82.61;Тестовый район';
const input={source:"Учебный файл для проверки импорта",sourceDate:"2026-10-16",content:headers+'\n'+line};
const values={name:"Тестовый объект",city:"Тестовый город",address:"Тестовый адрес",developerName:"Учебная компания",developerBin:"000000000099",latitude:49.95,longitude:82.61};
const fixture=t=>{const db=openDatabase(":memory:");t.after(()=>db.close());return db;};

test("CSV parser preserves leading zero BINs, BOM, escaped quotes, multiline and comma-separated cells",()=>{
  const csv='\uFEFF'+headers+'\r\n"Учебный; объект ""А""";Усть-Каменогорск;"Адрес\nстрока 2";Компания;000000000099;49.95;82.61;Район';
  const [row]=parseRegistryCsv(csv);
  assert.equal(row.name,'Учебный; объект "А"');assert.equal(row.address,'Адрес\nстрока 2');assert.equal(row.developerBin,'000000000099');
  assert.equal(parseRegistryCsv(headers.replaceAll(';',',')+'\n'+line.replaceAll(';',','))[0].district,'Тестовый район');
  for(const bad of [headers+'\n"broken',headers+'\nshort;row',headers+';name\n'+line+';extra',headers.replace('name','unknown')+'\n'+line]) assert.throws(()=>parseRegistryCsv(bad));
});

test("preview validates all rows and imports nothing on invalid coordinates, BIN, duplicate or oversized file",t=>{
  const db=fixture(t);
  const broken={...input,content:input.content+'\n'+line.replace('49.95','150').replace('000000000099','99')};
  const preview=previewRegistryImport(db,broken);assert.equal(preview.valid,false);assert.equal(preview.errors[0].row,2);
  assert.throws(()=>commitRegistryImport(db,{...broken,digest:preview.digest}),/Исправьте/u);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complexes').get().n,0);
  assert.equal(previewRegistryImport(db,{...input,content:input.content+'\n'+line}).errors[0].row,2);
  assert.throws(()=>previewRegistryImport(db,{...input,source:''}),/источник/u);
  assert.throws(()=>previewRegistryImport(db,{...input,sourceDate:'2026-02-30'}),/дату/u);
  assert.throws(()=>parseRegistryCsv('a'.repeat(700*1024+1)),/700/u);
  assert.throws(()=>parseRegistryCsv(headers+'\n'+Array(501).fill(line).join('\n')),/500/u);
});

test("import records provenance, audit, unique numbers and unverified risk; duplicate import never adds objects",t=>{
  const db=fixture(t),preview=previewRegistryImport(db,input);
  assert.equal(preview.valid,true);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complexes').get().n,0);
  const result=commitRegistryImport(db,{...input,digest:preview.digest}),detail=getComplexDetails(db,result.items[0].id);
  assert.equal(detail.objectNumber,'SQ-OBJ-0001');assert.equal(detail.developerBin,'000000000099');
  assert.equal(detail.isDemo,true);assert.equal(detail.legalBasisStatus,'UNKNOWN');assert.equal(detail.risk.score,0);assert.equal(detail.risk.zone,'green');assert.equal(detail.risk.needsReview,true);
  assert.equal(detail.passport.fields.district,'Тестовый район');assert.equal(detail.passport.checkedAt,undefined);
  assert.equal(detail.passport.registryImport.source,input.source);assert.equal(detail.passport.registryImport.sourceDate,input.sourceDate);
  assert.equal(db.prepare("SELECT actor FROM audit_logs WHERE action='REGISTRY_IMPORTED'").get().actor,'Demo Analyst');
  assert.equal(previewRegistryImport(db,input).valid,false);
  assert.throws(()=>commitRegistryImport(db,{...input,digest:preview.digest}),/изменились/u);
  savePassport(db,detail.id,{source:'Последующая ручная проверка',director:'Тестовый руководитель'});
  assert.equal(getComplexDetails(db,detail.id).passport.registryImport.source,input.source);
});

test("approval becomes stale when file, source or register changes; database failures roll back entire import",t=>{
  const db=fixture(t),preview=previewRegistryImport(db,input);
  for(const change of [{source:'Другой источник'},{content:input.content.replace('улица 1','улица 2')},{sourceDate:'2026-10-15'}]) assert.throws(()=>commitRegistryImport(db,{...input,...change,digest:preview.digest}),/изменились/u);
  createComplex(db,values);
  assert.throws(()=>commitRegistryImport(db,{...input,digest:preview.digest}),/изменились/u);
  const batch={...input,content:input.content+'\n'+line.replace('улица 1','улица 2')},fresh=previewRegistryImport(db,batch);
  db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON audit_logs WHEN NEW.action='REGISTRY_IMPORTED' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  assert.throws(()=>commitRegistryImport(db,{...batch,digest:fresh.digest}),/test rollback/u);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complexes').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='COMPLEX_CREATED'").get().n,1);
});

test("working dataset starts empty, requires admin, rejects demo/reset and preserves truthful flags and exports",async t=>{
  const db=fixture(t);configureDataset(db,'working');
  assert.throws(()=>assertDatasetReady(db),/администратора/u);assert.throws(()=>seedDemoData(db),/запрещены/u);
  assert.throws(()=>seedDemoData(db,{reset:true}),/запрещены/u);
  createUser(db,{username:'test.admin',role:'ADMIN',password:'isolated-test-password'});assertDatasetReady(db);
  const mio=createUser(db,{username:'test.mio',role:'MIO',password:'isolated-test-password'});
  await withUser(mio,async()=>{
    const preview=previewRegistryImport(db,input),result=commitRegistryImport(db,{...input,digest:preview.digest}),id=result.items[0].id;
    assert.equal(getComplexDetails(db,id).isDemo,false);
    const ad=await createAdvertisement(db,{platform:'Telegram',text:'Учебный объект. Продажа квартир. Внесите депозит 300000 тенге.',publicationDate:'2026-10-16',url:'https://example.invalid/test'});
    assert.equal(ad.isDemo,false);
    addManualFactor(db,id,{code:'R2',sourceLabel:'Тестовый источник',evidenceText:'Проверенный текст о депозите',notes:'Проверка записи'});
    setLegalBasisStatus(db,id,{status:'CONFIRMED_ABSENT',sourceLabel:'Тестовый источник',evidenceText:'Тестовое заключение для проверки записи',notes:'Проверка записи',expectedUpdatedAt:db.prepare('SELECT updated_at FROM complexes WHERE id=?').get(id).updated_at});
    assert.ok(db.prepare('SELECT is_demo FROM risk_factors').all().every(row=>row.is_demo===0));
    const report=renderSignalExport(createSignal(db,id));assert.ok(report.includes('Рабочий реестр'));assert.ok(report.includes('ещё не подтверждены ручной сверкой'));assert.equal(report.includes('Все объекты, компании и документы вымышлены.'),false);
  });
  assert.equal(getDataset(db).mode,'working');assert.throws(()=>configureDataset(db,'demo'),/пустая/u);
});

test("existing demo database cannot be silently relabelled as working",t=>{
  const db=fixture(t);seedDemoData(db);
  assert.throws(()=>configureDataset(db,'working'),/пустая/u);
  assert.equal(getDataset(db).mode,'demo');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complexes').get().n,10);
});

test("HTTP import requires MIO and authenticated preview; working bootstrap reports the dataset mode",async t=>{
  const db=fixture(t);configureDataset(db,'working');
  for(const [username,role] of [['test.admin','ADMIN'],['test.mio','MIO'],['test.gask','GASK']]) createUser(db,{username,role,password:'isolated-test-password'});
  const server=createHttpServer(db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const root='http://127.0.0.1:'+server.address().port;
  const request=(path,body,cookie)=>fetch(root+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/registry/preview',input)).status,401);
  const signIn=async username=>{const r=await request('/api/auth/login',{username,password:'isolated-test-password'});return r.headers.get('set-cookie').split(';')[0];};
  const gask=await signIn('test.gask');assert.equal((await request('/api/registry/preview',input,gask)).status,403);
  const admin=await signIn('test.admin');assert.equal((await request('/api/registry/import',input,admin)).status,403);
  const mio=await signIn('test.mio'),bootstrap=await (await request('/api/bootstrap',null,mio)).json();
  assert.equal(bootstrap.demo,false);assert.equal(bootstrap.dataset.mode,'working');
  const preview=await (await request('/api/registry/preview',input,mio)).json();
  const response=await request('/api/registry/import',{...input,digest:preview.digest},mio);
  assert.equal(response.status,201);assert.equal((await response.json()).count,1);
});
