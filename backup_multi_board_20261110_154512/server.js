const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const dbHelper = require('./db.js');

const PORT = 3000;

// 데이터베이스 초기화
dbHelper.initDatabase();

// MIME 타입
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 요청자 식별 및 권한 객체 조회
  const currentUserId = req.headers['x-user-id'] || null;
  const currentUser = currentUserId ? dbHelper.findUserById(currentUserId) : null;
  const isAdmin = currentUser && currentUser.role === 'admin';
  const isSuspended = currentUser && currentUser.status === 'suspended';

  // 관리자 공통 권한 가드
  const requireAdmin = () => {
    if (!currentUser) {
      sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      return false;
    }
    if (!isAdmin) {
      sendJson(res, 403, { success: false, message: '관리자 권한이 없습니다. 접근이 거부되었습니다.' });
      return false;
    }
    return true;
  };

  try {
    // ----------------------------------------------------
    // [회원 인증 API]
    // ----------------------------------------------------
    // 1. 회원가입: POST /api/auth/register
    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseBody(req);
      const { username, password, name, department } = body;

      if (!username || !password || !name) {
        return sendJson(res, 400, { success: false, message: '아이디, 비밀번호, 이름을 모두 입력해 주세요.' });
      }

      const existing = dbHelper.findUserByUsername(username.trim());
      if (existing) {
        return sendJson(res, 400, { success: false, message: '이미 사용 중인 아이디입니다.' });
      }

      const newUserId = 'u_' + crypto.randomUUID().substring(0, 8);
      const newUser = dbHelper.createUser({
        id: newUserId,
        username: username.trim(),
        password: password.trim(),
        name: name.trim(),
        role: 'user',
        department: (department && department.trim()) || '소프트웨어학부'
      });

      return sendJson(res, 201, {
        success: true,
        message: '회원가입이 완료되었습니다.',
        user: newUser
      });
    }

    // 2. 로그인: POST /api/auth/login
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const { username, password } = body;

      if (!username || !password) {
        return sendJson(res, 400, { success: false, message: '아이디와 비밀번호를 입력해 주세요.' });
      }

      const user = dbHelper.findUserByUsername(username.trim());
      if (!user || user.password !== password.trim()) {
        return sendJson(res, 401, { success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
      }

      const { password: _, ...userInfo } = user;
      return sendJson(res, 200, {
        success: true,
        message: '로그인에 성공했습니다.',
        user: userInfo
      });
    }

    // 3. 내 정보 확인: GET /api/auth/me
    if (method === 'GET' && pathname === '/api/auth/me') {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }
      return sendJson(res, 200, { success: true, user: currentUser });
    }

    // ----------------------------------------------------
    // [다중 게시판(Boards) API]
    // ----------------------------------------------------
    // 1. 전체 게시판 목록 조회: GET /api/boards (모든 사용자/비회원 조회 가능)
    if (method === 'GET' && pathname === '/api/boards') {
      const boards = dbHelper.getAllBoards();
      return sendJson(res, 200, { success: true, data: boards });
    }

    // 2. 단일 게시판 정보 조회: GET /api/boards/:id
    const boardDetailMatch = pathname.match(/^\/api\/boards\/([^\/]+)$/);
    if (method === 'GET' && boardDetailMatch) {
      const boardId = boardDetailMatch[1];
      const board = dbHelper.getBoardById(boardId);
      if (!board) {
        return sendJson(res, 404, { success: false, message: '해당 게시판을 찾을 수 없습니다.' });
      }
      return sendJson(res, 200, { success: true, board });
    }

    // 3. 관리자: 게시판 추가: POST /api/boards (관리자 권한 필수)
    if (method === 'POST' && pathname === '/api/boards') {
      if (!requireAdmin()) return;

      const body = await parseBody(req);
      const { name, description, customId } = body;

      if (!name || !name.trim()) {
        return sendJson(res, 400, { success: false, message: '게시판 이름을 입력해 주세요.' });
      }

      // 게시판 고유 ID 생성 또는 지정
      const boardId = (customId && customId.trim())
        ? customId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
        : 'b_' + crypto.randomUUID().substring(0, 8);

      const existing = dbHelper.getBoardById(boardId);
      if (existing) {
        return sendJson(res, 400, { success: false, message: '이미 동일한 식별자의 게시판이 존재합니다.' });
      }

      const newBoard = dbHelper.createBoard({
        id: boardId,
        name: name.trim(),
        description: (description && description.trim()) || ''
      });

      return sendJson(res, 201, {
        success: true,
        message: '새로운 게시판이 성공적으로 개설되었습니다.',
        board: newBoard
      });
    }

    // 4. 관리자: 게시판 수정 (이름, 설명): PUT /api/boards/:id (관리자 권한 필수)
    if (method === 'PUT' && boardDetailMatch) {
      if (!requireAdmin()) return;

      const boardId = boardDetailMatch[1];
      const board = dbHelper.getBoardById(boardId);
      if (!board) {
        return sendJson(res, 404, { success: false, message: '게시판을 찾을 수 없습니다.' });
      }

      const body = await parseBody(req);
      const { name, description } = body;

      if (!name || !name.trim()) {
        return sendJson(res, 400, { success: false, message: '게시판 이름을 입력해 주세요.' });
      }

      const updated = dbHelper.updateBoard({
        id: boardId,
        name: name.trim(),
        description: (description && description.trim()) || ''
      });

      return sendJson(res, 200, {
        success: true,
        message: '게시판 정보가 수정되었습니다.',
        board: updated
      });
    }

    // 5. 관리자: 게시판 삭제: DELETE /api/boards/:id (관리자 권한 필수)
    if (method === 'DELETE' && boardDetailMatch) {
      if (!requireAdmin()) return;

      const boardId = boardDetailMatch[1];
      const board = dbHelper.getBoardById(boardId);
      if (!board) {
        return sendJson(res, 404, { success: false, message: '삭제할 게시판을 찾을 수 없습니다.' });
      }

      // 공지사항 등 필수 기본 게시판 보호 (최소 1개 게시판 유지)
      const allBoards = dbHelper.getAllBoards();
      if (allBoards.length <= 1) {
        return sendJson(res, 400, { success: false, message: '최소 1개의 게시판은 유지되어야 하므로 삭제할 수 없습니다.' });
      }

      dbHelper.deleteBoard(boardId);
      return sendJson(res, 200, {
        success: true,
        message: `'${board.name}' 게시판과 해당 게시글이 모두 삭제되었습니다.`
      });
    }

    // ----------------------------------------------------
    // [게시글(Posts) API - 다중 게시판 분리 적용]
    // ----------------------------------------------------
    // 1. 게시글 목록 조회: GET /api/posts?board_id=xxx
    if (method === 'GET' && pathname === '/api/posts') {
      const boardId = parsedUrl.query.board_id || null;
      const posts = dbHelper.getPosts(boardId);
      return sendJson(res, 200, { success: true, data: posts });
    }

    // 2. 게시글 상세 조회: GET /api/posts/:id
    const postDetailMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (method === 'GET' && postDetailMatch) {
      const postId = parseInt(postDetailMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) {
        return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });
      }
      const comments = dbHelper.getCommentsByPostId(postId);
      return sendJson(res, 200, { success: true, post, comments });
    }

    // 3. 게시글 작성: POST /api/posts (board_id 필수 지정 및 독립 저장)
    if (method === 'POST' && pathname === '/api/posts') {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '게시글을 작성하려면 로그인이 필요합니다.' });
      }
      if (isSuspended) {
        return sendJson(res, 403, { success: false, message: '현재 이용이 제한된 계정입니다. 글을 작성할 수 없습니다.' });
      }

      const body = await parseBody(req);
      const { boardId, title, content, isNotice } = body;

      if (!boardId) {
        return sendJson(res, 400, { success: false, message: '게시글을 등록할 게시판을 선택해 주세요.' });
      }

      const targetBoard = dbHelper.getBoardById(boardId);
      if (!targetBoard) {
        return sendJson(res, 404, { success: false, message: '존재하지 않는 게시판입니다.' });
      }

      if (!title || !title.trim() || !content || !content.trim()) {
        return sendJson(res, 400, { success: false, message: '제목과 내용을 모두 입력해 주세요.' });
      }

      // 공지사항 등록 권한: 관리자만 isNotice=1 등록 가능
      const noticeFlag = (isNotice && isAdmin) ? 1 : 0;

      const newPost = dbHelper.createPost({
        boardId: targetBoard.id,
        userId: currentUser.id,
        title: title.trim(),
        content: content.trim(),
        isNotice: noticeFlag
      });

      return sendJson(res, 201, {
        success: true,
        message: `'${targetBoard.name}' 게시판에 글이 등록되었습니다.`,
        post: newPost
      });
    }

    // 4. 게시글 수정: PUT /api/posts/:id (작성자 본인만 수정 가능, 게시판 이동 포함)
    if (method === 'PUT' && postDetailMatch) {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }
      if (isSuspended) {
        return sendJson(res, 403, { success: false, message: '현재 이용이 제한된 계정입니다.' });
      }

      const postId = parseInt(postDetailMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) {
        return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });
      }

      if (post.user_id !== currentUser.id) {
        return sendJson(res, 403, { success: false, message: '본인이 작성한 게시글만 수정할 수 있습니다.' });
      }

      const body = await parseBody(req);
      const { boardId, title, content, isNotice } = body;

      if (!title || !title.trim() || !content || !content.trim()) {
        return sendJson(res, 400, { success: false, message: '제목과 내용을 모두 입력해 주세요.' });
      }

      const noticeFlag = isAdmin ? (isNotice ? 1 : 0) : post.is_notice;
      const targetBoardId = boardId || post.board_id;

      const updated = dbHelper.updatePost({
        postId,
        boardId: targetBoardId,
        title: title.trim(),
        content: content.trim(),
        isNotice: noticeFlag
      });

      return sendJson(res, 200, { success: true, message: '게시글이 수정되었습니다.', post: updated });
    }

    // 5. 게시글 삭제: DELETE /api/posts/:id (작성자 본인 또는 관리자 직권 삭제)
    if (method === 'DELETE' && postDetailMatch) {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }
      if (isSuspended) {
        return sendJson(res, 403, { success: false, message: '현재 이용이 제한된 계정입니다.' });
      }

      const postId = parseInt(postDetailMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) {
        return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });
      }

      if (!isAdmin && post.user_id !== currentUser.id) {
        return sendJson(res, 403, { success: false, message: '다른 사용자의 게시글을 삭제할 수 있는 권한이 없습니다.' });
      }

      dbHelper.deletePost(postId);
      return sendJson(res, 200, {
        success: true,
        message: isAdmin && post.user_id !== currentUser.id
          ? '관리자 권한으로 게시글이 삭제(관리 조치)되었습니다.'
          : '게시글이 삭제되었습니다.'
      });
    }

    // ----------------------------------------------------
    // [댓글 API]
    // ----------------------------------------------------
    // 1. 댓글 작성: POST /api/posts/:id/comments
    const commentCreateMatch = pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
    if (method === 'POST' && commentCreateMatch) {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '댓글을 작성하려면 로그인이 필요합니다.' });
      }
      if (isSuspended) {
        return sendJson(res, 403, { success: false, message: '현재 이용이 제한된 계정입니다. 댓글을 작성할 수 없습니다.' });
      }

      const postId = parseInt(commentCreateMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) {
        return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });
      }

      const body = await parseBody(req);
      const { content } = body;
      if (!content || !content.trim()) {
        return sendJson(res, 400, { success: false, message: '댓글 내용을 입력해 주세요.' });
      }

      const newComment = dbHelper.createComment({
        postId,
        userId: currentUser.id,
        content: content.trim()
      });

      return sendJson(res, 201, { success: true, message: '댓글이 등록되었습니다.', comment: newComment });
    }

    // 2. 댓글 삭제: DELETE /api/comments/:id
    const commentDeleteMatch = pathname.match(/^\/api\/comments\/(\d+)$/);
    if (method === 'DELETE' && commentDeleteMatch) {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }
      if (isSuspended) {
        return sendJson(res, 403, { success: false, message: '현재 이용이 제한된 계정입니다.' });
      }

      const commentId = parseInt(commentDeleteMatch[1], 10);
      const comment = dbHelper.getCommentById(commentId);
      if (!comment) {
        return sendJson(res, 404, { success: false, message: '댓글이 존재하지 않습니다.' });
      }

      if (!isAdmin && comment.user_id !== currentUser.id) {
        return sendJson(res, 403, { success: false, message: '다른 사용자의 댓글을 삭제할 수 있는 권한이 없습니다.' });
      }

      dbHelper.deleteComment(commentId);
      return sendJson(res, 200, {
        success: true,
        message: isAdmin && comment.user_id !== currentUser.id
          ? '관리자 권한으로 댓글이 삭제(관리 조치)되었습니다.'
          : '댓글이 삭제되었습니다.'
      });
    }

    // ----------------------------------------------------
    // [관리자 전용 API]
    // ----------------------------------------------------
    // 회원 목록 조회: GET /api/admin/users
    if (method === 'GET' && pathname === '/api/admin/users') {
      if (!requireAdmin()) return;
      const users = dbHelper.getAllUsers();
      return sendJson(res, 200, { success: true, data: users });
    }

    // 회원 이용 제한: PATCH /api/admin/users/:id/status
    const userStatusMatch = pathname.match(/^\/api\/admin\/users\/([^\/]+)\/status$/);
    if (method === 'PATCH' && userStatusMatch) {
      if (!requireAdmin()) return;
      const targetUserId = userStatusMatch[1];
      const targetUser = dbHelper.findUserById(targetUserId);

      if (!targetUser) {
        return sendJson(res, 404, { success: false, message: '대상을 찾을 수 없습니다.' });
      }

      if (targetUser.role === 'admin') {
        return sendJson(res, 400, { success: false, message: '관리자 계정은 이용을 제한할 수 없습니다.' });
      }

      const body = await parseBody(req);
      const { status } = body;
      if (!['active', 'suspended'].includes(status)) {
        return sendJson(res, 400, { success: false, message: '유효한 상태값이 아닙니다. (active 또는 suspended)' });
      }

      const updated = dbHelper.updateUserStatus(targetUserId, status);
      return sendJson(res, 200, {
        success: true,
        message: status === 'suspended' ? '해당 회원의 이용이 제한되었습니다.' : '해당 회원의 이용 제한이 해제되었습니다.',
        user: updated
      });
    }

    // 공지사항 모니터링: GET /api/admin/notices
    if (method === 'GET' && pathname === '/api/admin/notices') {
      if (!requireAdmin()) return;
      const notices = dbHelper.getNoticePosts();
      return sendJson(res, 200, { success: true, data: notices });
    }

    // 전체 댓글 모니터링: GET /api/admin/comments
    if (method === 'GET' && pathname === '/api/admin/comments') {
      if (!requireAdmin()) return;
      const allComments = dbHelper.getAllComments();
      return sendJson(res, 200, { success: true, data: allComments });
    }

    // ----------------------------------------------------
    // [정적 파일 서빙]
    // ----------------------------------------------------
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, 'public', safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    sendJson(res, 404, { success: false, message: '요청한 경로를 찾을 수 없습니다.' });
  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { success: false, message: '서버 내부 오류가 발생했습니다.' });
  }
});

server.listen(PORT, () => {
  console.log(`[서버 시작] 학과 커뮤니티 게시판 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
