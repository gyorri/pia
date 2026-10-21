'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const mod=await import('file://'+path.resolve(__dirname,'../public/capture-paddle.mjs'));
 const sample={items:[
  {text:'두번째 게시물',score:0.81,poly:[[2,110],[40,110],[40,130],[2,130]]},
  {text:'첫번째 게시물',score:0.91,poly:[[1,10],[40,10],[40,30],[1,30]]},
  {text:'세번째 게시물',score:0.87,poly:[[1,250],[40,250],[40,280],[1,280]]}
 ],metrics:{detMs:4,recMs:5,totalMs:9,detectedBoxes:3,recognizedCount:3}};
 const normalized=mod.normalizePaddleResult(sample);
 assert.equal(normalized.text,'첫번째 게시물\n두번째 게시물\n세번째 게시물');
 assert.equal(normalized.count,3);
 assert.ok(Math.abs(normalized.meanScore-.86333333)<.001);
 assert.equal(normalized.metrics.totalMs,9);
 assert.equal(mod.normalizePaddleResult({items:[{text:'',score:1},{text:'X'}]}).text,'X');
 let built=0,called=0,creationOpts;
 const sdk={create:async opts=>{built++;creationOpts=opts;return {predict:async blob=>{called++;assert.ok(blob instanceof Blob);return [sample]}}}};
 mod.resetPaddleEngineForTests();
 const first=await mod.runPaddleOCR(new Blob(['x']),()=>{},{sdkConstructor:sdk});
 const second=await mod.runPaddleOCR(new Blob(['x']),()=>{},{sdkConstructor:sdk});
 assert.equal(built,1,'engine reused across comparisons');
 assert.equal(called,2);
 assert.equal(first.text,normalized.text);
 assert.equal(second.text,normalized.text);
 assert.equal(creationOpts.textRecognitionModelName,'korean_PP-OCRv5_mobile_rec');
 assert.equal(creationOpts.lang,'korean');
 assert.equal(creationOpts.ortOptions.backend,'wasm');
 mod.resetPaddleEngineForTests();
 await assert.rejects(mod.runPaddleOCR(new Blob(['x']),()=>{},{sdkConstructor:{create:async()=>{throw Error('model failed')}}}),/model failed/);
 const after=await mod.runPaddleOCR(new Blob(['x']),()=>{},{sdkConstructor:sdk});
 assert.ok(after.text.includes('첫번째'));
 console.log('PASS: Korean model configuration, layout ordering, metrics, opt-in engine reuse, failure retry');
})().catch(e=>{console.error(e);process.exitCode=1});
