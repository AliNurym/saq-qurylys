import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ru'}};
const {setLocale}=await import('../public/i18n.js');
const {renderMap}=await import('../public/map-ui.js');
const fixture=demo=>({demo,dataset:demo===undefined?undefined:{isDemo:demo},cities:['Усть-Каменогорск'],overview:{updatedAt:'2026-10-19T01:00:00.000Z',complexes:[]}});

test('map provenance follows working/demo dataset and never treats an unknown mode as verified data',()=>{
  setLocale('ru');const working=renderMap(fixture(false),new URLSearchParams());assert.match(working,/Сведения внесены пользователями/u);assert.doesNotMatch(working,/Объекты демонстрационные/u);
  assert.match(renderMap(fixture(true),new URLSearchParams()),/Объекты демонстрационные/u);
  assert.match(renderMap(fixture(undefined),new URLSearchParams()),/Режим данных не указан/u);
});
test('map provenance and offline guidance are translated consistently in Kazakh',()=>{
  setLocale('kz');const working=renderMap(fixture(false),new URLSearchParams());assert.match(working,/Дереккөздерді тексеру қажет/u);assert.doesNotMatch(working,/Нысандар демо деректері/u);
  assert.match(renderMap(fixture(true),new URLSearchParams()),/Нысандар демо деректері/u);assert.match(working,/интернетті қажет етеді/u);setLocale('ru');
});
