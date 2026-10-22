const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const nodes=new Map();const modes=['quick','groups','timeline'].map(mode=>({dataset:{mode},attrs:{},classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this.attrs[k]=v},addEventListener(){}}));
function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',checked:false,indeterminate:false,disabled:false,hidden:false,options:[{value:''},{value:'active'},{value:'미선택'},{value:'제외'},{value:'author'},{value:'capture'}],dataset:{},style:{},addEventListener(){},classList:{add(){},remove(){},toggle(){}},before(){},remove(){},scrollIntoView(){},focus(){},querySelector(){return null}});return nodes.get(id)}
const listeners={};const doc={getElementById:node,querySelectorAll(q){return q==='[data-mode]'?modes:[]},addEventListener(type,fn){listeners[type]=fn},createElement(){return {innerHTML:'',className:'',id:'',remove(){},click(){}}},body:{append(){}}};
const win={PIA_REVIEW_TEST:null,PIAReviewXlsx:{parseSelectionXlsx:async()=>({records:[]})},PIAReviewExportXlsx:{createWorkbook(){return new Blob(['unused'])}}};
const ctx={document:doc,window:win,setTimeout(){return 1},clearTimeout(){},confirm:()=>true,URL:{revokeObjectURL(){},createObjectURL(){return 'blob:fake'}},fetch:async()=>({ok:true,json:async()=>({authenticated:false,configured:true})}),crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},console,encodeURIComponent,Blob,TextEncoder,Uint8Array,Uint32Array,Intl};
for(const id of ['query','authorFilter','auditFilter','typeFilter','duplicateFilter','choiceFilter'])node(id).value='';node('choiceFilter').value='active';node('sortFilter').value='original';node('pageSize').value='20';node('groupBy').value='author';
vm.runInNewContext(fs.readFileSync(path.join(base,'public/review.js'),'utf8'),ctx,{filename:'review.js'});
const {state,restoreBackup,setMode,setGroupBy,togglePending,markCurrentPage,markGroup,excludePending,undoLast,moveCursor}=win.PIA_REVIEW_TEST;
const entries=Array.from({length:1041},(_,i)=>{const id='P'+String(i+1).padStart(3,'0');return {id,choice:i<65?'제외':'미선택',memo:'',fields:{'게시물 ID':id,'사용자 최종 선택':i<65?'제외':'미선택','사용자 메모':'','검수 결과':'정상','작성자':i<500?'작가A':'작가B','아이디':i<500?'@alpha':'@beta','게시물 유형(검수안)':'post','본문 전체(검수안)':'안전 테스트 '+id,'원본 캡처 파일명':i<700?'shot1.png':'shot2.png'}}});
(async()=>{
 await restoreBackup({text:async()=>JSON.stringify({format:'pia-review-v1',fingerprint:'fixture',source:'synthetic.xlsx',records:entries})});
 assert.equal(state.ledger.size,65);assert.equal(state.filtered.length,976);assert.equal(state.mode,'quick');assert.equal(state.pageIds.length,20);
 assert.equal(node('batchToolbar').hidden,false);assert.equal(node('bulkExclude').hidden,true);
 const first=state.pageIds[0],last=state.pageIds[3];togglePending(first);togglePending(last,true);
 assert.equal(state.pending.size,4,'Shift range should check exactly four visible rows');assert.equal(state.byId.get(first).choice,'미선택','temporary checks cannot exclude');
 excludePending();assert.equal(state.ledger.size,69);assert.equal(state.pending.size,0);assert.equal(state.byId.get(first).choice,'제외');
 undoLast();assert.equal(state.ledger.size,65);assert.equal(state.byId.get(first).choice,'미선택');
 setMode('groups');assert.equal(node('groupSettings').hidden,false);assert.equal(state.filtered.length,976);
 assert.equal(state.pageGroups.length>0,true);markGroup(0);assert.equal(state.pending.size,20);assert.equal(state.ledger.size,65);
 setGroupBy('capture');assert.equal(state.pending.size,0);assert.equal(node('groupBy').value,'capture');assert(state.pageGroups.length>0);
 markCurrentPage(true);assert.equal(state.pending.size,20);
 // Page switches and filter changes discard temporary marked IDs.
 state.currentPage=1;state.pending.clear();state.anchorId='';state.cursorId='';win.PIA_REVIEW_TEST.refresh();assert.equal(state.pending.size,0);
 setMode('timeline');assert.equal(node('batchToolbar').hidden,true);assert.equal(node('bulkExclude').hidden,false);
 setMode('quick');assert.equal(node('batchToolbar').hidden,false);moveCursor(1);assert(state.cursorId);
 const current=state.cursorId;assert.equal(state.records.find(r=>r.id===current).choice,'미선택');
 const e={key:'x',ctrlKey:false,altKey:false,metaKey:false,target:{closest(){return false}},preventDefault(){}};
 // Key handler deliberately requires workspace visible and no image modal.
 node('workspace').hidden=false;node('imageModal').hidden=true;listeners.keydown(e);
 assert.equal(state.records.find(r=>r.id===current).choice,'제외');undoLast();assert.equal(state.ledger.size,65);
 node('query').value='P077';state.pending.add('P076');state.currentPage=2;listeners.keydown({...e,key:'j',target:{closest(){return true}}});assert.equal(state.currentPage,2);
 console.log('PASS: 1041/65 backup; quick/author/capture/timeline; Shift selection; check != exclude; bulk exclude + undo; no hidden group selection; keyboard X');
})().catch(e=>{console.error(e);process.exitCode=1});
