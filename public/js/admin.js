/**
 * SC GAMEING - Esports Tournament Admin Workstation Controller
 */

let adminStats = {};
let adminTournaments = [];
let adminUsers = [];
let adminDeposits = [];
let adminWithdrawals = [];
let activeResultTournamentId = null;

document.addEventListener('DOMContentLoaded', async () => {
  checkAdminAuth();
});

// Admin Auth check
async function checkAdminAuth() {
  const token = localStorage.getItem('scg_token');
  const user = JSON.parse(localStorage.getItem('scg_user') || 'null');

  if (!token || !user || user.role !== 'admin') {
    document.getElementById('admin-login-screen').classList.remove('hidden');
    document.getElementById('admin-dashboard-screen').classList.add('hidden');
    return;
  }

  // Verify fresh admin role from server
  try {
    const res = await api.getProfile();
    if (res.user.role !== 'admin') {
      showToast('Admin privileges required.', 'error');
      api.logout();
      return;
    }

    document.getElementById('admin-login-screen').classList.add('hidden');
    document.getElementById('admin-dashboard-screen').classList.remove('hidden');
    document.getElementById('admin-user-name').textContent = res.user.name;

    setupAdminTabs();
    await loadAdminDashboard();
    initAdminSupportSocket();
  } catch (err) {
    document.getElementById('admin-login-screen').classList.remove('hidden');
    document.getElementById('admin-dashboard-screen').classList.add('hidden');
  }
}

// Admin Login form submit
async function handleAdminLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('admin-email-input').value.trim();
  const password = document.getElementById('admin-pass-input').value;

  const btn = document.getElementById('btn-admin-login');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Authenticating...`;

  try {
    const res = await api.login({ identifier, password });
    if (res.user.role !== 'admin') {
      showToast('This account does not have admin permissions.', 'error');
      api.logout();
      return;
    }

    showToast('Admin authorized. Welcome to SC GAMEING Console.', 'success');
    await checkAdminAuth();
  } catch (err) {
    showToast(err.message || 'Invalid admin credentials.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Access Console <i class="fas fa-arrow-right"></i>`;
  }
}

// Admin Forgot Password Modal
function openAdminForgotModal() {
  const modal = document.getElementById('admin-forgot-modal');
  modal.classList.add('active');
  document.getElementById('admin-forgot-step1').classList.remove('hidden');
  document.getElementById('admin-forgot-step2').classList.add('hidden');
  const adminEmailInput = document.getElementById('admin-email-input').value.trim();
  if (adminEmailInput) {
    document.getElementById('admin-forgot-email').value = adminEmailInput;
  }
}

function closeAdminForgotModal() {
  document.getElementById('admin-forgot-modal').classList.remove('active');
}

async function handleAdminForgotStep1(e) {
  e.preventDefault();
  const email = document.getElementById('admin-forgot-email').value.trim();
  const btn = document.getElementById('btn-admin-forgot1');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating Code...`;

  try {
    const res = await api.forgotPassword(email);
    showToast(res.message, 'success');
    document.getElementById('admin-forgot-step1').classList.add('hidden');
    document.getElementById('admin-forgot-step2').classList.remove('hidden');

    if (res.resetCode) {
      document.getElementById('admin-code-hint').textContent = `Security Code: ${res.resetCode} (Valid for 15 mins)`;
      document.getElementById('admin-reset-code').value = res.resetCode;
    } else {
      document.getElementById('admin-code-hint').textContent = `Reset code sent to ${email}. Please check your inbox.`;
    }
  } catch (err) {
    showToast(err.message || 'Failed to request reset code.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-paper-plane"></i> Send Reset Code`;
  }
}

async function handleAdminForgotStep2(e) {
  e.preventDefault();
  const email = document.getElementById('admin-forgot-email').value.trim();
  const resetCode = document.getElementById('admin-reset-code').value.trim();
  const newPassword = document.getElementById('admin-reset-newpass').value;
  const btn = document.getElementById('btn-admin-forgot2');

  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Updating Password...`;

  try {
    const res = await api.resetPassword({ email, resetCode, newPassword });
    showToast(res.message, 'success');
    closeAdminForgotModal();

    // Auto login with new password
    const loginRes = await api.login({ identifier: email, password: newPassword });
    if (loginRes.user.role === 'admin') {
      await checkAdminAuth();
    }
  } catch (err) {
    showToast(err.message || 'Password reset failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-check"></i> Save New Password & Log In`;
  }
}

// Tab navigation within Admin Panel
function setupAdminTabs() {
  const tabs = document.querySelectorAll('.admin-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      switchAdminTab(target);
    });
  });
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => {
    if (b.getAttribute('data-tab') === tabName) {
      b.className = 'admin-tab-btn active px-4 py-2.5 rounded-lg text-sm font-bold bg-orange-600 text-white flex items-center gap-2';
    } else {
      b.className = 'admin-tab-btn px-4 py-2.5 rounded-lg text-sm font-bold text-gray-400 hover:text-white bg-slate-800/40 flex items-center gap-2';
    }
  });

  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
  const target = document.getElementById(`tab-content-${tabName}`);
  if (target) {
    target.classList.remove('hidden');
  }

  if (tabName === 'tournaments') loadAdminTournaments();
  else if (tabName === 'deposits') loadAdminDeposits();
  else if (tabName === 'withdrawals') loadAdminWithdrawals();
  else if (tabName === 'gateway') loadPaymentSettings();
  else if (tabName === 'users') loadAdminUsers();
  else if (tabName === 'products') loadAdminProducts();
  else if (tabName === 'orders') loadAdminOrders();
  else if (tabName === 'announcements') loadAdminAnnouncements();
  else if (tabName === 'support') loadAdminSupportChats();
  else if (tabName === 'overview') loadAdminDashboard();
}

// 1. OVERVIEW & STATS
async function loadAdminDashboard() {
  try {
    const res = await api.request('/admin/stats');
    adminStats = res.stats;

    document.getElementById('stat-total-users').textContent = adminStats.totalUsers;
    document.getElementById('stat-active-tournaments').textContent = adminStats.activeTournaments;
    document.getElementById('stat-wallet-float').textContent = `₹${adminStats.totalWalletFloat.toFixed(2)}`;
    document.getElementById('stat-total-deposits').textContent = `₹${adminStats.totalDeposited.toFixed(2)}`;
    document.getElementById('stat-pending-deposits').textContent = adminStats.pendingDepositsCount;
    document.getElementById('stat-total-withdrawals').textContent = `₹${adminStats.totalPaidWithdrawals.toFixed(2)}`;
    document.getElementById('stat-pending-withdrawals').textContent = adminStats.pendingWithdrawalsCount;

    // Badges in tabs
    const depBadge = document.getElementById('badge-pending-deposits');
    if (depBadge) {
      depBadge.textContent = adminStats.pendingDepositsCount;
      depBadge.style.display = adminStats.pendingDepositsCount > 0 ? 'inline' : 'none';
    }

    const wthBadge = document.getElementById('badge-pending-withdrawals');
    if (wthBadge) {
      wthBadge.textContent = adminStats.pendingWithdrawalsCount;
      wthBadge.style.display = adminStats.pendingWithdrawalsCount > 0 ? 'inline' : 'none';
    }

    // Support Unread Badge
    try {
      const supRes = await api.adminGetSupportConversations({ status: 'OPEN' });
      const supBadge = document.getElementById('badge-open-support');
      if (supBadge) {
        const unreadCount = Number(supRes.totalUnreadAdmin || 0);
        supBadge.textContent = unreadCount;
        supBadge.style.display = unreadCount > 0 ? 'inline' : 'none';
      }
    } catch (e) {}
  } catch (err) {
    console.error('Failed to load admin stats:', err);
  }
}

// 2. TOURNAMENT MANAGEMENT
async function loadAdminTournaments() {
  const container = document.getElementById('admin-tournaments-table-body');
  if (!container) return;

  try {
    const res = await api.getTournaments();
    adminTournaments = res.tournaments || [];

    if (adminTournaments.length === 0) {
      container.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-500">No tournaments created yet.</td></tr>`;
      return;
    }

    container.innerHTML = adminTournaments.map(t => {
      const sched = new Date(t.schedule_time).toLocaleString();
      let statusColor = 'bg-amber-500/20 text-amber-400';
      if (t.status === 'live' || t.status === 'room_ready') statusColor = 'bg-red-500/20 text-red-400 font-bold';
      if (t.status === 'completed') statusColor = 'bg-green-500/20 text-green-400';

      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30">
          <td class="py-3 px-4 font-bold text-white">${t.title}</td>
          <td class="py-3 px-4 text-xs text-gray-300">${t.map} (${t.match_type})</td>
          <td class="py-3 px-4 text-xs font-semibold text-cyan-400">₹${t.entry_fee}</td>
          <td class="py-3 px-4 text-xs font-semibold text-yellow-400">₹${t.total_prize_pool} (Kill: ₹${t.per_kill_prize})</td>
          <td class="py-3 px-4 text-xs text-gray-300">${t.slots_joined} / ${t.max_slots}</td>
          <td class="py-3 px-4 text-xs text-gray-400">${sched}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-xs uppercase border border-current ${statusColor}">${t.status}</span>
          </td>
          <td class="py-3 px-4 text-right space-x-2">
            <button onclick="openEditTimeModal('${t.id}')" class="px-2 py-1 rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600 hover:text-white text-xs font-bold transition" title="Edit Match Schedule Time">
              <i class="fas fa-clock"></i> Time
            </button>
            <button onclick="openSetRoomModal('${t.id}')" class="px-2 py-1 rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600 hover:text-white text-xs font-bold transition">
              <i class="fas fa-key"></i> Room
            </button>
            <button onclick="openMatchResultsModal('${t.id}')" class="px-2 py-1 rounded bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600 hover:text-white text-xs font-bold transition">
              <i class="fas fa-trophy"></i> Results & Payout
            </button>
            <button onclick="deleteTournament('${t.id}')" class="px-2 py-1 rounded bg-red-600/30 text-red-400 hover:bg-red-600 hover:text-white text-xs font-bold transition">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading admin tournaments:', err);
  }
}

// Open Create Tournament Modal
function openCreateTournamentModal() {
  const modal = document.getElementById('create-tournament-modal');
  modal.classList.add('active');

  // Set default schedule time to 2 hours from now
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const isoLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('new-tourn-time').value = isoLocal;
}

function closeCreateTournamentModal() {
  document.getElementById('create-tournament-modal').classList.remove('active');
}

// Create Tournament Submit
async function submitCreateTournament(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('new-tourn-title').value.trim(),
    match_type: document.getElementById('new-tourn-type').value,
    map: document.getElementById('new-tourn-map').value,
    entry_fee: Number(document.getElementById('new-tourn-fee').value),
    total_prize_pool: Number(document.getElementById('new-tourn-prize-pool').value),
    prize_1st: Number(document.getElementById('new-tourn-prize-1').value),
    prize_2nd: Number(document.getElementById('new-tourn-prize-2').value),
    prize_3rd: Number(document.getElementById('new-tourn-prize-3').value),
    per_kill_prize: Number(document.getElementById('new-tourn-per-kill').value),
    max_slots: Number(document.getElementById('new-tourn-slots').value),
    schedule_time: new Date(document.getElementById('new-tourn-time').value).toISOString(),
    rules: document.getElementById('new-tourn-rules').value.trim()
  };

  try {
    const res = await api.request('/admin/tournaments', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    showToast(res.message, 'success');
    closeCreateTournamentModal();
    loadAdminTournaments();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to create tournament.', 'error');
  }
}

// Set Room ID & Password Modal
function openSetRoomModal(tournamentId) {
  const t = adminTournaments.find(item => item.id === tournamentId);
  if (!t) return;

  const modal = document.getElementById('set-room-modal');
  document.getElementById('set-room-tourn-id').value = t.id;
  document.getElementById('set-room-tourn-title').textContent = t.title;
  document.getElementById('set-room-id-input').value = t.room_id || '';
  document.getElementById('set-room-pass-input').value = t.room_password || '';

  modal.classList.add('active');
}

function closeSetRoomModal() {
  document.getElementById('set-room-modal').classList.remove('active');
}

async function submitSetRoomCredentials(e) {
  e.preventDefault();
  const tournId = document.getElementById('set-room-tourn-id').value;
  const room_id = document.getElementById('set-room-id-input').value.trim();
  const room_password = document.getElementById('set-room-pass-input').value.trim();

  try {
    const res = await api.request(`/admin/tournaments/${tournId}/room`, {
      method: 'POST',
      body: JSON.stringify({ room_id, room_password, status: 'room_ready' })
    });

    showToast(res.message, 'success');
    closeSetRoomModal();
    loadAdminTournaments();
  } catch (err) {
    showToast(err.message || 'Failed to publish room credentials.', 'error');
  }
}

// ============================================================
// EDIT TOURNAMENT SCHEDULE TIME MODAL HANDLERS
// ============================================================
function openEditTimeModal(tournamentId) {
  const t = adminTournaments.find(item => item.id === tournamentId);
  if (!t) return;

  document.getElementById('edit-time-tourn-id').value = t.id;
  document.getElementById('edit-time-tourn-title').textContent = `${t.title} (${t.map} - ${t.match_type})`;
  
  const currentSched = t.schedule_time ? new Date(t.schedule_time).toLocaleString() : 'Not scheduled';
  document.getElementById('edit-time-current-display').textContent = currentSched;

  // Set input default to existing time or 1 hour from now
  try {
    const existingDate = t.schedule_time ? new Date(t.schedule_time) : new Date(Date.now() + 60 * 60 * 1000);
    const isoLocal = new Date(existingDate.getTime() - existingDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('edit-time-input').value = isoLocal;
  } catch(e) {
    document.getElementById('edit-time-input').value = '';
  }

  const modal = document.getElementById('edit-time-modal');
  if (modal) modal.classList.add('active');
}

function closeEditTimeModal() {
  const modal = document.getElementById('edit-time-modal');
  if (modal) modal.classList.remove('active');
}

async function submitEditTournamentTime(e) {
  e.preventDefault();
  const id = document.getElementById('edit-time-tourn-id').value;
  const newScheduleTime = document.getElementById('edit-time-input').value;
  const notifyPlayers = document.getElementById('edit-time-notify-checkbox')?.checked ?? true;

  if (!id || !newScheduleTime) {
    showToast('Please select a valid date and time.', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-edit-time');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rescheduling...`;
  }

  let isoTime = newScheduleTime;
  try {
    const d = new Date(newScheduleTime);
    if (!isNaN(d.getTime())) isoTime = d.toISOString();
  } catch(e) {}

  try {
    const res = await api.editTournamentSchedule(id, {
      schedule_time: isoTime,
      notify_players: notifyPlayers
    });

    showToast(res.message || 'Match rescheduled successfully!', 'success');
    closeEditTimeModal();
    await loadAdminTournaments();
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to reschedule tournament.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

// Delete Tournament
async function deleteTournament(id) {
  if (!confirm('Are you sure you want to delete this tournament? Any registered players will be refunded automatically.')) return;

  try {
    const res = await api.request(`/admin/tournaments/${id}`, { method: 'DELETE' });
    showToast(res.message, 'success');
    loadAdminTournaments();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to delete tournament.', 'error');
  }
}

// Match Results & Automatic Prize Distribution
async function openMatchResultsModal(tournamentId) {
  activeResultTournamentId = tournamentId;
  const modal = document.getElementById('admin-results-modal');

  try {
    const res = await api.getTournamentDetails(tournamentId);
    const t = res.tournament;
    document.getElementById('results-tourn-title').textContent = t.title;

    const participants = t.participants || [];
    const container = document.getElementById('results-entry-list');

    if (participants.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center text-gray-400">
          <i class="fas fa-users-slash text-2xl text-gray-500 mb-2"></i>
          <div>No players registered in this tournament yet.</div>
          <button onclick="markTournamentCompletedWithoutPayout('${tournamentId}')" class="btn-ff-outline text-xs mt-3">
            <i class="fas fa-check-circle"></i> Mark Tournament Completed
          </button>
        </div>`;
      document.getElementById('btn-submit-payouts').classList.add('hidden');
    } else {
      document.getElementById('btn-submit-payouts').classList.remove('hidden');
      container.innerHTML = participants.map((p, index) => `
        <div class="result-player-row p-3 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between" data-userid="${p.user_id || ''}" data-slot="${p.slot_number || ''}">
          <div>
            <div class="font-bold text-white">${p.ff_ign || 'Player'} <span class="text-xs text-gray-400">(Slot #${p.slot_number || (index + 1)})</span></div>
            <div class="text-xs text-gray-400">UID: ${p.ff_uid || 'N/A'}</div>
          </div>
          <div class="flex items-center gap-3">
            <div>
              <label class="text-[10px] uppercase text-gray-400 block">Rank (1=Booyah)</label>
              <input type="number" min="1" max="${participants.length}" value="${p.rank || (index === 0 ? 1 : '')}" class="result-rank-input w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-center text-white text-xs font-bold" />
            </div>
            <div>
              <label class="text-[10px] uppercase text-gray-400 block">Kills</label>
              <input type="number" min="0" value="${p.kills || 0}" class="result-kills-input w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-center text-white text-xs font-bold" />
            </div>
          </div>
        </div>
      `).join('');
    }

    modal.classList.add('active');
  } catch (err) {
    showToast(err.message || 'Failed to load tournament participants.', 'error');
  }
}

async function markTournamentCompletedWithoutPayout(tournamentId) {
  if (!confirm('Mark this tournament as completed without any prize payouts?')) return;
  try {
    const res = await api.request(`/admin/tournaments/${tournamentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'completed' })
    });
    showToast(res.message || 'Tournament marked as completed.', 'success');
    closeAdminResultsModal();
    loadAdminTournaments();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to update tournament status.', 'error');
  }
}

function closeAdminResultsModal() {
  document.getElementById('admin-results-modal').classList.remove('active');
}

async function submitResultsAndPayouts() {
  if (!activeResultTournamentId) return;

  const rows = document.querySelectorAll('.result-player-row');
  const playerResults = [];

  rows.forEach(row => {
    const userId = row.getAttribute('data-userid');
    const slotNumber = row.getAttribute('data-slot');
    const rankVal = row.querySelector('.result-rank-input').value;
    const killsVal = row.querySelector('.result-kills-input').value;

    playerResults.push({
      userId: userId || null,
      slotNumber: slotNumber ? Number(slotNumber) : null,
      rank: rankVal ? Number(rankVal) : null,
      kills: Number(killsVal) || 0
    });
  });

  const btn = document.getElementById('btn-submit-payouts');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Distributing Wallet Prizes...`;

  try {
    const res = await api.request(`/admin/tournaments/${activeResultTournamentId}/results`, {
      method: 'POST',
      body: JSON.stringify({ playerResults })
    });

    showToast(res.message, 'success');
    closeAdminResultsModal();
    loadAdminTournaments();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to submit results.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-coins"></i> Calculate & Distribute Cash Prizes`;
  }
}

// 3. UPI WALLET MANAGEMENT & DEPOSIT REQUESTS
let adminDepositFilter = 'ALL';
let adminDepositSearchTimeout = null;

async function loadAdminDeposits() {
  const container = document.getElementById('admin-deposits-table-body');
  if (!container) return;

  const searchInput = document.getElementById('admin-deposit-search-input');
  const query = searchInput ? searchInput.value.trim() : '';

  try {
    let url = `/admin/deposits/orders?status=${adminDepositFilter}`;
    if (query) url += `&search=${encodeURIComponent(query)}`;

    let orders = [];
    try {
      const res = await api.request(url);
      orders = res.orders || [];
    } catch (e) {
      // Fallback to legacy deposits endpoint if orders fails
      const fallback = await api.request('/admin/deposits');
      orders = (fallback.deposits || []).map(d => ({
        ...d,
        order_id: d.deposit_id || d.razorpay_order_id,
        amount: Number(d.amount),
        amount_paise: Math.round(Number(d.amount) * 100)
      }));
    }

    // Calculate metrics
    let pendingCount = 0;
    let verifiedSum = 0;
    orders.forEach(o => {
      if (['PENDING', 'SUBMITTED'].includes(o.status)) pendingCount++;
      if (['VERIFIED', 'APPROVED', 'COMPLETED'].includes(o.status)) verifiedSum += Number(o.amount || 0);
    });

    const pendingCountEl = document.getElementById('admin-upi-pending-count');
    if (pendingCountEl) pendingCountEl.textContent = pendingCount;
    const verifiedTotalEl = document.getElementById('admin-upi-verified-total');
    if (verifiedTotalEl) verifiedTotalEl.textContent = `₹${verifiedSum.toFixed(2)}`;

    const depBadge = document.getElementById('badge-pending-deposits');
    if (depBadge) {
      depBadge.textContent = pendingCount;
      depBadge.classList.toggle('hidden', pendingCount === 0);
    }

    if (orders.length === 0) {
      container.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-500">No deposit orders match this filter.</td></tr>`;
      return;
    }

    container.innerHTML = orders.map(o => {
      let statusBadge = 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
      if (o.status === 'VERIFIED' || o.status === 'APPROVED' || o.status === 'COMPLETED') {
        statusBadge = 'bg-green-500/20 text-green-400 border border-green-500/30 font-bold';
      } else if (o.status === 'SUBMITTED') {
        statusBadge = 'bg-blue-500/20 text-blue-400 border border-blue-500/40 font-bold animate-pulse';
      } else if (o.status === 'REJECTED' || o.status === 'CANCELLED' || o.status === 'FAILED') {
        statusBadge = 'bg-red-500/20 text-red-400 border border-red-500/30';
      } else if (o.status === 'EXPIRED') {
        statusBadge = 'bg-gray-700 text-gray-400 border border-gray-600';
      }

      const isActionable = ['PENDING', 'SUBMITTED'].includes(o.status);

      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30">
          <td class="py-3 px-4 font-mono text-xs font-bold text-orange-400">
            ${o.order_id}
          </td>
          <td class="py-3 px-4">
            <div class="font-bold text-white text-xs">${o.user_name || 'Player'}</div>
            <div class="text-[11px] text-gray-400 font-mono">${o.user_email || ''}</div>
            <div class="text-[10px] text-cyan-400 font-bold">Wallet: ₹${Number(o.user_balance || 0).toFixed(2)}</div>
          </td>
          <td class="py-3 px-4 font-bold text-green-400 font-heading text-sm">
            ₹${Number(o.amount).toFixed(2)}
          </td>
          <td class="py-3 px-4 font-mono text-xs">
            ${o.utr_number 
              ? `<span class="text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60 flex items-center gap-1.5 w-max">
                   <i class="fas fa-receipt text-[10px]"></i> ${o.utr_number}
                 </span>`
              : `<span class="text-gray-500 italic">Awaiting UTR</span>`
            }
          </td>
          <td class="py-3 px-4 text-xs">
            <span class="px-2 py-0.5 rounded text-[10px] uppercase ${statusBadge}">${o.status}</span>
            <div class="text-[10px] text-gray-500 mt-1">${new Date(o.created_at).toLocaleString()}</div>
          </td>
          <td class="py-3 px-4 text-right">
            ${isActionable ? `
              <div class="flex items-center justify-end gap-1.5">
                <button onclick="verifyAdminUpiOrder('${o.order_id}', '${o.utr_number || ''}', ${o.amount})" class="px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-white font-bold text-xs transition flex items-center gap-1">
                  <i class="fas fa-check"></i> Approve
                </button>
                <button onclick="rejectAdminUpiOrder('${o.order_id}')" class="px-2.5 py-1 rounded bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white font-bold text-xs transition border border-red-500/40">
                  <i class="fas fa-times"></i> Reject
                </button>
              </div>
            ` : `
              <span class="text-xs text-gray-500">
                ${o.status === 'VERIFIED' ? '<i class="fas fa-check-circle text-green-400"></i> Credited' : 'No Action'}
              </span>
            `}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading admin deposits:', err);
  }
}

// 1-Click Verification & Atomic Wallet Credit
async function verifyAdminUpiOrder(orderId, defaultUtr, amount) {
  const utrPrompt = prompt(`Confirm verifying deposit for Order: ${orderId}\nDeposit Amount: ₹${amount}\n\nEnter verified 12-digit Bank UTR:`, defaultUtr || '');
  if (utrPrompt === null) return; // Cancelled

  const cleanUtr = utrPrompt.trim();

  try {
    const res = await api.request(`/admin/deposits/orders/${encodeURIComponent(orderId)}/verify`, {
      method: 'POST',
      body: JSON.stringify({ utrNumber: cleanUtr || defaultUtr })
    });

    showToast(res.message || `Order ${orderId} verified and ₹${amount} credited!`, 'success');
    await loadAdminDeposits();
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to verify deposit order.', 'error');
  }
}

// Reject Deposit Order
async function rejectAdminUpiOrder(orderId) {
  const reason = prompt(`Enter reason for rejecting Order ${orderId}:`, 'Invalid UTR / Payment not received in bank account');
  if (reason === null) return;

  try {
    const res = await api.request(`/admin/deposits/orders/${encodeURIComponent(orderId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason.trim() })
    });

    showToast(res.message || `Order ${orderId} rejected.`, 'info');
    await loadAdminDeposits();
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to reject deposit order.', 'error');
  }
}

// Filter Deposits by Status
function filterAdminDeposits(status) {
  adminDepositFilter = status;
  document.querySelectorAll('.upi-filter-btn').forEach(btn => {
    btn.className = 'upi-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 text-gray-300 hover:text-white';
  });
  if (event && event.target) {
    event.target.classList.remove('bg-slate-800', 'text-gray-300');
    event.target.classList.add('bg-orange-500', 'text-black');
  }
  loadAdminDeposits();
}

// Search Debounce
function debounceAdminDepositSearch() {
  clearTimeout(adminDepositSearchTimeout);
  adminDepositSearchTimeout = setTimeout(() => {
    loadAdminDeposits();
  }, 300);
}

// Toggle & Load Audit Logs
async function toggleAuditLogs() {
  const section = document.getElementById('admin-audit-logs-section');
  if (!section) return;

  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) {
    await loadAdminAuditLogs();
  }
}

async function loadAdminAuditLogs() {
  const container = document.getElementById('admin-audit-logs-list');
  if (!container) return;

  container.innerHTML = '<div class="text-gray-500 py-2">Loading audit trail...</div>';
  try {
    const res = await api.request('/admin/audit-logs');
    const logs = res.logs || [];

    if (logs.length === 0) {
      container.innerHTML = '<div class="text-gray-500 py-2">No administrative audit actions recorded yet.</div>';
      return;
    }

    container.innerHTML = logs.map(l => {
      let details = l.details_json;
      try {
        const parsed = JSON.parse(l.details_json);
        details = JSON.stringify(parsed, null, 1);
      } catch (e) {}

      return `
        <div class="p-2.5 rounded bg-slate-900 border border-slate-800 flex justify-between items-start gap-3">
          <div>
            <div class="font-bold text-white flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300 font-mono text-[10px]">${l.action}</span>
              <span class="text-gray-300">${l.target_type}: ${l.target_id}</span>
            </div>
            <div class="text-[11px] text-gray-400 font-mono mt-1">${details}</div>
            <div class="text-[10px] text-gray-500 mt-1">Admin: ${l.admin_name || l.admin_email || l.admin_id} &bull; IP: ${l.ip_address || '127.0.0.1'}</div>
          </div>
          <div class="text-[10px] text-gray-400 font-mono whitespace-nowrap">
            ${new Date(l.created_at).toLocaleString()}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-red-400">Failed to load audit logs: ${err.message}</div>`;
  }
}

// 3b. PAYMENT GATEWAY CONTROLS (RAZORPAY)
async function loadPaymentSettings() {
  try {
    const res = await api.request('/admin/payment-settings');
    const s = res.settings;

    document.getElementById('gw-status-input').value = s.gateway_status || 'ACTIVE';
    document.getElementById('gw-mode-input').value = s.gateway_mode || 'TEST';
    document.getElementById('gw-key-id-input').value = s.razorpay_key_id || '';
    document.getElementById('gw-key-secret-input').value = s.razorpay_key_secret || '';
    document.getElementById('gw-min-dep-input').value = s.min_deposit || 10;
    document.getElementById('gw-max-dep-input').value = s.max_deposit || 50000;
    document.getElementById('gw-min-wth-input').value = s.min_withdrawal || 50;
    document.getElementById('gw-max-wth-input').value = s.max_withdrawal || 10000;

    const badge = document.getElementById('gateway-status-badge');
    if (badge) {
      const isActive = (s.gateway_status || 'ACTIVE') === 'ACTIVE';
      badge.textContent = isActive ? `${s.gateway_mode || 'TEST'} • ACTIVE` : 'MAINTENANCE';
      badge.className = isActive 
        ? 'px-3 py-1 rounded-full text-xs font-bold uppercase bg-green-500/20 text-green-400 border border-green-500/40'
        : 'px-3 py-1 rounded-full text-xs font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/40';
    }
  } catch (err) {
    showToast(err.message || 'Could not load payment settings.', 'error');
  }
}

async function savePaymentSettings(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-gateway');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving Settings...`;

  const payload = {
    gateway_status: document.getElementById('gw-status-input').value,
    gateway_mode: document.getElementById('gw-mode-input').value,
    razorpay_key_id: document.getElementById('gw-key-id-input').value.trim(),
    razorpay_key_secret: document.getElementById('gw-key-secret-input').value.trim(),
    min_deposit: Number(document.getElementById('gw-min-dep-input').value),
    max_deposit: Number(document.getElementById('gw-max-dep-input').value),
    min_withdrawal: Number(document.getElementById('gw-min-wth-input').value),
    max_withdrawal: Number(document.getElementById('gw-max-wth-input').value)
  };

  try {
    const res = await api.request('/admin/payment-settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast(res.message, 'success');
    await loadPaymentSettings();
  } catch (err) {
    showToast(err.message || 'Failed to save payment settings.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-save"></i> Save Payment Settings`;
  }
}

// 4. WITHDRAWALS VERIFICATION
async function loadAdminWithdrawals() {
  const container = document.getElementById('admin-withdrawals-table-body');
  if (!container) return;

  try {
    const res = await api.request('/admin/withdrawals');
    adminWithdrawals = res.withdrawals || [];

    if (adminWithdrawals.length === 0) {
      container.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-500">No withdrawal requests logged.</td></tr>`;
      return;
    }

    container.innerHTML = adminWithdrawals.map(w => {
      let statusColor = 'bg-yellow-500/20 text-yellow-400';
      if (w.status === 'PAID') statusColor = 'bg-green-500/20 text-green-400';
      if (w.status === 'REJECTED') statusColor = 'bg-red-500/20 text-red-400';

      const isPending = w.status === 'PENDING';

      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30">
          <td class="py-3 px-4 font-bold text-white">${w.user_name} <br/><span class="text-xs text-gray-400">${w.user_mobile}</span></td>
          <td class="py-3 px-4 font-bold text-amber-400 text-sm">₹${Number(w.amount).toFixed(2)}</td>
          <td class="py-3 px-4 text-xs font-mono text-white">${w.upi_id}</td>
          <td class="py-3 px-4 text-xs text-gray-300">${w.account_holder_name}</td>
          <td class="py-3 px-4 text-xs text-gray-400">${new Date(w.created_at).toLocaleString()}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-xs uppercase border border-current ${statusColor}">${w.status}</span>
          </td>
          <td class="py-3 px-4 text-right space-x-2">
            ${isPending ? `
              <button onclick="markWithdrawalPaid('${w.withdrawal_id}')" class="px-3 py-1 rounded bg-green-600 text-black font-bold text-xs hover:bg-green-500 transition">
                <i class="fas fa-check"></i> Mark Paid
              </button>
              <button onclick="rejectWithdrawal('${w.withdrawal_id}')" class="px-2 py-1 rounded bg-red-600/30 text-red-400 text-xs hover:bg-red-600 hover:text-white transition">
                Reject & Refund
              </button>
            ` : `<span class="text-xs text-gray-500">${w.admin_utr ? `Paid (${w.admin_utr})` : 'Resolved'}</span>`}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading admin withdrawals:', err);
  }
}

async function markWithdrawalPaid(withdrawalId) {
  const adminUtr = prompt('Enter Bank Transaction UTR / Reference ID after sending money:');
  if (!adminUtr) return;

  try {
    const res = await api.request(`/admin/withdrawals/${withdrawalId}/pay`, {
      method: 'POST',
      body: JSON.stringify({ adminUtr })
    });
    showToast(res.message, 'success');
    loadAdminWithdrawals();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to mark withdrawal as paid.', 'error');
  }
}

async function rejectWithdrawal(withdrawalId) {
  const reason = prompt('Enter rejection reason (Amount will be automatically refunded back to user wallet):', 'Incorrect UPI ID');
  if (!reason) return;

  try {
    const res = await api.request(`/admin/withdrawals/${withdrawalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    showToast(res.message, 'info');
    loadAdminWithdrawals();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to reject withdrawal.', 'error');
  }
}

// 5. USER MANAGEMENT
async function loadAdminUsers() {
  const container = document.getElementById('admin-users-table-body');
  if (!container) return;

  const search = document.getElementById('admin-user-search-input')?.value || '';

  try {
    const res = await api.request(`/admin/users${search ? '?search=' + encodeURIComponent(search) : ''}`);
    adminUsers = res.users || [];

    container.innerHTML = adminUsers.map(u => {
      const isBlocked = u.status === 'blocked';
      const isAdmin = u.role === 'admin';
      const safeName = (u.name || '').replace(/'/g, "\\'");

      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30">
          <td class="py-3 px-4 font-bold text-white">
            ${u.name} ${isAdmin ? '<span class="text-xs text-orange-400 font-normal">[Admin]</span>' : ''}
            <div class="text-xs text-gray-400">${u.email} • ${u.mobile}</div>
          </td>
          <td class="py-3 px-4 text-xs font-semibold text-orange-300">
            ${u.ff_ign || 'N/A'}<br/>
            <span class="text-gray-400 font-mono text-[11px]">${u.ff_uid || ''}</span>
          </td>
          <td class="py-3 px-4 font-bold text-sm text-green-400">₹${Number(u.wallet_balance).toFixed(2)}</td>
          <td class="py-3 px-4 text-xs">
            <span class="text-gray-400 font-mono">••••••••</span>
            <button onclick="openAdminUserPasswordModal('${u.id}')" class="ml-1.5 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-black font-bold transition text-[11px]">
              <i class="fas fa-key"></i> Set / View
            </button>
          </td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-xs uppercase ${isBlocked ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}">
              ${u.status}
            </span>
          </td>
          <td class="py-3 px-4 text-xs text-gray-400">${new Date(u.created_at).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
            <button onclick="openAdminUserDetailsModal('${u.id}')" class="px-2 py-1 rounded bg-slate-700/80 hover:bg-slate-600 text-gray-200 text-xs font-bold transition">
              <i class="fas fa-id-card"></i> Details
            </button>
            <button onclick="openAdjustWalletModal('${u.id}', '${safeName}')" class="px-2 py-1 rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600 hover:text-white text-xs font-bold transition">
              <i class="fas fa-coins"></i> Wallet
            </button>
            ${!isAdmin ? `
              <button onclick="toggleUserStatus('${u.id}', '${isBlocked ? 'active' : 'blocked'}')" class="px-2 py-1 rounded ${isBlocked ? 'bg-green-600/30 text-green-400 hover:bg-green-600 hover:text-white' : 'bg-red-600/30 text-red-400 hover:bg-red-600 hover:text-white'} text-xs font-bold transition">
                ${isBlocked ? 'Unblock' : 'Block'}
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

async function toggleUserStatus(userId, newStatus) {
  try {
    const res = await api.request(`/admin/users/${userId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    showToast(res.message, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message || 'Failed to update user status.', 'error');
  }
}

function openAdjustWalletModal(userId, userName) {
  const modal = document.getElementById('adjust-wallet-modal');
  document.getElementById('adjust-user-id').value = userId;
  document.getElementById('adjust-user-name').textContent = userName;
  document.getElementById('adjust-amount').value = '';
  document.getElementById('adjust-reason').value = '';

  modal.classList.add('active');
}

function closeAdjustWalletModal() {
  document.getElementById('adjust-wallet-modal').classList.remove('active');
}

async function submitWalletAdjustment(e) {
  e.preventDefault();
  const userId = document.getElementById('adjust-user-id').value;
  const type = document.getElementById('adjust-type').value;
  const amount = Number(document.getElementById('adjust-amount').value);
  const reason = document.getElementById('adjust-reason').value.trim();

  try {
    const res = await api.request(`/admin/users/${userId}/wallet-adjust`, {
      method: 'POST',
      body: JSON.stringify({ type, amount, reason })
    });

    showToast(res.message, 'success');
    closeAdjustWalletModal();
    loadAdminUsers();
    loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to adjust balance.', 'error');
  }
}

// 5b. Admin User Password Management
function openAdminUserPasswordModal(userId) {
  const user = adminUsers.find(u => String(u.id) === String(userId));
  if (!user) {
    showToast('User not found.', 'error');
    return;
  }

  document.getElementById('user-password-target-id').value = user.id;
  document.getElementById('user-password-target-name').textContent = `${user.name} (UID: ${user.ff_uid || user.id})`;
  document.getElementById('user-password-target-email').textContent = user.email;
  document.getElementById('user-password-hash-display').textContent = user.password_hash || 'Bcrypt hash unavailable';
  document.getElementById('admin-user-new-password').value = '';

  const modal = document.getElementById('user-password-modal');
  if (modal) modal.classList.add('active');
}

function closeUserPasswordModal() {
  const modal = document.getElementById('user-password-modal');
  if (modal) modal.classList.remove('active');
}

function generateRandomUserPassword() {
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let randChars = '';
  for (let i = 0; i < 4; i++) {
    randChars += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const generated = `FF_${randChars}@${randNum}`;
  document.getElementById('admin-user-new-password').value = generated;
  showToast(`Generated: ${generated}`, 'info');
}

function copyNewPasswordToClipboard() {
  const input = document.getElementById('admin-user-new-password');
  if (!input || !input.value) {
    showToast('No password to copy yet. Type or generate one.', 'error');
    return;
  }
  navigator.clipboard.writeText(input.value)
    .then(() => showToast('Password copied to clipboard!', 'success'))
    .catch(() => showToast('Failed to copy. Please copy manually.', 'error'));
}

async function submitAdminUserPassword(e) {
  e.preventDefault();
  const userId = document.getElementById('user-password-target-id').value;
  const newPassword = document.getElementById('admin-user-new-password').value.trim();
  const btn = document.getElementById('btn-save-user-password');

  if (!newPassword || newPassword.length < 6) {
    showToast('Password must be at least 6 characters.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

  try {
    const res = await api.request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });

    showToast(res.message || 'Password updated successfully!', 'success');
    closeUserPasswordModal();
    loadAdminUsers();
  } catch (err) {
    showToast(err.message || 'Failed to update user password.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-save"></i> Save & Update Password`;
  }
}

// 5c. Admin User Full Details Modal
function openAdminUserDetailsModal(userId) {
  const user = adminUsers.find(u => String(u.id) === String(userId));
  if (!user) {
    showToast('User not found.', 'error');
    return;
  }

  document.getElementById('detail-user-name-title').textContent = user.name;
  document.getElementById('detail-user-id').textContent = user.id;
  document.getElementById('detail-user-name').textContent = user.name;
  document.getElementById('detail-user-email').textContent = user.email;
  document.getElementById('detail-user-mobile').textContent = user.mobile;
  document.getElementById('detail-user-ign').textContent = user.ff_ign || 'Not set';
  document.getElementById('detail-user-uid').textContent = user.ff_uid || 'Not set';
  document.getElementById('detail-user-balance').textContent = `₹${Number(user.wallet_balance || 0).toFixed(2)}`;
  
  const statusEl = document.getElementById('detail-user-status');
  statusEl.textContent = user.status;
  statusEl.className = user.status === 'blocked' ? 'font-bold uppercase text-red-400' : 'font-bold uppercase text-green-400';

  document.getElementById('detail-user-hash').textContent = user.password_hash || 'Encrypted';

  const btnPass = document.getElementById('btn-detail-manage-pass');
  btnPass.onclick = () => {
    closeUserDetailsModal();
    openAdminUserPasswordModal(user.id);
  };

  const btnWallet = document.getElementById('btn-detail-manage-wallet');
  btnWallet.onclick = () => {
    closeUserDetailsModal();
    openAdjustWalletModal(user.id, user.name);
  };

  const modal = document.getElementById('user-details-modal');
  if (modal) modal.classList.add('active');
}

function closeUserDetailsModal() {
  const modal = document.getElementById('user-details-modal');
  if (modal) modal.classList.remove('active');
}

// 6. ANNOUNCEMENTS
async function loadAdminAnnouncements() {
  const container = document.getElementById('admin-announcements-list');
  if (!container) return;

  try {
    const res = await api.request('/admin/announcements');
    const announcements = res.announcements || [];

    container.innerHTML = announcements.map(a => `
      <div class="p-3 bg-slate-900 border border-slate-800 rounded-lg flex justify-between items-center mb-2">
        <div>
          <div class="font-bold text-white text-sm">${a.title}</div>
          <div class="text-xs text-gray-400">${a.message}</div>
        </div>
        <button onclick="deleteAnnouncement('${a.id}')" class="text-red-400 hover:text-red-300 p-1">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading announcements:', err);
  }
}

async function submitCreateAnnouncement(e) {
  e.preventDefault();
  const title = document.getElementById('ann-title-input').value.trim();
  const message = document.getElementById('ann-message-input').value.trim();

  try {
    const res = await api.request('/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ title, message, type: 'ALERT' })
    });
    showToast(res.message, 'success');
    document.getElementById('ann-title-input').value = '';
    document.getElementById('ann-message-input').value = '';
    loadAdminAnnouncements();
  } catch (err) {
    showToast(err.message || 'Failed to create announcement.', 'error');
  }
}

async function deleteAnnouncement(id) {
  try {
    await api.request(`/admin/announcements/${id}`, { method: 'DELETE' });
    showToast('Announcement removed.', 'info');
    loadAdminAnnouncements();
  } catch (err) {
    showToast(err.message || 'Failed to delete announcement.', 'error');
  }
}

// ============================================================
// 7. PRODUCTS & INVENTORY MANAGEMENT
// ============================================================
let adminProductsList = [];

async function loadAdminProducts() {
  const tbody = document.getElementById('admin-products-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Loading inventory...</td></tr>`;

  try {
    const res = await api.request('/admin/products');
    adminProductsList = res.products || [];

    if (adminProductsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-500">No products configured yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = adminProductsList.map(p => {
      const stockBadge = p.stock_quantity <= 0 
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">OUT OF STOCK (0)</span>`
        : p.stock_quantity <= p.low_stock_threshold
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 font-mono">${p.stock_quantity} (Low)</span>`
          : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 font-mono">${p.stock_quantity}</span>`;

      const statusBadge = p.is_active
        ? `<span class="text-green-400 font-semibold text-xs"><i class="fas fa-check-circle"></i> Active</span>`
        : `<span class="text-gray-500 font-semibold text-xs"><i class="fas fa-pause-circle"></i> Inactive</span>`;

      return `
        <tr class="border-b border-slate-800/60 hover:bg-slate-900/40">
          <td class="py-3 px-4">
            <div class="font-bold text-white">${escapeHtml(p.name)}</div>
            <div class="text-[11px] text-gray-400 font-mono">${escapeHtml(p.sku || 'N/A')}</div>
          </td>
          <td class="py-3 px-4 text-gray-300">${escapeHtml(p.category_name || 'General')}</td>
          <td class="py-3 px-4 font-mono font-bold text-white">₹${parseFloat(p.price).toFixed(2)}</td>
          <td class="py-3 px-4">${stockBadge}</td>
          <td class="py-3 px-4">${statusBadge}</td>
          <td class="py-3 px-4 text-right space-x-2">
            <button onclick="openAdjustStockModal('${p.id}', '${escapeHtml(p.name)}', ${p.stock_quantity})" class="btn-ff-outline text-[11px] px-2.5 py-1">
              <i class="fas fa-boxes"></i> Adjust Stock
            </button>
            <button onclick="deleteAdminProduct('${p.id}', '${escapeHtml(p.name)}')" class="text-red-400 hover:text-red-300 text-xs p-1">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-400">${err.message || 'Failed to load products.'}</td></tr>`;
  }
}

function openCreateProductModal() {
  const modal = document.getElementById('create-product-modal');
  if (modal) modal.classList.add('active');
}

function closeCreateProductModal() {
  const modal = document.getElementById('create-product-modal');
  if (modal) modal.classList.remove('active');
}

async function submitCreateProduct(e) {
  e.preventDefault();
  const name = document.getElementById('new-prod-name').value.trim();
  const category_id = document.getElementById('new-prod-category').value;
  const sku = document.getElementById('new-prod-sku').value.trim();
  const price = parseFloat(document.getElementById('new-prod-price').value);
  const stock_quantity = parseInt(document.getElementById('new-prod-stock').value, 10);
  const description = document.getElementById('new-prod-desc').value.trim();

  const btn = document.getElementById('btn-create-product');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Creating...`;

  try {
    const res = await api.request('/admin/products', {
      method: 'POST',
      body: JSON.stringify({ name, category_id, sku, price, stock_quantity, description })
    });
    showToast('Product created successfully!', 'success');
    closeCreateProductModal();
    document.getElementById('new-prod-name').value = '';
    document.getElementById('new-prod-sku').value = '';
    document.getElementById('new-prod-desc').value = '';
    loadAdminProducts();
  } catch (err) {
    showToast(err.message || 'Failed to create product.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Create Product';
  }
}

function openAdjustStockModal(id, name, currentStock) {
  document.getElementById('adjust-stock-prod-id').value = id;
  document.getElementById('adjust-stock-prod-name').textContent = `${name} (Current: ${currentStock})`;
  document.getElementById('adjust-stock-qty').value = '';
  document.getElementById('adjust-stock-reason').value = '';
  const modal = document.getElementById('adjust-stock-modal');
  if (modal) modal.classList.add('active');
}

function closeAdjustStockModal() {
  const modal = document.getElementById('adjust-stock-modal');
  if (modal) modal.classList.remove('active');
}

async function submitAdjustStock(e) {
  e.preventDefault();
  const id = document.getElementById('adjust-stock-prod-id').value;
  const change_type = document.getElementById('adjust-stock-type').value;
  const quantity = parseInt(document.getElementById('adjust-stock-qty').value, 10);
  const reason = document.getElementById('adjust-stock-reason').value.trim();

  const btn = document.getElementById('btn-adjust-stock');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Updating...`;

  try {
    const res = await api.request(`/admin/products/${id}/stock`, {
      method: 'POST',
      body: JSON.stringify({ change_type, quantity, reason })
    });
    showToast(`Stock updated! New count: ${res.current_stock}`, 'success');
    closeAdjustStockModal();
    loadAdminProducts();
  } catch (err) {
    showToast(err.message || 'Failed to update stock.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Update Stock';
  }
}

async function deleteAdminProduct(id, name) {
  if (!confirm(`Are you sure you want to delete product "${name}"?`)) return;
  try {
    await api.request(`/admin/products/${id}`, { method: 'DELETE' });
    showToast('Product removed.', 'info');
    loadAdminProducts();
  } catch (err) {
    showToast(err.message || 'Failed to delete product.', 'error');
  }
}

// ============================================================
// 8. CUSTOMER ORDERS MANAGEMENT
// ============================================================
let adminOrdersList = [];

async function loadAdminOrders() {
  const tbody = document.getElementById('admin-orders-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>`;

  try {
    const res = await api.request('/admin/orders');
    adminOrdersList = res.orders || [];
    filterAdminOrders();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-400">${err.message || 'Failed to load orders.'}</td></tr>`;
  }
}

function filterAdminOrders() {
  const tbody = document.getElementById('admin-orders-table-body');
  if (!tbody) return;

  const filter = (document.getElementById('orders-filter-status')?.value || 'ALL').toLowerCase();
  const filtered = filter === 'all' 
    ? adminOrdersList 
    : adminOrdersList.filter(o => (o.status || '').toLowerCase() === filter);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-500">No orders match the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => {
    const dateStr = new Date(o.created_at).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    const paymentBadge = o.payment_status === 'paid'
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400">PAID</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">${(o.payment_status || 'PENDING').toUpperCase()}</span>`;

    const statusOptions = ['pending', 'processing', 'completed', 'cancelled'];
    const selectOptions = statusOptions.map(st => `
      <option value="${st}" ${o.status === st ? 'selected' : ''}>${st.toUpperCase()}</option>
    `).join('');

    return `
      <tr class="border-b border-slate-800/60 hover:bg-slate-900/40">
        <td class="py-3 px-4 font-mono font-bold text-white text-xs">${escapeHtml(o.order_number || o.id)}</td>
        <td class="py-3 px-4">
          <div class="font-bold text-white">${escapeHtml(o.user_name || 'Player')}</div>
          <div class="text-[11px] text-gray-400">${escapeHtml(o.user_email || '')}</div>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-green-400">₹${parseFloat(o.total_amount).toFixed(2)}</td>
        <td class="py-3 px-4">${paymentBadge}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
            o.status === 'completed' ? 'bg-green-500/20 text-green-400' :
            o.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
            o.status === 'processing' ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'
          }">${o.status}</span>
        </td>
        <td class="py-3 px-4 text-gray-400 text-[11px]">${dateStr}</td>
        <td class="py-3 px-4 text-right">
          <select onchange="updateOrderStatus('${o.id}', this.value)" class="bg-slate-900 border border-slate-700 text-xs rounded px-2 py-1 text-white">
            ${selectOptions}
          </select>
        </td>
      </tr>
    `;
  }).join('');
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    await api.request(`/admin/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    showToast(`Order status updated to ${newStatus.toUpperCase()}`, 'success');
    loadAdminOrders();
  } catch (err) {
    showToast(err.message || 'Failed to update order status.', 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// 10. LIVE CUSTOMER SERVICE DESK & REAL-TIME SUPPORT CONSOLE
// ============================================================

let adminSupportSocket = null;
let currentAdminSupportFilter = 'ALL';
let currentAdminSupportSearch = '';
let activeAdminSupportConvId = null;
let activeAdminSupportConv = null;
let adminSupportSearchTimer = null;
let adminTypingTimeout = null;

// Initialize admin socket for real-time customer messages and notification chimes
function initAdminSupportSocket() {
  if (typeof io === 'undefined') return;
  if (!adminSupportSocket) {
    adminSupportSocket = io();
  }

  adminSupportSocket.emit('join_admin_support');

  // When any player sends a message
  adminSupportSocket.off('new_customer_message');
  adminSupportSocket.on('new_customer_message', (data) => {
    playAdminSupportChime();
    
    // Update badge
    const badge = document.getElementById('badge-open-support');
    if (badge) {
      const current = parseInt(badge.textContent || '0', 10);
      badge.textContent = current + 1;
      badge.style.display = 'inline';
    }

    showToast(`💬 Support from ${data.userName || 'Player'}: "${(data.message.message || '').substring(0, 40)}..."`, 'info');

    // If support tab is currently active
    const supportTab = document.getElementById('tab-content-support');
    if (supportTab && !supportTab.classList.contains('hidden')) {
      loadAdminSupportChats(false); // reload list silently

      // If viewing this conversation, append message to transcript
      if (activeAdminSupportConvId === data.conversationId) {
        appendAdminSupportTranscript(data.message);
      }
    }
  });

  // When player starts/stops typing
  adminSupportSocket.off('typing_indicator');
  adminSupportSocket.on('typing_indicator', (data) => {
    if (activeAdminSupportConvId === data.conversationId) {
      const indicator = document.getElementById('admin-chat-typing-indicator');
      if (indicator) {
        if (data.isTyping && data.senderType === 'USER') {
          indicator.classList.remove('hidden');
        } else {
          indicator.classList.add('hidden');
        }
      }
    }
  });
}

function playAdminSupportChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(659.25, now); // E5
    osc.frequency.setValueAtTime(880.00, now + 0.1); // A5
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  } catch (e) {}
}

// Filter conversations by status
function filterAdminSupportStatus(status) {
  currentAdminSupportFilter = status;
  document.querySelectorAll('.admin-support-filter').forEach(btn => {
    if (btn.getAttribute('data-status') === status) {
      btn.className = 'admin-support-filter active px-2.5 py-1 rounded bg-orange-600 text-white font-bold';
    } else {
      btn.className = 'admin-support-filter px-2.5 py-1 rounded bg-slate-800 text-gray-400 hover:text-white font-bold';
    }
  });
  loadAdminSupportChats();
}

// Debounced search input handler
function debounceAdminSupportSearch() {
  clearTimeout(adminSupportSearchTimer);
  adminSupportSearchTimer = setTimeout(() => {
    const input = document.getElementById('admin-support-search');
    currentAdminSupportSearch = input ? input.value.trim() : '';
    loadAdminSupportChats();
  }, 300);
}

// Load and render conversation threads
async function loadAdminSupportChats(showLoading = true) {
  const container = document.getElementById('admin-support-conversations-list');
  if (!container) return;

  if (showLoading) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-500 text-xs">
        <i class="fas fa-spinner fa-spin text-orange-500 text-lg mb-2"></i>
        <p>Fetching player inquiries...</p>
      </div>
    `;
  }

  try {
    const res = await api.adminGetSupportConversations({
      status: currentAdminSupportFilter,
      search: currentAdminSupportSearch
    });

    const conversations = res.conversations || [];
    
    // Update badge counters
    const badge = document.getElementById('badge-open-support');
    const openCount = document.getElementById('admin-support-open-count');
    const unreadTotal = Number(res.totalUnreadAdmin || 0);

    if (badge) {
      badge.textContent = unreadTotal;
      badge.style.display = unreadTotal > 0 ? 'inline' : 'none';
    }
    if (openCount) {
      const openTotal = conversations.filter(c => c.status === 'OPEN').length;
      openCount.textContent = openTotal;
    }

    if (conversations.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-500 text-xs">
          <i class="fas fa-inbox text-2xl text-slate-700 mb-2"></i>
          <p class="font-bold text-gray-400">No conversations found</p>
          <p class="text-[11px] text-gray-600 mt-1">There are no player chats matching this filter.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = conversations.map(c => {
      const isSelected = activeAdminSupportConvId === c.id;
      const unreadCount = Number(c.unread_admin_count || 0);
      const isResolved = c.status === 'RESOLVED';

      let timeAgo = '';
      try {
        const d = new Date(c.last_message_at || c.created_at);
        timeAgo = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (e) {}

      return `
        <div 
          onclick="selectAdminSupportConversation('${c.id}')"
          class="p-3.5 cursor-pointer transition border-l-4 ${
            isSelected 
              ? 'bg-orange-500/10 border-orange-500' 
              : unreadCount > 0 
                ? 'bg-slate-900/90 hover:bg-slate-800/80 border-red-500' 
                : 'bg-slate-900/40 hover:bg-slate-800/60 border-transparent'
          }"
        >
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <span class="font-bold text-xs ${unreadCount > 0 ? 'text-white' : 'text-gray-300'}">
                ${escapeHtml(c.user_name || 'Guest')}
              </span>
              ${c.ff_ign ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">${escapeHtml(c.ff_ign)}</span>` : ''}
              ${!c.user_id ? `<span class="px-1 py-0.2 rounded text-[9px] bg-slate-800 text-gray-400">GUEST</span>` : ''}
            </div>
            <span class="text-[10px] text-gray-500 font-mono">${timeAgo}</span>
          </div>

          <p class="text-xs text-gray-400 line-clamp-1 truncate ${unreadCount > 0 ? 'font-semibold text-gray-200' : ''}">
            ${escapeHtml(c.last_message || 'New customer inquiry')}
          </p>

          <div class="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/50 text-[10px]">
            <span class="px-1.5 py-0.5 rounded font-mono font-bold ${
              isResolved ? 'bg-slate-800 text-gray-500' : 'bg-green-500/15 text-green-400'
            }">
              ${c.status}
            </span>
            ${unreadCount > 0 ? `<span class="px-1.5 py-0.2 rounded-full bg-red-600 text-white font-bold font-mono text-[9px]">${unreadCount} NEW</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `
      <div class="p-6 text-center text-red-400 text-xs">
        <p>Failed to load customer conversations.</p>
        <p class="text-[11px] text-gray-500 mt-1">${err.message}</p>
      </div>
    `;
  }
}

// Select conversation and render transcript
async function selectAdminSupportConversation(convId) {
  activeAdminSupportConvId = convId;

  // Highlight list item immediately
  document.querySelectorAll('#admin-support-conversations-list > div').forEach(card => {
    card.classList.remove('bg-orange-500/10', 'border-orange-500');
  });

  const emptyState = document.getElementById('admin-support-empty-state');
  const activeChat = document.getElementById('admin-support-active-chat');
  const transcript = document.getElementById('admin-support-chat-transcript');

  if (emptyState) emptyState.classList.add('hidden');
  if (activeChat) activeChat.classList.remove('hidden');

  if (transcript) {
    transcript.innerHTML = `
      <div class="p-8 text-center text-gray-500 text-xs">
        <i class="fas fa-spinner fa-spin text-orange-500 text-lg mb-2"></i>
        <p>Loading message history & player details...</p>
      </div>
    `;
  }

  try {
    const res = await api.adminGetSupportConversation(convId);
    if (!res.success) throw new Error(res.message);

    activeAdminSupportConv = res.conversation;

    // Header info
    document.getElementById('admin-chat-player-name').textContent = activeAdminSupportConv.user_name || 'Guest Player';
    document.getElementById('admin-chat-player-role').textContent = activeAdminSupportConv.user_id ? 'REGISTERED' : 'GUEST';
    document.getElementById('admin-chat-player-ign').textContent = activeAdminSupportConv.ff_ign ? `IGN: ${activeAdminSupportConv.ff_ign}` : 'IGN: Not set';
    document.getElementById('admin-chat-player-mobile').textContent = activeAdminSupportConv.user_mobile ? `📱 ${activeAdminSupportConv.user_mobile}` : (activeAdminSupportConv.user_email || 'No contact');
    
    const balance = activeAdminSupportConv.wallet_balance !== null && activeAdminSupportConv.wallet_balance !== undefined
      ? `₹${parseFloat(activeAdminSupportConv.wallet_balance).toFixed(2)}`
      : '₹0.00';
    document.getElementById('admin-chat-player-balance').textContent = balance;

    // Status pill & Toggle Button
    updateAdminChatStatusUI(activeAdminSupportConv.status);

    // Render transcript
    renderAdminSupportTranscript(res.messages || []);

    // Scroll bottom
    scrollAdminSupportTranscript();

    // Listen on this conversation socket room
    if (adminSupportSocket) {
      adminSupportSocket.emit('join_support_conversation', convId);
    }

    // Attach typing emitter on admin reply input
    const input = document.getElementById('admin-support-reply-input');
    if (input) {
      input.focus();
      input.oninput = () => {
        if (!adminSupportSocket) return;
        adminSupportSocket.emit('typing_start', {
          conversationId: convId,
          senderName: 'Support Agent',
          senderType: 'ADMIN'
        });
        clearTimeout(adminTypingTimeout);
        adminTypingTimeout = setTimeout(() => {
          adminSupportSocket.emit('typing_stop', { conversationId: convId });
        }, 1500);
      };
    }

    // Update list to clear unread marker
    loadAdminSupportChats(false);
  } catch (err) {
    showToast(err.message || 'Failed to open conversation.', 'error');
  }
}

function updateAdminChatStatusUI(status) {
  const pill = document.getElementById('admin-chat-status-pill');
  const btn = document.getElementById('btn-toggle-ticket-status');

  if (pill) {
    pill.textContent = status;
    if (status === 'RESOLVED') {
      pill.className = 'px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-800 text-gray-400 border border-slate-700 font-mono';
    } else {
      pill.className = 'px-1.5 py-0.2 rounded text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 font-mono';
    }
  }

  if (btn) {
    if (status === 'RESOLVED') {
      btn.innerHTML = `<i class="fas fa-undo text-yellow-400"></i> Reopen Ticket`;
    } else {
      btn.innerHTML = `<i class="fas fa-check-circle text-green-400"></i> Mark Resolved`;
    }
  }
}

// Render messages in admin transcript
function renderAdminSupportTranscript(messages) {
  const container = document.getElementById('admin-support-chat-transcript');
  if (!container) return;

  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500 text-xs">
        <p>No messages in this conversation yet.</p>
      </div>
    `;
    return;
  }

  messages.forEach(msg => appendAdminSupportTranscript(msg, false));
  scrollAdminSupportTranscript();
}

function appendAdminSupportTranscript(msg, scroll = true) {
  const container = document.getElementById('admin-support-chat-transcript');
  if (!container) return;

  let timeStr = '';
  try {
    const d = msg.created_at ? new Date(msg.created_at) : new Date();
    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {}

  const el = document.createElement('div');
  const safeText = formatAdminChatMessage(msg.message);

  let screenshotHtml = '';
  if (msg.screenshot_url) {
    screenshotHtml = `
      <div class="mt-2">
        <a href="${msg.screenshot_url}" target="_blank" rel="noopener noreferrer" title="Click to view full screenshot">
          <img src="${msg.screenshot_url}" alt="Screenshot" class="max-w-[240px] max-h-[180px] rounded-lg border border-slate-700/80 shadow object-cover hover:opacity-90 transition cursor-zoom-in" />
        </a>
      </div>
    `;
  }

  if (msg.sender_type === 'ADMIN') {
    el.className = 'self-end bg-gradient-to-r from-orange-600 to-orange-700 text-white rounded-2xl rounded-br-sm p-3 max-w-[80%] text-xs shadow-md';
    el.innerHTML = `
      <div class="flex items-center gap-1.5 mb-1 text-[10px] text-orange-200">
        <span class="font-bold">${escapeHtml(msg.sender_name || 'Admin')}</span>
        <span class="ml-auto opacity-75 font-mono">${timeStr}</span>
      </div>
      <div class="leading-relaxed">${safeText}</div>
      ${screenshotHtml}
    `;
  } else if (msg.sender_type === 'BOT') {
    el.className = 'self-start bg-slate-900 border border-cyan-500/30 text-gray-300 rounded-2xl rounded-bl-sm p-3 max-w-[82%] text-xs';
    el.innerHTML = `
      <div class="flex items-center gap-1.5 mb-1 pb-1 border-b border-cyan-500/20 text-[10px] text-cyan-400">
        <i class="fas fa-robot"></i>
        <span class="font-bold">Automated Bot Resolution</span>
        <span class="ml-auto text-gray-500 font-mono">${timeStr}</span>
      </div>
      <div class="leading-relaxed text-gray-200">${safeText}</div>
      ${screenshotHtml}
    `;
  } else {
    // User message
    el.className = 'self-start bg-slate-800/90 border border-slate-700 text-white rounded-2xl rounded-bl-sm p-3 max-w-[82%] text-xs shadow-md';
    el.innerHTML = `
      <div class="flex items-center gap-1.5 mb-1 text-[10px] text-orange-400">
        <span class="font-bold">${escapeHtml(msg.sender_name || 'Player')}</span>
        <span class="ml-auto text-gray-400 font-mono">${timeStr}</span>
      </div>
      <div class="leading-relaxed">${safeText}</div>
      ${screenshotHtml}
    `;
  }

  container.appendChild(el);
  if (scroll) scrollAdminSupportTranscript();
}

function formatAdminChatMessage(text) {
  if (!text) return '';
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/`([^`]+)`/g, '<code class="bg-black/50 px-1 py-0.5 rounded text-yellow-300 font-mono text-[10px]">$1</code>');
  safe = safe.replace(/\n/g, '<br/>');
  return safe;
}

function scrollAdminSupportTranscript() {
  const container = document.getElementById('admin-support-chat-transcript');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

let currentAdminScreenshot = null;

async function handleAdminScreenshotSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.match(/^image\/(jpeg|jpg|png|webp|gif)$/i)) {
    showToast('Please select an image file (JPG, PNG, WEBP, GIF).', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Screenshot must be 10MB or smaller.', 'error');
    return;
  }

  showToast('Uploading screenshot...', 'info');
  try {
    const data = await api.uploadSupportScreenshot(file);
    currentAdminScreenshot = data.url;

    // Show preview
    const previewBar = document.getElementById('admin-attachment-preview');
    const previewImg = document.getElementById('admin-preview-img');
    const previewFilename = document.getElementById('admin-preview-filename');
    if (previewBar && previewImg) {
      previewImg.src = data.url;
      if (previewFilename) previewFilename.textContent = file.name;
      previewBar.classList.remove('hidden');
    }
    showToast('Screenshot attached! Ready to send.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to upload screenshot.', 'error');
  }
}

function clearAdminChatAttachment() {
  currentAdminScreenshot = null;
  const fileInput = document.getElementById('admin-chat-screenshot-input');
  if (fileInput) fileInput.value = '';
  const previewBar = document.getElementById('admin-attachment-preview');
  if (previewBar) previewBar.classList.add('hidden');
}

// Admin Send Reply Handler
async function handleAdminSendSupportReply(e) {
  if (e) e.preventDefault();
  if (!activeAdminSupportConvId) {
    showToast('Please select a conversation first.', 'error');
    return;
  }

  const input = document.getElementById('admin-support-reply-input');
  const text = input ? input.value.trim() : '';

  const hasText = !!text;
  const hasScreenshot = !!currentAdminScreenshot;

  if (!hasText && !hasScreenshot) return;

  const outgoingScreenshot = currentAdminScreenshot;
  clearAdminChatAttachment();

  if (input) {
    input.value = '';
    input.focus();
  }

  // Clear typing indicator
  if (adminSupportSocket) {
    adminSupportSocket.emit('typing_stop', { conversationId: activeAdminSupportConvId });
  }

  try {
    const res = await api.adminSendSupportReply(activeAdminSupportConvId, {
      message: text,
      screenshot_url: outgoingScreenshot
    });
    if (res.success && res.message) {
      appendAdminSupportTranscript(res.message);
      // Update status pill to OPEN if it was resolved
      updateAdminChatStatusUI('OPEN');
      loadAdminSupportChats(false);
    }
  } catch (err) {
    showToast(err.message || 'Failed to send reply.', 'error');
  }
}

// Toggle conversation status between OPEN and RESOLVED
async function toggleAdminConversationStatus() {
  if (!activeAdminSupportConvId || !activeAdminSupportConv) return;

  const newStatus = activeAdminSupportConv.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED';

  try {
    const res = await api.adminUpdateSupportStatus(activeAdminSupportConvId, newStatus);
    if (res.success) {
      activeAdminSupportConv.status = newStatus;
      updateAdminChatStatusUI(newStatus);
      showToast(`Conversation marked as ${newStatus}`, 'success');
      loadAdminSupportChats(false);
    }
  } catch (err) {
    showToast(err.message || 'Failed to update status.', 'error');
  }
}

// Insert Canned Response shortcut into reply input
function insertCannedResponse(text) {
  const input = document.getElementById('admin-support-reply-input');
  if (input) {
    input.value = text;
    input.focus();
  }
}
