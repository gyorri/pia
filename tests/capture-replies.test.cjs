'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','public/capture.js'),'utf8');
const start=source.indexOf('const xDatePattern='),end=source.indexOf('function newItem',start);
assert(start>=0&&end>start,'parser functions accessible');
const run=vm.runInNewContext(`const charLimit=(s,n)=>String(s??'').slice(0,n); ${source.slice(start,end)}; parseCandidates;`,{},{timeout:2000});
const cases=[
 {name:'user OCR original with badly damaged reply heading',text:`< _ 게시하기

참@
@drt CHRM

씨발 꼬우면 느그가 웃긴트윗을 써
ㅋㅋㅋㅋ

너네들끼리 웃기라고 그럼 되잖아
왜자꾸 나를신경씀

2026년 01월 16일ㆍ12:33 오전ㆍ조회수 91회

5 마음에 들어요
62                          VJ

관련성이 가장 높은 HE v

28 @drt CHRM - 8A|

승  @drt CHRM 님에게 보내는 답
그리고 일론 개년아
내가 계정 2개에서 차단을 처갈겼는데 전
계정에다가 트윗을 띄워?
추천탐라 없애라고
제발`,expected:2},
 {name:'enhanced OCR with broken supplementary strings',text:`< _ 게시하기
참@
@drt CHRM

씨발 꼬우면 느그가 웃긴트윗을 M
EE EE]
너네들끼리 웃기라고 그럼 되잖아
왜자꾸 나를신경씀
2026년 01월 16일ㆍ12:33 오전ㆍ조회수 91회
5 마음에 들어요
62 2
관련성이 가장 높은 답글 Vv
#6 @drt CHRM - 84
@drt CHRM 님에게 보내는 답글
그리고 일론 개년아
내가 계정 2개에서 차단을 처갈겼는데 전
계정에다가 트윗을 띄워?
추천탐라 없애라고
제발
혀무
2401 신
회
}보지도
안느
ㄴㄴ`,expected:2},
 {name:'heading OCR missing but account+replyto intact',text:`참
@drt_CHRM
원글 본문입니다.
2026년 1월 16일 · 12:33 오전 · 조회수 91회
5 마음에 들어요
@other_user · 8시
@drt_CHRM 님에게 보내는 답글
둘째 글 본문입니다.
마지막 문장`,expected:2},
 {name:'heading and account missing, but replyto visible',text:`참
@drt_CHRM
원글 본문입니다.
2026년 1월 16일 · 12:33 오전 · 조회수 91회
5 마음에 들어요
==| !@#$
@drt_CHRM 님에게 보내는 답글
둘째 글 본문입니다.`,expected:2},
 {name:'single post, no replies',text:`참
@drt_CHRM
원글 본문입니다.
2026년 01월 16일ㆍ12:33 오전ㆍ조회수 91회
5 마음에 들어요`,expected:1},
 {name:'false positive: heading-like text is tweet content not a reply header',text:`참
@drt_CHRM
관련성이 가장 높은 답글
이라고 사람들이 말하지만 이건 원글 내용입니다.
2026년 01월 16일ㆍ12:33 오전ㆍ조회수 91회`,expected:1},
 {name:'false positive: normal text with broken heading after date but no reply-to cue',text:`참
@drt_CHRM
본문
2026년 01월 16일ㆍ12:33 오전ㆍ조회수 91회
관련성이 가장 높은 HE v
난 답글이 아님`,expected:1},
 {name:'two replies after first timestamp, no repeated heading',text:`참
@drt_CHRM
원글 본문
2026년 1월 16일 · 12:33 오전 · 조회수 91회
관련성이 가장 높은 답글
하나 @alice_1 · 8시
@drt_CHRM 님에게 보내는 답글
첫 답글 본문
2026년 1월 16일 · 2:00 오후 · 조회수 10회
둘 @bob_2 · 4시
@drt_CHRM 님에게 보내는 답글
두 번째 답글 본문`,expected:3},
 {name:'reply with date only keeps time unconfirmed',text:`참
@drt_CHRM
원글 본문
2026년 1월 16일 · 12:33 오전
관련성이 가장 높은 HE v
둘 @bob_2 · 4시
@drt_CHRM 님에게 보내는 답글
두 번째 답글 본문`,expected:2},
 {name:'original has only date (12:00 placeholder), no inherit',text:`참
@drt_CHRM
원글 본문
2026년 1월 16일
관련성이 가장 높은 HE v
둘 @bob_2 · 4시
@drt_CHRM 님에게 보내는 답글
두 번째 답글 본문`,expected:2}
];
for(const c of cases){
 const result=run(c.text);
 assert.equal(result.length,c.expected,`${c.name}: expected ${c.expected} posts, got ${result.length}, ${JSON.stringify(result)}`);
 if(c.expected>1){
  assert.equal(result[0].type,'original',`${c.name} first must be original`);
  for(const p of result.slice(1)){
   assert.equal(p.type,'reply',`${c.name}: missing reply`);
   if(c.name==='original has only date (12:00 placeholder), no inherit'){
    assert.equal(p.date,'',`${c.name}: cannot inherit unverified original clock`);
   }else if(c.name==='two replies after first timestamp, no repeated heading'&&p.content.includes('첫 답글')){
    assert.equal(p.date,'2026-01-16T14:00',`${c.name}: explicitly visible reply time wins`);
   }else if(c.name==='two replies after first timestamp, no repeated heading'&&p.content.includes('두 번째')){
    assert.equal(p.date,'2026-01-16T00:38',`${c.name}: matching parent +5 if no own clock`);
   }else{
    assert.equal(p.date,'2026-01-16T00:38',`${c.name}: reply +5 minute provisional date`);
    assert.equal(p.dateBasis,'parent-plus-5');
    assert.equal(p.dateReview,true);
   }
   assert(p.content.includes('본문')||p.content.includes('그리고'),`${c.name}: missing reply body`);
  }
  assert(!result[0].content.includes('그리고 일론'),`${c.name}: leaked reply into original`);
 }
 if(c.name==='false positive: heading-like text is tweet content not a reply header') assert(result[0].content.includes('관련성이 가장 높은 답글'), 'ordinary tweet content was discarded');
 if(c.name==='user OCR original with badly damaged reply heading'){
  assert.equal(result[0].date,'2026-01-16T00:33');
  assert.equal(result[0].handle,'');
  assert.equal(result[1].handle,'');
  assert(!result[1].content.includes('관련성이'), 'reply heading leaked');
  assert(!result[1].content.includes('보내는 답'), 'reply label leaked');
  assert(result[1].content.includes('제발'),'last reply line missing');
 }
 console.log(`PASS ${c.name}: ${result.map(x=>`${x.type}:${x.content.slice(0,20).replace(/\n/g,' ')}${x.date?`:${x.date}`:''}`).join(' | ')}`);
}

const extraCases=[
 {name:'mismatched addressee does not inherit',text:`원글이름
@first_user
본문 글입니다.
2026년 1월 16일 · 12:33 오전 · 조회수 1회
관련성이 가장 높은 답글
답글이름 @reply_user · 8시
@other_user 님에게 보내는 답글
답글 내용입니다.`, expected:''},
 {name:'explicit reply clock is respected',text:`원글이름
@first_user
본문 글입니다.
2026년 1월 16일 · 12:33 오전 · 조회수 1회
관련성이 가장 높은 답글
답글이름 @reply_user · 8시
@first_user 님에게 보내는 답글
답글 내용입니다.
2026년 1월 16일 · 9:22 오전 · 조회수 1회`,expected:'2026-01-16T09:22'},
 {name:'reply date only matching the original day inherits +5',text:`원글이름
@first_user
본문 글입니다.
2026년 1월 16일 · 12:33 오전 · 조회수 1회
관련성이 가장 높은 답글
답글이름 @reply_user · 8시
@first_user 님에게 보내는 답글
답글 내용입니다.
2026년 1월 16일`,expected:'2026-01-16T00:38'},
 {name:'reply date only different day not overwritten',text:`원글이름
@first_user
본문 글입니다.
2026년 1월 16일 · 12:33 오전 · 조회수 1회
관련성이 가장 높은 답글
답글이름 @reply_user · 8시
@first_user 님에게 보내는 답글
답글 내용입니다.
2026년 1월 17일`,expected:'2026-01-17T12:00'},
 {name:'midnight rollover applies',text:`원글이름
@first_user
본문 글입니다.
2026년 1월 16일 · 11:58 오후 · 조회수 1회
관련성이 가장 높은 답글
답글이름 @reply_user · 8시
@first_user 님에게 보내는 답글
답글 내용입니다.`,expected:'2026-01-17T00:03'}
];
for(const c of extraCases){
 const got=run(c.text);
 assert.equal(got.length,2,c.name+': expected 2 candidates');
 assert.equal(got[1].date,c.expected,c.name+': incorrect inherited time');
 assert.equal(got[1].dateReview,true,c.name+': review flag must stay on');
 console.log('PASS',c.name,got[1].date||'(blank)');
}
assert.equal(run(`참
@drt_CHRM
원글입니다
2026년 1월 16일
관련성이 가장 높은 답글
답글 @abc_1 · 8시
@drt_CHRM 님에게 보내는 답글
둘째 본문`)[1].date,'','date-only parent must not invent a precise time');
const testFns=vm.runInNewContext(`const message=()=>{};const state={db:{accounts:[],posts:[]}};const getPostById=id=>state.db.posts.find(p=>p.id===id);const getAccountByHandle=()=>null;const getAccountById=()=>null;${source.slice(source.indexOf('function updateItemField('),source.indexOf('async function createAccount('))};updateItemField;`,{});
const estimated={type:'reply',decision:'pending',date:'2026-01-16T00:38',dateBasis:'parent-plus-5',dateReview:true,allowDistinct:false};
testFns(estimated,'dateReview',false);assert.equal(estimated.dateReview,true,'cannot uncheck unconfirmed +5 flag');
testFns(estimated,'date','2026-01-16T00:39');assert.equal(estimated.dateBasis,'manual','manual edit must disarm auto-inheritance');
console.log('PASS estimated flag cannot be silently confirmed; manual date edit opts out');

console.log(`${cases.length+extraCases.length} regression cases passed.`);
