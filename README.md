# PIA v0.2.1 관리자 UI 패치

기존 v0.2.0 소스에 **변경 파일만** 덮어쓰는 패치입니다. GitHub 저장소 최상위에 ZIP의 `public/` 폴더 구조 그대로 업로드하세요.

- `public/admin.html` 교체
- `public/admin.js` 교체
- `public/admin.css` 신규 추가
- `README.md`, `HISTORY.md` 최신화

Cloudflare Pages 출력 디렉터리는 기존대로 `public`입니다. D1 SQL 및 API 코드는 변경하지 않습니다. 관리자 접속은 `/admin.html`입니다.

## 입력 순서
1. 관리자 로그인 후 계정 닉네임·아이디를 저장합니다.
2. 게시물 작성자를 선택하고 원본 날짜·시간과 시간대를 입력합니다.
3. 답글은 게시물 유형을 '다른 게시물에 답글'로 선택한 후 원문을 지정합니다.
4. 등록 목록에서 수정·삭제할 수 있습니다.

## 참고
프로필 사진은 URL 입력 방식이며 이미지 업로드 기능은 아직 없습니다. 원본 날짜·시간은 지정한 UTC 오프셋으로 DB에 저장됩니다. DB 바인딩 `DB`와 Secret `ADMIN_PASSWORD`는 기존 설정을 유지합니다.
