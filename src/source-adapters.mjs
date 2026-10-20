import { createHash } from 'node:crypto';
import { validPublicationDate, todayInKazakhstan } from './dates.mjs';
import { validateSourceUrl,redactCredentialQueryParameters } from './public-http.mjs';
import {SourceValidationError} from './collection-errors.mjs';

const invalid=message=>{throw new SourceValidationError(message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
export function htmlToText(html) {
  const document=html.replace(/<!--[\s\S]*?-->/gu,'').replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,' ');
  const body=document.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/iu)?.[1] ?? document.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? document;
  return body.replace(/<[^>]*>/gu,' ').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu,(_,entity)=>{
    if(entity[0]!=='#')return entities[entity.toLowerCase()]??' ';
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)?String.fromCodePoint(code):' ';
  }).replace(/\s+/gu,' ').trim();
}

export function parseSourceResponse(source, resource) {
  if(!Buffer.isBuffer(resource.bytes) || resource.bytes.length>2*1024*1024)invalid('Ответ источника превышает допустимый размер.');
  let body;
  try {body=new TextDecoder('utf-8',{fatal:true}).decode(resource.bytes);} catch {invalid('Источник должен возвращать UTF-8.');}
  let rows;
  if(source.kind==='JSON_FEED') {
    if(resource.mime!=='application/json')invalid('Для JSON_FEED требуется application/json.');
    let feed;try{feed=JSON.parse(body);}catch{invalid('Некорректный JSON источника.');}
    if(!feed || !Array.isArray(feed.items) || feed.items.length>100)invalid('Источник должен содержать items: массив не более 100 публикаций.');
    rows=feed.items;
  } else {
    if(!['text/html','application/xhtml+xml'].includes(resource.mime))invalid('Для HTML_PAGE требуется HTML.');
    rows=[{id:source.url,text:htmlToText(body),url:new URL(resource.finalUrl).origin}];
  }
  const seen=new Set();
  return rows.map(row=>{
    if(!row || typeof row!=='object' || Array.isArray(row) || typeof row.id!=='string' || !row.id.trim() || row.id.length>300)invalid('У публикации отсутствует строковый id до 300 символов.');
    if(seen.has(row.id))invalid('В одном ответе повторяется id публикации.');seen.add(row.id);
    if(typeof row.text!=='string' || row.text.trim().length<5 || row.text.length>12000)invalid('Текст публикации: от 5 до 12000 символов.');
    for(const [key,max] of [['account',120],['phone',40]])if(row[key]!=null && (typeof row[key]!=='string'||row[key].length>max))invalid('Некорректное поле публикации: '+key);
    const url=validateSourceUrl(redactCredentialQueryParameters(row.url || resource.finalUrl)).href;
    const publishedAt=row.publishedAt??null;
    if(publishedAt!==null && (typeof publishedAt!=='string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(publishedAt) || !validPublicationDate(publishedAt.slice(0,10)) || !Number.isFinite(Date.parse(publishedAt)) || (publishedAt.includes('T') && Date.parse(publishedAt)>Date.now())))invalid('Некорректная дата публикации источника.');
    const item={externalId:row.id,text:row.text.trim(),url,account:row.account||null,phone:row.phone||null,publishedAt};
    return {...item,contentSha256:digest(JSON.stringify(item)),publicationDate:publishedAt?.slice(0,10)||todayInKazakhstan(),
      notes:publishedAt?'Автоматически получено из настроенного источника; сведения требуют проверки.':'Дата публикации неизвестна. В поле даты показан день наблюдения; сведения требуют проверки.'};
  });
}
