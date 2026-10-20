import {isIP} from 'node:net';

const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
export function normalizedAddress(address) {
  if(typeof address!=='string')return '';
  const lower=address.toLowerCase();return lower.startsWith('::ffff:')&&isIP(lower.slice(7))===4?lower.slice(7):lower;
}
export const loopbackAddress=address=>{const normalized=normalizedAddress(address);return normalized==='::1'||isIP(normalized)===4&&normalized.startsWith('127.');};

export function getHttpPolicy(env=process.env) {
  const raw=env.SAQ_PUBLIC_ORIGIN?.trim()??'',proxy=env.SAQ_TRUSTED_PROXY_IP?.trim()??'';
  if(!raw&&proxy)throw new Error('SAQ_TRUSTED_PROXY_IP требует SAQ_PUBLIC_ORIGIN.');
  if(!raw) {
    const host=env.HOST?.trim()||'127.0.0.1';
    if(host!=='localhost'&&isIP(host)&&!loopbackAddress(host))throw new Error('Для сетевого доступа настройте SAQ_PUBLIC_ORIGIN и SAQ_TRUSTED_PROXY_IP; локальный режим должен слушать loopback.');
    return Object.freeze({publicOrigin:null,trustedProxyIP:null});
  }
  let url;try{url=new URL(raw);}catch{throw new Error('SAQ_PUBLIC_ORIGIN: укажите HTTPS origin без пути и учётных данных.');}
  if(url.protocol!=='https:'||url.port==='0'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('SAQ_PUBLIC_ORIGIN: допустим только HTTPS origin без пути и учётных данных.');
  if(!isIP(proxy)||['0.0.0.0','::'].includes(proxy))throw new Error('SAQ_TRUSTED_PROXY_IP: укажите один конкретный IP прокси.');
  return Object.freeze({publicOrigin:url.origin,trustedProxyIP:normalizedAddress(proxy)});
}

export function getListenerConfig(env=process.env) {
  const host=env.HOST?.trim()||'127.0.0.1',raw=env.PORT??'4173',port=Number(raw);
  if(!/^\d+$/u.test(String(raw))||!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT: целое число от 1 до 65535.');
  if(host!=='localhost'&&!isIP(host))throw new Error('HOST: укажите IP интерфейса или localhost.');
  return {host,port};
}

function localAuthority(request,url) {
  const hostname=url.hostname.replace(/^\[|\]$/gu,''),local=normalizedAddress(request.socket.localAddress);
  return Number(url.port||(url.protocol==='https:'?443:80))===request.socket.localPort&&
    ((hostname==='localhost'&&loopbackAddress(local))||(isIP(hostname)&&((loopbackAddress(hostname)&&loopbackAddress(local))||normalizedAddress(hostname)===local)));
}

export function inspectHttpRequest(request,policy) {
  const target=request.url??'/';
  if(!target.startsWith('/')||target.startsWith('//')||target.includes('\\'))fail(400,'Некорректный адрес запроса.');
  const url=new URL(target,'http://localhost');let path;
  try{path=decodeURIComponent(url.pathname);}catch{fail(400,'Некорректный адрес запроса.');}
  if(path.includes('\0')||path.includes('\\'))fail(400,'Некорректный адрес запроса.');
  const peer=normalizedAddress(request.socket.remoteAddress),secure=Boolean(policy.publicOrigin)||Boolean(request.socket.encrypted);
  let authority;try{
    const host=request.headers.host;if(typeof host!=='string'||!host||/[\s/\\@?#]/u.test(host))throw new Error();
    authority=new URL((secure?'https:':'http:')+'//'+host);
  }catch{fail(400,'Некорректный Host.');}
  const localHealth=path==='/healthz'&&['GET','HEAD'].includes(request.method)&&loopbackAddress(peer)&&localAuthority(request,authority);
  const validHost=policy.publicOrigin?authority.origin===policy.publicOrigin:localAuthority(request,authority);
  if(!validHost&&!localHealth)fail(421,'Адрес запроса не соответствует настройкам сервера.');
  let clientAddress=peer;
  if(policy.publicOrigin&&!localHealth) {
    if(peer!==policy.trustedProxyIP)fail(403,'Запрос должен поступить через настроенный прокси.');
    const real=request.headers['x-real-ip'];if(typeof real!=='string'||!isIP(real))fail(400,'Прокси должен передать единственный X-Real-IP.');
    clientAddress=normalizedAddress(real);
  }
  const expectedOrigin=policy.publicOrigin??authority.origin;
  if(!['GET','HEAD'].includes(request.method)) {
    const origin=request.headers.origin;
    if(origin!==undefined&&origin!==expectedOrigin||request.headers['sec-fetch-site']==='cross-site')fail(403,'Запросы с другого сайта запрещены.');
  }
  return {url,path,clientAddress,secure,publicRequest:Boolean(policy.publicOrigin)&&!localHealth};
}

export function sessionCookie(token,context) {
  return 'saq_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+(token?'28800':'0')+(context.secure?'; Secure':'');
}

export function applyHttpHeaders(response,policy) {
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','strict-origin-when-cross-origin');response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(policy.publicOrigin)response.setHeader('Strict-Transport-Security','max-age=31536000');
}
