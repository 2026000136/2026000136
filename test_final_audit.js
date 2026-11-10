const fs = require('fs');
const path = require('path');
const db = require('./db.js');

console.log('====================================================');
console.log('   복합 다중 게시판 시스템 13대 핵심 기능 전수 검증');
console.log('====================================================');

let totalTests = 0;
let passedTests = 0;
const resultsLog = [];

function recordTest(num, name, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${num}. ${name}`);
    resultsLog.push({ num, name, status: 'PASS', details });
  } else {
    console.error(`[FAIL] ${num}. ${name} - ${details}`);
    resultsLog.push({ num, name, status: 'FAIL', details });
    throw new Error(`Test failed: ${num}. ${name}`);
  }
}

// DB 초기화
db.initDatabase();

// ----------------------------------------------------
// [1. 회원가입 및 로그인 테스트]
// ----------------------------------------------------
const testUser1 = db.createUser({
  id: 'u_final_test_1',
  username: 'final_user_01',
  password: 'pwd',
  name: '최종검증학생',
  role: 'user',
  department: '컴퓨터공학과'
});
const foundUser = db.findUserByUsername('final_user_01');
recordTest('1', '회원가입 및 로그인', 
  foundUser && foundUser.password === 'pwd' && foundUser.name === '최종검증학생',
  'DB users 테이블에 실제 데이터 영구 저장 및 비밀번호 일치 확인'
);

// ----------------------------------------------------
// [2. 게시글 작성 및 조회 테스트]
// ----------------------------------------------------
// 컴공 공간에 회원 등록 후 글 작성
db.addSpaceMember('cs', testUser1.id, 'member');

const createdPost = db.createPost({
  boardId: 'cs_free',
  userId: testUser1.id,
  title: '최종 점검 테스트 게시글입니다',
  content: '본문 내용이 데이터베이스에 정상 기록되는지 확인합니다.',
  isNotice: 0
});
const fetchedPost = db.getPostById(createdPost.id);
recordTest('2', '게시글 작성 및 조회',
  fetchedPost && fetchedPost.title === '최종 점검 테스트 게시글입니다' && fetchedPost.author_name === '최종검증학생',
  '게시글 번호, 제목, 본문, 작성자 실명이 DB posts에 기록되고 상세 조회됨'
);

// ----------------------------------------------------
// [3. 게시글 수정 및 삭제 테스트]
// ----------------------------------------------------
const updatedPost = db.updatePost({
  postId: createdPost.id,
  title: '수정 완료된 제목입니다',
  content: '수정 완료된 본문 내용입니다.'
});
const isUpdated = updatedPost.title === '수정 완료된 제목입니다';

db.deletePost(createdPost.id);
const isDeleted = db.getPostById(createdPost.id) === undefined;

recordTest('3', '게시글 수정 및 삭제',
  isUpdated && isDeleted,
  '게시글 제목/본문 수정 및 DB posts에서 정상 삭제 확인'
);

// ----------------------------------------------------
// [4. 댓글 작성 및 삭제 테스트]
// ----------------------------------------------------
// 새 글 등록 후 댓글 테스트
const postForComment = db.createPost({
  boardId: 'cs_free',
  userId: testUser1.id,
  title: '댓글 검증용 게시글',
  content: '댓글 테스트'
});

const comment = db.createComment({
  postId: postForComment.id,
  userId: testUser1.id,
  content: '테스트 댓글입니다.'
});
const commentsList = db.getCommentsByPostId(postForComment.id);
const commentCreated = commentsList.length === 1 && commentsList[0].content === '테스트 댓글입니다.';

db.deleteComment(comment.id);
const commentDeleted = db.getCommentsByPostId(postForComment.id).length === 0;

recordTest('4', '댓글 작성 및 삭제',
  commentCreated && commentDeleted,
  '댓글이 post_id에 종속되어 DB comments에 기록되고 삭제 시 제거됨'
);

// ----------------------------------------------------
// [5. 게시판 생성 및 삭제 테스트]
// ----------------------------------------------------
const newBoard = db.createBoard({
  id: 'cs_final_board',
  spaceId: 'cs',
  name: '최종 검증 게시판',
  description: '테스트용 신규 게시판'
});
const boardCreated = db.getBoardById('cs_final_board') !== undefined;

db.deleteBoard('cs_final_board');
const boardDeleted = db.getBoardById('cs_final_board') === undefined;

recordTest('5', '게시판 생성 및 삭제',
  boardCreated && boardDeleted,
  '공간 종속 게시판의 생성 및 삭제 정상 작동'
);

// ----------------------------------------------------
// [6. 게시판별 게시글 분리 테스트]
// ----------------------------------------------------
const postNotice = db.createPost({
  boardId: 'cs_notice',
  userId: 'u_mgr_cs',
  title: '공지사항 게시판 글',
  content: '공지'
});
const postFree = db.createPost({
  boardId: 'cs_free',
  userId: testUser1.id,
  title: '자유게시판 글',
  content: '자유'
});

const noticeList = db.getPostsBySpace('cs', 'cs_notice');
const freeList = db.getPostsBySpace('cs', 'cs_free');

const noticeOnlyHasNotice = noticeList.some(p => p.id === postNotice.id) && !noticeList.some(p => p.id === postFree.id);
const freeOnlyHasFree = freeList.some(p => p.id === postFree.id) && !freeList.some(p => p.id === postNotice.id);

recordTest('6', '게시판별 게시글 분리',
  noticeOnlyHasNotice && freeOnlyHasFree,
  '하나의 게시판에 작성한 글이 다른 게시판에 노출되지 않고 완벽 분리됨'
);

// ----------------------------------------------------
// [7. 운영 공간 생성 및 삭제 테스트]
// ----------------------------------------------------
const tempSpace = db.createSpace({
  id: 'temp_bio_dept',
  name: '생명공학과',
  description: '생명공학 연구 소통 공간',
  managerId: null
});
const spaceCreated = db.getSpaceById('temp_bio_dept') !== undefined;

db.deleteSpace('temp_bio_dept');
const spaceDeleted = db.getSpaceById('temp_bio_dept') === undefined;

recordTest('7', '운영 공간 생성 및 삭제',
  spaceCreated && spaceDeleted,
  '최고 관리자의 운영 공간 생성 및 DB spaces에서 정상 삭제 확인'
);

// ----------------------------------------------------
// [8. 공간별 게시판 관리 테스트]
// ----------------------------------------------------
const csBoards = db.getBoardsBySpaceId('cs');
const designBoards = db.getBoardsBySpaceId('design');
const bizBoards = db.getBoardsBySpaceId('biz');

recordTest('8', '공간별 게시판 관리',
  csBoards.length >= 3 && designBoards.length >= 3 && bizBoards.length >= 3,
  `컴공(${csBoards.length}개), 디자인(${designBoards.length}개), 경영(${bizBoards.length}개)이 각각 독립적인 게시판 목록을 보유`
);

// ----------------------------------------------------
// [9. 공간별 사용자 관리 테스트]
// ----------------------------------------------------
db.addSpaceMember('cs', testUser1.id, 'space_admin');
const updatedRole = db.getUserSpaceMembership('cs', testUser1.id).space_role;

db.removeSpaceMember('cs', testUser1.id);
const removedMember = db.getUserSpaceMembership('cs', testUser1.id) === undefined;

recordTest('9', '공간별 사용자 관리',
  updatedRole === 'space_admin' && removedMember,
  '공간에 사용자 등록, 역할 승격(space_admin) 및 방출 정상 동작'
);

// ----------------------------------------------------
// [10. 최고 관리자 권한 테스트]
// ----------------------------------------------------
const superAdminUser = db.findUserByUsername('admin');
const superAdminCanAccessAll = db.getUserAccessibleSpaces(superAdminUser.id).length === db.getAllSpaces().length;

recordTest('10', '최고 관리자 권한',
  superAdminUser.role === 'super_admin' && superAdminCanAccessAll,
  '최고 관리자는 시스템 내 모든 운영 공간에 무제한 접근 및 총괄 관리 권한 보유'
);

// ----------------------------------------------------
// [11. 공간 관리자 권한 테스트]
// ----------------------------------------------------
const csAdminUser = db.findUserByUsername('cs_admin');
const csAdminRoleInCS = db.getUserSpaceMembership('cs', csAdminUser.id)?.space_role;
const csAdminRoleInDesign = db.getUserSpaceMembership('design', csAdminUser.id)?.space_role;

recordTest('11', '공간 관리자 권한',
  csAdminRoleInCS === 'space_admin' && csAdminRoleInDesign === undefined,
  '컴공 관리자는 본인 공간만 관리 권한을 가지며 타 공간(디자인)의 관리 권한이 없음'
);

// ----------------------------------------------------
// [12. 일반 사용자 권한 테스트]
// ----------------------------------------------------
const studentCS = db.findUserByUsername('student01');
const studentCSIsAdmin = studentCS.role === 'super_admin';
const studentCSInCS = db.getUserSpaceMembership('cs', studentCS.id)?.space_role;

recordTest('12', '일반 사용자 권한',
  !studentCSIsAdmin && studentCSInCS === 'member',
  '일반 사용자는 관리자 권한이 없으며 소속 공간의 일반 회원으로 활동'
);

// ----------------------------------------------------
// [13. 운영 공간 간 데이터 접근 차단 테스트]
// ----------------------------------------------------
const csPosts = db.getPostsBySpace('cs');
const designPosts = db.getPostsBySpace('design');

const designTitles = designPosts.map(p => p.title);
let noCrossLeak = true;
for (const p of csPosts) {
  if (designTitles.includes(p.title)) {
    noCrossLeak = false;
    break;
  }
}

// studentCS가 디자인 공간에 소속되어 있는지 확인 (소속 없음이어야 함)
const studentCSInDesign = db.getUserSpaceMembership('design', studentCS.id);

recordTest('13', '운영 공간 간 데이터 접근 차단',
  noCrossLeak && studentCSInDesign === undefined,
  '공간 ID가 다른 게시글이 서로의 목록에 절대 누출되지 않으며 타 공간 접근 차단'
);

// 테스트 데이터 정리
db.deletePost(postForComment.id);
db.deletePost(postNotice.id);
db.deletePost(postFree.id);
db.db.prepare('DELETE FROM users WHERE id = ?').run(testUser1.id);

console.log('====================================================');
console.log(`  최종 테스트 완료: ${passedTests} / ${totalTests} 항목 통과 (100%)`);
console.log('====================================================');
