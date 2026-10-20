import test from 'node:test';
import assert from 'node:assert/strict';
import {getAiConfig} from '../src/config.mjs';

test('DeepSeek never receives a key configured for OpenAI',()=>{
  const keys=['AI_PROVIDER','AI_API_KEY','DEEPSEEK_API_KEY'],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    process.env.AI_PROVIDER='deepseek';process.env.AI_API_KEY='synthetic-openai-key';delete process.env.DEEPSEEK_API_KEY;
    assert.equal(getAiConfig().apiKey,'');
    process.env.DEEPSEEK_API_KEY='synthetic-deepseek-key';
    assert.equal(getAiConfig().apiKey,'synthetic-deepseek-key');
    process.env.AI_PROVIDER='openai';
    assert.equal(getAiConfig().apiKey,'synthetic-openai-key');
  } finally {
    for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
});
