# X-style Archive Test

비공식 수동 입력 타임라인 아카이브 테스트. 실제 X와 연결되지 않습니다.

## 빠른 배포
1. ZIP을 풀고 GitHub 새 저장소에 **내용물 전체**를 업로드합니다.
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → GitHub 저장소 선택.
3. Framework preset: None, Build command: 비움, Build output directory: `public`.
4. Deploy 후 생성된 `*.pages.dev` 주소로 접속합니다.

## 현재 기능
- X 스타일 반응형 다크 UI, 계정 타임라인, 게시물 상세, 답글 스레드, 계정 프로필 이동
- 브라우저 localStorage에 테스트 계정/게시물 등록 (해당 브라우저에만 저장)
- 관리자 데모 화면: `/admin.html` (인증 없음; 공개 배포 시 개인정보/민감 정보 입력 금지)

## 다음 단계
공용 데이터 저장은 Cloudflare D1 + Pages Functions 및 인증 적용 필요. 현재는 D1 미연결이며 다른 기기와 데이터가 공유되지 않습니다.
