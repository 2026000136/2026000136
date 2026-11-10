const fs = require('fs');
const path = require('path');
const db = require('./db.js');

console.log('=== [복합 다중 운영 공간 시스템 종합 점검 테스트 시작] ===');

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

// 2. 최고 관리자 및 공간 관리자/학생 계정 확인
const superAdmin = db.findUserByUsername('admin');
const csAdmin = db.findUserByUsername('cs_admin');
const designAdmin = db.findUserByUsername('design_admin');
const studentCS = db.findUserByUsername('student01');
const studentDesign = db.findUserByUsername('student02');

assert(superAdmin && superAdmin.role === 'super_admin', '최고 관리자 계정(admin) super_admin 권한 확인');
assert(csAdmin && csAdmin.username === 'cs_admin', '컴공 공간 관리자 계정 확인');
assert(designAdmin && designAdmin.username === 'design_admin', '디자인 공간 관리자 계정 확인');
assert(studentCS && studentCS.username === 'student01', '컴공 학생 계정 확인');
assert(studentDesign && studentDesign.username === 'student02', '디자인 학생 계정 확인');

// 3. 운영 공간(Spaces) 관리 검증
const allSpaces = db.getAllSpaces();
assert(allSpaces.length >= 3, '최소 3개 이상의 운영 공간 존재 (컴퓨터공학과, 디자인학과, 경영학과)');

const csSpace = allSpaces.find(s => s.id === 'cs');
const designSpace = allSpaces.find(s => s.id === 'design');
assert(csSpace && csSpace.name === '컴퓨터공학과' && csSpace.manager_id === csAdmin.id, '컴공 공간 정보 및 담당 관리자 정상 매핑');
assert(designSpace && designSpace.name === '디자인학과' && designSpace.manager_id === designAdmin.id, '디자인 공간 정보 및 담당 관리자 정상 매핑');

// 4. 공간별 독립 게시판 구조 검증
const csBoards = db.getBoardsBySpaceId('cs');
const designBoards = db.getBoardsBySpaceId('design');
assert(csBoards.length >= 3, '컴퓨터공학과 독립 게시판(공지, 자유, 질문 등) 보유');
assert(designBoards.length >= 3, '디자인학과 독립 게시판(공지, 작품공유, 자유 등) 보유');

// 5. 공간별 회원 및 권한 검증 (공간 격리)
const csMembers = db.getSpaceMembers('cs');
const designMembers = db.getSpaceMembers('design');

assert(csMembers.some(m => m.user_id === csAdmin.id && m.space_role === 'space_admin'), '컴공 관리자는 컴공 공간의 space_admin 권한 보유');
assert(csMembers.some(m => m.user_id === studentCS.id && m.space_role === 'member'), '컴공 학생(student01)은 컴공 공간의 일반 member');
assert(!csMembers.some(m => m.user_id === studentDesign.id), '★ 디자인 학생(student02)은 컴공 공간의 회원이 아님 (권한 격리)');

assert(designMembers.some(m => m.user_id === studentDesign.id && m.space_role === 'member'), '디자인 학생(student02)은 디자인 공간의 일반 member');
assert(!designMembers.some(m => m.user_id === studentCS.id), '★ 컴공 학생(student01)은 디자인 공간의 회원이 아님 (권한 격리)');

// 6. 공간별 게시글 데이터 분리 검증 (데이터 격리)
const csPosts = db.getPostsBySpace('cs');
const designPosts = db.getPostsBySpace('design');

assert(csPosts.length > 0, '컴공 공간 게시글 존재');
assert(designPosts.length > 0, '디자인 공간 게시글 존재');

// 컴공 공간 글 목록에 디자인 글이 나타나지 않는지 확인
const designPostTitles = designPosts.map(p => p.title);
for (const p of csPosts) {
  assert(!designPostTitles.includes(p.title), `★ 컴공 공간 목록에 디자인 글('${p.title}')이 섞이지 않음`);
}

// 7. 공간 관리자의 게시판 생성 및 삭제 권한 검증
const newTestBoardId = 'cs_algo_lab';
const createdBoard = db.createBoard({
  id: newTestBoardId,
  spaceId: 'cs',
  name: '알고리즘 연구실 소통판',
  description: '알고리즘 연구실 전용 게시판'
});
assert(createdBoard && createdBoard.id === newTestBoardId, '컴공 공간 내 신규 게시판 생성 성공');

const testPostInNewBoard = db.createPost({
  boardId: newTestBoardId,
  userId: csAdmin.id,
  title: '연구실 신규 서버 공지',
  content: '연구실 서버 안내',
  isNotice: 1
});
assert(testPostInNewBoard && testPostInNewBoard.board_id === newTestBoardId, '신규 게시판에 글 작성 성공');

// 게시판 삭제 시 연쇄 삭제 확인
db.deleteBoard(newTestBoardId);
assert(db.getBoardById(newTestBoardId) === undefined, '게시판 삭제 성공');
assert(db.getPostById(testPostInNewBoard.id) === undefined, '게시판 삭제 시 해당 글도 종속 삭제 확인');

// 8. 최고 관리자의 운영 공간 생성 및 삭제 검증
const newSpaceId = 'test_space_law';
const createdSpace = db.createSpace({
  id: newSpaceId,
  name: '법학전문대학원',
  description: '로스쿨 학우 소통 공간',
  managerId: null
});
assert(createdSpace && createdSpace.id === newSpaceId, '최고 관리자의 신규 운영 공간 생성 성공');

db.deleteSpace(newSpaceId);
assert(db.getSpaceById(newSpaceId) === undefined, '최고 관리자의 운영 공간 삭제 성공');

console.log(`\n=== [복합 다중 운영 공간 테스트 결과: ${passedTests} / ${totalTests} 전체 통과] ===`);
