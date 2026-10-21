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
 {name:'unreadable original date does not fabricate reply date',text:`참
@drt_CHRM
원글 본문
2026년 1월 16일 · 12:33 오전
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
  for(const p of result.slice(1)){ assert.equal(p.type,'reply',`${c.name}: missing reply`); if(c.name!=='two replies after first timestamp, no repeated heading'||!p.content.includes('첫 답글'))assert.equal(p.date,'',`${c.name}: reply must not inherit datetime`); assert(p.content.includes('본문')||p.content.includes('그리고'),`${c.name}: missing reply body`); }
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
console.log(`${cases.length} regression cases passed.`);
