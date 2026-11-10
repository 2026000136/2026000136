const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function initDatabase() {
  // 1. 회원 테이블 (users)
  // role: 'super_admin' (최고 관리자), 'user' (일반 회원 - 공간별로 space_admin 또는 member 권한 부여)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      department TEXT DEFAULT '소프트웨어학부',
      status TEXT DEFAULT 'active', -- active, suspended
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. 운영 공간 테이블 (spaces)
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      manager_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // 3. 공간별 회원 및 권한 매핑 테이블 (space_members)
  // space_role: 'space_admin' (공간 관리자), 'member' (일반 소속 회원)
  db.exec(`
    CREATE TABLE IF NOT EXISTS space_members (
      space_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      space_role TEXT DEFAULT 'member', -- space_admin, member
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (space_id, user_id),
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. 공간별 게시판 테이블 (boards)
  // space_id 컬럼으로 각 운영 공간에 엄격하게 종속
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
    );
  `);

  // 기존 boards 테이블에 space_id 컬럼이 없을 경우를 대비한 안전 추가
  try {
    db.exec(`ALTER TABLE boards ADD COLUMN space_id TEXT NOT NULL DEFAULT 'cs';`);
  } catch (e) {}

  // 5. 게시글 테이블 (posts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_notice INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 6. 댓글 테이블 (comments)
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 데이터 시드 (초기 3대 학과 공간 및 기본 데이터)
  seedInitialData();
}

function seedInitialData() {
  // 1. 기본 사용자 확인 및 등록
  // admin -> super_admin으로 승격, 학과별 관리자 및 학생 세팅
  const existingAdmin = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  if (!existingAdmin) {
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, department, status)
      VALUES ('u_admin', 'admin', '1234', '대학 총괄 최고관리자', 'super_admin', '대학본부', 'active')
    `).run();
  } else {
    db.prepare("UPDATE users SET role = 'super_admin' WHERE username = 'admin'").run();
  }

  // 공간 관리자 및 일반 학생 계정 보장
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, username, password, name, role, department, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertUser.run('u_mgr_cs', 'cs_admin', '1234', '컴공 학과장(관리자)', 'user', '컴퓨터공학과', 'active');
  insertUser.run('u_mgr_design', 'design_admin', '1234', '디자인 학과장(관리자)', 'user', '디자인학과', 'active');
  insertUser.run('u_mgr_biz', 'biz_admin', '1234', '경영 학과장(관리자)', 'user', '경영학과', 'active');
  insertUser.run('u_student1', 'student01', '1234', '김민수 (컴공학생)', 'user', '컴퓨터공학과', 'active');
  insertUser.run('u_student2', 'student02', '1234', '이영희 (디자인학생)', 'user', '디자인학과', 'active');
  insertUser.run('u_student3', 'student03', '1234', '박지훈 (경영학생)', 'user', '경영학과', 'active');

  // 2. 운영 공간(Spaces) 확인 및 생성
  const spaceCount = db.prepare('SELECT COUNT(*) as count FROM spaces').get().count;
  if (spaceCount === 0) {
    const insertSpace = db.prepare('INSERT INTO spaces (id, name, description, manager_id) VALUES (?, ?, ?, ?)');
    insertSpace.run('cs', '컴퓨터공학과', '알고리즘, 소프트웨어, 인공지능 연구 및 컴퓨터공학부 전용 공간입니다.', 'u_mgr_cs');
    insertSpace.run('design', '디자인학과', 'UX/UI, 시각디자인, 디지털 미디어 아트 창작 및 작품 공유 공간입니다.', 'u_mgr_design');
    insertSpace.run('biz', '경영학과', '경영학, 마케팅, 재무, 스타트업 및 취업 정보 교류 공간입니다.', 'u_mgr_biz');

    // 공간별 회원 및 권한 등록
    const insertMember = db.prepare('INSERT INTO space_members (space_id, user_id, space_role) VALUES (?, ?, ?)');
    // 컴공 공간
    insertMember.run('cs', 'u_mgr_cs', 'space_admin');
    insertMember.run('cs', 'u_student1', 'member');

    // 디자인 공간
    insertMember.run('design', 'u_mgr_design', 'space_admin');
    insertMember.run('design', 'u_student2', 'member');

    // 경영학과 공간
    insertMember.run('biz', 'u_mgr_biz', 'space_admin');
    insertMember.run('biz', 'u_student3', 'member');

    // 3. 공간별 독립 게시판 생성
    const insertBoard = db.prepare('INSERT OR REPLACE INTO boards (id, space_id, name, description) VALUES (?, ?, ?, ?)');
    // 컴퓨터공학과 게시판
    insertBoard.run('cs_notice', 'cs', '공지사항', '컴퓨터공학과 학사 및 필수 연구 공지');
    insertBoard.run('cs_free', 'cs', '자유게시판', '컴공 학우들의 일상 및 자유로운 소통 공간');
    insertBoard.run('cs_qna', 'cs', '질문게시판', '코딩, 자료구조, 시스템 관련 전공 Q&A');

    // 디자인학과 게시판
    insertBoard.run('design_notice', 'design', '공지사항', '디자인학과 전시회 및 학사 일정 공지');
    insertBoard.run('design_works', 'design', '작품공유게시판', '졸업작품, 포트폴리오, 그래픽 과제 피드백 공간');
    insertBoard.run('design_free', 'design', '자유게시판', '디자인학부 일상 및 영감 소통 공간');

    // 경영학과 게시판
    insertBoard.run('biz_notice', 'biz', '공지사항', '경영대학 학사일정 및 장학금 공지');
    insertBoard.run('biz_career', 'biz', '취업정보게시판', '인턴십, 공채, 공모전 및 자격증 정보 공유');
    insertBoard.run('biz_free', 'biz', '자유게시판', '경영학부 학우들의 자유 소통 게시판');

    // 4. 공간별 샘플 게시글
    const insertPost = db.prepare('INSERT INTO posts (board_id, user_id, title, content, is_notice) VALUES (?, ?, ?, ?, ?)');
    // 컴공 글
    insertPost.run('cs_notice', 'u_mgr_cs', '[컴공 필독] 2026학년도 GPU 실습 서버 계정 신청 안내', '인공지능 실습실 신규 GPU 서버 계정 발급이 시작되었습니다.', 1);
    insertPost.run('cs_free', 'u_student1', '알고리즘 스터디 모집 (백준 골드 이상)', '주 2회 백준/프로그래머스 문제 풀이 스터디원 구합니다.', 0);
    insertPost.run('cs_qna', 'u_student1', '리눅스 소켓 프로그래밍 질문입니다.', 'epoll 이벤트 루프 처리 중 질문이 있습니다.', 0);

    // 디자인 글
    insertPost.run('design_notice', 'u_mgr_design', '[디자인 공지] 2026 정기 졸업작품 전시회 일정 안내', '예술관 2층 갤러리에서 졸업전시회가 개최됩니다.', 1);
    insertPost.run('design_works', 'u_student2', '모바일 앱 UI 리디자인 포트폴리오 피드백 부탁드립니다!', '피그마로 제작한 대학생 커뮤니티 앱 UI 디자인 시안입니다.', 0);

    // 경영 글
    insertPost.run('biz_notice', 'u_mgr_biz', '[경영 공지] 2026 동계 대기업 인턴십 채용 설명회', '경영관 101호에서 채용 연계형 인턴 설명회가 열립니다.', 1);
    insertPost.run('biz_career', 'u_student3', '외국계 컨설팅 RA 서류 합격 후기 및 팁 공유', '경영학과 학우분들을 위해 면접 준비 과정 공유합니다.', 0);
  }
}

// ----------------------------------------------------
// [회원 관련 쿼리]
// ----------------------------------------------------
function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findUserById(id) {
  return db.prepare('SELECT id, username, name, role, department, status, created_at FROM users WHERE id = ?').get(id);
}

function createUser({ id, username, password, name, role = 'user', department = '소프트웨어학부' }) {
  db.prepare(`
    INSERT INTO users (id, username, password, name, role, department, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, username, password, name, role, department);
  return findUserById(id);
}

function getAllUsers() {
  return db.prepare(`
    SELECT id, username, name, role, department, status, created_at,
           (SELECT COUNT(*) FROM posts WHERE user_id = users.id) as post_count,
           (SELECT COUNT(*) FROM comments WHERE user_id = users.id) as comment_count
    FROM users
    ORDER BY role DESC, created_at ASC
  `).all();
}

function updateUserStatus(userId, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  return findUserById(userId);
}

// ----------------------------------------------------
// [운영 공간(Spaces) 쿼리]
// ----------------------------------------------------
function getAllSpaces() {
  return db.prepare(`
    SELECT s.id, s.name, s.description, s.created_at, s.manager_id,
           u.name as manager_name, u.username as manager_username,
           (SELECT COUNT(*) FROM boards WHERE space_id = s.id) as board_count,
           (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) as member_count,
           (SELECT COUNT(*) FROM posts p JOIN boards b ON p.board_id = b.id WHERE b.space_id = s.id) as post_count
    FROM spaces s
    LEFT JOIN users u ON s.manager_id = u.id
    ORDER BY s.created_at ASC
  `).all();
}

function getSpaceById(spaceId) {
  return db.prepare(`
    SELECT s.id, s.name, s.description, s.created_at, s.manager_id,
           u.name as manager_name, u.username as manager_username,
           (SELECT COUNT(*) FROM boards WHERE space_id = s.id) as board_count,
           (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) as member_count,
           (SELECT COUNT(*) FROM posts p JOIN boards b ON p.board_id = b.id WHERE b.space_id = s.id) as post_count
    FROM spaces s
    LEFT JOIN users u ON s.manager_id = u.id
    WHERE s.id = ?
  `).get(spaceId);
}

function createSpace({ id, name, description, managerId }) {
  db.prepare(`
    INSERT INTO spaces (id, name, description, manager_id)
    VALUES (?, ?, ?, ?)
  `).run(id, name, description || '', managerId || null);

  // 관리자가 지정된 경우 해당 공간의 space_admin으로 자동 멤버 등록
  if (managerId) {
    addSpaceMember(id, managerId, 'space_admin');
  }

  return getSpaceById(id);
}

function updateSpace({ id, name, description, managerId }) {
  db.prepare(`
    UPDATE spaces
    SET name = ?, description = ?, manager_id = ?
    WHERE id = ?
  `).run(name, description || '', managerId || null, id);

  if (managerId) {
    addSpaceMember(id, managerId, 'space_admin');
  }

  return getSpaceById(id);
}

function deleteSpace(spaceId) {
  return db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
}

// ----------------------------------------------------
// [공간별 회원 및 권한(space_members) 쿼리]
// ----------------------------------------------------
function getSpaceMembers(spaceId) {
  return db.prepare(`
    SELECT sm.space_id, sm.user_id, sm.space_role, sm.joined_at,
           u.name as user_name, u.username, u.department, u.status, u.role as global_role
    FROM space_members sm
    JOIN users u ON sm.user_id = u.id
    WHERE sm.space_id = ?
    ORDER BY CASE WHEN sm.space_role = 'space_admin' THEN 1 ELSE 2 END, sm.joined_at ASC
  `).all(spaceId);
}

function getUserSpaceMembership(spaceId, userId) {
  return db.prepare(`
    SELECT * FROM space_members
    WHERE space_id = ? AND user_id = ?
  `).get(spaceId, userId);
}

function getUserAccessibleSpaces(userId) {
  const user = findUserById(userId);
  if (!user) return [];
  // 최고 관리자(super_admin)는 모든 운영 공간에 접근 가능
  if (user.role === 'super_admin') {
    return getAllSpaces();
  }

  return db.prepare(`
    SELECT s.id, s.name, s.description, s.created_at, s.manager_id,
           sm.space_role,
           u.name as manager_name,
           (SELECT COUNT(*) FROM boards WHERE space_id = s.id) as board_count,
           (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) as member_count,
           (SELECT COUNT(*) FROM posts p JOIN boards b ON p.board_id = b.id WHERE b.space_id = s.id) as post_count
    FROM spaces s
    JOIN space_members sm ON s.id = sm.space_id
    LEFT JOIN users u ON s.manager_id = u.id
    WHERE sm.user_id = ?
    ORDER BY s.created_at ASC
  `).all(userId);
}

function addSpaceMember(spaceId, userId, spaceRole = 'member') {
  db.prepare(`
    INSERT INTO space_members (space_id, user_id, space_role)
    VALUES (?, ?, ?)
    ON CONFLICT(space_id, user_id) DO UPDATE SET space_role = excluded.space_role
  `).run(spaceId, userId, spaceRole);
  return getUserSpaceMembership(spaceId, userId);
}

function removeSpaceMember(spaceId, userId) {
  return db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, userId);
}

function updateSpaceMemberRole(spaceId, userId, spaceRole) {
  db.prepare('UPDATE space_members SET space_role = ? WHERE space_id = ? AND user_id = ?').run(spaceRole, spaceId, userId);
  return getUserSpaceMembership(spaceId, userId);
}

// ----------------------------------------------------
// [공간별 게시판(boards) 쿼리]
// ----------------------------------------------------
function getBoardsBySpaceId(spaceId) {
  return db.prepare(`
    SELECT b.id, b.space_id, b.name, b.description, b.created_at,
           s.name as space_name,
           (SELECT COUNT(*) FROM posts WHERE board_id = b.id) as post_count
    FROM boards b
    JOIN spaces s ON b.space_id = s.id
    WHERE b.space_id = ?
    ORDER BY b.created_at ASC
  `).all(spaceId);
}

function getAllBoards() {
  return db.prepare(`
    SELECT b.id, b.space_id, b.name, b.description, b.created_at,
           s.name as space_name,
           (SELECT COUNT(*) FROM posts WHERE board_id = b.id) as post_count
    FROM boards b
    JOIN spaces s ON b.space_id = s.id
    ORDER BY s.name ASC, b.created_at ASC
  `).all();
}

function getBoardById(boardId) {
  return db.prepare(`
    SELECT b.id, b.space_id, b.name, b.description, b.created_at,
           s.name as space_name,
           (SELECT COUNT(*) FROM posts WHERE board_id = b.id) as post_count
    FROM boards b
    JOIN spaces s ON b.space_id = s.id
    WHERE b.id = ?
  `).get(boardId);
}

function createBoard({ id, spaceId, name, description }) {
  db.prepare(`
    INSERT INTO boards (id, space_id, name, description)
    VALUES (?, ?, ?, ?)
  `).run(id, spaceId, name, description || '');
  return getBoardById(id);
}

function updateBoard({ id, name, description }) {
  db.prepare(`
    UPDATE boards
    SET name = ?, description = ?
    WHERE id = ?
  `).run(name, description || '', id);
  return getBoardById(id);
}

function deleteBoard(boardId) {
  return db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
}

// ----------------------------------------------------
// [게시글(Posts) 쿼리 - 공간/게시판 독립 필터링]
// ----------------------------------------------------
function getPostsBySpace(spaceId, boardId = null) {
  if (boardId) {
    return db.prepare(`
      SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
             b.name as board_name, b.space_id, s.name as space_name,
             u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN boards b ON p.board_id = b.id
      JOIN spaces s ON b.space_id = s.id
      JOIN users u ON p.user_id = u.id
      WHERE b.space_id = ? AND p.board_id = ?
      ORDER BY p.is_notice DESC, p.id DESC
    `).all(spaceId, boardId);
  }

  return db.prepare(`
    SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           b.name as board_name, b.space_id, s.name as space_name,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN boards b ON p.board_id = b.id
    JOIN spaces s ON b.space_id = s.id
    JOIN users u ON p.user_id = u.id
    WHERE b.space_id = ?
    ORDER BY p.is_notice DESC, p.id DESC
  `).all(spaceId);
}

function getAllPosts() {
  return db.prepare(`
    SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           b.name as board_name, b.space_id, s.name as space_name,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN boards b ON p.board_id = b.id
    JOIN spaces s ON b.space_id = s.id
    JOIN users u ON p.user_id = u.id
    ORDER BY p.is_notice DESC, p.id DESC
  `).all();
}

function getPostById(postId) {
  return db.prepare(`
    SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           b.name as board_name, b.space_id, s.name as space_name,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role
    FROM posts p
    JOIN boards b ON p.board_id = b.id
    JOIN spaces s ON b.space_id = s.id
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(postId);
}

function createPost({ boardId, userId, title, content, isNotice = 0 }) {
  const stmt = db.prepare(`
    INSERT INTO posts (board_id, user_id, title, content, is_notice)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(boardId, userId, title, content, isNotice ? 1 : 0);
  return getPostById(Number(result.lastInsertRowid));
}

function updatePost({ postId, boardId, title, content, isNotice }) {
  if (boardId) {
    db.prepare(`
      UPDATE posts
      SET board_id = ?, title = ?, content = ?, is_notice = COALESCE(?, is_notice), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(boardId, title, content, isNotice !== undefined ? (isNotice ? 1 : 0) : null, postId);
  } else {
    db.prepare(`
      UPDATE posts
      SET title = ?, content = ?, is_notice = COALESCE(?, is_notice), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, content, isNotice !== undefined ? (isNotice ? 1 : 0) : null, postId);
  }
  return getPostById(postId);
}

function deletePost(postId) {
  return db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
}

// ----------------------------------------------------
// [댓글(Comments) 쿼리]
// ----------------------------------------------------
function getCommentsByPostId(postId) {
  return db.prepare(`
    SELECT c.id, c.post_id, c.content, c.created_at,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.id ASC
  `).all(postId);
}

function getCommentsBySpace(spaceId) {
  return db.prepare(`
    SELECT c.id, c.post_id, c.content, c.created_at,
           p.title as post_title,
           b.name as board_name, b.space_id,
           u.id as user_id, u.name as author_name, u.username as author_username
    FROM comments c
    JOIN posts p ON c.post_id = p.id
    JOIN boards b ON p.board_id = b.id
    JOIN users u ON c.user_id = u.id
    WHERE b.space_id = ?
    ORDER BY c.id DESC
  `).all(spaceId);
}

function getAllComments() {
  return db.prepare(`
    SELECT c.id, c.post_id, c.content, c.created_at,
           p.title as post_title,
           b.name as board_name, b.space_id, s.name as space_name,
           u.id as user_id, u.name as author_name, u.username as author_username
    FROM comments c
    JOIN posts p ON c.post_id = p.id
    JOIN boards b ON p.board_id = b.id
    JOIN spaces s ON b.space_id = s.id
    JOIN users u ON c.user_id = u.id
    ORDER BY c.id DESC
  `).all();
}

function getCommentById(commentId) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
}

function createComment({ postId, userId, content }) {
  const result = db.prepare(`
    INSERT INTO comments (post_id, user_id, content)
    VALUES (?, ?, ?)
  `).run(postId, userId, content);
  return db.prepare(`
    SELECT c.id, c.post_id, c.content, c.created_at,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(Number(result.lastInsertRowid));
}

function deleteComment(commentId) {
  return db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}

module.exports = {
  db,
  initDatabase,
  findUserByUsername,
  findUserById,
  createUser,
  getAllUsers,
  updateUserStatus,
  getAllSpaces,
  getSpaceById,
  createSpace,
  updateSpace,
  deleteSpace,
  getSpaceMembers,
  getUserSpaceMembership,
  getUserAccessibleSpaces,
  addSpaceMember,
  removeSpaceMember,
  updateSpaceMemberRole,
  getBoardsBySpaceId,
  getAllBoards,
  getBoardById,
  createBoard,
  updateBoard,
  deleteBoard,
  getPostsBySpace,
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getCommentsByPostId,
  getCommentsBySpace,
  getAllComments,
  getCommentById,
  createComment,
  deleteComment
};
