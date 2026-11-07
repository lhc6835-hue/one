# 리듬 문지기 (RHYTHM GATE)

내 음악 파일을 올리면 브라우저가 곡을 분석해서 박자에 맞는 채보를 만들어 주는 **원탭 리듬 게임**이에요.
노트가 사방에서 가운데 코어로 날아오고, 판정 링에 닿는 순간 화면 아무 데나 탭(또는 클릭, 아무 키)하면 돼요.

- 서버 없이 브라우저 안에서 다 처리해요. 곡 파일은 어디에도 업로드되지 않아요.
- 빌드하면 `dist/index.html` 파일 하나로 나와요. 더블클릭해서 바로 열 수 있어요.
- 이펙트는 [pixelfx](https://github.com/patch-gg/pixelfx)(MIT)의 코어와 이펙트 13종을 그대로 쓰고,
  같은 규약으로 이 게임 전용 이펙트 6종을 새로 만들었어요.

## 실행

```bash
npm install
npm run build      # dist/index.html 생성
npm run dev        # http://localhost:5173 (저장하면 자동 재빌드)
```

## 게임 방법

| | |
|---|---|
| 탭 | 화면 탭 · 마우스 클릭 · 아무 키 |
| 일시정지 | `Esc` 또는 오른쪽 아래 버튼 |
| 판정 | PERFECT ±45ms · GREAT ±90ms · GOOD ±135ms |
| 노트 색 | 청록 = 정박, 분홍 = 반박, 연두 = 16분, **금색** = 다운비트 강타 |
| FEVER | 곡에서 가장 센 구간. 오로라가 뜨고, 불꽃놀이가 터지고, HP 회복이 2배예요 |
| 랭크 | S+ ≥ 980,000 · S ≥ 950,000 · A ≥ 900,000 · B ≥ 800,000 · C ≥ 700,000 |

결과 화면에 평균 타이밍 오차가 나와요. 버튼 한 번으로 오프셋을 보정할 수 있어요.
블루투스 이어폰처럼 지연이 큰 환경이면 설정에서 직접 조절해도 돼요.

## 곡 분석은 이렇게 해요 (`src/audio/analyze.js`)

1. **디코딩 → 22,050Hz 모노**: `OfflineAudioContext`로 리샘플링해요.
2. **온셋 강도**: STFT(창 1024, hop 256)를 돌리고 로그 스펙트럼의 *spectral flux*를 구해요.
   저역·중역·고역 flux도 따로 저장해서 강세와 노트 방향을 정할 때 써요.
3. **템포**: 온셋 자기상관에 120BPM 중심의 로그-가우시안 사전분포를 곱해서 골라요.
   결과가 75~165BPM 밖이면 반 배 또는 두 배 템포 후보와 비교해서 옮겨요.
4. **비트 추적**: Ellis(2007)의 동적 계획법을 써요.
5. **박자 격자 맞춤**: 템포가 일정한 곡은 DP 비트에 `t0 + k·P` 직선을 강건 회귀로 맞추고, 그 격자를 비트로 써요.
   그래서 엇박만 나오는 인트로에서 추적기가 반 박 밀려도 정박으로 돌아오고, 프레임 양자화 지터도 없어져요.
   격자가 잘 안 맞는 곡(라이브 녹음 등)은 이웃 비트 회귀로 지터만 펴요.
6. **다운비트**: 4박 위상 가운데 킥(저역) 에너지가 가장 센 위상을 골라요.
7. **피버 구간**: 비트별 에너지를 Otsu 문턱으로 나누고, 16박 넘게 이어지는 센 구간을 피버로 잡아요.

합성 데모 곡(128 / 96 / 174 BPM)으로 검증해 보니 비트 위치 오차는 최대 12ms 안쪽이었어요.

## 채보 생성 (`src/audio/chart.js`)

- 정박을 뼈대로 깔고, 난이도가 오를수록 반박·16분 자리 중 **실제로 소리가 있는 곳**에만 노트를 더해요.
- 세기는 주변 8박 대비 상대값으로 판단해요. 그래서 조용한 구간에도 그 구간 나름의 강세에 노트가 붙어요.
- 피버 구간은 문턱이 낮아져서 노트가 더 촘촘해요.
- 방향은 12방향이고, 마디마다 패턴(쓸기, 지그재그, 반대편, 나선, 점프, 진자)을 골라 흐름을 만들어요.
- 같은 곡은 시드가 같아서 언제나 같은 채보가 나와요. 기록 경쟁이 가능해요.

## 연출에 쓴 pixelfx 이펙트

| 상황 | 이펙트 |
|---|---|
| 시작 카운트다운 | `ui/countdown` |
| PERFECT | `pickups/collect-burst` + 자체 `noteBurst` |
| GREAT | `impacts/hit-spark` |
| 금색 노트 | `impacts/crit-hit` + `impacts/parry` |
| MISS | `lightning/zap-hit`(붉은 팔레트) + 자체 `coreCrack` |
| 콤보 25 / 50 단위 | `ui/combo-counter` + `arcane/mana-burst` |
| 피버 진입 | 자체 `feverBanner` + `explosions/plasma-explosion` |
| 피버 중 다운비트 | `explosions/firework-burst` |
| 피버 · 결과 배경 | `weather/aurora` |
| 타이틀 배경 | `weather/shooting-stars` |
| 결과 | `ui/confetti`, 자체 `rankStamp` |
| 판정 글자 · 탭 물결 | 자체 `judgePop`, `tapRipple` |

자체 이펙트(`src/game/fx-custom.js`)도 pixelfx의 `docs/AUTHORING.md` 규약을 따라 만들었어요.
`meta`와 `draw(p, t, o)` 또는 `create(o)` 구조이고, 로컬 좌표를 쓰고, 원샷은 끝날 때 아무것도 남기지 않고,
`Math.random` 대신 시드 Rng를 써요.

화면은 짧은 변이 약 250px인 픽셀 프레임에 그린 다음 정수배로 키워요.
pixelfx의 빛 버퍼만 따로 흐리게 만들어 더하는 블룸, 스캔라인, 비네트를 얹었어요.
프레임 처리 시간이 계속 길어지면 무거운 연출을 자동으로 줄여요.

## 구조

```
index.html              화면 마크업 (빌드 때 CSS·JS를 인라인)
src/main.js             화면 흐름, 업로드, 입력, 저장(최고 기록·설정)
src/audio/              fft · analyze(곡 분석) · chart(채보) · demo(데모 곡 합성)
src/game/stage.js       렌더링, 오디오 시계 동기화, 판정, 점수, 이펙트 연출
src/game/fx-custom.js   pixelfx 규약으로 만든 게임 전용 이펙트
src/game/rank-badge.js  결과 카드의 랭크 도장
src/vendor/pixelfx/     pixelfx 코어와 사용한 이펙트 (MIT, LICENSE·NOTICE 포함)
tools/build.mjs         esbuild 번들 → 단일 HTML
```

## 라이선스 · 크레딧

- pixelfx © 2026 Patch, Hugo Duprez: MIT (`src/vendor/pixelfx/LICENSE`, `NOTICE.md`)
- 폰트: Black Han Sans, Noto Sans KR, Press Start 2P (Google Fonts, OFL)
