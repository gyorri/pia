const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const BASE=path.resolve(__dirname,'..');
// Synthetic 1,041-record regression fixture; private user backups are never included in the patch ZIP.
const allIds=Array.from({length:1041},(_,i)=>'P'+String(i+1).padStart(3,'0'));
const excluded=new Set(allIds.filter((id,i)=>i<41||i>=42&&i<66));
const backup={format:'pia-review-v1',version:1,fingerprint:'fixture',source:'synthetic_1041.xlsx',records:allIds.map(id=>{
 const choice=excluded.has(id)?'제외':'미선택';
 const fields={'게시물 ID':id,'사용자 최종 선택':choice,'사용자 메모':'','검수 결과':'정상','작성자':'작성자','아이디':'@fixture','게시물 유형(검수안)':'post','본문 전체(검수안)':'테스트 게시물 '+id,'중복 판정':'후보 미검출'};
 return {id,choice,memo:'',fields};
})};
assert.equal(excluded.size,65);
const nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,options:[{value:''},{value:'active'},{value:'미선택'},{value:'제외'}],dataset:{},style:{},addEventListener(){},classList:{add(){},remove(){},toggle(){}},before(){},remove(){},scrollIntoView(){},querySelector(){return null}});return nodes.get(id)}
const doc={getElementById:node,querySelectorAll(){return[]},addEventListener(){},createElement(){return {innerHTML:'',className:'',id:'',remove(){},click(){}}},body:{append(){}}};
let exportedBlob=null;
const win={PIAReviewExportXlsx:null,PIA_REVIEW_TEST:null,PIAReviewXlsx:{parseSelectionXlsx:async()=>({records:[]})}};
const ctx={document:doc,window:win,setTimeout(){return 1},clearTimeout(){},confirm:()=>true,URL:{revokeObjectURL(){},createObjectURL(blob){exportedBlob=blob;return 'blob:fake'}},fetch:async()=>({ok:true,json:async()=>({authenticated:false,configured:true})}),crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},console,encodeURIComponent,Blob,TextEncoder,Uint8Array,Uint32Array,Intl};
for(const k of ['query','authorFilter','auditFilter','typeFilter','duplicateFilter','choiceFilter'])node(k).value='';node('choiceFilter').value='active';node('sortFilter').value='original';node('pageSize').value='20';
vm.runInNewContext(fs.readFileSync(path.join(BASE,'public/review-export-xlsx.js'),'utf8'),ctx,{filename:'review-export-xlsx.js'});
vm.runInNewContext(fs.readFileSync(path.join(BASE,'public/review.js'),'utf8'),ctx,{filename:'review.js'});
const {state,setChoice,undoLast,importWorkbook,restoreBackup,ledgerArray}=win.PIA_REVIEW_TEST;
(async()=>{
 await restoreBackup({text:async()=>JSON.stringify(backup)});
 assert.equal(state.records.length,1041);assert.equal(state.ledger.size,65);assert.equal(node('countExclude').textContent,'65');assert.equal(node('countNone').textContent,'976');
 assert.equal(state.records.find(x=>x.id==='P001').choice,'제외');assert.equal(state.records.find(x=>x.id==='P042').choice,'미선택');
 assert.equal(state.filtered.length,976);
 setChoice('P042','제외');assert.equal(state.ledger.size,66);assert.equal(state.filtered.length,975);
 undoLast();assert.equal(state.ledger.size,65);assert.equal(state.filtered.length,976);
 node('choiceFilter').value='';setChoice('P001','미선택');assert.equal(state.ledger.size,64);
 setChoice('P001','제외');assert.equal(state.ledger.size,65);
 const blob=win.PIAReviewExportXlsx.createWorkbook({records:state.records,ledger:ledgerArray()});
 assert(blob.size>20000); fs.writeFileSync(path.join(BASE,'test_js_generated.xlsx'),Buffer.from(await blob.arrayBuffer()));
 // Work's next workbook contains only remaining records: historical exclusions must survive.
 win.PIAReviewXlsx.parseSelectionXlsx=async()=>({records:backup.records.filter(x=>x.choice!=='제외').slice(0,5).map(x=>x.fields)});
 await importWorkbook({name:'WORK_2차.xlsx',arrayBuffer:async()=>new TextEncoder().encode('second-round').buffer});
 assert.equal(state.records.length,5);assert.equal(state.ledger.size,65);assert.equal(state.filtered.length,5);
 const blob2=win.PIAReviewExportXlsx.createWorkbook({records:state.records,ledger:ledgerArray()});
 fs.writeFileSync(path.join(BASE,'test_js_cycle2.xlsx'),Buffer.from(await blob2.arrayBuffer()));
 // excluded ID returns from Work: must remain excluded.
 win.PIAReviewXlsx.parseSelectionXlsx=async()=>({records:[backup.records[0].fields,backup.records[41].fields]});
 await importWorkbook({name:'WORK_3차.xlsx',arrayBuffer:async()=>new TextEncoder().encode('third-round').buffer});
 assert.equal(state.records.length,2);assert.equal(state.records.find(x=>x.id==='P001').choice,'제외');
 assert.equal(state.ledger.size,65);assert.equal(state.filtered.length,1);
 console.log('PASS: v1 backup 1041/65 migration; exclusion undo; cumulative 65 through Work rounds; reappearing excluded ID protected; xlsx export');
})().catch(e=>{console.error(e);process.exitCode=1})
