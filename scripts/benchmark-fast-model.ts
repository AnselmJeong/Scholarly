import fs from 'node:fs/promises';
import {requestCodexServer} from '../electron/services/codex-server';
import {buildDigestSystemPrompt,normalizeGeneratedDigestBody} from '../electron/services/digest';
const model=process.argv[2];if(!model)throw new Error('Specify a model');
const source=await fs.readFile('.scholarly-eval/2026-11-13/empirical-method/source.txt','utf8');
const directory=`.scholarly-eval/fast-model/${model}`;await fs.mkdir(directory,{recursive:true});
for(let run=1;run<=3;run++){
  try{await fs.access(`${directory}/run-${run}.json`);continue}catch{}
  const start=Date.now();let firstTextMs:number|null=null;
  const result=await requestCodexServer('/Users/anselm/.local/bin/codex',[{role:'system',content:buildDigestSystemPrompt('ko')},{role:'user',content:`<source_material>${source}</source_material>`}],model,{reasoningEffort:'low',onText:text=>{if(firstTextMs===null&&text.length>=200)firstTextMs=Date.now()-start;}});
  const body=normalizeGeneratedDigestBody(result.content);
  await fs.writeFile(`${directory}/run-${run}.md`,body);
  await fs.writeFile(`${directory}/run-${run}.json`,JSON.stringify({model,run,durationMs:Date.now()-start,firstTextMs,eojeol:body.split(/\s+/).length,usage:result.usage},null,2));
  console.log(JSON.stringify({model,run,durationMs:Date.now()-start,firstTextMs}));
}
