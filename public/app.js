// 복합 다중 게시판 전역 상태 관리
const state = {
  currentUser: null,
  isSuperAdmin: false,
  accessibleSpaces: [],
  currentSpace: null, // 현재 선택된 운영 공간 객체
  currentSpaceRole: null, // 현재 공간에서 사용자 권한 ('space_admin', 'member', null)
  boards: [],
  selectedBoardId: 'all',
  posts: [],
  currentPost: null,
  currentComments: [],
  currentView: 'list',
  allUsers: [] // 관리자용 전체 회원 목록
};

// DOM 로드 시 초기화
document.addEventListener('DOMContentLoaded', async () => {
  restoreUserSession();
  await checkAuthStatus();
  await loadAccessibleSpaces();

  window.addEventListener('hashchange', handleHashChange);
  if (window.location.hash) {
    handleHashChange();
  } else {
    navigateTo('list');
  }
});

// ----------------------------------------------------
// [운영 공간 로드 및 전환]
// ----------------------------------------------------
async function loadAccessibleSpaces() {
  try {
    const res = await fetch('/api/spaces', {
      headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {}
    });
    const result = await res.json();
    if (result.success) {
      state.accessibleSpaces = result.data;

      // 현재 공간이 지정되지 않았다면 첫 번째 공간을 기본값으로 설정
      if (!state.currentSpace && state.accessibleSpaces.length > 0) {
        state.currentSpace = state.accessibleSpaces[0];
      }

      renderSpaceSelector();
      if (state.currentSpace) {
        await refreshCurrentSpaceData();
      }
    }
  } catch (err) {
    console.error('Failed to load spaces:', err);
  }
}

function renderSpaceSelector() {
  const selector = document.getElementById('spaceSelector');
  const regSelect = document.getElementById('regSpace');

  if (!selector) return;

  selector.innerHTML = state.accessibleSpaces.map(s => `
    <option value="${s.id}" ${state.currentSpace && state.currentSpace.id === s.id ? 'selected' : ''}>
      🏛️ ${escapeHtml(s.name)}
    </option>
  `).join('');

  if (regSelect) {
    regSelect.innerHTML = state.accessibleSpaces.map(s => `
      <option value="${s.id}">${escapeHtml(s.name)}</option>
    `).join('');
  }
}

async function handleSpaceSelectChange(e) {
  const newSpaceId = e.target.value;
  await switchCurrentSpace(newSpaceId);
}

async function switchCurrentSpace(spaceId) {
  const targetSpace = state.accessibleSpaces.find(s => s.id === spaceId);
  if (!targetSpace) return;

  state.currentSpace = targetSpace;
  state.selectedBoardId = 'all';

  await refreshCurrentSpaceData();

  if (state.currentView === 'spaces') {
    navigateTo('list');
  } else {
    loadViewData(state.currentView);
  }
}

async function refreshCurrentSpaceData() {
  if (!state.currentSpace) return;

  // 1. 현재 공간 상세 및 내 권한 조회
  try {
    const res = await fetch(`/api/spaces/${state.currentSpace.id}`, {
      headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {}
    });
    const result = await res.json();
    if (result.success) {
      state.currentSpace = result.space;
      state.currentSpaceRole = result.roleInSpace;
    }
  } catch (e) {}

  updateSidebarSpaceInfo();
  await loadCurrentSpaceBoards();
}

function updateSidebarSpaceInfo() {
  if (!state.currentSpace) return;

  document.getElementById('sidebarSpaceName').textContent = state.currentSpace.name;
  document.getElementById('sidebarSpaceDesc').textContent = state.currentSpace.description || '학과 소통 공간';
  document.getElementById('sidebarSpaceManager').textContent = state.currentSpace.manager_name || '미지정';

  // 공간 관리자 권한 확인
  const isManagerOfThisSpace = state.isSuperAdmin || state.currentSpaceRole === 'space_admin';
  const sidebarAdminCard = document.getElementById('sidebarAdminCard');
  if (sidebarAdminCard) {
    sidebarAdminCard.style.display = isManagerOfThisSpace ? 'block' : 'none';
  }

  // 상단 공간 관리자 센터 바로가기 버튼 제어
  const btnSpaceAdminNav = document.getElementById('btnSpaceAdminNav');
  if (btnSpaceAdminNav) {
    btnSpaceAdminNav.style.display = isManagerOfThisSpace ? 'inline-flex' : 'none';
  }
}

async function loadCurrentSpaceBoards() {
  if (!state.currentSpace) return;

  try {
    const res = await fetch(`/api/spaces/${state.currentSpace.id}/boards`, {
      headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {}
    });
    const result = await res.json();
    if (result.success) {
      state.boards = result.data;
      renderSidebarBoards();
      populateBoardSelects();
    }
  } catch (err) {
    console.error('Failed to load boards for current space:', err);
  }
}

function renderSidebarBoards() {
  const listEl = document.getElementById('sidebarBoardList');
  if (!listEl) return;

  const totalCount = state.boards.reduce((acc, b) => acc + (b.post_count || 0), 0);

  let html = `
    <li class="board-nav-item ${state.selectedBoardId === 'all' ? 'active' : ''}" onclick="selectBoard('all')">
      <div class="board-nav-left">
        <span>🏠</span>
        <span>전체 통합글</span>
      </div>
      <span class="board-count-badge">${totalCount}</span>
    </li>
  `;

  state.boards.forEach(b => {
    const icon = getBoardIcon(b.id, b.name);
    const isActive = state.selectedBoardId === b.id;
    html += `
      <li class="board-nav-item ${isActive ? 'active' : ''}" onclick="selectBoard('${b.id}')">
        <div class="board-nav-left">
          <span>${icon}</span>
          <span>${escapeHtml(b.name)}</span>
        </div>
        <span class="board-count-badge">${b.post_count || 0}</span>
      </li>
    `;
  });

  listEl.innerHTML = html;
}

function selectBoard(boardId) {
  state.selectedBoardId = boardId;
  renderSidebarBoards();
  if (state.currentView === 'list') {
    loadPosts();
  } else {
    navigateTo('list');
  }
}

function getBoardIcon(id, name) {
  if (name.includes('공지')) return '📢';
  if (name.includes('자유')) return '💬';
  if (name.includes('질문') || name.includes('Q&A')) return '❓';
  if (name.includes('취업') || name.includes('정보')) return '💼';
  if (name.includes('작품') || name.includes('전시')) return '🎨';
  if (name.includes('익명')) return '🎭';
  return '📋';
}

function populateBoardSelects() {
  const writeSelect = document.getElementById('writeBoardSelect');
  const editSelect = document.getElementById('editBoardSelect');

  const optionsHtml = state.boards.map(b => `
    <option value="${b.id}">${getBoardIcon(b.id, b.name)} ${escapeHtml(b.name)}</option>
  `).join('');

  if (writeSelect) writeSelect.innerHTML = optionsHtml;
  if (editSelect) editSelect.innerHTML = optionsHtml;
}

// ----------------------------------------------------
// [화면 전환 라우팅 & 권한 통제]
// ----------------------------------------------------
function navigateTo(viewName, param = null) {
  // 최고 관리자 전용 권한 가드
  if (viewName === 'super-admin' && !state.isSuperAdmin) {
    alert('접근 권한이 없습니다. 최고 관리자만 접근할 수 있습니다.');
    navigateTo('list');
    return;
  }

  // 공간 관리자 전용 권한 가드
  if (['space-admin', 'space-members'].includes(viewName)) {
    const canManage = state.isSuperAdmin || state.currentSpaceRole === 'space_admin';
    if (!canManage) {
      alert('해당 운영 공간에 대한 관리자 권한이 없습니다.');
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

  updateAdminSubNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  loadViewData(viewName, param);
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

function loadViewData(viewName, param = null) {
  if (viewName === 'spaces') {
    loadAllSpacesView();
  } else if (viewName === 'list') {
    loadPosts();
  } else if (viewName === 'write') {
    setupWriteView(param === 'notice');
  } else if (viewName === 'detail' && param) {
    loadPostDetail(param);
  } else if (viewName === 'super-admin') {
    loadSuperAdminDashboard();
  } else if (viewName === 'space-admin') {
    loadSpaceAdminDashboard();
  } else if (viewName === 'space-members') {
    loadSpaceMembers();
  }
}

function updateAdminSubNav() {
  const subNav = document.getElementById('adminSubNav');
  const titleEl = document.getElementById('adminSubNavTitle');
  const tabsContainer = document.getElementById('adminSubNavTabs');

  if (state.isSuperAdmin) {
    subNav.style.display = 'block';
    titleEl.textContent = '👑 대학 총괄 최고 관리자 제어 센터';
    tabsContainer.innerHTML = `
      <span class="admin-nav-tab ${state.currentView === 'super-admin' ? 'active' : ''}" onclick="navigateTo('super-admin')">📊 전체 공간 관리</span>
      <span class="admin-nav-tab ${state.currentView === 'spaces' ? 'active' : ''}" onclick="navigateTo('spaces')">🏛️ 공간 목록</span>
      <span class="admin-nav-tab ${state.currentView === 'space-admin' ? 'active' : ''}" onclick="navigateTo('space-admin')">🛡️ 현재 공간 제어</span>
      <span class="admin-nav-tab ${state.currentView === 'space-members' ? 'active' : ''}" onclick="navigateTo('space-members')">👥 공간 회원 관리</span>
      <span class="admin-nav-tab" onclick="navigateTo('list')">↩️ 일반 게시판 보기</span>
    `;
  } else if (state.currentSpaceRole === 'space_admin') {
    subNav.style.display = 'block';
    titleEl.textContent = `🛡️ ${state.currentSpace ? state.currentSpace.name : '운영 공간'} 관리자 제어 센터`;
    tabsContainer.innerHTML = `
      <span class="admin-nav-tab ${state.currentView === 'space-admin' ? 'active' : ''}" onclick="navigateTo('space-admin')">📑 게시판 및 글 관리</span>
      <span class="admin-nav-tab ${state.currentView === 'space-members' ? 'active' : ''}" onclick="navigateTo('space-members')">👥 공간 회원 관리</span>
      <span class="admin-nav-tab ${state.currentView === 'spaces' ? 'active' : ''}" onclick="navigateTo('spaces')">🏛️ 공간 목록</span>
      <span class="admin-nav-tab" onclick="navigateTo('list')">↩️ 게시판 보기</span>
    `;
  } else {
    subNav.style.display = 'none';
  }
}

// ----------------------------------------------------
// [회원 인증]
// ----------------------------------------------------
function restoreUserSession() {
  const saved = localStorage.getItem('dept_compound_user');
  if (saved) {
    try {
      state.currentUser = JSON.parse(saved);
      updateNavUI();
    } catch (e) {
      localStorage.removeItem('dept_compound_user');
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
      state.isSuperAdmin = result.isSuperAdmin;
      state.accessibleSpaces = result.accessibleSpaces;
      localStorage.setItem('dept_compound_user', JSON.stringify(result.user));
    } else {
      state.currentUser = null;
      state.isSuperAdmin = false;
      localStorage.removeItem('dept_compound_user');
    }
    updateNavUI();
  } catch (err) {
    console.error('Auth error:', err);
  }
}

function updateNavUI() {
  const navGuest = document.getElementById('navGuest');
  const navAuth = document.getElementById('navAuth');
  const navAvatar = document.getElementById('navAvatar');
  const navUserName = document.getElementById('navUserName');
  const navUserRole = document.getElementById('navUserRole');
  const btnSuperAdmin = document.getElementById('btnSuperAdminNav');
  const btnSpaceAdmin = document.getElementById('btnSpaceAdminNav');

  if (state.currentUser) {
    navGuest.style.display = 'none';
    navAuth.style.display = 'flex';
    navAvatar.textContent = state.currentUser.name.charAt(0);
    navUserName.textContent = state.currentUser.name;

    state.isSuperAdmin = state.currentUser.role === 'super_admin';

    if (state.isSuperAdmin) {
      navAvatar.className = 'user-avatar super-admin';
      navUserRole.className = 'role-badge super-admin';
      navUserRole.textContent = '최고 관리자';
      btnSuperAdmin.style.display = 'inline-flex';
      btnSpaceAdmin.style.display = 'none';
    } else {
      navAvatar.className = 'user-avatar';
      navUserRole.className = 'role-badge user';
      navUserRole.textContent = '일반 사용자';
      btnSuperAdmin.style.display = 'none';
    }
  } else {
    navGuest.style.display = 'flex';
    navAuth.style.display = 'none';
    btnSuperAdmin.style.display = 'none';
    btnSpaceAdmin.style.display = 'none';
  }

  updateAdminSubNav();
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
      localStorage.setItem('dept_compound_user', JSON.stringify(data.user));
      await checkAuthStatus();
      await loadAccessibleSpaces();
      alert(`${data.user.name}님 환영합니다!`);
      navigateTo('list');
    } else {
      alert(data.message || '로그인에 실패했습니다.');
    }
  } catch (err) {
    alert('로그인 통신 오류가 발생했습니다.');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const spaceId = document.getElementById('regSpace').value;
  const name = document.getElementById('regName').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId, name, username, password })
    });
    const data = await res.json();

    if (data.success) {
      state.currentUser = data.user;
      localStorage.setItem('dept_compound_user', JSON.stringify(data.user));
      await checkAuthStatus();
      await loadAccessibleSpaces();
      alert(`회원가입이 완료되었습니다!\n${data.user.name}님으로 로그인되었습니다.`);
      navigateTo('list');
    } else {
      alert(data.message || '회원가입 실패');
    }
  } catch (err) {
    alert('회원가입 통신 오류');
  }
}

function logout() {
  state.currentUser = null;
  state.isSuperAdmin = false;
  state.currentSpaceRole = null;
  localStorage.removeItem('dept_compound_user');
  updateNavUI();
  alert('로그아웃되었습니다.');
  navigateTo('list');
}

function fillLoginForm(username, password) {
  document.getElementById('loginUsername').value = username;
  document.getElementById('loginPassword').value = password;
}

// ----------------------------------------------------
// [1. 전체 운영 공간 목록 화면]
// ----------------------------------------------------
async function loadAllSpacesView() {
  try {
    const res = await fetch('/api/spaces', {
      headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {}
    });
    const result = await res.json();
    if (result.success) {
      renderSpaceCards(result.data);
    }
  } catch (err) {
    console.error('Spaces view error:', err);
  }

  const btnCreate = document.getElementById('btnCreateSpaceTop');
  if (btnCreate) {
    btnCreate.style.display = state.isSuperAdmin ? 'inline-flex' : 'none';
  }
}

function renderSpaceCards(spaces) {
  const container = document.getElementById('spaceCardsContainer');
  if (!container) return;

  container.innerHTML = spaces.map(s => {
    return `
      <div class="space-card" onclick="enterSpace('${s.id}')">
        <div>
          <div class="space-card-header">
            <h3 class="space-card-title">🏛️ ${escapeHtml(s.name)}</h3>
            <span class="role-badge user" style="background:#f1f5f9; color:#475569;">${s.id}</span>
          </div>
          <p class="space-card-desc">${escapeHtml(s.description || '학과 및 자치기구 소통 공간')}</p>
        </div>
        <div class="space-card-footer">
          <span>👤 관리자: <strong>${escapeHtml(s.manager_name || '미지정')}</strong></span>
          <span>게시판 ${s.board_count}개 / 글 ${s.post_count}개</span>
        </div>
      </div>
    `;
  }).join('');
}

async function enterSpace(spaceId) {
  await switchCurrentSpace(spaceId);
  navigateTo('list');
}

// ----------------------------------------------------
// [2. 게시판별 게시글 목록 조회]
// ----------------------------------------------------
async function loadPosts() {
  if (!state.currentSpace) return;

  try {
    let url = `/api/posts?space_id=${state.currentSpace.id}`;
    if (state.selectedBoardId !== 'all') {
      url += `&board_id=${state.selectedBoardId}`;
    }

    const res = await fetch(url, {
      headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {}
    });
    const result = await res.json();

    if (result.success) {
      state.posts = result.data;
      updateBoardHeader();
      renderPostsTable(state.posts);
    } else {
      // 접근 차단 (403)
      renderRestrictedAccessMessage(result.message);
    }
  } catch (err) {
    console.error('Load posts error:', err);
  }
}

function renderRestrictedAccessMessage(msg) {
  const tbody = document.getElementById('postsTableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align: center; padding: 3rem; color: var(--danger);">
        <strong>🚫 접근 제한 안내</strong><br>
        <span style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem; display: block;">
          ${escapeHtml(msg || '해당 운영 공간에 소속된 회원만 열람할 수 있습니다.')}
        </span>
      </td>
    </tr>
  `;
}

function updateBoardHeader() {
  const iconEl = document.getElementById('currentBoardIcon');
  const nameEl = document.getElementById('currentBoardName');
  const descEl = document.getElementById('currentBoardDesc');

  if (state.selectedBoardId === 'all') {
    iconEl.textContent = '🏠';
    nameEl.textContent = `${state.currentSpace.name} 전체 통합글`;
    descEl.textContent = `${state.currentSpace.name}의 모든 게시판 소식을 한눈에 확인하세요.`;
  } else {
    const board = state.boards.find(b => b.id === state.selectedBoardId);
    if (board) {
      iconEl.textContent = getBoardIcon(board.id, board.name);
      nameEl.textContent = board.name;
      descEl.textContent = board.description || '구성원 간 원활한 소통을 지원합니다.';
    }
  }
}

function renderPostsTable(posts) {
  const tbody = document.getElementById('postsTableBody');
  if (!posts || posts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
          이 공간/게시판에 등록된 게시글이 없습니다. 첫 글을 작성해 보세요!
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

    return `
      <tr class="post-row ${isNotice ? 'is-notice' : ''}" onclick="navigateTo('detail', ${post.id})">
        <td style="text-align: center;">${numOrNotice}</td>
        <td>
          <span class="role-badge user" style="background:#f1f5f9; color:#475569; font-size:0.75rem;">
            ${escapeHtml(post.board_name || '게시판')}
          </span>
        </td>
        <td class="post-title-cell">
          <span>${escapeHtml(post.title)}</span>
          ${commentBadge}
        </td>
        <td>
          <span style="font-size: 0.9rem; font-weight: 500; color: #334155;">${escapeHtml(post.author_name)}</span>
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
// [3. 게시글 작성 및 수정]
// ----------------------------------------------------
function setupWriteView(asNotice = false) {
  if (!state.currentUser) {
    alert('게시글을 작성하려면 로그인이 필요합니다.');
    navigateTo('login');
    return;
  }

  populateBoardSelects();
  const selectEl = document.getElementById('writeBoardSelect');

  if (state.selectedBoardId !== 'all') {
    selectEl.value = state.selectedBoardId;
  }

  document.getElementById('writeAuthor').value = `${state.currentUser.name} (${state.currentSpace ? state.currentSpace.name : ''})`;
  document.getElementById('writeTitle').value = '';
  document.getElementById('writeContent').value = '';

  const noticeGroup = document.getElementById('writeNoticeGroup');
  const isNoticeCheck = document.getElementById('writeIsNotice');

  const canNotice = state.isSuperAdmin || state.currentSpaceRole === 'space_admin';
  noticeGroup.style.display = canNotice ? 'block' : 'none';
  isNoticeCheck.checked = asNotice && canNotice;
}

async function handleCreatePost(e) {
  e.preventDefault();
  if (!state.currentUser) return navigateTo('login');

  const boardId = document.getElementById('writeBoardSelect').value;
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
      body: JSON.stringify({ boardId, title, content, isNotice })
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message);
      await loadCurrentSpaceBoards();
      navigateTo('detail', result.post.id);
    } else {
      alert(result.message || '게시글 작성에 실패했습니다.');
    }
  } catch (err) {
    alert('게시글 등록 통신 오류');
  }
}

// ----------------------------------------------------
// [4. 게시글 상세 조회 및 댓글]
// ----------------------------------------------------
async function loadPostDetail(postId) {
  try {
    const res = await fetch(`/api/posts/${postId}`, {
      headers: state.currentUser ? { 'x-user-id': state.currentUser.id } : {}
    });
    const result = await res.json();

    if (result.success) {
      state.currentPost = result.post;
      state.currentComments = result.comments;
      renderPostDetail();
    } else {
      alert(result.message || '게시글을 찾을 수 없거나 접근 권한이 없습니다.');
      navigateTo('list');
    }
  } catch (err) {
    console.error('Load detail error:', err);
  }
}

function renderPostDetail() {
  const post = state.currentPost;
  if (!post) return;

  const isNotice = post.is_notice === 1;
  const noticeBadge = document.getElementById('detailNoticeBadge');
  noticeBadge.style.display = isNotice ? 'inline-block' : 'none';

  document.getElementById('detailSpaceBadge').textContent = `🏛️ ${post.space_name}`;
  document.getElementById('detailBoardBadge').textContent = `📁 ${post.board_name}`;
  document.getElementById('detailPostNumber').textContent = `No. ${post.id}`;
  document.getElementById('detailTitle').textContent = post.title;
  document.getElementById('detailAuthor').textContent = `${post.author_name} (${post.author_username})`;
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

  const btnEdit = document.getElementById('btnEditPost');
  const btnDelete = document.getElementById('btnDeletePost');

  const isAuthor = state.currentUser && state.currentUser.id === post.user_id;
  const isManager = state.isSuperAdmin || state.currentSpaceRole === 'space_admin';

  btnEdit.style.display = isAuthor ? 'inline-flex' : 'none';
  btnDelete.style.display = (isAuthor || isManager) ? 'inline-flex' : 'none';
  btnDelete.textContent = isManager && !isAuthor ? '🛡️ 관리 조치로 삭제' : '🗑️ 삭제';

  renderComments();
}

function handleEditCurrentPost() {
  if (!state.currentPost || !state.currentUser) return;
  if (state.currentPost.user_id !== state.currentUser.id) {
    alert('본인이 작성한 글만 수정할 수 있습니다.');
    return;
  }

  populateBoardSelects();
  document.getElementById('editPostId').value = state.currentPost.id;
  document.getElementById('editBoardSelect').value = state.currentPost.board_id;
  document.getElementById('editAuthor').value = `${state.currentPost.author_name} (본인)`;
  document.getElementById('editTitle').value = state.currentPost.title;
  document.getElementById('editContent').value = state.currentPost.content;

  const noticeGroup = document.getElementById('editNoticeGroup');
  const isNoticeCheck = document.getElementById('editIsNotice');
  const canNotice = state.isSuperAdmin || state.currentSpaceRole === 'space_admin';
  noticeGroup.style.display = canNotice ? 'block' : 'none';
  isNoticeCheck.checked = state.currentPost.is_notice === 1;

  navigateTo('edit');
}

async function handleUpdatePost(e) {
  e.preventDefault();
  const postId = document.getElementById('editPostId').value;
  const boardId = document.getElementById('editBoardSelect').value;
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
      body: JSON.stringify({ boardId, title, content, isNotice })
    });
    const result = await res.json();

    if (result.success) {
      alert('게시글이 수정되었습니다.');
      await loadCurrentSpaceBoards();
      navigateTo('detail', postId);
    } else {
      alert(result.message || '게시글 수정 실패');
    }
  } catch (err) {
    alert('게시글 수정 통신 오류');
  }
}

async function handleDeleteCurrentPost() {
  if (!state.currentPost || !state.currentUser) return;

  if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;

  try {
    const res = await fetch(`/api/posts/${state.currentPost.id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message || '게시글이 삭제되었습니다.');
      await loadCurrentSpaceBoards();
      navigateTo('list');
    } else {
      alert(result.message || '게시글 삭제 실패');
    }
  } catch (err) {
    alert('게시글 삭제 오류');
  }
}

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
  } else {
    commentNoticeMsg.style.display = 'none';
    writeBox.style.display = 'block';
  }

  if (state.currentComments.length === 0) {
    commentList.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: #94a3b8; font-size: 0.9rem;">작성된 댓글이 없습니다.</div>`;
    return;
  }

  const isManager = state.isSuperAdmin || state.currentSpaceRole === 'space_admin';

  commentList.innerHTML = state.currentComments.map(c => {
    const isCommentAuthor = state.currentUser && state.currentUser.id === c.user_id;
    const canDelete = isCommentAuthor || isManager;

    const deleteBtn = canDelete
      ? `<button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="handleDeleteComment(${c.id}, ${isManager && !isCommentAuthor})">${isManager && !isCommentAuthor ? '관리자 삭제' : '삭제'}</button>`
      : '';

    return `
      <div class="comment-item">
        <div class="comment-item-header">
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="comment-author">💬 ${escapeHtml(c.author_name)}</span>
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
  if (!state.currentUser) return navigateTo('login');

  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content) return alert('댓글 내용을 입력해 주세요.');

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
      alert(result.message || '댓글 등록 실패');
    }
  } catch (err) {
    alert('댓글 등록 통신 오류');
  }
}

async function handleDeleteComment(commentId, isForceAdmin = false) {
  if (!confirm('댓글을 삭제하시겠습니까?')) return;

  try {
    const res = await fetch(`/api/comments/${commentId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();

    if (result.success) {
      state.currentComments = state.currentComments.filter(c => c.id !== commentId);
      renderComments();
    } else {
      alert(result.message || '댓글 삭제 실패');
    }
  } catch (err) {
    alert('댓글 삭제 오류');
  }
}

// ----------------------------------------------------
// [5. 최고 관리자 전용 대시보드 및 운영 공간 관리]
// ----------------------------------------------------
async function loadSuperAdminDashboard() {
  try {
    const [spacesRes, boardsRes, usersRes, postsRes] = await Promise.all([
      fetch('/api/spaces', { headers: { 'x-user-id': state.currentUser.id } }),
      fetch('/api/boards', { headers: { 'x-user-id': state.currentUser.id } }),
      fetch('/api/admin/users', { headers: { 'x-user-id': state.currentUser.id } }),
      fetch('/api/posts', { headers: { 'x-user-id': state.currentUser.id } })
    ]);

    const spacesData = await spacesRes.json();
    const boardsData = await boardsRes.json();
    const usersData = await usersRes.json();
    const postsData = await postsRes.json();

    if (spacesData.success) {
      document.getElementById('statSuperSpaces').textContent = spacesData.data.length;
      document.getElementById('statSuperBoards').textContent = boardsData.data ? boardsData.data.length : 0;
      document.getElementById('statSuperUsers').textContent = usersData.data ? usersData.data.length : 0;
      document.getElementById('statSuperPosts').textContent = postsData.data ? postsData.data.length : 0;

      state.allUsers = usersData.data || [];
      renderSuperSpacesTable(spacesData.data);
    }
  } catch (err) {
    console.error('Super admin dashboard error:', err);
  }
}

function renderSuperSpacesTable(spaces) {
  const tbody = document.getElementById('superSpacesTableBody');
  if (!tbody) return;

  tbody.innerHTML = spaces.map(s => {
    return `
      <tr>
        <td style="font-family: monospace; font-weight: 700; color: var(--accent);">${escapeHtml(s.id)}</td>
        <td style="font-weight: 700;">🏛️ ${escapeHtml(s.name)}</td>
        <td style="font-size: 0.85rem; color: var(--text-sub);">${escapeHtml(s.description || '-')}</td>
        <td>👤 <strong>${escapeHtml(s.manager_name || '미지정')}</strong></td>
        <td style="text-align: center; font-size: 0.85rem;">판 ${s.board_count} / 인 ${s.member_count}</td>
        <td style="text-align: center;">
          <button class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="openEditSpaceModal('${s.id}')">수정</button>
          <button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="handleDeleteSpace('${s.id}', '${escapeHtml(s.name)}')">삭제</button>
        </td>
      </tr>
    `;
  }).join('');
}

function openCreateSpaceModal() {
  document.getElementById('spaceModalTitle').textContent = '➕ 새 운영 공간 생성';
  document.getElementById('modalSpaceMode').value = 'create';
  document.getElementById('modalSpaceIdGroup').style.display = 'block';
  document.getElementById('modalSpaceId').value = '';
  document.getElementById('modalSpaceName').value = '';
  document.getElementById('modalSpaceDesc').value = '';
  document.getElementById('btnSubmitSpaceModal').textContent = '공간 생성';

  populateManagerSelect();
  document.getElementById('spaceModal').classList.add('active');
}

function openEditSpaceModal(spaceId) {
  const space = state.accessibleSpaces.find(s => s.id === spaceId);
  if (!space) return;

  document.getElementById('spaceModalTitle').textContent = '🛠️ 운영 공간 정보 및 관리자 수정';
  document.getElementById('modalSpaceMode').value = 'edit';
  document.getElementById('modalSpaceIdGroup').style.display = 'none';
  document.getElementById('modalSpaceId').value = space.id;
  document.getElementById('modalSpaceName').value = space.name;
  document.getElementById('modalSpaceDesc').value = space.description || '';
  document.getElementById('btnSubmitSpaceModal').textContent = '수정 완료';

  populateManagerSelect(space.manager_id);
  document.getElementById('spaceModal').classList.add('active');
}

function populateManagerSelect(selectedId = null) {
  const select = document.getElementById('modalSpaceManager');
  select.innerHTML = `<option value="">(관리자 미지정)</option>` + state.allUsers.map(u => `
    <option value="${u.id}" ${selectedId === u.id ? 'selected' : ''}>
      ${escapeHtml(u.name)} (${u.username} - ${u.department})
    </option>
  `).join('');
}

function closeSpaceModal() {
  document.getElementById('spaceModal').classList.remove('active');
}

async function handleSaveSpaceModal(e) {
  e.preventDefault();
  const mode = document.getElementById('modalSpaceMode').value;
  const id = document.getElementById('modalSpaceId').value.trim();
  const name = document.getElementById('modalSpaceName').value.trim();
  const description = document.getElementById('modalSpaceDesc').value.trim();
  const managerId = document.getElementById('modalSpaceManager').value;

  try {
    let res;
    if (mode === 'create') {
      res = await fetch('/api/spaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({ id, name, description, managerId })
      });
    } else {
      res = await fetch(`/api/spaces/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({ name, description, managerId })
      });
    }

    const result = await res.json();
    if (result.success) {
      alert(result.message);
      closeSpaceModal();
      await loadAccessibleSpaces();
      loadSuperAdminDashboard();
    } else {
      alert(result.message || '저장 실패');
    }
  } catch (err) {
    alert('운영 공간 저장 통신 오류');
  }
}

async function handleDeleteSpace(spaceId, spaceName) {
  if (!confirm(`정말로 '${spaceName}' 운영 공간을 삭제하시겠습니까?\n해당 공간의 모든 게시판, 게시글, 댓글이 영구 삭제됩니다!`)) return;

  try {
    const res = await fetch(`/api/spaces/${spaceId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message);
      await loadAccessibleSpaces();
      loadSuperAdminDashboard();
    } else {
      alert(result.message || '삭제 실패');
    }
  } catch (err) {
    alert('공간 삭제 오류');
  }
}

// ----------------------------------------------------
// [6. 공간 관리자 대시보드]
// ----------------------------------------------------
async function loadSpaceAdminDashboard() {
  if (!state.currentSpace) return;
  document.getElementById('spaceAdminTitleName').textContent = state.currentSpace.name;

  try {
    await loadCurrentSpaceBoards();
    renderSpaceAdminBoardsTable();

    // 해당 공간 글 목록 조회
    const res = await fetch(`/api/posts?space_id=${state.currentSpace.id}`, {
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      renderSpaceAdminPostsTable(result.data);
    }
  } catch (err) {
    console.error('Space admin dashboard error:', err);
  }
}

function renderSpaceAdminBoardsTable() {
  const tbody = document.getElementById('spaceAdminBoardsTableBody');
  if (!tbody) return;

  tbody.innerHTML = state.boards.map(b => {
    return `
      <tr>
        <td style="font-family: monospace; font-weight: 600; color: var(--accent);">${escapeHtml(b.id)}</td>
        <td style="font-weight: 700;">${getBoardIcon(b.id, b.name)} ${escapeHtml(b.name)}</td>
        <td style="font-size: 0.85rem; color: var(--text-sub);">${escapeHtml(b.description || '-')}</td>
        <td style="text-align: center; font-weight: 600;">${b.post_count || 0}</td>
        <td style="text-align: center;">
          <button class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="openEditBoardModal('${b.id}')">수정</button>
          <button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="handleDeleteBoard('${b.id}', '${escapeHtml(b.name)}')">삭제</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderSpaceAdminPostsTable(posts) {
  const tbody = document.getElementById('spaceAdminPostsTableBody');
  if (!tbody) return;

  tbody.innerHTML = posts.map(p => {
    return `
      <tr>
        <td style="text-align: center; font-weight: 600;">${p.id}</td>
        <td><span class="role-badge user" style="background:#f1f5f9; color:#475569;">${escapeHtml(p.board_name)}</span></td>
        <td>
          ${p.is_notice === 1 ? '<span class="notice-tag">공지</span> ' : ''}
          <a href="#" onclick="navigateTo('detail', ${p.id}); return false;" style="font-weight: 600; color: var(--text-main);">
            ${escapeHtml(p.title)}
          </a>
        </td>
        <td>${escapeHtml(p.author_name)}</td>
        <td style="font-size: 0.82rem; color: #64748b;">${formatDateTime(p.created_at)}</td>
        <td style="text-align: center;">
          <button class="btn-danger" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="spaceAdminDeletePost(${p.id})">삭제</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function spaceAdminDeletePost(postId) {
  if (!confirm('공간 관리자 권한으로 이 게시글을 삭제하시겠습니까?')) return;

  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      loadSpaceAdminDashboard();
    }
  } catch (e) {}
}

// ----------------------------------------------------
// [공간별 게시판 생성 및 수정 모달]
// ----------------------------------------------------
function openCreateBoardModal() {
  document.getElementById('boardModalTitle').textContent = `➕ [${state.currentSpace.name}] 새 게시판 개설`;
  document.getElementById('modalBoardMode').value = 'create';
  document.getElementById('modalBoardCustomIdGroup').style.display = 'block';
  document.getElementById('modalBoardId').value = '';
  document.getElementById('modalBoardName').value = '';
  document.getElementById('modalBoardDesc').value = '';
  document.getElementById('btnSubmitBoardModal').textContent = '게시판 생성';

  document.getElementById('boardModal').classList.add('active');
}

function openEditBoardModal(boardId) {
  const board = state.boards.find(b => b.id === boardId);
  if (!board) return;

  document.getElementById('boardModalTitle').textContent = '🛠️ 게시판 정보 수정';
  document.getElementById('modalBoardMode').value = 'edit';
  document.getElementById('modalBoardCustomIdGroup').style.display = 'none';
  document.getElementById('modalBoardId').value = board.id;
  document.getElementById('modalBoardName').value = board.name;
  document.getElementById('modalBoardDesc').value = board.description || '';
  document.getElementById('btnSubmitBoardModal').textContent = '수정 완료';

  document.getElementById('boardModal').classList.add('active');
}

function closeBoardModal() {
  document.getElementById('boardModal').classList.remove('active');
}

async function handleSaveBoardModal(e) {
  e.preventDefault();
  const mode = document.getElementById('modalBoardMode').value;
  const id = document.getElementById('modalBoardId').value.trim();
  const name = document.getElementById('modalBoardName').value.trim();
  const description = document.getElementById('modalBoardDesc').value.trim();

  try {
    let res;
    if (mode === 'create') {
      res = await fetch(`/api/spaces/${state.currentSpace.id}/boards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({ customId: id, name, description })
      });
    } else {
      res = await fetch(`/api/boards/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': state.currentUser.id
        },
        body: JSON.stringify({ name, description })
      });
    }

    const result = await res.json();
    if (result.success) {
      alert(result.message);
      closeBoardModal();
      await loadCurrentSpaceBoards();
      if (state.currentView === 'space-admin') loadSpaceAdminDashboard();
    } else {
      alert(result.message || '저장 실패');
    }
  } catch (err) {
    alert('게시판 저장 통신 오류');
  }
}

async function handleDeleteBoard(boardId, boardName) {
  if (!confirm(`'${boardName}' 게시판을 삭제하시겠습니까? 관련 글들이 함께 삭제됩니다.`)) return;

  try {
    const res = await fetch(`/api/boards/${boardId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message);
      if (state.selectedBoardId === boardId) state.selectedBoardId = 'all';
      await loadCurrentSpaceBoards();
      if (state.currentView === 'space-admin') loadSpaceAdminDashboard();
    } else {
      alert(result.message || '삭제 실패');
    }
  } catch (e) {}
}

// ----------------------------------------------------
// [7. 공간별 회원 및 권한 관리 (#space-members)]
// ----------------------------------------------------
async function loadSpaceMembers() {
  if (!state.currentSpace) return;
  document.getElementById('spaceMembersTitleName').textContent = state.currentSpace.name;

  try {
    const [membersRes, usersRes] = await Promise.all([
      fetch(`/api/spaces/${state.currentSpace.id}/members`, { headers: { 'x-user-id': state.currentUser.id } }),
      fetch('/api/admin/users', { headers: { 'x-user-id': state.currentUser.id } })
    ]);

    const membersData = await membersRes.json();
    const usersData = await usersRes.json();

    if (membersData.success) {
      state.allUsers = usersData.data || [];
      renderSpaceMembersTable(membersData.data);
    } else {
      alert(membersData.message || '회원 목록 조회 실패');
    }
  } catch (err) {
    console.error('Space members error:', err);
  }
}

function renderSpaceMembersTable(members) {
  const tbody = document.getElementById('spaceMembersTableBody');
  if (!tbody) return;

  tbody.innerHTML = members.map(m => {
    const isAdmin = m.space_role === 'space_admin';
    const roleBadge = isAdmin
      ? `<span class="role-badge space-admin">공간 관리자</span>`
      : `<span class="role-badge user">일반 회원</span>`;

    const toggleAction = isAdmin
      ? `<button class="btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="changeMemberRole('${m.user_id}', 'member')">일반회원으로 강등</button>`
      : `<button class="btn-admin" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="changeMemberRole('${m.user_id}', 'space_admin')">공간관리자로 임명</button>`;

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(m.username)}</td>
        <td>${escapeHtml(m.user_name)}</td>
        <td style="font-size: 0.85rem; color: #64748b;">${escapeHtml(m.department || '-')}</td>
        <td style="text-align: center;">${roleBadge}</td>
        <td style="text-align: center; font-size: 0.82rem; color: #64748b;">${formatDateTime(m.joined_at)}</td>
        <td style="text-align: center;">
          ${toggleAction}
          <button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="removeMemberFromSpace('${m.user_id}', '${escapeHtml(m.user_name)}')">방출</button>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddMemberModal() {
  const select = document.getElementById('modalMemberUserSelect');
  select.innerHTML = state.allUsers.map(u => `
    <option value="${u.id}">${escapeHtml(u.name)} (${u.username} - ${u.department})</option>
  `).join('');

  document.getElementById('memberModal').classList.add('active');
}

function closeMemberModal() {
  document.getElementById('memberModal').classList.remove('active');
}

async function handleSaveMemberModal(e) {
  e.preventDefault();
  const userId = document.getElementById('modalMemberUserSelect').value;
  const spaceRole = document.getElementById('modalMemberRole').value;

  try {
    const res = await fetch(`/api/spaces/${state.currentSpace.id}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': state.currentUser.id
      },
      body: JSON.stringify({ userId, spaceRole })
    });
    const result = await res.json();

    if (result.success) {
      alert(result.message);
      closeMemberModal();
      loadSpaceMembers();
    } else {
      alert(result.message || '회원 배정 실패');
    }
  } catch (e) {
    alert('회원 배정 통신 오류');
  }
}

async function changeMemberRole(userId, newRole) {
  try {
    const res = await fetch(`/api/spaces/${state.currentSpace.id}/members/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': state.currentUser.id
      },
      body: JSON.stringify({ spaceRole: newRole })
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      loadSpaceMembers();
    }
  } catch (e) {}
}

async function removeMemberFromSpace(userId, userName) {
  if (!confirm(`'${userName}' 회원을 이 공간에서 제외(방출)하시겠습니까?`)) return;

  try {
    const res = await fetch(`/api/spaces/${state.currentSpace.id}/members/${userId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': state.currentUser.id }
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      loadSpaceMembers();
    }
  } catch (e) {}
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
