const fs = require('fs');
const path = require('path');
const db = require('./db.js');

console.log('=== [다중 게시판 시스템 종합 점검 테스트 시작] ===');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log('  [PASS] ' + message);
  } else {
    console.error('  [FAIL] ' + message);
    throw new Error('Test failed: ' + message);
  }
}

// 1. DB 초기화 및 기본 다중 게시판 로드 확인
db.initDatabase();
const boards = db.getAllBoards();
assert(boards.length >= 5, '기본 다중 게시판 5개 이상 로드 (공지, 자유, 질문, 정보, 익명 등)');

const noticeBoard = boards.find(b => b.id === 'notice');
const freeBoard = boards.find(b => b.id === 'free');
const qnaBoard = boards.find(b => b.id === 'qna');
assert(noticeBoard && noticeBoard.name === '공지사항', '공지사항 게시판 존재');
assert(freeBoard && freeBoard.name === '자유게시판', '자유게시판 존재');
assert(qnaBoard && qnaBoard.name === '질문게시판', '질문게시판 존재');

// 2. 관리자 계정 및 일반 계정 준비
const admin = db.findUserByUsername('admin');
const student1 = db.findUserByUsername('student01');
const student2 = db.findUserByUsername('student02');
assert(admin && admin.role === 'admin', '관리자 계정 확인');
assert(student1 && student1.role === 'user', '일반 사용자 계정 확인');

// 3. 관리자 신규 게시판 생성 테스트 (ID, 이름, 설명)
const customBoardId = 'seminar_board';
const newBoard = db.createBoard({
  id: customBoardId,
  name: '세미나 및 특강',
  description: '학과 초청 특강 및 학술 세미나 공지'
});
assert(newBoard && newBoard.id === customBoardId, '새 게시판 생성 성공 (ID 저장)');
assert(newBoard.name === '세미나 및 특강', '새 게시판 이름 저장');
assert(newBoard.description === '학과 초청 특강 및 학술 세미나 공지', '새 게시판 설명 저장');

// 4. 관리자 게시판 수정 테스트 (이름 및 설명 변경)
const updatedBoard = db.updateBoard({
  id: customBoardId,
  name: '최신 AI 세미나 및 워크숍',
  description: 'AI 특강 안내로 업데이트'
});
assert(updatedBoard.name === '최신 AI 세미나 및 워크숍', '게시판 이름 수정 성공');
assert(updatedBoard.description === 'AI 특강 안내로 업데이트', '게시판 설명 수정 성공');

// 5. 게시판별 게시글 독립성 검증 (필수 조건)
// - notice 게시판에 공지글 작성
// - free 게시판에 자유글 작성
// - seminar 게시판에 세미나글 작성
const postNotice = db.createPost({
  boardId: 'notice',
  userId: admin.id,
  title: '2학기 학사일정 공지',
  content: '학사일정 안내',
  isNotice: 1
});
const postFree = db.createPost({
  boardId: 'free',
  userId: student1.id,
  title: '주말 풋살 모임 구합니다',
  content: '일요일 오후에 같이 차요',
  isNotice: 0
});
const postSeminar = db.createPost({
  boardId: customBoardId,
  userId: admin.id,
  title: '생성형 AI 초청 세미나',
  content: 'IT관 301호 14시',
  isNotice: 0
});

// 각각의 게시판별로 조회하여 다른 게시판의 글이 섞이지 않는지 엄격하게 검증
const noticePosts = db.getPosts('notice');
const freePosts = db.getPosts('free');
const seminarPosts = db.getPosts(customBoardId);

assert(noticePosts.some(p => p.id === postNotice.id), 'notice 게시판에 공지글 존재');
assert(!noticePosts.some(p => p.id === postFree.id), '★ notice 게시판에 free 게시글이 나타나지 않음 (독립성 확인)');
assert(!noticePosts.some(p => p.id === postSeminar.id), '★ notice 게시판에 seminar 게시글이 나타나지 않음 (독립성 확인)');

assert(freePosts.some(p => p.id === postFree.id), 'free 게시판에 자유글 존재');
assert(!freePosts.some(p => p.id === postNotice.id), '★ free 게시판에 notice 게시글이 나타나지 않음 (독립성 확인)');
assert(!freePosts.some(p => p.id === postSeminar.id), '★ free 게시판에 seminar 게시글이 나타나지 않음 (독립성 확인)');

assert(seminarPosts.some(p => p.id === postSeminar.id), 'seminar 게시판에 세미나글 존재');
assert(!seminarPosts.some(p => p.id === postFree.id), '★ seminar 게시판에 free 게시글이 나타나지 않음 (독립성 확인)');

// 6. 댓글 작성 및 게시판 소속 연계 검증
const comment = db.createComment({
  postId: postFree.id,
  userId: student2.id,
  content: '저도 풋살 참가합니다!'
});
assert(comment && comment.author_name === '이영희', '다중 게시판 환경에서도 댓글 정상 작성');

const postDetail = db.getPostById(postFree.id);
assert(postDetail.board_id === 'free' && postDetail.board_name === '자유게시판', '게시글 상세 조회 시 소속 게시판 ID/이름 바인딩');

// 7. 게시판 삭제 및 종속 게시글 연쇄 삭제 (CASCADE) 검증
db.deleteBoard(customBoardId);
assert(db.getBoardById(customBoardId) === undefined, '게시판 삭제 성공');
assert(db.getPostById(postSeminar.id) === undefined, '게시판 삭제 시 해당 게시판의 게시글도 안전하게 연쇄 삭제');

// 테스트 글 정리
db.deleteComment(comment.id);
db.deletePost(postNotice.id);
db.deletePost(postFree.id);

console.log(`\n=== [다중 게시판 테스트 결과: ${passedTests} / ${totalTests} 전체 통과] ===`);
