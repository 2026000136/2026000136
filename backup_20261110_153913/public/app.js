// 전역 상태
const state = {
  currentUser: null,
  posts: [],
  currentPost: null,
  currentComments: [],
  currentView: 'list',
  adminUsers: [],
  adminNotices: [],
  adminComments: []
};

// DOM 로드 시 초기화
document.addEventListener('DOMContentLoaded', async () => {
  restoreUserSession();
  await checkAuthStatus();
  await loadPosts();

  window.addEventListener('hashchange', handleHashChange);
  if (window.location.hash) {
    handleHashChange();
  } else {
    navigateTo('list');
  }
});

// ----------------------------------------------------
// [화면 전환 라우팅 & 권한 가드]
// ----------------------------------------------------
function navigateTo(viewName, param = null) {
  // 관리자 전용 화면 접근 통제 (클라이언트 1차 가드)
  if (['admin-dashboard', 'admin-notices', 'admin-users'].includes(viewName)) {
    if (!state.currentUser || state.currentUser.role !== 'admin') {
      alert('접근 권한이 없습니다. 관리자만 접근할 수 있습니다.');
      navigateTo('list');
      return;
    }
  }

  state.currentView = viewName;
  window.location.hash = param ? `${viewName}/${param}` : viewName;

  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  }

  // 관리자 탭 활성화 상태 변경
  document.querySelectorAll('.admin-nav-tab').forEach(t => t.classList.remove('active'));
  if (viewName === 'admin-dashboard') document.getElementById('tabAdminDash')?.classList.add('active');
  if (viewName === 'admin-notices') document.getElementById('tabAdminNotices')?.classList.add('active');
  if (viewName === 'admin-users') document.getElementById('tabAdminUsers')?.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 뷰별 데이터 로드
  if (viewName === 'list') {
    loadPosts();
  } else if (viewName === 'write') {
    setupWriteView(param === 'notice');
  } else if (viewName === 'detail' && param) {
    loadPostDetail(param);
  } else if (viewName === 'admin-dashboard') {
    loadAdminDashboard();
  } else if (viewName === 'admin-notices') {
    loadAdminNotices();
  } else if (viewName === 'admin-users') {
    loadAdminUsers();
  }
}

function handleHashChange() {
  const hash = window.location.hash.replace('#', '');
  if (!hash) {
    navigateTo('list');
    return;
  }
  const parts = hash.split('/');
  const view = parts[0];
  const param = parts[1] || null;
  navigateTo(view, param);
}

// ----------------------------------------------------
// [회원 인증 및 상단 UI]
// ----------------------------------------------------
function restoreUserSession() {
  const saved = localStorage.getItem('dept_board_user');
  if (saved) {
    try {
      state.currentUser = JSON.parse(saved);
      updateNavUI();
    } catch (e) {
      localStorage.removeItem('dept_board_user');
    }
  }
}

async function checkAuthStatus() {
  if (!state.currentUser) {
    updateNavUI();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      state.currentUser = result.user;
      localStorage.setItem('dept_board_user', JSON.stringify(result.user));
    } else {
      state.currentUser = null;
      localStorage.removeItem('dept_board_user');
    }
    updateNavUI();
  } catch (err) {
    console.error('Auth check error:', err);
  }
}

function updateNavUI() {
  const navGuest = document.getElementById('navGuest');
  const navAuth = document.getElementById('navAuth');
  const navAvatar = document.getElementById('navAvatar');
  const navUserName = document.getElementById('navUserName');
  const navUserRole = document.getElementById('navUserRole');
  const navUserStatus = document.getElementById('navUserStatus');
  const btnAdminNav = document.getElementById('btnAdminNav');
  const adminSubNav = document.getElementById('adminSubNav');

  if (state.currentUser) {
    navGuest.style.display = 'none';
    navAuth.style.display = 'flex';
    navAvatar.textContent = state.currentUser.name.charAt(0);
    navUserName.textContent = state.currentUser.name;

    const isAdmin = state.currentUser.role === 'admin';
    const isSuspended = state.currentUser.status === 'suspended';

    navAvatar.className = `user-avatar ${isAdmin ? 'admin' : ''}`;
    navUserRole.className = `role-badge ${isAdmin ? 'admin' : 'user'}`;
    navUserRole.textContent = isAdmin ? '관리자' : '일반 사용자';

    if (isSuspended) {
      navUserStatus.style.display = 'inline-block';
      navUserStatus.className = 'status-badge suspended';
      navUserStatus.textContent = '이용 제한됨';
    } else {
      navUserStatus.style.display = 'none';
    }

    if (isAdmin) {
      btnAdminNav.style.display = 'inline-flex';
      adminSubNav.style.display = 'block';
    } else {
      btnAdminNav.style.display = 'none';
      adminSubNav.style.display = 'none';
    }
  } else {
    navGuest.style.display = 'flex';
    navAuth.style.display = 'none';
    btnAdminNav.style.display = 'none';
    adminSubNav.style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      state.currentUser = data.user;
      localStorage.setItem('dept_board_user', JSON.stringify(data.user));
      updateNavUI();
      alert(`${data.user.name}님 환영합니다! (${data.user.role === 'admin' ? '관리자 권한' : '일반 사용자 권한'})`);
      navigateTo('list');
    } else {
      alert(data.message || '로그인에 실패했습니다.');
    }
  } catch (err) {
    alert('서버와 통신 중 오류가 발생했습니다.');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const department = document.getElementById('regDept').value.trim();

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, password, department })
    });
    const data = await res.json();

    if (data.success) {
      state.currentUser = data.user;
      localStorage.setItem('dept_board_user', JSON.stringify(data.user));
      updateNavUI();
      alert(`회원가입이 완료되었습니다!\n${data.user.name}님으로 자동 로그인되었습니다.`);
      navigateTo('list');
    } else {
      alert(data.message || '회원가입에 실패했습니다.');
    }
  } catch (err) {
    alert('서버와 통신 중 오류가 발생했습니다.');
  }
}

function logout() {
  state.currentUser = null;
  localStorage.removeItem('dept_board_user');
  updateNavUI();
  alert('로그아웃되었습니다.');
  navigateTo('list');
}

function fillLoginForm(username, password) {
  document.getElementById('loginUsername').value = username;
  document.getElementById('loginPassword').value = password;
}

// ----------------------------------------------------
// [일반 사용자 & 게시판 기능]
// ----------------------------------------------------
async function loadPosts() {
  try {
    const res = await fetch('/api/posts');
    const result = await res.json();
    if (result.success) {
      state.posts = result.data;
      renderPostsTable(state.posts);
    }
  } catch (err) {
    console.error('Failed to load posts:', err);
  }
}

function renderPostsTable(posts) {
  const tbody = document.getElementById('postsTableBody');
  if (!posts || posts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
          등록된 게시글이 없습니다. 첫 글을 작성해 보세요!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = posts.map(post => {
    const isNotice = post.is_notice === 1;
    const numOrNotice = isNotice
      ? `<span class="notice-tag">공지</span>`
      : `<span style="font-weight: 600; color: #64748b;">${post.id}</span>`;

    const commentBadge = (post.comment_count > 0)
      ? `<span class="comment-count-pill">[${post.comment_count}]</span>`
      : '';

    const roleBadge = post.author_role === 'admin'
      ? `<span class="role-badge admin" style="margin-left: 4px;">관리자</span>`
      : '';

    return `
      <tr class="post-row ${isNotice ? 'is-notice' : ''}" onclick="navigateTo('detail', ${post.id})">
        <td style="text-align: center;">${numOrNotice}</td>
        <td class="post-title-cell">
          <span>${escapeHtml(post.title)}</span>
          ${commentBadge}
        </td>
        <td>
          <span style="font-size: 0.9rem; font-weight: 500; color: #334155;">${escapeHtml(post.author_name)}</span>
          ${roleBadge}
        </td>
        <td style="text-align: center; font-size: 0.82rem; color: #64748b;">
          ${formatDateTime(post.created_at)}
        </td>
        <td style="text-align: right; font-size: 0.82rem; color: #94a3b8;">
          ${formatDateTime(post.updated_at)}
        </td>
      </tr>
    `;
  }).join('');
}

// ----------------------------------------------------
// [게시글 작성/수정 화면 제어]
// ----------------------------------------------------
function setupWriteView(asNotice = false) {
  if (!state.currentUser) {
    alert('게시글을 작성하려면 로그인이 필요합니다.');
    navigateTo('login');
    return;
  }

  if (state.currentUser.status === 'suspended') {
    alert('현재 이용이 제한된 계정입니다. 글을 작성할 수 없습니다.');
    navigateTo('list');
    return;
  }

  document.getElementById('writeAuthor').value = `${state.currentUser.name} (${state.currentUser.department || '소프트웨어학부'})`;
  document.getElementById('writeTitle').value = '';
  document.getElementById('writeContent').value = '';

  const noticeGroup = document.getElementById('writeNoticeGroup');
  const isNoticeCheck = document.getElementById('writeIsNotice');

  // 관리자에게만 공지사항 등록 체크박스 활성화
  if (state.currentUser.role === 'admin') {
    noticeGroup.style.display = 'block';
    isNoticeCheck.checked = asNotice;
  } else {
    noticeGroup.style.display = 'none';
    isNoticeCheck.checked = false;
  }
}

function openNoticeWrite() {
  navigateTo('write', 'notice');
}

async function handleCreatePost(e) {
  e.preventDefault();
  if (!state.currentUser) {
    alert('로그인이 필요합니다.');
    navigateTo('login');
    return;
  }

  const title = document.getElementById('writeTitle').value.trim();
  const content = document.getElementById('writeContent').value.trim();
  const isNotice = document.getElementById('writeIsNotice').checked;

  try {
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': state.currentUser.id
      },
      body: JSON.stringify({ title, content, isNotice })
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message || '게시글이 등록되었습니다.');
      navigateTo('detail', result.post.id);
    } else {
      alert(result.message || '게시글 작성에 실패했습니다.');
    }
  } catch (err) {
    alert('게시글 등록 중 통신 오류가 발생했습니다.');
  }
}

// ----------------------------------------------------
// [게시글 상세 및 권한별 수정/삭제]
// ----------------------------------------------------
async function loadPostDetail(postId) {
  try {
    const res = await fetch(`/api/posts/${postId}`);
    const result = await res.json();
    if (result.success) {
      state.currentPost = result.post;
      state.currentComments = result.comments;
      renderPostDetail();
    } else {
      alert(result.message || '게시글을 찾을 수 없습니다.');
      navigateTo('list');
    }
  } catch (err) {
    console.error('Load detail error:', err);
    alert('게시글을 불러오는 중 오류가 발생했습니다.');
  }
}

function renderPostDetail() {
  const post = state.currentPost;
  if (!post) return;

  const isNotice = post.is_notice === 1;
  const noticeBadge = document.getElementById('detailNoticeBadge');
  if (isNotice) {
    noticeBadge.style.display = 'inline-block';
  } else {
    noticeBadge.style.display = 'none';
  }

  document.getElementById('detailPostNumber').textContent = `No. ${post.id}`;
  document.getElementById('detailTitle').textContent = post.title;

  const roleText = post.author_role === 'admin' ? ' [관리자]' : '';
  document.getElementById('detailAuthor').textContent = `${post.author_name}${roleText} (${post.author_username})`;
  document.getElementById('detailCreatedAt').textContent = formatDateTime(post.created_at);

  const updatedWrap = document.getElementById('detailUpdatedWrap');
  const updatedAtEl = document.getElementById('detailUpdatedAt');
  if (post.updated_at && post.updated_at !== post.created_at) {
    updatedWrap.style.display = 'inline-flex';
    updatedAtEl.textContent = formatDateTime(post.updated_at);
  } else {
    updatedWrap.style.display = 'none';
  }

  document.getElementById('detailContent').textContent = post.content;

  // 권한별 버튼 가시성 제어:
  // - 수정 버튼: 오직 작성자 본인에게만 표시 (일반 사용자의 타인 글 수정 불가)
  // - 삭제 버튼: 작성자 본인 OR 관리자에게 표시 (관리자의 부적절한 글 관리 가능)
  const btnEdit = document.getElementById('btnEditPost');
  const btnDelete = document.getElementById('btnDeletePost');

  const isAuthor = state.currentUser && state.currentUser.id === post.user_id;
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';

  if (isAuthor) {
    btnEdit.style.display = 'inline-flex';
  } else {
    btnEdit.style.display = 'none';
  }

  if (isAuthor || isAdmin) {
    btnDelete.style.display = 'inline-flex';
    btnDelete.textContent = isAdmin && !isAuthor ? '🛡️ 관리자 권한으로 삭제' : '🗑️ 삭제';
  } else {
    btnDelete.style.display = 'none';
  }

  renderComments();
}

function handleEditCurrentPost() {
  if (!state.currentPost || !state.currentUser) return;
  if (state.currentPost.user_id !== state.currentUser.id) {
    alert('본인이 작성한 게시글만 수정할 수 있습니다.');
    return;
  }

  document.getElementById('editPostId').value = state.currentPost.id;
  document.getElementById('editAuthor').value = `${state.currentPost.author_name} (본인)`;
  document.getElementById('editTitle').value = state.currentPost.title;
  document.getElementById('editContent').value = state.currentPost.content;

  const noticeGroup = document.getElementById('editNoticeGroup');
  const isNoticeCheck = document.getElementById('editIsNotice');
  if (state.currentUser.role === 'admin') {
    noticeGroup.style.display = 'block';
    isNoticeCheck.checked = state.currentPost.is_notice === 1;
  } else {
    noticeGroup.style.display = 'none';
  }

  navigateTo('edit');
}

async function handleUpdatePost(e) {
  e.preventDefault();
  const postId = document.getElementById('editPostId').value;
  const title = document.getElementById('editTitle').value.trim();
  const content = document.getElementById('editContent').value.trim();
  const isNotice = document.getElementById('editIsNotice').checked;

  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': state.currentUser.id
      },
      body: JSON.stringify({ title, content, isNotice })
    });
    const result = await res.json();

    if (result.success) {
      alert('게시글이 수정되었습니다.');
      navigateTo('detail', postId);
    } else {
      alert(result.message || '게시글 수정에 실패했습니다.');
    }
  } catch (err) {
    alert('게시글 수정 중 오류가 발생했습니다.');
  }
}

async function handleDeleteCurrentPost() {
  if (!state.currentPost || !state.currentUser) return;

  const isAuthor = state.currentPost.user_id === state.currentUser.id;
  const isAdmin = state.currentUser.role === 'admin';

  if (!isAuthor && !isAdmin) {
    alert('게시글을 삭제할 권한이 없습니다.');
    return;
  }

  const confirmMsg = isAdmin && !isAuthor
    ? '[관리자 조치] 부적절한 게시글로 판단하여 삭제하시겠습니까?'
    : '정말로 이 게시글을 삭제하시겠습니까?';

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/posts/${state.currentPost.id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message || '게시글이 삭제되었습니다.');
      navigateTo('list');
    } else {
      alert(result.message || '게시글 삭제에 실패했습니다.');
    }
  } catch (err) {
    alert('게시글 삭제 중 오류가 발생했습니다.');
  }
}

// ----------------------------------------------------
// [댓글 영역 및 본인/관리자 삭제 권한]
// ----------------------------------------------------
function renderComments() {
  const commentList = document.getElementById('commentList');
  const commentCountEl = document.getElementById('detailCommentCount');
  const commentNoticeMsg = document.getElementById('commentNoticeMsg');
  const writeBox = document.getElementById('commentWriteBox');

  commentCountEl.textContent = `(${state.currentComments.length})`;

  if (!state.currentUser) {
    commentNoticeMsg.style.display = 'block';
    commentNoticeMsg.innerHTML = `댓글을 작성하려면 <a href="#" onclick="navigateTo('login'); return false;" style="color: var(--accent); font-weight: 600; text-decoration: underline;">로그인</a>해 주세요.`;
    writeBox.style.display = 'none';
  } else if (state.currentUser.status === 'suspended') {
    commentNoticeMsg.style.display = 'block';
    commentNoticeMsg.innerHTML = `<span style="color: var(--danger); font-weight: 600;">⚠️ 현재 계정이 이용 제한 상태이므로 댓글을 작성할 수 없습니다.</span>`;
    writeBox.style.display = 'none';
  } else {
    commentNoticeMsg.style.display = 'none';
    writeBox.style.display = 'block';
  }

  if (state.currentComments.length === 0) {
    commentList.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; color: #94a3b8; font-size: 0.9rem;">
        작성된 댓글이 없습니다. 첫 댓글을 남겨보세요!
      </div>
    `;
    return;
  }

  const isAdmin = state.currentUser && state.currentUser.role === 'admin';

  commentList.innerHTML = state.currentComments.map(c => {
    const isCommentAuthor = state.currentUser && state.currentUser.id === c.user_id;
    const canDelete = isCommentAuthor || isAdmin;

    const deleteBtn = canDelete
      ? `<button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="handleDeleteComment(${c.id}, ${isAdmin && !isCommentAuthor})">${isAdmin && !isCommentAuthor ? '관리자 삭제' : '삭제'}</button>`
      : '';

    return `
      <div class="comment-item">
        <div class="comment-item-header">
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="comment-author">💬 ${escapeHtml(c.author_name)}</span>
            ${c.author_role === 'admin' ? '<span class="role-badge admin">관리자</span>' : ''}
            <span class="comment-date">(${formatDateTime(c.created_at)})</span>
          </div>
          ${deleteBtn}
        </div>
        <div class="comment-content">${escapeHtml(c.content)}</div>
      </div>
    `;
  }).join('');
}

async function handleCreateComment() {
  if (!state.currentUser) {
    alert('댓글을 작성하려면 로그인이 필요합니다.');
    navigateTo('login');
    return;
  }
  if (state.currentUser.status === 'suspended') {
    alert('이용이 제한된 계정은 댓글을 작성할 수 없습니다.');
    return;
  }

  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content) {
    alert('댓글 내용을 입력해 주세요.');
    return;
  }

  try {
    const res = await fetch(`/api/posts/${state.currentPost.id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': state.currentUser.id
      },
      body: JSON.stringify({ content })
    });
    const result = await res.json();

    if (result.success) {
      input.value = '';
      state.currentComments.push(result.comment);
      renderComments();
    } else {
      alert(result.message || '댓글 등록에 실패했습니다.');
    }
  } catch (err) {
    alert('댓글 등록 중 오류가 발생했습니다.');
  }
}

async function handleDeleteComment(commentId, isForceAdmin = false) {
  const msg = isForceAdmin
    ? '[관리자 조치] 부적절한 댓글로 판단하여 삭제하시겠습니까?'
    : '작성하신 댓글을 삭제하시겠습니까?';

  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/comments/${commentId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();

    if (result.success) {
      state.currentComments = state.currentComments.filter(c => c.id !== commentId);
      renderComments();
      if (state.currentView === 'admin-dashboard') {
        loadAdminDashboard();
      }
    } else {
      alert(result.message || '댓글 삭제에 실패했습니다.');
    }
  } catch (err) {
    alert('댓글 삭제 중 오류가 발생했습니다.');
  }
}

// ----------------------------------------------------
// [관리자 전용 화면 로직]
// ----------------------------------------------------
// 1. 관리자 통합 대시보드
async function loadAdminDashboard() {
  try {
    // 병렬 데이터 페칭
    const [postsRes, usersRes, commentsRes] = await Promise.all([
      fetch('/api/posts'),
      fetch('/api/admin/users', { headers: { 'x-user-id': state.currentUser.id } }),
      fetch('/api/admin/comments', { headers: { 'x-user-id': state.currentUser.id } })
    ]);

    const postsData = await postsRes.json();
    const usersData = await usersRes.json();
    const commentsData = await commentsRes.json();

    if (usersData.success && commentsData.success) {
      state.posts = postsData.data;
      state.adminUsers = usersData.data;
      state.adminComments = commentsData.data;

      // 통계 바인딩
      document.getElementById('statTotalPosts').textContent = state.posts.length;
      document.getElementById('statTotalUsers').textContent = state.adminUsers.length;
      document.getElementById('statTotalComments').textContent = state.adminComments.length;

      renderAdminPostsTable();
      renderAdminCommentsTable();
    } else {
      alert(usersData.message || '관리자 권한이 확인되지 않았습니다.');
      navigateTo('list');
    }
  } catch (err) {
    console.error('Failed to load admin dashboard:', err);
  }
}

function renderAdminPostsTable() {
  const tbody = document.getElementById('adminPostsTableBody');
  tbody.innerHTML = state.posts.map(p => {
    return `
      <tr>
        <td style="text-align: center; font-weight: 600;">${p.id}</td>
        <td>
          ${p.is_notice === 1 ? '<span class="notice-tag">공지</span> ' : ''}
          <a href="#" onclick="navigateTo('detail', ${p.id}); return false;" style="font-weight: 600; color: var(--text-main);">
            ${escapeHtml(p.title)}
          </a>
        </td>
        <td>${escapeHtml(p.author_name)} (${p.author_username})</td>
        <td style="font-size: 0.82rem; color: #64748b;">${formatDateTime(p.created_at)}</td>
        <td style="text-align: center;">
          <button class="btn-danger" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="adminForceDeletePost(${p.id})">
            삭제
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminCommentsTable() {
  const tbody = document.getElementById('adminCommentsTableBody');
  if (state.adminComments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 1.5rem; color:#94a3b8;">등록된 댓글이 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.adminComments.map(c => {
    return `
      <tr>
        <td style="text-align: center; font-weight: 600;">${c.id}</td>
        <td style="font-size: 0.85rem; color: var(--text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">
          <a href="#" onclick="navigateTo('detail', ${c.post_id}); return false;">${escapeHtml(c.post_title)}</a>
        </td>
        <td>${escapeHtml(c.content)}</td>
        <td>${escapeHtml(c.author_name)}</td>
        <td style="text-align: center;">
          <button class="btn-danger" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="handleDeleteComment(${c.id}, true)">
            삭제
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function adminForceDeletePost(postId) {
  if (!confirm(`[관리자 제재] ${postId}번 게시글을 삭제하시겠습니까?`)) return;

  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      loadAdminDashboard();
    } else {
      alert(result.message || '삭제 실패');
    }
  } catch (err) {
    alert('삭제 통신 오류');
  }
}

// 2. 관리자 공지사항 관리 화면
async function loadAdminNotices() {
  try {
    const res = await fetch('/api/admin/notices', {
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      state.adminNotices = result.data;
      renderAdminNoticesTable();
    } else {
      alert(result.message || '공지사항 목록 조회 실패');
    }
  } catch (err) {
    console.error('Admin notices error:', err);
  }
}

function renderAdminNoticesTable() {
  const tbody = document.getElementById('adminNoticesTableBody');
  if (state.adminNotices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color:#94a3b8;">등록된 공지사항이 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.adminNotices.map(n => {
    return `
      <tr>
        <td style="text-align: center; font-weight: 600;">${n.id}</td>
        <td>
          <span class="notice-tag">공지</span>
          <a href="#" onclick="navigateTo('detail', ${n.id}); return false;" style="font-weight: 600; color: var(--text-main); margin-left: 0.3rem;">
            ${escapeHtml(n.title)}
          </a>
        </td>
        <td>${escapeHtml(n.author_name)}</td>
        <td style="font-size: 0.82rem; color: #64748b;">${formatDateTime(n.created_at)}</td>
        <td style="text-align: center;">
          <button class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="navigateTo('detail', ${n.id})">확인</button>
          <button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="adminForceDeletePost(${n.id})">삭제</button>
        </td>
      </tr>
    `;
  }).join('');
}

// 3. 관리자 회원 관리 및 이용 제한 화면
async function loadAdminUsers() {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      state.adminUsers = result.data;
      renderAdminUsersTable();
    } else {
      alert(result.message || '회원 목록 조회 실패');
    }
  } catch (err) {
    console.error('Admin users error:', err);
  }
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('adminUsersTableBody');
  tbody.innerHTML = state.adminUsers.map(u => {
    const isAdmin = u.role === 'admin';
    const isSuspended = u.status === 'suspended';

    const roleBadge = isAdmin
      ? `<span class="role-badge admin">관리자</span>`
      : `<span class="role-badge user">일반</span>`;

    const statusBadge = isSuspended
      ? `<span class="status-badge suspended">이용 제한</span>`
      : `<span class="status-badge active">정상</span>`;

    let actionBtn = '-';
    if (!isAdmin) {
      if (isSuspended) {
        actionBtn = `<button class="btn-outline" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; color: var(--success); border-color: var(--success);" onclick="toggleUserStatus('${u.id}', 'active')">제한 해제</button>`;
      } else {
        actionBtn = `<button class="btn-danger" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="toggleUserStatus('${u.id}', 'suspended')">이용 제한</button>`;
      }
    }

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.name)}</td>
        <td style="text-align: center;">${roleBadge}</td>
        <td style="text-align: center;">${statusBadge}</td>
        <td style="font-size: 0.85rem; color: #64748b;">${escapeHtml(u.department || '-')}</td>
        <td style="text-align: center; font-size: 0.85rem;">글 ${u.post_count} / 댓 ${u.comment_count}</td>
        <td style="text-align: center;">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

async function toggleUserStatus(userId, newStatus) {
  const promptText = newStatus === 'suspended'
    ? '해당 회원의 게시판 글쓰기 및 댓글 작성을 제한하시겠습니까?'
    : '해당 회원의 이용 제한을 해제하시겠습니까?';

  if (!confirm(promptText)) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': state.currentUser.id
      },
      body: JSON.stringify({ status: newStatus })
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message);
      loadAdminUsers();
    } else {
      alert(result.message || '상태 변경에 실패했습니다.');
    }
  } catch (err) {
    alert('회원 상태 변경 통신 오류');
  }
}

// ----------------------------------------------------
// [공통 유틸리티]
// ----------------------------------------------------
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return dateStr;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
