import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { request } from 'node:https';
import {SourceValidationError} from './collection-errors.mjs';

const blocked = new BlockList();
const sensitiveQueryKey = key => {
  const normalized=String(key).toLowerCase().replace(/[^a-z0-9]/gu,'');
  return /token|secret|password|passwd|credential|authorization|signature|session|bearer|jwt|oauth|stkn|pwd/u.test(normalized)||/(?:key|keyid)$/u.test(normalized)||/^(?:auth|sig)$/u.test(normalized);
};
for (const [address, bits] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3],
]) blocked.addSubnet(address,bits,'ipv4');
// Only global unicast IPv6 is permitted; mapped IPv4 is checked separately.
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
for (const [address,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked.addSubnet(address,bits,'ipv6');

export function isPublicAddress(address) {
  if (isIP(address) === 4) return !blocked.check(address,'ipv4');
  if (isIP(address) !== 6) return false;
  return globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}

export function validateSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new SourceValidationError('Укажите корректный HTTPS URL источника.'); }
  if (typeof value !== 'string' || value.length > 500 || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) {
    throw new SourceValidationError('Источник должен иметь HTTPS URL без пароля, нестандартного порта и фрагмента.');
  }
  const host=url.hostname.replace(/^\[|\]$/gu,'');
  if([...url.searchParams.keys()].some(sensitiveQueryKey)) {
    throw new SourceValidationError('Секрет источника задаётся через tokenEnv, а не в URL.');
  }
  if (host.toLowerCase() === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !isPublicAddress(host))) {
    throw new SourceValidationError('Локальные и служебные адреса источников запрещены.');
  }
  return url;
}

export function redactCredentialQueryParameters(value) {
  let url;try{url=new URL(value);}catch{return value;}
  for(const key of [...url.searchParams.keys()])if(sensitiveQueryKey(key))url.searchParams.delete(key);
  url.hash='';
  return url.href;
}

export async function resolvePublicHost(hostname, resolver = lookup) {
  const host=hostname.replace(/^\[|\]$/gu,'');
  const records=isIP(host) ? [{address:host,family:isIP(host)}] : await resolver(host,{all:true,verbatim:true});
  if (!records.length || records.some(record=>!isPublicAddress(record.address))) throw new Error('DNS источника указывает на запрещённую сеть.');
  return records[0];
}

// Resolve once, validate every address and pin the connection to that resolution.
// A shared deadline includes DNS, redirects and body reads; no credentials cross origins.
export async function fetchPublicResource(value, { token = '', timeoutMs = 15000, maxBytes = 2*1024*1024, resolver = lookup, transport = request,allowedMimes=['application/json','text/html','application/xhtml+xml'] } = {}) {
  const signal=AbortSignal.timeout(timeoutMs);
  let url=validateSourceUrl(value), redirects=0;
  const initialOrigin=url.origin;
  while (true) {
    const record=await new Promise((resolve,reject)=>{
      if(signal.aborted) return reject(new Error('Истекло время загрузки источника.'));
      const abort=()=>reject(new Error('Истекло время загрузки источника.'));
      signal.addEventListener('abort',abort,{once:true});
      resolvePublicHost(url.hostname,resolver).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
    const result=await new Promise((resolve,reject)=>{
      const headers={Accept:'application/json, text/html;q=0.9', 'User-Agent':'SAQ-QURYLYS-Collector/1.0', 'Accept-Encoding':'identity'};
      if(token && url.origin===initialOrigin) headers.Authorization='Bearer '+token;
      const req=transport(url,{signal,headers,lookup:(_host,options,callback)=>callback(null,options.all?[record]:record.address,record.family)},response=>{
        const status=response.statusCode;
        if ([301,302,303,307,308].includes(status)) { response.destroy(); resolve({redirect:response.headers.location}); return; }
        if(status < 200 || status >= 300) { response.destroy(); reject(new Error('Источник вернул HTTP '+status+'.')); return; }
        if(response.headers['content-encoding'] && response.headers['content-encoding']!=='identity') { response.destroy(); reject(new Error('Сжатый ответ источника не поддерживается.')); return; }
        const mime=(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(!allowedMimes.includes(mime)) {response.destroy();reject(new Error('Неподдерживаемый формат источника.'));return;}
        const chunks=[];let size=0;
        response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes) response.destroy(new Error('Ответ источника превышает 2 МБ.'));else chunks.push(chunk);});
        response.on('error',reject);
        response.on('end',()=>resolve({bytes:Buffer.concat(chunks),mime,finalUrl:url.href}));
      });
      req.on('error',()=>reject(new Error(signal.aborted?'Истекло время загрузки источника.':'Не удалось подключиться к источнику.')));
      req.end();
    });
    if(!Object.hasOwn(result,'redirect'))return result;
    if(!result.redirect || ++redirects>3)throw new Error('Слишком много перенаправлений или отсутствует адрес.');
    url=validateSourceUrl(new URL(result.redirect,url).href);
  }
}
