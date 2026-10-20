# PIA v0.2.0

## Cloudflare Pages + D1 배포
1. ZIP의 **내용물 전체**를 GitHub 저장소 루트에 업로드합니다. `public/`, `functions/`, `schema.sql`이 모두 루트에 있어야 합니다.
2. Cloudflare Pages Git 연동: Root directory `/`, Build command 비움, Build output directory `public`.
3. Cloudflare > D1에서 DB를 생성합니다. D1 SQL 콘솔에 `schema.sql` 내용을 실행합니다.
4. Pages 프로젝트 > Settings > Bindings > D1 database 바인딩 추가: **Variable name `DB`**, 생성한 DB 선택.
5. Pages 프로젝트 > Settings > Variables and Secrets: **`ADMIN_PASSWORD`를 Secret**으로 설정합니다. 길고 고유한 비밀번호를 사용하세요.
6. Pages에서 새 배포(Retry deployment 또는 Git 커밋)를 실행합니다. `/admin.html`에 접속하여 로그인 후 계정과 게시물을 입력합니다.

**주의:** 공개 타임라인은 로그인 없이 조회 가능하며 관리자 API만 비밀번호 세션으로 보호됩니다. 공개할 권한이 없는 개인정보/비공개 대화는 등록하지 마세요. X 연동은 없습니다. 초기 데이터는 비어 있습니다. 이전 브라우저 localStorage 테스트 데이터는 자동 이전되지 않습니다.

## 변경 이력
- v0.2.0: 라이트 테마 기본, D1 DB, 관리자 로그인, 계정·게시물 CRUD, 원본 시간대 입력.
- v0.1.0: 로컬스토리지 시제품.
