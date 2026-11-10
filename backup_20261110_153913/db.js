const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function initDatabase() {
  // 1. 회원 테이블 (users)
  // role: 'admin' (관리자), 'user' (일반 사용자)
  // status: 'active' (정상), 'suspended' (이용 제한/정지)
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

  // 기존 테이블에 status 및 role 마이그레이션 안전 처리
  try {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';`);
  } catch (e) {
    // 이미 존재하는 경우 무시
  }

  // 2. 단일 통합 게시판 (boards)
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. 게시글 테이블 (posts)
  // is_notice: 1 (공지사항 - 상단 고정), 0 (일반 게시글)
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

  try {
    db.exec(`ALTER TABLE posts ADD COLUMN is_notice INTEGER DEFAULT 0;`);
  } catch (e) {}

  // 4. 댓글 테이블 (comments)
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

  // 기본 보드 등록
  const boardCount = db.prepare('SELECT COUNT(*) as count FROM boards').get().count;
  if (boardCount === 0) {
    db.prepare('INSERT INTO boards (id, name, description) VALUES (?, ?, ?)')
      .run('main_board', '학과 자유 소통 게시판', '학과 구성원들이 공지 및 다양한 의견을 자유롭게 나누는 게시판입니다.');
  }

  // 기본 시드 유저 세팅 (관리자 1명, 일반 유저 2명)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO users (id, username, password, name, role, department, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertUser.run('u_admin', 'admin', '1234', '학과 관리자', 'admin', '소프트웨어학부', 'active');
    insertUser.run('u_student1', 'student01', '1234', '김민수', 'user', '소프트웨어학부', 'active');
    insertUser.run('u_student2', 'student02', '1234', '이영희', 'user', '소프트웨어학부', 'active');

    // 샘플 공지사항 및 게시글
    const insertPost = db.prepare(`
      INSERT INTO posts (board_id, user_id, title, content, is_notice, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertPost.run('main_board', 'u_admin', '[공지] 2026학년도 학과 커뮤니티 이용 수칙 및 가이드라인', '학과 구성원 간의 건전하고 유익한 소통을 위해 비방 및 부적절한 게시글은 관리자에 의해 제재될 수 있습니다.', 1, '2026-11-10 09:00:00', '2026-11-10 09:00:00');
    insertPost.run('main_board', 'u_student1', '이번 학기 알고리즘 스터디원 모집합니다!', '백준 및 프로그래머스 코딩테스트 대비 스터디입니다. 주 2회 진행 예정이니 관심 있으신 분들은 댓글 남겨주세요.', 0, '2026-11-10 10:30:00', '2026-11-10 10:30:00');
    insertPost.run('main_board', 'u_student2', '학술 세미나 발표 자료 어디서 확인하나요?', '지난주 목요일에 있었던 AI 세미나 자료가 포털에 안 보여서 질문드립니다.', 0, '2026-11-10 13:15:00', '2026-11-10 13:15:00');

    // 샘플 댓글
    const insertComment = db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)');
    insertComment.run(2, 'u_student2', '저도 스터디 참여하고 싶습니다! 혹시 몇 학년 대상인가요?', '2026-11-10 11:00:00');
    insertComment.run(3, 'u_admin', '학과 홈페이지 자료실 메뉴에 업로드되어 있으니 참고하시기 바랍니다.', '2026-11-10 13:40:00');
  } else {
    // 기존 데이터 중 student 역할이 남아있다면 user로 통일, admin은 admin 유지
    db.exec(`UPDATE users SET role = 'user' WHERE role != 'admin';`);
    db.exec(`UPDATE users SET status = 'active' WHERE status IS NULL;`);
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
// [게시글 관련 쿼리 (공지사항 상단 정렬 및 최신순)]
// ----------------------------------------------------
function getPosts() {
  return db.prepare(`
    SELECT p.id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.is_notice DESC, p.id DESC
  `).all();
}

function getNoticePosts() {
  return db.prepare(`
    SELECT p.id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           u.id as user_id, u.name as author_name, u.username as author_username,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.is_notice = 1
    ORDER BY p.id DESC
  `).all();
}

function getPostById(postId) {
  return db.prepare(`
    SELECT p.id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(postId);
}

function createPost({ userId, title, content, isNotice = 0 }) {
  const stmt = db.prepare(`
    INSERT INTO posts (board_id, user_id, title, content, is_notice)
    VALUES ('main_board', ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, title, content, isNotice ? 1 : 0);
  return getPostById(Number(result.lastInsertRowid));
}

function updatePost({ postId, title, content, isNotice }) {
  if (isNotice !== undefined) {
    db.prepare(`
      UPDATE posts
      SET title = ?, content = ?, is_notice = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, content, isNotice ? 1 : 0, postId);
  } else {
    db.prepare(`
      UPDATE posts
      SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, content, postId);
  }
  return getPostById(postId);
}

function deletePost(postId) {
  return db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
}

// ----------------------------------------------------
// [댓글 관련 쿼리]
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

function getAllComments() {
  return db.prepare(`
    SELECT c.id, c.post_id, c.content, c.created_at,
           p.title as post_title,
           u.id as user_id, u.name as author_name, u.username as author_username
    FROM comments c
    JOIN posts p ON c.post_id = p.id
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
  getPosts,
  getNoticePosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getCommentsByPostId,
  getAllComments,
  getCommentById,
  createComment,
  deleteComment
};
