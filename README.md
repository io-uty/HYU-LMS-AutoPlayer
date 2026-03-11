# HY-Play
Hanyang University LMS 자동 강의 재생 크롬 확장프로그램

## 프로젝트 소개
HY-Play는 한양대학교 LMS에서 수강해야 하는 온라인 강의를 보다 편리하게 수강할 수 있도록 돕는 Chrome Extension입니다.

강의 목록을 정리하고 강의가 끝나면 자동으로 다음 강의로 넘어가도록 하여 사용자가 매번 클릭하지 않아도 연속적으로 강의를 수강할 수 있도록 돕습니다.

## 주요 기능

- 📚 강의 목록 자동 정리
- ▶️ 강의 자동 재생
- ⏭️ 강의 종료 후 다음 강의 자동 이동
- 🖱️ 반복적인 클릭 없이 연속 강의 수강

## 기술 스택

- JavaScript
- HTML
- Chrome Extension API
- DOM Manipulation

## 프로젝트 구조
HY-Play
├ manifest.json
├ content.js
├ background.js
├ popup.html
└ README.md

## 설치 방법

1. 프로젝트 다운로드
   git clone https://github.com/username/HY-Play.git
3. 크롬 확장프로그램 페이지 접속
   chrome://extensions

3. 개발자 모드 활성화

4. "압축해제된 확장 프로그램 로드" 클릭

5. 프로젝트 폴더 선택

## 개발 동기

타 대학 공식 iOS 앱을 관리하며 사용자 오류를 수정하고 업데이트 및 배포를 담당했던 경험이 있습니다.  
특히 모바일 출입카드 앱을 혼자 설계부터 배포까지 진행하며 개발 과정에서 자동화와 효율성의 중요성을 크게 느꼈습니다.

이러한 경험을 바탕으로 반복적인 강의 수강 과정을 자동화하고자 본 프로젝트를 진행하게 되었습니다.

## 향후 개선 계획

- 재생률 버그 수정
- 강의 리스트 드래그 정렬 기능
- 강의 진도 자동 체크
- UI 개선
- 강의 재생 속도 조절 기능

## 👩‍💻 Author

박수지
