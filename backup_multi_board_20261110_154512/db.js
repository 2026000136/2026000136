const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function initDatabase() {
  // 1. 회원 테이블 (users)
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

  try {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';`);
  } catch (e) {}

  // 2. 게시판 테이블 (boards)
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. 게시글 테이블 (posts)
  // board_id 필드로 자신이 속한 게시판 구분
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

  // 다중 게시판 기본 시드 데이터 (예시 게시판들 생성)
  seedBoardsIfEmpty();

  // 기본 시드 회원 생성
  seedUsersIfEmpty();
}

function seedBoardsIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as count FROM boards').get().count;
  if (count <= 1) {
    // 기존 main_board가 있다면 '자유게시판'으로 정돈하거나 유지하고 나머지 표준 게시판 추가
    const insertBoard = db.prepare('INSERT OR IGNORE INTO boards (id, name, description) VALUES (?, ?, ?)');
    insertBoard.run('notice', '공지사항', '소프트웨어학부 학사 및 주요 공지사항을 안내합니다.');
    insertBoard.run('free', '자유게시판', '학과 구성원 간 자유로운 의견 교환 및 일상 소통 게시판입니다.');
    insertBoard.run('qna', '질문게시판', '수강신청, 전공 교과목, 프로그래밍 및 학업 관련 질의응답 게시판입니다.');
    insertBoard.run('info', '정보공유게시판', '채용/인턴십, IT 공모전, 자격증, 세미나 등 유익한 정보를 공유합니다.');
    insertBoard.run('anonymous', '익명게시판', '학과 생활 및 진로에 관한 솔직한 고민을 나누는 익명/자유 소통 공간입니다.');

    // 기존 main_board 글들이 있었다면 free 게시판으로 마이그레이션하거나 연결
    try {
      db.prepare("UPDATE posts SET board_id = 'free' WHERE board_id = 'main_board'").run();
      db.prepare("DELETE FROM boards WHERE id = 'main_board'").run();
    } catch (e) {}
  }
}

function seedUsersIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO users (id, username, password, name, role, department, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertUser.run('u_admin', 'admin', '1234', '학과 관리자', 'admin', '소프트웨어학부', 'active');
    insertUser.run('u_student1', 'student01', '1234', '김민수', 'user', '소프트웨어학부', 'active');
    insertUser.run('u_student2', 'student02', '1234', '이영희', 'user', '소프트웨어학부', 'active');

    // 샘플 글 (게시판별 독립 생성)
    const insertPost = db.prepare(`
      INSERT INTO posts (board_id, user_id, title, content, is_notice, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertPost.run('notice', 'u_admin', '[필독] 2026학년도 소프트웨어학부 커뮤니티 다중 게시판 오픈 안내', '다양한 주제별로 소통할 수 있도록 공지, 자유, 질문, 정보공유, 익명 게시판이 개설되었습니다.', 1, '2026-11-10 09:00:00', '2026-11-10 09:00:00');
    insertPost.run('free', 'u_student1', '이번 학기 알고리즘 스터디원 모집합니다!', '백준 및 프로그래머스 코딩테스트 대비 스터디입니다. 주 2회 진행 예정입니다.', 0, '2026-11-10 10:30:00', '2026-11-10 10:30:00');
    insertPost.run('qna', 'u_student2', '운영체제 페이징 과제 관련 질문드립니다.', 'xv6 페이지 테이블 워크 구현 중 질문이 있습니다.', 0, '2026-11-10 13:15:00', '2026-11-10 13:15:00');
    insertPost.run('info', 'u_admin', '2026 전국 대학생 오픈소스 SW 해커톤 참가자 모집', '상금 총 2000만원 규모의 전국 해커톤 정보 공유합니다.', 0, '2026-11-10 14:00:00', '2026-11-10 14:00:00');

    // 샘플 댓글
    const insertComment = db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)');
    insertComment.run(2, 'u_student2', '저도 스터디 참여하고 싶습니다!', '2026-11-10 11:00:00');
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
// [다중 게시판(Boards) 관련 쿼리]
// ----------------------------------------------------
function getAllBoards() {
  return db.prepare(`
    SELECT b.id, b.name, b.description, b.created_at,
           (SELECT COUNT(*) FROM posts WHERE board_id = b.id) as post_count
    FROM boards b
    ORDER BY b.created_at ASC
  `).all();
}

function getBoardById(boardId) {
  return db.prepare(`
    SELECT b.id, b.name, b.description, b.created_at,
           (SELECT COUNT(*) FROM posts WHERE board_id = b.id) as post_count
    FROM boards b
    WHERE b.id = ?
  `).get(boardId);
}

function createBoard({ id, name, description }) {
  db.prepare(`
    INSERT INTO boards (id, name, description)
    VALUES (?, ?, ?)
  `).run(id, name, description || '');
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
// [게시글(Posts) 관련 쿼리 (게시판별 독립 필터링 지원)]
// ----------------------------------------------------
function getPosts(boardId = null) {
  if (boardId) {
    return db.prepare(`
      SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
             b.name as board_name,
             u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN boards b ON p.board_id = b.id
      JOIN users u ON p.user_id = u.id
      WHERE p.board_id = ?
      ORDER BY p.is_notice DESC, p.id DESC
    `).all(boardId);
  }

  // 전체 조회 (관리자 대시보드 등)
  return db.prepare(`
    SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           b.name as board_name,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN boards b ON p.board_id = b.id
    JOIN users u ON p.user_id = u.id
    ORDER BY p.is_notice DESC, p.id DESC
  `).all();
}

function getNoticePosts() {
  return db.prepare(`
    SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           b.name as board_name,
           u.id as user_id, u.name as author_name, u.username as author_username,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN boards b ON p.board_id = b.id
    JOIN users u ON p.user_id = u.id
    WHERE p.is_notice = 1
    ORDER BY p.id DESC
  `).all();
}

function getPostById(postId) {
  return db.prepare(`
    SELECT p.id, p.board_id, p.title, p.content, p.is_notice, p.created_at, p.updated_at,
           b.name as board_name,
           u.id as user_id, u.name as author_name, u.username as author_username, u.role as author_role
      FROM posts p
      JOIN boards b ON p.board_id = b.id
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
// [댓글(Comments) 관련 쿼리]
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
           b.name as board_name,
           u.id as user_id, u.name as author_name, u.username as author_username
    FROM comments c
    JOIN posts p ON c.post_id = p.id
    JOIN boards b ON p.board_id = b.id
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
  getAllBoards,
  getBoardById,
  createBoard,
  updateBoard,
  deleteBoard,
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
