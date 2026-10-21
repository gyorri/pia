'use strict';
// PIA v0.3.33 no-dependency regression tests for reused DB originals.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','public','capture.js'),'utf8');
const start=source.indexOf('const norm='),end=source.indexOf('function ocrDiffSummary',start);
assert(start>0&&end>start,'matching functions exist');
const accounts=[{id:'a1',name:'참',handle:'drt_CHRM'},{id:'a2',name:'다른 작성자',handle:'other'}];
const body='a'.repeat(100);
const posts=[
 {id:'exact',account_id:'a1',parent_id:null,content:body,posted_at:'2026-01-16T00:33:00+09:00',date_needs_review:false},
 {id:'ninety',account_id:'a1',parent_id:null,content:'a'.repeat(90)+'b'.repeat(10),posted_at:'2026-01-16T00:35:00+09:00',date_needs_review:0},
 {id:'eighty-nine',account_id:'a1',parent_id:null,content:'a'.repeat(89)+'b'.repeat(11),posted_at:'2026-01-16T00:36:00+09:00',date_needs_review:false},
 {id:'different-author',account_id:'a2',parent_id:null,content:body,posted_at:'2026-01-16T00:33:00+09:00',date_needs_review:false},
 {id:'reply-not-original',account_id:'a1',parent_id:'exact',content:body,posted_at:'2026-01-16T00:40:00+09:00',date_needs_review:false},
 {id:'unconfirmed-time',account_id:'a1',parent_id:null,content:'a'.repeat(95)+'c'.repeat(5),posted_at:'2026-01-16T12:00:00+09:00',date_needs_review:true}
];
const state={db:{accounts,posts},items:[]};
const f=vm.runInNewContext(`${source.slice(start,end)}; ({reusableOriginalHits,linkedOriginalsForReply,xAddFiveMinutesToStoredPost,duplicateHits,similarBody});`,{state},{timeout:5000});
function sample(overrides={}){return {id:'c1',type:'original',content:body,accountId:'a1',handle:'drt_CHRM',imageId:'i1',decision:'pending',...overrides}}
const matches=f.reusableOriginalHits(sample());
assert.equal(matches.some(x=>x.post.id==='exact'),true,'100% suggested');
assert.equal(matches.some(x=>x.post.id==='ninety'),true,'90% suggested');
assert.equal(matches.some(x=>x.post.id==='eighty-nine'),false,'89% not suggested');
assert.equal(matches.some(x=>x.post.id==='different-author'),false,'different author not suggested');
assert.equal(matches.some(x=>x.post.id==='reply-not-original'),false,'existing reply not offered as original');
assert.equal(matches.every(x=>x.score>=.9),true);
assert.equal(f.reusableOriginalHits(sample({accountId:'a2',handle:'other'})).every(x=>x.post.account_id==='a2'),true);
assert.equal(f.reusableOriginalHits(sample({accountId:'',handle:'unknown'})).length,0,'unknown account cannot suggest existing original');
assert.equal(f.reusableOriginalHits(sample({type:'reply'})).length,0,'only an OCR original can be reused');
state.items=[sample({decision:'linked',linkedPostId:'exact'}),{id:'c2',type:'reply',imageId:'i1',parentId:'',decision:'pending'},
 sample({id:'c3',imageId:'i2',decision:'linked',linkedPostId:'ninety'})];
assert.equal(f.linkedOriginalsForReply(state.items[1]).length,1,'only linked originals from same image are shown');
assert.equal(f.linkedOriginalsForReply(state.items[1])[0].post.id,'exact');
assert.equal(f.xAddFiveMinutesToStoredPost(posts[0]),'2026-01-16T00:38','confirmed parent +5');
assert.equal(f.xAddFiveMinutesToStoredPost(posts[5]),'','unconfirmed parent is not a clock source');
assert.equal(f.duplicateHits(sample()).some(x=>x.other?.decision==='linked'),false,'linked OCR original is not treated as new duplicate');
// All string similarity figures are **text** similarity, never OCR confidence.
assert(Math.abs(f.similarBody(body,'a'.repeat(90)+'b'.repeat(10))-.90)<.0001);
assert(Math.abs(f.similarBody(body,'a'.repeat(89)+'b'.repeat(11))-.89)<.0001);
console.log('PASS v0.3.33: 90/89 threshold, same account, only DB originals, cross-image isolation, +5 review, linked state');
