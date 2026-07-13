# YouTube FactCheck

유튜브 링크 → **일반 요약** → **팩트체크(자동+수정)** → **유형별 보고서** → 인포그래픽 → 저장·검색·공유

## 흐름

1. **요약** — 영상 내용을 일반적인 방법으로 요약
2. **팩트체크** — 요약 포인트 자동 가이드 + 수동 수정
3. **보고서** (헤더: 제목 / 채널 / 링크 / 작성일)
   - **H 역사**: 배경·원인 → 핵심사건 → 결과·영향
   - **S 주식**: 현황 → 근거·지표 → 결론·리스크
   - **C 교양**: 핵심메시지 → 실천·주의
   - **P 정치/시사**: 사안 본질 → 대립·쟁점 → 전망·관전포인트
4. **인포그래픽** + **저장 / 검색 / 공유**(이메일, 카톡)

## 스크립트(자막) 우선순위

요약은 **영상 스크립트**를 최우선으로 사용합니다.

1. 사용자가 붙여넣은 스크립트
2. 유튜브 공식 자막 (`youtube-transcript`)
3. 유튜브 자동생성 자막 (timedtext / captionTracks)
4. **yt-dlp** 자동자막 (선택 설치) — 음성을 텍스트로 변환
5. 제목·설명·챕터만 (품질 제한)

자막이 없으면 **요약 시작 전** 경고가 표시됩니다. 스크립트를 붙여넣거나, 설명·챕터만으로 계속할 수 있습니다.

### yt-dlp (선택)

자막 API로 텍스트를 못 가져올 때 음성→자막 변환을 시도합니다.

```bash
# Windows (winget 예시)
winget install yt-dlp

# 또는 pip
pip install yt-dlp
```

## 시작

```bash
npm install
npm run dev
```

http://localhost:3000

### 선택: OpenAI

`.env.local`에 `OPENAI_API_KEY`를 설정하면 요약·팩트체크 가이드 품질이 향상됩니다. 없으면 규칙 기반으로 동작합니다.

## 배포 (GitHub + Vercel)

```bash
# 1) GitHub 원격 저장소 연결 후 푸시
git remote add origin https://github.com/<USER>/youtube-factcheck.git
git push -u origin master

# 2) Vercel 배포 (프로젝트명 예: builder)
npx vercel login
npx vercel --prod --name builder
```

Vercel 서버리스에서는 영상 데이터가 `/tmp`에 저장되어 **재배포·재시작 시 초기될 수 있습니다**.

