import { crc32,inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const MAX_BYTES=700*1024,MAX_PIXELS=16_000_000,MAX_RAW_BYTES=64*1024*1024;
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
const dimensions=(width,height)=>{
  if(!width||!height||width>16000||height>16000||width*height>MAX_PIXELS)fail('Изображение: допустимо до 16 миллионов пикселей и до 16000 по каждой стороне.');
  return {width,height};
};

function inspectPng(bytes) {
  let offset=8,header=null,ended=false,palette=false,idatEnded=false,hasIdat=false;
  const compressed=[];
  while(offset<bytes.length) {
    if(offset+12>bytes.length)fail('Повреждён PNG: неполный блок.');
    const length=bytes.readUInt32BE(offset),end=offset+12+length;
    if(end>bytes.length)fail('Повреждён PNG: длина блока.');
    const type=bytes.subarray(offset+4,offset+8).toString('ascii'),data=bytes.subarray(offset+8,offset+8+length);
    if(!/^[A-Za-z]{4}$/u.test(type)||crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))fail('Повреждён PNG: тип или контрольная сумма блока.');
    if(!header && type!=='IHDR')fail('Повреждён PNG: отсутствует заголовок.');
    if(type==='IHDR') {
      if(header||length!==13)fail('Повреждён PNG: заголовок.');
      const width=data.readUInt32BE(0),height=data.readUInt32BE(4),depth=data[8],color=data[9],interlace=data[12];
      dimensions(width,height);
      const modes={0:{channels:1,depths:[1,2,4,8,16]},2:{channels:3,depths:[8,16]},3:{channels:1,depths:[1,2,4,8]},4:{channels:2,depths:[8,16]},6:{channels:4,depths:[8,16]}};
      if(!modes[color]?.depths.includes(depth)||data[10]!==0||data[11]!==0||interlace>1)fail('Неподдерживаемые параметры PNG.');
      header={width,height,depth,color,interlace,channels:modes[color].channels};
    } else if(type==='PLTE') {
      if(palette||hasIdat||!length||length%3||length>768||[0,4].includes(header.color)||(header.color===3&&length/3>2**header.depth))fail('Повреждена палитра PNG.');
      palette=true;
    } else if(type==='IDAT') {
      if(idatEnded||(header.color===3&&!palette))fail('Повреждён порядок блоков PNG.');
      hasIdat=true;compressed.push(data);
    } else if(type==='IEND') {
      if(length||!hasIdat||end!==bytes.length)fail('Повреждён конец PNG.');
      ended=true;offset=end;break;
    } else {
      if(hasIdat)idatEnded=true;
      if(type==='acTL')fail('Для доказательства загрузите статичный PNG или JPEG.');
      if(type[0]===type[0].toUpperCase())fail('Неподдерживаемый обязательный блок PNG.');
    }
    offset=end;
  }
  if(!ended||!header)fail('Повреждён PNG: файл не завершён.');
  const passes=header.interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{
    const width=Math.max(0,Math.ceil((header.width-x)/dx)),height=Math.max(0,Math.ceil((header.height-y)/dy));
    return {height:width?height:0,stride:1+Math.ceil(width*header.channels*header.depth/8)};
  });
  const expected=rows.reduce((sum,pass)=>sum+pass.height*pass.stride,0);
  if(expected>MAX_RAW_BYTES)fail('Распакованное изображение превышает 64 МБ.');
  let raw;try {raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch {fail('Повреждены или превышены данные пикселей PNG.');}
  if(raw.length!==expected)fail('Длина данных пикселей PNG не соответствует заголовку.');
  let position=0;
  for(const pass of rows)for(let row=0;row<pass.height;row++){if(raw[position]>4)fail('Повреждён фильтр строки PNG.');position+=pass.stride;}
  return dimensions(header.width,header.height);
}

function inspectJpeg(bytes) {
  let offset=2,frame=null,scans=0,quantization=false,huffman=false,ended=false;
  while(offset<bytes.length) {
    if(bytes[offset++]!==255)fail('Повреждён JPEG: маркер блока.');
    while(bytes[offset]===255)offset++;
    const marker=bytes[offset++];
    if(marker===217) {ended=offset===bytes.length;break;}
    if(marker===216||marker===0||marker===undefined||marker===1||(marker>=208&&marker<=215))fail('Повреждён JPEG: порядок маркеров.');
    if(offset+2>bytes.length)fail('Повреждён JPEG: длина блока.');
    const length=bytes.readUInt16BE(offset),end=offset+length;
    if(length<2||end>bytes.length)fail('Повреждён JPEG: неполный блок.');
    const data=bytes.subarray(offset+2,end);
    if([192,193,194].includes(marker)) {
      if(frame||data.length<6||data[0]!==8||![1,3,4].includes(data[5])||length!==8+3*data[5])fail('Неподдерживаемый заголовок JPEG.');
      frame={...dimensions(data.readUInt16BE(3),data.readUInt16BE(1)),components:data[5]};
    } else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))fail('Неподдерживаемый режим JPEG.');
    if(marker===219) {
      let position=0;
      while(position<data.length) {
        const spec=data[position++],precision=spec>>4;
        if(precision>1||(spec&15)>3)fail('Повреждены таблицы квантования JPEG.');
        position+=64*(precision+1);
        if(position>data.length)fail('Неполная таблица квантования JPEG.');
      }
      if(!position)fail('Пустая таблица квантования JPEG.');
      quantization=true;
    }
    if(marker===196) {
      let position=0;
      while(position<data.length) {
        const spec=data[position++];
        if((spec>>4)>1||(spec&15)>3||position+16>data.length)fail('Повреждены таблицы Хаффмана JPEG.');
        let count=0,slots=1;
        for(let i=0;i<16;i++){slots=slots*2-data[position+i];count+=data[position+i];if(slots<0)fail('Некорректные коды Хаффмана JPEG.');}
        position+=16+count;
        if(!count||count>256||position>data.length)fail('Неполная таблица Хаффмана JPEG.');
      }
      if(!position)fail('Пустая таблица Хаффмана JPEG.');
      huffman=true;
    }
    offset=end;
    if(marker===218) {
      if(!frame||!quantization||!huffman||!data.length||data[0]<1||data[0]>frame.components||length!==6+2*data[0])fail('Повреждён JPEG: параметры сканирования.');
      let entropy=0;
      while(offset<bytes.length) {
        if(bytes[offset]!==255){entropy++;offset++;continue;}
        if(bytes[offset+1]===0){entropy++;offset+=2;continue;}
        if(bytes[offset+1]>=208&&bytes[offset+1]<=215){offset+=2;continue;}
        break;
      }
      if(!entropy)fail('Повреждён JPEG: отсутствуют данные сканирования.');
      scans++;
    }
  }
  if(!ended||!frame||!scans)fail('Повреждён JPEG: файл не завершён.');
  return dimensions(frame.width,frame.height);
}

export function decodeEvidenceImage(data) {
  if(typeof data!=='string'||!data.length||data.length%4||data.length>Math.ceil(MAX_BYTES/3)*4||! /^[A-Za-z0-9+/]+={0,2}$/u.test(data))fail('Добавьте PNG или JPEG в base64 размером до 700 КБ.');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>MAX_BYTES||bytes.toString('base64')!==data)fail('Добавьте корректный PNG или JPEG размером до 700 КБ.');
  let mime,size;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {mime='image/png';size=inspectPng(bytes);}
  else if(bytes[0]===255&&bytes[1]===216) {mime='image/jpeg';size=inspectJpeg(bytes);}
  else fail('Файл должен быть снимком PNG или JPEG.');
  return {bytes,mime,...size,sha256:createHash('sha256').update(bytes).digest('hex')};
}
