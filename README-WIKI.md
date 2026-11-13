# PIA 위키 사용 및 설정 안내 (v0.3.46)

## 구성

- `/`: 비공개 위키 메인 (테마별 메뉴, 문서·링크·이미지, 검색, 휴지통)
- `/x.html`: 기존 X 아카이브; 게시물·계정 등 X 기능은 이전과 동일
- 사이트 **공통 입장 비밀번호 하나**로 위키 읽기 및 작성이 가능합니다. 개인별 아이디는 없습니다. X 관리자 작업은 기존 `ADMIN_PASSWORD`가 별도로 필요합니다.
- 메인에 긴 소개 문구를 두지 않고, **자료실 / 새 문서 / 검색 / 테마별 자료실 / 최근 자료**만 보여줍니다.

## 신규 KV 이미지 저장소 연결 (카드 등록 없는 Free 플랜)

1. Cloudflare Dashboard → **Storage & Databases → KV** → 새 KV namespace 생성 (예: `pia-wiki-images`).
2. **Workers & Pages → [PIA Pages 프로젝트] → Settings → Bindings → Add → KV namespace**를 선택합니다.
3. 변수 이름을 정확히 **`WIKI_MEDIA_KV`** 로 입력하고 위에서 만든 namespace를 선택합니다. **Secret이 아니며 D1 바인딩도 아닙니다.**
4. 변경을 Production에 적용하고 Pages Production 배포를 다시 실행합니다. `WIKI_MEDIA_KV`를 만든 뒤 배포되지 않았다면 앱에서 아직 인식되지 않을 수 있습니다.
5. 사이트 입장 후 사진 첨부를 확인합니다. `/api/wiki/session`의 응답에서 `mediaReady: true`, `mediaBackend: "kv"`로 확인할 수 있습니다. 로그인하지 않은 상태에서는 `/api/wiki/assets/{id}`가 401이어야 합니다.

**R2 연결이나 새 결제수단 등록은 이 경로에서 필요 없습니다.** 기존 Secret (`PIA_ACCESS_PASSWORD`, `WIKI_SESSION_SECRET`, `ADMIN_PASSWORD`) 및 D1 `DB` 바인딩은 유지하세요. **D1 SQL 신규 실행도 필요 없습니다.**

## 이미지 저장 방식과 한도

- JPG, PNG, WebP, GIF를 **장당 최대 10MiB**, 1회 선택 최대 15장까지 업로드합니다. iPhone HEIC 파일은 JPG/PNG로 변환해 올리세요.
- 새 파일은 KV에 `kv/wiki/{문서ID}/{파일ID}.{확장자}` 키로 저장, 문서 및 이미지 메타데이터는 기존 D1 `wiki_*` 테이블에 저장합니다.
- 저장 파일을 외부 공개 주소로 열지 않고, `/api/wiki/assets/{id}`에서 사이트 입장 쿠키를 서버에서 확인 후 전송합니다.
- 이전 R2로 저장한 이미지가 있는 경우에만 구 `WIKI_MEDIA` R2 바인딩을 유지해야 이전 이미지를 볼 수 있습니다. KV로 자동 이전하거나 삭제하지 않습니다.
- KV는 다른 지역에서 새로운 값을 읽기까지 60초 이상 지연될 수 있습니다. 새 이미지 로딩이 실패하면 화면은 제한적으로 재시도합니다. 영구적으로 누락되면 페이지를 반복 새로고침하는 대신 저장소 연결·할당량·로그를 점검해야 합니다.
- Workers KV Free 제한(Cloudflare 2026-10-30 문서): **1GB 전체 저장 / 읽기 100,000회·일 / 서로 다른 키 쓰기 1,000회·일 / 값당 최대 25MiB**. 소수 사용자 사용이라도 저장 용량이나 작업 수가 초과되면 실패할 수 있습니다.
- 문서는 휴지통 복원이 가능하므로 이미지 파일은 문서 삭제만으로 KV에서 즉시 제거되지 않습니다. 정리/백업은 별도 기능이 필요합니다.

## 배포 방법

- 이미 v0.3.45를 운영 중이라면 `PIA_v0.3.46_KV_Photos_Patch.zip` 내부 파일을 저장소 루트에 **같은 경로로 덮어쓴 다음 GitHub에 커밋**하세요.
- 운영 저장소가 v0.3.45 이후 별도 변경되었다면 무작정 덮어쓰지 말고 변경점 비교 후 적용하세요.
- Cloudflare 배포 성공 후 Chrome `Ctrl+Shift+R`로 새로고침합니다.
- `functions/_utils/wiki.js`, `public/wiki.js`, `public/wiki.css`, `public/index.html`가 함께 배포되어야 합니다.
- 테스트: `node tests/wiki-kv.test.mjs`, `node tests/wiki.test.mjs`, `node tests/wiki-gate-integration.test.mjs`, `node tests/wiki-no-loop.test.mjs`.
- 실제 Cloudflare Production·계정 설정·실제 KV 대역은 로컬 테스트로 대체할 수 없습니다. 배포 후 사진 업로드와 새로고침 조회를 직접 확인하세요.

## 개인정보와 보안

- 비공개 인물·SNS·대화 캡처에는 다른 사람의 개인정보가 들어갈 수 있습니다. 적법한 수집·공유 권한을 확인하고 식별정보를 가리세요.
- 공통 비밀번호를 아는 사람은 **전체 위키 자료를 열람·수정·삭제할 수 있습니다**. 개인별 권한·수정자 추적 기능은 없습니다.
- 비밀번호를 변경하면 이전 로그인 쿠키가 무효화됩니다. 개인정보가 담긴 자료를 계속 보관할 경우 백업과 노출 위험 관리가 필요합니다.
- Pages Functions 요청 한도에 대한 **Fail closed** 설정과 인증 시도 제한도 검토하세요.

이전 릴리스 내역은 `HISTORY.md`에 기록되어 있습니다.
