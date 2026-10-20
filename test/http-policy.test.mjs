import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { getHttpPolicy,getListenerConfig,inspectHttpRequest,sessionCookie,normalizedAddress } from '../src/http-policy.mjs';
import { openDatabase } from '../src/db.mjs';
import { createHttpServer } from '../src/server.mjs';
import { createUser } from '../src/access-service.mjs';

const local=getHttpPolicy({});
const publicPolicy=getHttpPolicy({SAQ_PUBLIC_ORIGIN:'https://saq.example',SAQ_TRUSTED_PROXY_IP:'127.0.0.1'});
const request=(headers={},extra={})=>({method:'GET',url:'/api/auth/session',headers:{host:'127.0.0.1:4173',...headers},socket:{localAddress:'127.0.0.1',localPort:4173,remoteAddress:'127.0.0.1'},...extra});
const status=(fn,code)=>assert.throws(fn,{statusCode:code});

test('deployment policy requires HTTPS origin and one explicit proxy; listener is validated',()=>{
  assert.deepEqual(local,{publicOrigin:null,trustedProxyIP:null});
  assert.equal(getHttpPolicy({SAQ_PUBLIC_ORIGIN:'https://SAQ.example:443/',SAQ_TRUSTED_PROXY_IP:'::ffff:127.0.0.1'}).publicOrigin,'https://saq.example');
  assert.throws(()=>getHttpPolicy({HOST:'0.0.0.0'}),/SAQ_PUBLIC_ORIGIN/u);
  assert.throws(()=>getHttpPolicy({HOST:'192.168.1.20'}),/SAQ_PUBLIC_ORIGIN/u);
  assert.deepEqual(getHttpPolicy({HOST:'::1'}),local);
  for(const origin of ['invalid','http://saq.example','https://saq.example:0','https://saq.example/path','https://user:pass@saq.example','https://saq.example/?token=a','https://saq.example/#x'])assert.throws(()=>getHttpPolicy({SAQ_PUBLIC_ORIGIN:origin,SAQ_TRUSTED_PROXY_IP:'127.0.0.1'}));
  for(const proxy of ['','localhost','0.0.0.0','::','127.0.0.1,127.0.0.2'])assert.throws(()=>getHttpPolicy({SAQ_PUBLIC_ORIGIN:'https://saq.example',SAQ_TRUSTED_PROXY_IP:proxy}));
  assert.throws(()=>getHttpPolicy({SAQ_TRUSTED_PROXY_IP:'127.0.0.1'}));
  assert.deepEqual(getListenerConfig({}),{host:'127.0.0.1',port:4173});
  assert.deepEqual(getListenerConfig({HOST:'::1',PORT:'4444'}),{host:'::1',port:4444});
  for(const port of ['0','65536','1.5','abc',''])assert.throws(()=>getListenerConfig({PORT:port}));
  assert.throws(()=>getListenerConfig({HOST:'untrusted.example'}));
});

test('local host validation rejects rebinding and mismatched ports',()=>{
  for(const host of ['127.0.0.1:4173','localhost:4173','[::1]:4173'])assert.equal(inspectHttpRequest(request({host}),local).clientAddress,'127.0.0.1');
  for(const host of ['attacker.example:4173','127.0.0.1:9999','192.0.2.1:4173'])status(()=>inspectHttpRequest(request({host}),local),421);
  for(const host of ['','user@localhost:4173','localhost:4173/path','localhost:4173 x'])status(()=>inspectHttpRequest(request({host}),local),400);
  assert.equal(normalizedAddress('::ffff:127.0.0.1'),'127.0.0.1');
});

test('malformed targets are rejected before routing and cross-site writes cannot use cookies',()=>{
  for(const url of ['https://saq.example/api','//other/api','/bad\\path','/%00','/%5c','/%ZZ'])status(()=>inspectHttpRequest(request({}, {url}),local),400);
  for(const origin of ['https://attacker.example','null','http://localhost:4173'])status(()=>inspectHttpRequest(request({origin},{method:'POST'}),local),403);
  status(()=>inspectHttpRequest(request({'sec-fetch-site':'cross-site'},{method:'POST'}),local),403);
  assert.equal(inspectHttpRequest(request({origin:'http://127.0.0.1:4173'},{method:'POST'}),local).secure,false);
});

test('only immediate trusted proxy may supply one valid client address',()=>{
  const proxied=request({host:'saq.example','x-real-ip':'203.0.113.12','x-forwarded-for':'attacker'});
  assert.equal(inspectHttpRequest(proxied,publicPolicy).clientAddress,'203.0.113.12');
  for(const real of [undefined,'bad','203.0.113.1, 203.0.113.2',['203.0.113.1','203.0.113.2']])status(()=>inspectHttpRequest(request({host:'saq.example','x-real-ip':real}),publicPolicy),400);
  status(()=>inspectHttpRequest({...proxied,socket:{...proxied.socket,remoteAddress:'192.0.2.4'}},publicPolicy),403);
  assert.equal(inspectHttpRequest(request({'x-real-ip':'203.0.113.12','x-forwarded-for':'203.0.113.13'}),local).clientAddress,'127.0.0.1');
  status(()=>inspectHttpRequest(request({host:'other.example','x-real-ip':'203.0.113.12'}),publicPolicy),421);
});

test('public mutation origin and session attributes refer to the browser HTTPS origin',()=>{
  const headers={host:'saq.example','x-real-ip':'203.0.113.12',origin:'https://saq.example'};
  const context=inspectHttpRequest(request(headers,{method:'POST'}),publicPolicy);
  assert.equal(context.publicRequest,true);assert.equal(context.secure,true);
  assert.match(sessionCookie('sample',context),/HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure$/u);
  assert.match(sessionCookie('',context),/Max-Age=0; Secure$/u);
  status(()=>inspectHttpRequest(request({...headers,origin:'http://saq.example'},{method:'POST'}),publicPolicy),403);
  assert.doesNotMatch(sessionCookie('sample',{secure:false}),/; Secure/u);
});

function raw(server,path,headers={},method='GET',body) {
  return new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end(body);
  });
}
async function fixture(t,policy=local,account=true) {
  const db=openDatabase(':memory:');if(account)createUser(db,{username:'proxy.admin',password:'temporary-proxy-password',role:'ADMIN'});
  const server=createHttpServer(db,{collectionWorker:false,httpPolicy:policy});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));if(db.isOpen)db.close();});
  return {db,server};
}

test('real public HTTP backend enforces proxy boundary, secure login and logout',async t=>{
  const {server}=await fixture(t,publicPolicy);
  const headers={host:'saq.example','x-real-ip':'203.0.113.12',origin:'https://saq.example','content-type':'application/json'};
  assert.equal((await raw(server,'/api/auth/session',{host:'saq.example'})).status,400);
  const signed=await raw(server,'/api/auth/login',headers,'POST',JSON.stringify({username:'proxy.admin',password:'temporary-proxy-password'}));
  assert.equal(signed.status,200);assert.match(signed.headers['set-cookie'][0],/; Secure$/u);
  const cookie=signed.headers['set-cookie'][0].split(';')[0];
  assert.equal((await raw(server,'/api/bootstrap',{...headers,cookie})).status,200);
  assert.equal((await raw(server,'/api/auth/logout',{...headers,cookie,origin:'https://other.example'},'POST','{}')).status,403);
  const loggedOut=await raw(server,'/api/auth/logout',{...headers,cookie},'POST','{}');assert.equal(loggedOut.status,200);assert.match(loggedOut.headers['set-cookie'][0],/Max-Age=0; Secure$/u);
  assert.equal((await raw(server,'/api/bootstrap',{...headers,cookie})).status,401);
  assert.equal(server.requestTimeout,30000);assert.equal(server.headersTimeout,10000);
});

test('health is minimal, unauthenticated and remains available to local supervisor behind proxy',async t=>{
  const {db,server}=await fixture(t,publicPolicy);
  const localHost={host:'127.0.0.1:'+server.address().port};
  const health=await raw(server,'/healthz',localHost);assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.text),{status:'ok'});
  assert.equal((await raw(server,'/healthz',localHost,'HEAD')).text,'');
  assert.equal((await raw(server,'/api/auth/session',localHost)).status,421);
  assert.equal(health.headers['x-frame-options'],'DENY');assert.match(health.headers['content-security-policy'],/frame-ancestors 'none'/u);
  assert.equal(health.headers['strict-transport-security'],'max-age=31536000');
  db.close();const unavailable=await raw(server,'/healthz',localHost);assert.equal(unavailable.status,503);assert.deepEqual(JSON.parse(unavailable.text),{status:'unavailable'});
});

test('public first-admin setup is forbidden and local HTTP does not advertise HSTS',async t=>{
  const db=openDatabase(':memory:');try {
    assert.throws(()=>createHttpServer(db,{collectionWorker:false,httpPolicy:publicPolicy}),/действующего ADMIN/u);
    createUser(db,{username:'disabled.admin',password:'disabled-admin-password',role:'ADMIN'});db.exec("UPDATE users SET disabled_at='2026-10-19T00:00:00.000Z'");
    assert.throws(()=>createHttpServer(db,{collectionWorker:false,httpPolicy:publicPolicy}),/действующего ADMIN/u);
  }finally{db.close();}
  const other=await fixture(t,local);assert.equal((await raw(other.server,'/healthz')).headers['strict-transport-security'],undefined);
});
