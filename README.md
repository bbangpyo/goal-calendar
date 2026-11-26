# 목표 캘린더

반복 목표를 정해 두고 체크하면 캘린더에 날짜별 달성률이 표시되는 할 일 앱이에요.
아이폰 홈 화면에 추가해서 앱처럼 쓸 수 있어요.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html` | 앱 전체 (화면, 기능, 애니메이션) |
| `manifest.webmanifest` | 홈 화면에 추가할 때 쓰는 앱 이름과 아이콘 정보 |
| `sw.js` | 인터넷이 없어도 앱이 열리게 해 줘요 |
| `sync.js` | 로그인과 기기 연동 (Firebase) |
| `firebase-config.js` | 내 Firebase 프로젝트 연결 정보. `null` 이면 연동이 꺼져요 |
| `firestore.rules` | 본인 기록만 읽고 쓰게 하는 보안 규칙 (Firebase 콘솔에 붙여 넣어요) |
| `icons/` | 앱 아이콘 |

## 1. GitHub에 올리기 (웹사이트에서)

1. github.com에 로그인한 다음 오른쪽 위 **+** 를 누르고 **New repository** 를 골라요.
2. Repository name을 `goal-calendar` 로 적고, **Public** 을 고른 다음 **Create repository** 를 눌러요.
   (무료 계정은 Public 저장소만 GitHub Pages를 쓸 수 있어요. 코드는 공개되지만, 목표 기록은 이 저장소에 올라가지 않아요.)
3. 새 저장소 화면에서 **uploading an existing file** 링크를 눌러요.
4. 이 폴더 안의 파일을 모두 끌어다 놓아요: `index.html`, `sync.js`, `firebase-config.js`, `firestore.rules`, `manifest.webmanifest`, `sw.js`, `README.md`, 그리고 `icons` 폴더째로.
5. 아래 **Commit changes** 를 눌러요.

## 2. GitHub Pages 켜기

1. 저장소의 **Settings** → 왼쪽 메뉴 **Pages** 로 가요.
2. **Source** 를 `Deploy from a branch` 로, **Branch** 를 `main` / `/ (root)` 로 고르고 **Save** 를 눌러요.
3. 1~2분 기다리면 같은 화면 위쪽에 주소가 나와요: `https://<내 아이디>.github.io/goal-calendar/`

## 3. 아이폰 홈 화면에 추가

1. 아이폰 **Safari** 로 위 주소를 열어요. (다른 브라우저 말고 Safari로 여세요.)
2. 아래쪽 **공유 버튼(□↑)** → **홈 화면에 추가** → **추가** 를 눌러요.
3. 이제 홈 화면의 초록 아이콘으로 앱처럼 열려요.

## 4. 컴퓨터와 폰 연동 (Firebase)

1. https://console.firebase.google.com 에서 **프로젝트 만들기** (요금제는 무료 Spark 그대로).
2. **Authentication** → 시작하기 → **이메일/비밀번호** 사용 설정.
3. **Authentication → Users → 사용자 추가** 로 내 이메일과 비밀번호를 등록해요.
4. **Authentication → 설정 → 사용자 작업** 에서 **만들기(가입) 사용 설정** 을 꺼요. 다른 사람이 가입하지 못하게 해요.
5. **Firestore Database** → 데이터베이스 만들기 → **프로덕션 모드**, 위치는 서울(`asia-northeast3`).
6. Firestore의 **규칙** 탭에 `firestore.rules` 내용을 붙여 넣고 **게시**.
7. **프로젝트 설정 → 내 앱 → 웹(`</>`)** 으로 앱을 등록하고, 나오는 `firebaseConfig` 값을 `firebase-config.js` 에 넣어요.
8. 컴퓨터와 폰에서 각각 **반복 설정 탭 → 기기 연동** 에 로그인해요.

## 고친 내용을 반영하려면

`index.html` 등을 고친 뒤 GitHub 저장소에 같은 이름으로 다시 올리면 돼요. 폰에서 앱을 껐다 켜면 새 버전이 열려요.
`sw.js` 맨 위 `goal-calendar-v1` 의 숫자를 올려 주면 저장된 옛 버전이 확실히 지워져요.

## 알아 둘 점

- 로그인하지 않으면 기록은 **그 기기 안에만** 저장돼요. 로그인하면 구글 Firebase에도 저장돼요. Safari에서 연 페이지와 홈 화면 앱은 저장 공간이 서로 다를 수 있어요. 그러니 로그인하지 않을 때는 홈 화면 앱에서만 쓰세요.
- 폰을 바꾸거나 앱을 지우기 전에는 **반복 설정 탭 → 백업 파일 저장** 으로 백업해 두세요. 새 폰에서 **백업 불러오기** 를 누르면 그대로 옮겨져요.
- 예전에 Claude 아티팩트에서 쓰던 기록은 저장소가 달라서 이 앱으로 자동으로 넘어오지 않아요.
