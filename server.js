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

  // 요청자 식별 및 권한 정보 조회
  const currentUserId = req.headers['x-user-id'] || null;
  const currentUser = currentUserId ? dbHelper.findUserById(currentUserId) : null;
  const isSuperAdmin = currentUser && currentUser.role === 'super_admin';
  const isSuspended = currentUser && currentUser.status === 'suspended';

  // ----------------------------------------------------
  // [보안 권한 가드 헬퍼 함수]
  // ----------------------------------------------------
  // 특정 공간에서의 역할 ('space_admin', 'member', null)
  const getSpaceRole = (spaceId) => {
    if (!currentUser) return null;
    if (isSuperAdmin) return 'space_admin';
    const membership = dbHelper.getUserSpaceMembership(spaceId, currentUser.id);
    return membership ? membership.space_role : null;
  };

  // 해당 공간에 접근 권한(조회 권한)이 있는지 검증
  const canAccessSpace = (spaceId) => {
    if (!currentUser) return false; // 로그인 필수
    if (isSuperAdmin) return true;
    return getSpaceRole(spaceId) !== null;
  };

  // 해당 공간의 관리자 권한이 있는지 검증 (공간 관리자 또는 최고 관리자)
  const isSpaceAdmin = (spaceId) => {
    if (!currentUser) return false;
    if (isSuperAdmin) return true;
    return getSpaceRole(spaceId) === 'space_admin';
  };

  try {
    // ----------------------------------------------------
    // [회원 인증 API]
    // ----------------------------------------------------
    // 1. 회원가입: POST /api/auth/register
    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseBody(req);
      const { username, password, name, department, spaceId } = body;

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
        department: (department && department.trim()) || '소속학과'
      });

      if (spaceId) {
        const space = dbHelper.getSpaceById(spaceId);
        if (space) {
          dbHelper.addSpaceMember(spaceId, newUserId, 'member');
        }
      }

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

    // 3. 내 정보 확인 및 접근 가능 공간 목록: GET /api/auth/me
    if (method === 'GET' && pathname === '/api/auth/me') {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }
      const accessibleSpaces = dbHelper.getUserAccessibleSpaces(currentUser.id);
      return sendJson(res, 200, {
        success: true,
        user: currentUser,
        accessibleSpaces,
        isSuperAdmin
      });
    }

    // ----------------------------------------------------
    // [1. 운영 공간(Spaces) 관리 API - 접근 권한 엄격 통제]
    // ----------------------------------------------------
    // 1. 운영 공간 목록 조회: GET /api/spaces
    if (method === 'GET' && pathname === '/api/spaces') {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인 후 운영 공간을 확인할 수 있습니다.' });
      }

      // 최고 관리자: 전체 공간 목록
      // 공간 관리자 및 일반 사용자: 본인이 권한을 가진 공간 목록만 반환
      if (isSuperAdmin) {
        const spaces = dbHelper.getAllSpaces();
        return sendJson(res, 200, { success: true, data: spaces, isSuperAdmin: true });
      } else {
        const spaces = dbHelper.getUserAccessibleSpaces(currentUser.id);
        return sendJson(res, 200, { success: true, data: spaces, isSuperAdmin: false });
      }
    }

    // 2. 단일 운영 공간 상세 조회: GET /api/spaces/:id
    const spaceDetailMatch = pathname.match(/^\/api\/spaces\/([^\/]+)$/);
    if (method === 'GET' && spaceDetailMatch) {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }

      const spaceId = spaceDetailMatch[1];
      const space = dbHelper.getSpaceById(spaceId);
      if (!space) {
        return sendJson(res, 404, { success: false, message: '해당 운영 공간을 찾을 수 없습니다.' });
      }

      // 보안 검증: 해당 공간에 소속되지 않은 일반 사용자나 타 공간 관리자는 조회 차단 (403)
      if (!canAccessSpace(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 운영 공간에 대한 접근 권한이 없습니다.' });
      }

      const roleInSpace = getSpaceRole(spaceId);
      return sendJson(res, 200, {
        success: true,
        space,
        roleInSpace,
        canManage: roleInSpace === 'space_admin'
      });
    }

    // 3. 최고 관리자 전용: 운영 공간 생성: POST /api/spaces
    if (method === 'POST' && pathname === '/api/spaces') {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (!isSuperAdmin) {
        return sendJson(res, 403, { success: false, message: '최고 관리자만 새로운 운영 공간을 개설할 수 있습니다.' });
      }

      const body = await parseBody(req);
      const { id, name, description, managerId } = body;

      if (!id || !name || !id.trim() || !name.trim()) {
        return sendJson(res, 400, { success: false, message: '공간 ID와 공간 이름을 입력해 주세요.' });
      }

      const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const existing = dbHelper.getSpaceById(cleanId);
      if (existing) {
        return sendJson(res, 400, { success: false, message: '이미 존재하는 공간 ID입니다.' });
      }

      const newSpace = dbHelper.createSpace({
        id: cleanId,
        name: name.trim(),
        description: (description && description.trim()) || '',
        managerId: managerId || null
      });

      dbHelper.createBoard({ id: `${cleanId}_notice`, spaceId: cleanId, name: '공지사항', description: `${name} 공지사항` });
      dbHelper.createBoard({ id: `${cleanId}_free`, spaceId: cleanId, name: '자유게시판', description: `${name} 자유게시판` });

      return sendJson(res, 201, {
        success: true,
        message: `'${newSpace.name}' 운영 공간이 생성되었습니다.`,
        space: newSpace
      });
    }

    // 4. 최고 관리자 전용: 운영 공간 수정/관리자 지정: PUT /api/spaces/:id
    if (method === 'PUT' && spaceDetailMatch) {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (!isSuperAdmin) {
        return sendJson(res, 403, { success: false, message: '최고 관리자만 운영 공간을 수정할 수 있습니다.' });
      }

      const spaceId = spaceDetailMatch[1];
      const space = dbHelper.getSpaceById(spaceId);
      if (!space) {
        return sendJson(res, 404, { success: false, message: '운영 공간을 찾을 수 없습니다.' });
      }

      const body = await parseBody(req);
      const { name, description, managerId } = body;

      if (!name || !name.trim()) {
        return sendJson(res, 400, { success: false, message: '공간 이름을 입력해 주세요.' });
      }

      const updated = dbHelper.updateSpace({
        id: spaceId,
        name: name.trim(),
        description: (description && description.trim()) || '',
        managerId: managerId || null
      });

      return sendJson(res, 200, {
        success: true,
        message: '운영 공간 정보가 수정되었습니다.',
        space: updated
      });
    }

    // 5. 최고 관리자 전용: 운영 공간 삭제: DELETE /api/spaces/:id
    if (method === 'DELETE' && spaceDetailMatch) {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (!isSuperAdmin) {
        return sendJson(res, 403, { success: false, message: '최고 관리자만 운영 공간을 삭제할 수 있습니다.' });
      }

      const spaceId = spaceDetailMatch[1];
      const space = dbHelper.getSpaceById(spaceId);
      if (!space) {
        return sendJson(res, 404, { success: false, message: '운영 공간을 찾을 수 없습니다.' });
      }

      const allSpaces = dbHelper.getAllSpaces();
      if (allSpaces.length <= 1) {
        return sendJson(res, 400, { success: false, message: '최소 1개의 운영 공간은 유지되어야 합니다.' });
      }

      dbHelper.deleteSpace(spaceId);
      return sendJson(res, 200, {
        success: true,
        message: `'${space.name}' 운영 공간이 삭제되었습니다.`
      });
    }

    // ----------------------------------------------------
    // [2. 공간별 회원 및 권한(Space Members) API - 타 공간 정보 차단]
    // ----------------------------------------------------
    // 1. 공간 소속 회원 목록 조회: GET /api/spaces/:id/members
    const spaceMembersMatch = pathname.match(/^\/api\/spaces\/([^\/]+)\/members$/);
    if (method === 'GET' && spaceMembersMatch) {
      const spaceId = spaceMembersMatch[1];
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 다른 공간의 관리자나 일반 사용자가 해당 공간 회원 정보를 조회할 수 없도록 엄격 차단
      if (!canAccessSpace(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 공간에 소속되지 않아 회원 정보를 조회할 수 없습니다.' });
      }

      const members = dbHelper.getSpaceMembers(spaceId);
      return sendJson(res, 200, { success: true, data: members });
    }

    // 2. 공간 회원 등록: POST /api/spaces/:id/members
    if (method === 'POST' && spaceMembersMatch) {
      const spaceId = spaceMembersMatch[1];
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 해당 공간의 space_admin 또는 super_admin만 회원 등록 가능
      if (!isSpaceAdmin(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 관리자 권한이 없습니다.' });
      }

      const body = await parseBody(req);
      const { userId, username, spaceRole } = body;

      let targetUser = null;
      if (userId) targetUser = dbHelper.findUserById(userId);
      else if (username) targetUser = dbHelper.findUserByUsername(username.trim());

      if (!targetUser) {
        return sendJson(res, 404, { success: false, message: '등록할 사용자를 찾을 수 없습니다.' });
      }

      const member = dbHelper.addSpaceMember(spaceId, targetUser.id, spaceRole || 'member');
      return sendJson(res, 201, {
        success: true,
        message: `${targetUser.name}님이 공간 회원으로 등록되었습니다.`,
        member
      });
    }

    // 3. 공간 회원 권한 변경 / 방출: PATCH/DELETE /api/spaces/:id/members/:userId
    const spaceMemberItemMatch = pathname.match(/^\/api\/spaces\/([^\/]+)\/members\/([^\/]+)$/);
    if (method === 'PATCH' && spaceMemberItemMatch) {
      const spaceId = spaceMemberItemMatch[1];
      const targetUserId = spaceMemberItemMatch[2];

      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (!isSpaceAdmin(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 관리자 권한이 없습니다.' });
      }

      const body = await parseBody(req);
      const { spaceRole } = body;
      if (!['space_admin', 'member'].includes(spaceRole)) {
        return sendJson(res, 400, { success: false, message: '유효한 권한이 아닙니다.' });
      }

      const updated = dbHelper.updateSpaceMemberRole(spaceId, targetUserId, spaceRole);
      return sendJson(res, 200, { success: true, message: '회원 권한이 변경되었습니다.', member: updated });
    }

    if (method === 'DELETE' && spaceMemberItemMatch) {
      const spaceId = spaceMemberItemMatch[1];
      const targetUserId = spaceMemberItemMatch[2];

      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (!isSpaceAdmin(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 관리자 권한이 없습니다.' });
      }

      dbHelper.removeSpaceMember(spaceId, targetUserId);
      return sendJson(res, 200, { success: true, message: '회원이 공간에서 제외되었습니다.' });
    }

    // ----------------------------------------------------
    // [3. 공간별 게시판(Boards) API - 타 공간 게시판 관리 차단]
    // ----------------------------------------------------
    // 1. 특정 공간의 게시판 목록 조회: GET /api/spaces/:id/boards
    const spaceBoardsMatch = pathname.match(/^\/api\/spaces\/([^\/]+)\/boards$/);
    if (method === 'GET' && spaceBoardsMatch) {
      const spaceId = spaceBoardsMatch[1];
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 타 공간 게시판 접근 차단 (403)
      if (!canAccessSpace(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 운영 공간에 소속되지 않아 게시판을 조회할 수 없습니다.' });
      }

      const boards = dbHelper.getBoardsBySpaceId(spaceId);
      return sendJson(res, 200, { success: true, data: boards });
    }

    // 2. 공간 관리자: 해당 공간의 새 게시판 생성: POST /api/spaces/:id/boards
    if (method === 'POST' && spaceBoardsMatch) {
      const spaceId = spaceBoardsMatch[1];
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 자신이 관리하는 공간이 아니면 게시판 생성 불가 (403)
      if (!isSpaceAdmin(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 관리자만 게시판을 생성할 수 있습니다.' });
      }

      const body = await parseBody(req);
      const { name, description, customId } = body;

      if (!name || !name.trim()) {
        return sendJson(res, 400, { success: false, message: '게시판 이름을 입력해 주세요.' });
      }

      const boardId = (customId && customId.trim())
        ? `${spaceId}_${customId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')}`
        : `${spaceId}_b_${crypto.randomUUID().substring(0, 6)}`;

      const existing = dbHelper.getBoardById(boardId);
      if (existing) {
        return sendJson(res, 400, { success: false, message: '이미 존재하는 게시판 ID입니다.' });
      }

      const newBoard = dbHelper.createBoard({
        id: boardId,
        spaceId,
        name: name.trim(),
        description: (description && description.trim()) || ''
      });

      return sendJson(res, 201, {
        success: true,
        message: `'${newBoard.name}' 게시판이 개설되었습니다.`,
        board: newBoard
      });
    }

    // 3. 게시판 수정/삭제: PUT / DELETE /api/boards/:id
    const boardDetailMatch = pathname.match(/^\/api\/boards\/([^\/]+)$/);
    if (method === 'PUT' && boardDetailMatch) {
      const boardId = boardDetailMatch[1];
      const board = dbHelper.getBoardById(boardId);
      if (!board) return sendJson(res, 404, { success: false, message: '게시판을 찾을 수 없습니다.' });

      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 해당 게시판이 속한 공간의 관리자인지 철저히 검증 (타 공간 관리자 수정 불가)
      if (!isSpaceAdmin(board.space_id)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 관리자만 게시판을 수정할 수 있습니다.' });
      }

      const body = await parseBody(req);
      const { name, description } = body;
      if (!name || !name.trim()) return sendJson(res, 400, { success: false, message: '게시판 이름을 입력해 주세요.' });

      const updated = dbHelper.updateBoard({ id: boardId, name: name.trim(), description: (description && description.trim()) || '' });
      return sendJson(res, 200, { success: true, message: '게시판 정보가 수정되었습니다.', board: updated });
    }

    if (method === 'DELETE' && boardDetailMatch) {
      const boardId = boardDetailMatch[1];
      const board = dbHelper.getBoardById(boardId);
      if (!board) return sendJson(res, 404, { success: false, message: '게시판을 찾을 수 없습니다.' });

      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 타 공간 관리자 또는 일반 사용자의 게시판 삭제 차단
      if (!isSpaceAdmin(board.space_id)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 관리자만 게시판을 삭제할 수 있습니다.' });
      }

      dbHelper.deleteBoard(boardId);
      return sendJson(res, 200, { success: true, message: `'${board.name}' 게시판이 삭제되었습니다.` });
    }

    // ----------------------------------------------------
    // [4. 게시글(Posts) API - 공간 격리 및 권한 검증]
    // ----------------------------------------------------
    // 1. 게시글 목록 조회: GET /api/posts?space_id=xxx
    if (method === 'GET' && pathname === '/api/posts') {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }

      const spaceId = parsedUrl.query.space_id;
      const boardId = parsedUrl.query.board_id || null;

      if (!spaceId) {
        if (isSuperAdmin) {
          const allPosts = dbHelper.getAllPosts();
          return sendJson(res, 200, { success: true, data: allPosts });
        }
        return sendJson(res, 400, { success: false, message: '조회할 운영 공간(space_id)을 지정해야 합니다.' });
      }

      // 보안 핵심: space_id를 조작하여 다른 공간의 데이터를 조회하려는 시도 원천 차단 (403)
      if (!canAccessSpace(spaceId)) {
        return sendJson(res, 403, { success: false, message: '해당 운영 공간에 소속되지 않아 게시글을 조회할 수 없습니다.' });
      }

      const posts = dbHelper.getPostsBySpace(spaceId, boardId);
      return sendJson(res, 200, { success: true, data: posts });
    }

    // 2. 게시글 상세 조회: GET /api/posts/:id
    const postDetailMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (method === 'GET' && postDetailMatch) {
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      }

      const postId = parseInt(postDetailMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });

      // 보안 핵심: 타 공간 게시글 URL 직접 접근 차단 (403)
      if (!canAccessSpace(post.space_id)) {
        return sendJson(res, 403, { success: false, message: '해당 운영 공간의 게시글을 열람할 수 있는 권한이 없습니다.' });
      }

      const comments = dbHelper.getCommentsByPostId(postId);
      return sendJson(res, 200, { success: true, post, comments });
    }

    // 3. 게시글 작성: POST /api/posts
    if (method === 'POST' && pathname === '/api/posts') {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (isSuspended) return sendJson(res, 403, { success: false, message: '이용이 제한된 계정입니다.' });

      const body = await parseBody(req);
      const { boardId, title, content, isNotice } = body;

      if (!boardId) return sendJson(res, 400, { success: false, message: '게시판을 선택해 주세요.' });
      const targetBoard = dbHelper.getBoardById(boardId);
      if (!targetBoard) return sendJson(res, 404, { success: false, message: '존재하지 않는 게시판입니다.' });

      // 보안 검증: 해당 공간의 정식 회원이 아니면 글 작성 차단 (403)
      if (!canAccessSpace(targetBoard.space_id)) {
        return sendJson(res, 403, { success: false, message: '해당 공간의 회원이 아니므로 글을 작성할 수 없습니다.' });
      }

      if (!title || !title.trim() || !content || !content.trim()) {
        return sendJson(res, 400, { success: false, message: '제목과 내용을 모두 입력해 주세요.' });
      }

      const canPostNotice = isSpaceAdmin(targetBoard.space_id);
      const noticeFlag = (isNotice && canPostNotice) ? 1 : 0;

      const newPost = dbHelper.createPost({
        boardId: targetBoard.id,
        userId: currentUser.id,
        title: title.trim(),
        content: content.trim(),
        isNotice: noticeFlag
      });

      return sendJson(res, 201, {
        success: true,
        message: `'${targetBoard.name}'에 글이 등록되었습니다.`,
        post: newPost
      });
    }

    // 4. 게시글 수정: PUT /api/posts/:id (작성자 본인만 수정 가능)
    if (method === 'PUT' && postDetailMatch) {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (isSuspended) return sendJson(res, 403, { success: false, message: '이용이 제한된 계정입니다.' });

      const postId = parseInt(postDetailMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });

      // 보안 조건: 다른 사용자의 게시글 수정 원천 차단 (403) - 관리자라도 작성자 본인이 아니면 원문 수정 불가
      if (post.user_id !== currentUser.id) {
        return sendJson(res, 403, { success: false, message: '본인이 작성한 게시글만 수정할 수 있습니다.' });
      }

      const body = await parseBody(req);
      const { boardId, title, content, isNotice } = body;
      if (!title || !title.trim() || !content || !content.trim()) {
        return sendJson(res, 400, { success: false, message: '제목과 내용을 모두 입력해 주세요.' });
      }

      const canPostNotice = isSpaceAdmin(post.space_id);
      const noticeFlag = canPostNotice ? (isNotice ? 1 : 0) : post.is_notice;

      const updated = dbHelper.updatePost({
        postId,
        boardId: boardId || post.board_id,
        title: title.trim(),
        content: content.trim(),
        isNotice: noticeFlag
      });

      return sendJson(res, 200, { success: true, message: '게시글이 수정되었습니다.', post: updated });
    }

    // 5. 게시글 삭제: DELETE /api/posts/:id (작성자 본인 또는 해당 공간의 관리자만 가능)
    if (method === 'DELETE' && postDetailMatch) {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (isSuspended) return sendJson(res, 403, { success: false, message: '이용이 제한된 계정입니다.' });

      const postId = parseInt(postDetailMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });

      const isAuthor = post.user_id === currentUser.id;
      const hasSpaceAdmin = isSpaceAdmin(post.space_id);

      // 보안 조건: 타 공간 관리자 또는 타 일반 사용자의 글 삭제 시도 차단 (403)
      if (!isAuthor && !hasSpaceAdmin) {
        return sendJson(res, 403, { success: false, message: '해당 게시글을 삭제할 수 있는 권한이 없습니다.' });
      }

      dbHelper.deletePost(postId);
      return sendJson(res, 200, {
        success: true,
        message: hasSpaceAdmin && !isAuthor ? '공간 관리 조치로 게시글이 삭제되었습니다.' : '게시글이 삭제되었습니다.'
      });
    }

    // ----------------------------------------------------
    // [5. 댓글 API - 공간 격리 및 권한 검증]
    // ----------------------------------------------------
    const commentCreateMatch = pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
    if (method === 'POST' && commentCreateMatch) {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (isSuspended) return sendJson(res, 403, { success: false, message: '이용이 제한된 계정입니다.' });

      const postId = parseInt(commentCreateMatch[1], 10);
      const post = dbHelper.getPostById(postId);
      if (!post) return sendJson(res, 404, { success: false, message: '게시글이 존재하지 않습니다.' });

      // 보안 조건: 타 공간 게시글에 댓글 작성 불가
      if (!canAccessSpace(post.space_id)) {
        return sendJson(res, 403, { success: false, message: '해당 공간 회원이 아니므로 댓글을 작성할 수 없습니다.' });
      }

      const body = await parseBody(req);
      const { content } = body;
      if (!content || !content.trim()) return sendJson(res, 400, { success: false, message: '댓글 내용을 입력해 주세요.' });

      const newComment = dbHelper.createComment({
        postId,
        userId: currentUser.id,
        content: content.trim()
      });

      return sendJson(res, 201, { success: true, message: '댓글이 등록되었습니다.', comment: newComment });
    }

    const commentDeleteMatch = pathname.match(/^\/api\/comments\/(\d+)$/);
    if (method === 'DELETE' && commentDeleteMatch) {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });
      if (isSuspended) return sendJson(res, 403, { success: false, message: '이용이 제한된 계정입니다.' });

      const commentId = parseInt(commentDeleteMatch[1], 10);
      const comment = dbHelper.getCommentById(commentId);
      if (!comment) return sendJson(res, 404, { success: false, message: '댓글이 존재하지 않습니다.' });

      const post = dbHelper.getPostById(comment.post_id);
      const isCommentAuthor = comment.user_id === currentUser.id;
      const hasSpaceAdmin = post ? isSpaceAdmin(post.space_id) : isSuperAdmin;

      // 보안 조건: 본인 댓글이 아니거나 해당 공간 관리자가 아니면 삭제 차단
      if (!isCommentAuthor && !hasSpaceAdmin) {
        return sendJson(res, 403, { success: false, message: '댓글을 삭제할 수 있는 권한이 없습니다.' });
      }

      dbHelper.deleteComment(commentId);
      return sendJson(res, 200, {
        success: true,
        message: hasSpaceAdmin && !isCommentAuthor ? '관리자 권한으로 댓글이 삭제되었습니다.' : '댓글이 삭제되었습니다.'
      });
    }

    // ----------------------------------------------------
    // [6. 전체 및 공간별 대시보드 모니터링 API - 일반 사용자 차단]
    // ----------------------------------------------------
    // 전체 사용자 목록 조회: GET /api/admin/users
    if (method === 'GET' && pathname === '/api/admin/users') {
      if (!currentUser) return sendJson(res, 401, { success: false, message: '로그인이 필요합니다.' });

      // 보안 조건: 최고 관리자이거나 최소 1개 이상 공간의 관리자만 전체 사용자 목록(회원 배정용) 열람 가능
      const isAnyAdmin = isSuperAdmin || dbHelper.getUserAccessibleSpaces(currentUser.id).some(s => s.space_role === 'space_admin');
      if (!isAnyAdmin) {
        return sendJson(res, 403, { success: false, message: '관리자 권한이 없습니다.' });
      }

      const users = dbHelper.getAllUsers();
      return sendJson(res, 200, { success: true, data: users });
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
  console.log(`[서버 시작] 보안 강화된 복합 다중 게시판 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
