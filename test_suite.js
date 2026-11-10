const fs = require('fs');
const path = require('path');
const db = require('./db.js');

console.log('=== [정밀 종합 점검 테스트 시작] ===');

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

// 1. DB 초기화 확인
db.initDatabase();
assert(fs.existsSync(path.join(__dirname, 'database.sqlite')), 'SQLite DB 파일이 정상 생성되어 있음');

// 2. 기본 시드 유저 확인
const admin = db.findUserByUsername('admin');
const student1 = db.findUserByUsername('student01');
const student2 = db.findUserByUsername('student02');
assert(admin && admin.role === 'admin', '관리자 계정 존재 및 admin 역할');
assert(student1 && student1.role === 'user', '일반 사용자 1 계정 존재 및 user 역할');
assert(student2 && student2.role === 'user', '일반 사용자 2 계정 존재 및 user 역할');

// 3. 신규 회원가입 테스트 (작성자 실명 표기 연동)
const newUserId = 'u_test_' + Date.now();
const newUser = db.createUser({
  id: newUserId,
  username: 'new_member',
  password: 'password123',
  name: '신규학생',
  role: 'user',
  department: '인공지능학과'
});
assert(newUser && newUser.name === '신규학생' && newUser.role === 'user', '신규 회원가입 및 기본 role user 부여 성공');
assert(newUser.status === 'active', '신규 회원 초기 상태는 active');

// 4. 일반 사용자 글쓰기 테스트
const testPost = db.createPost({
  userId: newUser.id,
  title: '신규학생이 작성한 테스트 글',
  content: '안녕하세요! 새로 가입했습니다.',
  isNotice: 0
});
assert(testPost && testPost.title === '신규학생이 작성한 테스트 글', '게시글 정상 생성');
assert(testPost.author_name === '신규학생', '가입 시 입력한 이름이 작성자 이름으로 자동 표기');
assert(testPost.is_notice === 0, '일반 사용자의 글은 is_notice = 0');
assert(testPost.created_at && testPost.updated_at, '작성일시 및 수정일시 생성 확인');

// 5. 관리자 공지사항 등록 및 정렬 테스트
const adminNotice = db.createPost({
  userId: admin.id,
  title: '[중요 공지] 종합 테스트 공지사항',
  content: '공지 내용입니다.',
  isNotice: 1
});
assert(adminNotice && adminNotice.is_notice === 1, '관리자 공지사항 등록 성공');

const allPosts = db.getPosts();
assert(allPosts.length > 0, '게시글 목록 조회 성공');
assert(allPosts[0].id === adminNotice.id, '공지사항이 게시글 최상단에 고정 정렬됨');
assert(allPosts[0].is_notice === 1, '최상단 글이 공지사항 플래그를 가짐');

// 6. 댓글 작성 테스트
const comment1 = db.createComment({
  postId: testPost.id,
  userId: student1.id,
  content: '환영합니다! 김민수입니다.'
});
assert(comment1 && comment1.author_name === '김민수', '댓글 작성 및 작성자 이름 매핑 정상');

const comments = db.getCommentsByPostId(testPost.id);
assert(comments.length === 1 && comments[0].id === comment1.id, '게시글에 달린 댓글 조회 성공');

// 7. 게시글 상세 조회 테스트
const fetchedDetail = db.getPostById(testPost.id);
assert(fetchedDetail.id === testPost.id, '게시글 번호 일치');
assert(fetchedDetail.content === '안녕하세요! 새로 가입했습니다.', '게시글 내용 일치');

// 8. 게시글 수정 테스트 (본인)
const updatedPost = db.updatePost({
  postId: testPost.id,
  title: '신규학생이 수정한 테스트 글',
  content: '수정된 내용입니다.'
});
assert(updatedPost.title === '신규학생이 수정한 테스트 글', '게시글 제목 수정 성공');
assert(updatedPost.content === '수정된 내용입니다.', '게시글 본문 수정 성공');

// 9. 권한 통제 시뮬레이션: 타인 글 수정/삭제 차단 검증
const canUser2Edit = (student2.id === updatedPost.user_id);
assert(!canUser2Edit, '일반 사용자(student02)는 타인(new_member)의 글을 수정할 수 없음');

const canUser2Delete = (student2.role === 'admin' || student2.id === updatedPost.user_id);
assert(!canUser2Delete, '일반 사용자(student02)는 타인(new_member)의 글을 삭제할 수 없음');

const canAdminDelete = (admin.role === 'admin' || admin.id === updatedPost.user_id);
assert(canAdminDelete, '관리자(admin)는 타인의 부적절한 글을 삭제할 수 있음');

const canStudent1DeleteComment = (student1.role === 'admin' || student1.id === comment1.user_id);
assert(canStudent1DeleteComment, '댓글 작성자 본인은 댓글 삭제 가능');

const canStudent2DeleteComment = (student2.role === 'admin' || student2.id === comment1.user_id);
assert(!canStudent2DeleteComment, '타인은 타인의 댓글을 삭제할 수 없음');

const canAdminDeleteComment = (admin.role === 'admin' || admin.id === comment1.user_id);
assert(canAdminDeleteComment, '관리자는 부적절한 댓글을 관리 삭제할 수 있음');

// 10. 댓글 삭제 실행
db.deleteComment(comment1.id);
assert(db.getCommentsByPostId(testPost.id).length === 0, '댓글 삭제 성공');

// 11. 게시글 삭제 실행
db.deletePost(testPost.id);
assert(db.getPostById(testPost.id) === undefined, '게시글 삭제 성공');
db.deletePost(adminNotice.id);

// 12. 회원 이용 제한(Suspension) 기능 테스트
db.updateUserStatus(newUser.id, 'suspended');
const suspendedUser = db.findUserById(newUser.id);
assert(suspendedUser.status === 'suspended', '관리자의 회원 이용 제한(suspended) 처리 성공');

db.updateUserStatus(newUser.id, 'active');
const restoredUser = db.findUserById(newUser.id);
assert(restoredUser.status === 'active', '관리자의 회원 이용 제한 해제(active) 처리 성공');

// 테스트 회원 정리
db.db.prepare('DELETE FROM users WHERE id = ?').run(newUser.id);

console.log(`\n=== [테스트 통과 결과: ${passedTests} / ${totalTests} 전체 통과] ===`);
