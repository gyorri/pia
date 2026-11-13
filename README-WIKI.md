# PIA v0.3.40 — Cloudflare 관리자 생성 오류 긴급 수정

- **원인**: Cloudflare Workers의 PBKDF2 1회 호출 상한은 100,000회인데 v0.3.39가 120,000회를 요청하여 `/api/wiki/setup`이 HTTP 500을 반환했습니다.
- **조치**: `functions/_utils/wiki.js`의 반복 횟수를 100,000으로 변경했습니다. 최초 관리자 생성뿐 아니라 로그인, 멤버 생성, 비밀번호 변경 모두 동일 함수를 거칩니다.
- **적용**: `PIA_v0.3.40_PBKDF2_Fix_Patch.zip` 압축 해제 후 파일 경로 그대로 GitHub 저장소에 반영하고 Production 배포가 완료되면 첫 관리자 설정을 다시 시도하세요.
- **추가 Cloudflare 작업 없음**: 기존 `wiki_*` D1 테이블 4개를 다시 만들지 마세요. `WIKI_SETUP_KEY`, `WIKI_SESSION_SECRET`, `DB` 바인딩을 유지하세요. R2는 이미지 첨부 단계에서만 필요합니다.
- **확인**: 관리자 생성 후 D1 `SELECT COUNT(*) AS member_count FROM wiki_members;` 결과가 1 이상인지 확인하고, 로그아웃/로그인도 테스트하세요.
- **주의**: PBKDF2-SHA256 100,000회는 Workers의 플랫폼 상한을 준수하기 위한 단기 호환성 설정으로, 고위험 개인 자료를 보관할 서비스의 장기 보안 수준을 충족한다고 단정할 수 없습니다. 강한 비밀번호, 계정별 접근 제한, 로그인 시도 제한 등 추가 보호 조치도 고려하세요.
- **테스트**: 로컬 Node crypto는 Workers 100,000회 제한을 적용하지 않으므로, 회귀 테스트가 그 제한을 강제로 검사하도록 보완했습니다. 운영 환경 실사용 성공은 별도 확인이 필요합니다.

---

# PIA v0.3.39 — 모임용 비공개 위키 + 기존 X 아카이브

**적용 기준:** 사용자가 업로드한 `pia-main.zip`의 v0.3.38 전체 파일. 운영 환경의 현재 GitHub 코드나 DB 내용은 조회하지 않았습니다. **서버 배포나 실제 DB 마이그레이션은 실행하지 않았습니다.** 이 파일에는 가입자/게시물/사진 실데이터나 설정 비밀값이 없습니다.

## 구성

- `/` — **비공개 모임 위키 메인**. 로그인 전에는 자료 제목·내용을 조회할 수 없습니다.
- `/x.html` — 기존 X 형태 타임라인. 원래 `/`에 있던 화면·해시 경로를 `/x.html#/post/…`, `/x.html#/@…`, `/x.html#/search`로 이동했습니다.
- `/admin.html`, `/capture.html`, `/review.html`, `/import.html` — 기존 X 자료 관리자/일괄등록 작업실. 기존 DB와 연결 방식 유지.

### 위키 기능

- 테마별 폴더/하위 폴더 생성·이름 수정·빈 폴더 삭제.
- 문서 유형: 자유 정리 / 인물 관련 / X / 인스타그램 / 포스타입 / 신고·접수 / 대화 캡처 / 링크 모음.
- 내용 블록: 본문, 소제목, 인용, 원본 링크, 체크리스트, 구분선, 단일 사진, 다중 사진 갤러리. 블록 순서 위/아래 이동, 삭제 가능.
- 모바일 갤러리 또는 카메라 파일 첨부, PC 이미지 파일 선택/드롭/클립보드 붙여넣기, 이미지는 로그인 필요 API를 통해서만 제공.
- 원문 URL·날짜·태그·자료 상태(정리 중/확인 필요/출처 확인), 제목·본문·태그·링크 검색, 문서 링크 공유, 휴지통과 복원.
- 사용자별 계정(소유자/편집자/열람자), 소유자 멤버 생성·접근 중지, 본인 비밀번호 변경. **기존 X 관리자 비밀번호와 위키 계정은 별개**입니다.
- 수정 자동 저장(약 1.4초 후), 명시적 저장 버튼, 낙관적 버전 충돌 검사(다른 사람이 먼저 저장한 변경을 조용히 덮어쓰지 않음).

**중요:** 구글 문서 같은 *실시간 동시 편집, 댓글·멘션, 사진 편집/자동 익명화, 권한별 개별 문서 공개 범위, HTML·PDF·CSV 본문 가져오기*는 구현 범위가 아닙니다. 모든 위키 멤버는 기본적으로 모든 위키 문서를 볼 수 있습니다. **'출처 확인'은 그 출처 링크를 정리자가 확인했다는 상태 표시에 불과하며, 게시물의 주장이나 신고 결과가 사실임을 검증했다는 의미가 아닙니다.**

## 배포 시 필요한 설정 (필수)

1. **업데이트 전 백업**: 운영 GitHub 코드, D1(기존 X 데이터 포함), 기존 이미지 저장소/브라우저 백업 파일을 확보합니다. 운영 `main`에 업로드 ZIP보다 새로운 수정이 있다면 병합 후 진행합니다.
2. **D1 마이그레이션**: 기존 Cloudflare Pages 프로젝트의 `DB` D1 바인딩에 대해 **`migration-v0.3.39-wiki.sql`을 1회 적용**합니다. 이 파일은 새 `wiki_*` 테이블만 만듭니다. 예시(실제 DB 이름으로 교체): `npx wrangler d1 execute <D1_DATABASE_NAME> --remote --file=migration-v0.3.39-wiki.sql`.
3. **Cloudflare Pages 환경변수**: `WIKI_SESSION_SECRET`(길고 무작위인 비밀값), `WIKI_SETUP_KEY`(첫 위키 소유자 계정 설정용 길고 무작위인 비밀값)를 **암호화된 Secret**으로 설정합니다. 실제 값을 파일이나 저장소에 넣지 마세요. `ADMIN_PASSWORD`는 기존 X 관리자용으로 별도 유지합니다.
4. **R2 바인딩**: 비공개 R2 버킷을 생성해 Pages Functions에서 `WIKI_MEDIA`라는 이름으로 바인딩합니다. R2 퍼블릭 개발자 URL/커스텀 도메인을 켜지 않아야 개인 캡처가 우회 공개되지 않습니다. 이미지 최대 10MB/장; JPG, PNG, WebP, GIF 지원. iOS HEIC는 JPG로 변환해 올리세요.
5. **Pages 배포 후** `/` 접속 → `WIKI_SETUP_KEY`로 첫 소유자 계정 생성 → 멤버 관리에서 친구별 계정 생성 → 각자가 초기 비밀번호 변경. `WIKI_SETUP_KEY`는 첫 계정 생성 후 제거하는 것을 권장합니다.
6. **검증**: 로그아웃 상태에서 `/api/wiki/data` 및 `/api/wiki/assets/{id}`가 401인지, 일반 멤버가 X `/api/posts` 관리자 작업을 할 수 없는지, 업로드와 문서 검색/저장/복원, `/x.html`에서 기존 게시물/답글 링크가 정상인지 확인합니다.
7. **운영 보안**: 공개 페이지와 별개로 이 위키는 모임 계정으로 보호되지만 개인 캡처와 대화 기록을 공유하는 만큼 HTTPS, 장기 백업 정책, Cloudflare 접근·요청 제한, 비밀번호 관리, 이용자별 저장 책임, 삭제 요청 처리 정책을 마련하세요.

## 데이터 저장 구조

- `wiki_members` — 위키 전용 로그인 계정, salted PBKDF2-SHA256 비밀번호 해시, 활성/역할/세션 버전.
- `wiki_folders`, `wiki_docs` — 메뉴 및 블록 JSON 본문. X의 `accounts`/`posts` 테이블은 변경 없음.
- `wiki_assets` — 첨부 메타데이터. 실제 이미지 바이너리는 비공개 R2 `WIKI_MEDIA`에 저장.
- 이미지 API와 문서 API는 위키 세션을 매 요청마다 검사. **X의 `/api/data`는 기존과 같이 공개 타임라인용**으로 남습니다. 위키의 정보 비공개와 X 화면의 공개 범위는 별개의 문제입니다.

## 검증 범위

- `node --check`로 신규 JS/기존 X 앱/기존 API 문법을 검사했습니다.
- `tests/wiki.test.mjs`의 Node 내장 SQLite 기반 D1 모의 연동: 초기 설정, 인증, 멤버, 폴더, 문서, 갤러리 업로드, 검색, 충돌, 삭제·복원, 비밀번호 변경, 비로그인 접근 차단 통과.
- Playwright에서 화면 코드를 별도 DOM에 삽입하고 모의 API 응답으로 PC 1440px/모바일 390px 문서 표시, 편집, 자동 저장 동작 점검. 보안 정책으로 `localhost` 내비게이션은 차단되어 **실제 Cloudflare 배포 환경의 종단간 화면·R2·D1 바인딩은 확인하지 못했습니다**.
- 기존 Node 회귀 테스트는 `tests/`에 보존합니다. **기준 원본 v0.3.38에서도** `tests/review-quick-duplicate.test.cjs`는 `review-controls` 렌더링 순서 단언에 실패했습니다(원본 ZIP에서 동일 실패 재현). 신규 위키에 의한 회귀로 간주하지 않으며 이 테스트는 기존 선별 화면 수정 이력과 맞춰 별도 정비가 필요합니다. 나머지 기존 테스트는 통과했습니다. 실행: `for f in tests/*.cjs; do node "$f"; done` 및 `node tests/wiki.test.mjs`.

## 업데이트된 파일

`public/index.html` (위키 메인), `public/wiki.js`, `public/wiki.css`, `public/x.html`, `public/app.js`, `public/style.css`, `public/admin.html`, `public/review.html`, `public/capture.js`, `public/review.js`, `functions/api/[[path]].js`, `functions/_utils/wiki.js`, `migration-v0.3.39-wiki.sql`, `tests/wiki.test.mjs`, `README-WIKI.md`, `README.md`, `HISTORY.md`, `package.json`. 기존 파일은 나머지 모두 보존합니다.
