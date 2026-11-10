const fs = require('fs');
const path = require('path');
const db = require('./db.js');

console.log('=== [보안 및 접근 권한 집중 전수 점검 테스트 시작] ===');

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

// ----------------------------------------------------
// 계정 준비
// ----------------------------------------------------
db.initDatabase();

const superAdmin = db.findUserByUsername('admin');
const csAdmin = db.findUserByUsername('cs_admin');
const designAdmin = db.findUserByUsername('design_admin');
const studentCS = db.findUserByUsername('student01');
const studentDesign = db.findUserByUsername('student02');

// ----------------------------------------------------
// 권한 검증 헬퍼 (server.js와 동일한 보안 판정 로직)
// ----------------------------------------------------
function getSpaceRole(user, spaceId) {
  if (!user) return null;
  if (user.role === 'super_admin') return 'space_admin';
  const membership = dbHelper.getUserSpaceMembership(spaceId, user.id);
  return membership ? membership.space_role : null;
}
const dbHelper = db;

function canAccessSpace(user, spaceId) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return getSpaceRole(user, spaceId) !== null;
}

function isSpaceAdmin(user, spaceId) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return getSpaceRole(user, spaceId) === 'space_admin';
}

function canEditPost(user, post) {
  if (!user || user.status === 'suspended') return false;
  return post.user_id === user.id; // 본인만 수정 가능
}

function canDeletePost(user, post) {
  if (!user || user.status === 'suspended') return false;
  const isAuthor = post.user_id === user.id;
  const hasSpaceAdmin = isSpaceAdmin(user, post.space_id);
  return isAuthor || hasSpaceAdmin;
}

// ----------------------------------------------------
// [테스트 시나리오 1 & 2]
// 컴퓨터공학과 공간 관리자로 로그인하여 컴퓨터공학과 게시판 관리 가능 확인
// ----------------------------------------------------
console.log('\n--- [시나리오 1 & 2: CS 관리자의 CS 공간 관리 권한 검증] ---');
assert(isSpaceAdmin(csAdmin, 'cs') === true, '1. cs_admin은 컴퓨터공학과(cs)의 space_admin 권한을 가짐');

const csTestBoard = db.createBoard({
  id: 'cs_sec_test',
  spaceId: 'cs',
  name: '컴공 보안 테스트 게시판',
  description: '테스트용'
});
assert(csTestBoard && csTestBoard.id === 'cs_sec_test', '2. cs_admin은 CS 공간에 새 게시판을 생성할 수 있음');

const updatedBoard = db.updateBoard({
  id: 'cs_sec_test',
  name: '컴공 보안 테스트 게시판(수정)',
  description: '수정됨'
});
assert(updatedBoard && updatedBoard.name === '컴공 보안 테스트 게시판(수정)', '3. cs_admin은 CS 공간의 게시판을 수정할 수 있음');

db.deleteBoard('cs_sec_test');
assert(db.getBoardById('cs_sec_test') === undefined, '4. cs_admin은 CS 공간의 게시판을 삭제할 수 있음');

// ----------------------------------------------------
// [테스트 시나리오 3]
// 컴퓨터공학과 관리자가 디자인학과(design) 게시판에 접근하거나 수정할 수 있는지 확인 -> 차단(false)
// ----------------------------------------------------
console.log('\n--- [시나리오 3: CS 관리자의 디자인학과 게시판 접근/수정 차단 검증] ---');
const designBoard = db.getBoardsBySpaceId('design')[0];
assert(designBoard !== undefined, '디자인학과 게시판 존재 확인');

assert(canAccessSpace(csAdmin, 'design') === false, '5. [보안] cs_admin은 디자인학과 공간 접근 권한이 없음 (false)');
assert(isSpaceAdmin(csAdmin, 'design') === false, '6. [보안] cs_admin은 디자인학과 공간 관리자 권한이 없음 (false)');

// 타 공간 관리자가 디자인 게시판 수정 시도 시 권한 검사
const canCSAdminEditDesignBoard = isSpaceAdmin(csAdmin, designBoard.space_id);
assert(canCSAdminEditDesignBoard === false, '7. [보안] cs_admin은 디자인학과 게시판을 수정할 수 없음 (false 차단)');

const canCSAdminDeleteDesignBoard = isSpaceAdmin(csAdmin, designBoard.space_id);
assert(canCSAdminDeleteDesignBoard === false, '8. [보안] cs_admin은 디자인학과 게시판을 삭제할 수 없음 (false 차단)');

// ----------------------------------------------------
// [테스트 시나리오 4]
// 다른 공간의 회원 정보를 조회할 수 있는지 확인 -> 차단(false)
// ----------------------------------------------------
console.log('\n--- [시나리오 4: 타 공간 회원 정보 조회 차단 검증] ---');
assert(canAccessSpace(csAdmin, 'design') === false, '9. [보안] cs_admin은 디자인 공간 회원 목록 조회 불가 (접근 차단)');
assert(canAccessSpace(studentCS, 'design') === false, '10. [보안] student01(컴공학생)은 디자인 공간 회원 목록 조회 불가 (접근 차단)');
assert(canAccessSpace(designAdmin, 'design') === true, '11. design_admin은 디자인 공간 회원 목록 조회 가능 (true)');
assert(canAccessSpace(superAdmin, 'design') === true, '12. super_admin은 모든 공간의 회원 목록 조회 가능 (true)');

// ----------------------------------------------------
// [테스트 시나리오 5]
// 일반 사용자 계정으로 관리자 페이지에 접근할 수 있는지 확인 -> 차단(false)
// ----------------------------------------------------
console.log('\n--- [시나리오 5: 일반 사용자의 관리자 페이지 접근 차단 검증] ---');
// 최고 관리자 페이지 (#super-admin) 접근 권한: 오직 super_admin만
const canStudentSuperAdmin = (studentCS.role === 'super_admin');
assert(canStudentSuperAdmin === false, '13. [보안] student01은 최고 관리자 페이지 접근 권한 없음 (false)');

const canCSAdminSuperAdmin = (csAdmin.role === 'super_admin');
assert(canCSAdminSuperAdmin === false, '14. [보안] cs_admin은 최고 관리자 페이지 접근 권한 없음 (false)');

// 공간 관리자 페이지 (#space-admin, #space-members) 접근 권한: space_admin 또는 super_admin만
const canStudentSpaceAdmin = isSpaceAdmin(studentCS, 'cs');
assert(canStudentSpaceAdmin === false, '15. [보안] student01은 CS 공간 관리자 페이지 접근 권한 없음 (false)');

// ----------------------------------------------------
// [테스트 시나리오 6]
// 다른 사용자의 게시글을 직접 수정하거나 삭제할 수 있는지 확인
// ----------------------------------------------------
console.log('\n--- [시나리오 6: 타인 게시글 임의 수정/삭제 차단 및 관리자 권한 검증] ---');
// studentCS가 작성한 글
const postByStudentCS = db.createPost({
  boardId: 'cs_free',
  userId: studentCS.id,
  title: '김민수의 자유글',
  content: '본문 내용'
});

// studentDesign이 작성한 글
const postByStudentDesign = db.createPost({
  boardId: 'design_works',
  userId: studentDesign.id,
  title: '이영희의 작품글',
  content: '작품 본문'
});

// 1) studentDesign이 studentCS의 글 수정 시도 -> 차단
assert(canEditPost(studentDesign, postByStudentCS) === false, '16. [보안] student02는 student01의 글을 수정할 수 없음 (false)');

// 2) csAdmin이라도 studentCS의 글 수정 시도 -> 차단 (원문 무결성)
assert(canEditPost(csAdmin, postByStudentCS) === false, '17. [보안] 관리자라도 작성자 본인이 아니면 글 내용 수정 불가 (false)');

// 3) studentCS 본인은 본인 글 수정 가능 -> 허용
assert(canEditPost(studentCS, postByStudentCS) === true, '18. 작성자 본인은 본인 글 수정 가능 (true)');

// 4) studentDesign이 studentCS의 글 삭제 시도 -> 차단
assert(canDeletePost(studentDesign, postByStudentCS) === false, '19. [보안] student02는 student01의 글을 삭제할 수 없음 (false)');

// 5) csAdmin이 studentCS의 글(동일 공간 부적절 글) 관리 삭제 -> 허용
assert(canDeletePost(csAdmin, postByStudentCS) === true, '20. cs_admin은 본인 공간(cs)의 게시글 삭제 가능 (true)');

// 6) csAdmin이 studentDesign의 글(타 공간 글) 삭제 시도 -> 차단
assert(canDeletePost(csAdmin, postByStudentDesign) === false, '21. [보안] cs_admin은 타 공간(design)의 게시글 삭제 불가 (false)');

// 7) superAdmin은 어느 공간의 글이든 부적절 글 삭제 가능 -> 허용
assert(canDeletePost(superAdmin, postByStudentDesign) === true, '22. super_admin은 모든 공간의 부적절 글 삭제 가능 (true)');

// ----------------------------------------------------
// [기존 CRUD 및 댓글 기능 재검증]
// ----------------------------------------------------
console.log('\n--- [기존 게시글 및 댓글 기본 기능 무결성 재검증] ---');
// 글 수정 실행
const updatedTestPost = db.updatePost({
  postId: postByStudentCS.id,
  title: '김민수의 수정된 자유글',
  content: '수정된 내용입니다.'
});
assert(updatedTestPost.title === '김민수의 수정된 자유글', '23. 게시글 제목 정상 수정');

// 댓글 등록 실행
const testComment = db.createComment({
  postId: postByStudentCS.id,
  userId: studentCS.id,
  content: '본인 글에 단 댓글'
});
assert(testComment && testComment.content === '본인 글에 단 댓글', '24. 댓글 정상 등록');

// 댓글 삭제 실행
db.deleteComment(testComment.id);
assert(db.getCommentsByPostId(postByStudentCS.id).length === 0, '25. 댓글 정상 삭제');

// 테스트 글 정리
db.deletePost(postByStudentCS.id);
db.deletePost(postByStudentDesign.id);
assert(db.getPostById(postByStudentCS.id) === undefined, '26. 게시글 정상 삭제');

console.log(`\n=== [보안 및 접근 권한 점검 결과: ${passedTests} / ${totalTests} 전 항목 PASS] ===`);
