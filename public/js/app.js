/**
 * SC GAMEING - Core Client Application Controller
 */

let allTournaments = [];
let currentFilterType = 'ALL';
let currentStatusTab = 'upcoming';
let countdownInterval = null;
let activeTournamentToJoin = null;
let socket = null;

document.addEventListener('DOMContentLoaded', async () => {
  initSocketConnection();
  setupNavigation();
  updateAuthUI();
  await loadTournaments();
  startGlobalCountdowns();

  // If user is logged in, refresh profile and stats
  if (api.token) {
    try {
      const res = await api.getProfile();
      api.setSession(api.token, res.user);
      updateAuthUI();
    } catch (e) {
      console.warn('Profile sync failed:', e);
    }
  }
});

// Setup Socket.IO for real-time room updates and slots
function initSocketConnection() {
  if (typeof io !== 'undefined') {
    socket = io();
    socket.on('connect', () => {
      console.log('⚡ Connected to real-time esports server.');
      if (api.user && api.user.id) {
        socket.emit('authenticate_user', api.user.id);
      }
    });

    // Public lobby update: reloads tournaments without leaking credentials
    socket.on('tournament_updated', (data) => {
      loadTournaments();
      const matchesView = document.getElementById('view-matches');
      if (matchesView && !matchesView.classList.contains('hidden')) {
        loadUserMatches();
      }
    });

    socket.on('tournaments_updated', () => {
      loadTournaments();
      const matchesView = document.getElementById('view-matches');
      if (matchesView && !matchesView.classList.contains('hidden')) {
        loadMyMatches();
      }
    });

    // Real-time slot selection and sold out updates
    socket.on('slot_updated', (data) => {
      console.log('⚡ Real-time Slot Update received:', data);
      if (typeof activeSlotSelectTournId !== 'undefined' && activeSlotSelectTournId === data.tournamentId) {
        openSlotSelectModal(data.tournamentId);
      }
      loadTournaments();
      const matchesView = document.getElementById('view-matches');
      if (matchesView && !matchesView.classList.contains('hidden')) {
        loadMyMatches();
      }
    });

    // Real-time participant IGN & UID update
    socket.on('participant_updated', (data) => {
      console.log('⚡ Participant Info Updated:', data);
      loadTournaments();
      const matchesView = document.getElementById('view-matches');
      if (matchesView && !matchesView.classList.contains('hidden')) {
        loadMyMatches();
      }
    });

    socket.on('tournament_rescheduled', (data) => {
      loadTournaments();
      const matchesView = document.getElementById('view-matches');
      if (matchesView && !matchesView.classList.contains('hidden')) {
        loadMyMatches();
      }
      loadUserNotifications();
      if (data && data.title) {
        showToast(`⏰ Match Rescheduled: "${data.title}" start time has been updated!`, 'info');
      }
    });

    // EXCLUSIVE PUSH NOTIFICATION: Pushed to registered tournament joined users ONLY
    socket.on('room_credentials_released', (data) => {
      console.log('🔥 Exclusive Room Push Notification received:', data);
      playRoomAlertChime();

      // 1. Instantly pop up room credentials modal with 1-click copy buttons
      const modal = document.getElementById('room-modal');
      if (modal) {
        document.getElementById('room-modal-title').textContent = data.title;
        document.getElementById('room-id-val').textContent = data.roomId;
        document.getElementById('room-pass-val').textContent = data.roomPassword;
        modal.classList.add('active');
      }

      // 2. Trigger browser desktop notification if supported
      triggerSystemPushNotification(data.title, data.roomId, data.roomPassword);

      // 3. Prominent in-app toast
      showToast(`🎮 ROOM UNLOCKED! ID: ${data.roomId} | Password: ${data.roomPassword}`, 'success');

      // 4. Update in-app notifications dropdown & badge
      loadUserNotifications();

      // 5. Instantly refresh tournaments & My Matches
      loadTournaments();
      const matchesView = document.getElementById('view-matches');
      if (matchesView && !matchesView.classList.contains('hidden')) {
        loadUserMatches();
      }
    });
  }
}

// Global Tab & Bottom Navigation
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.getAttribute('data-view');
      switchView(targetView);
    });
  });
}

function switchView(viewName) {
  // Update nav item active state
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Hide all view containers
  document.querySelectorAll('.app-view').forEach(v => v.classList.add('hidden'));

  // Show selected view
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (viewName === 'wallet') {
    initWallet();
  } else if (viewName === 'matches') {
    loadMyMatches();
  } else if (viewName === 'profile') {
    loadProfileView();
  } else if (viewName === 'home') {
    loadTournaments();
  }
}

// Update Header / UI based on user login state
function updateAuthUI() {
  const loggedInElems = document.querySelectorAll('.auth-logged-in');
  const loggedOutElems = document.querySelectorAll('.auth-logged-out');

  if (api.token && api.user) {
    loggedInElems.forEach(el => el.classList.remove('hidden'));
    loggedOutElems.forEach(el => el.classList.add('hidden'));

    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = api.user.name);
    document.querySelectorAll('.user-ign-display').forEach(el => el.textContent = api.user.ff_ign || 'Set In-Game Name');
    document.querySelectorAll('.user-uid-display').forEach(el => el.textContent = api.user.ff_uid || 'Set UID');

    const balance = Number(api.user.wallet_balance || 0).toFixed(2);
    document.querySelectorAll('.user-balance-val').forEach(el => el.textContent = `₹${balance}`);

    // If admin, show admin portal button
    if (api.user.role === 'admin') {
      document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('hidden'));
    } else {
      document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.add('hidden'));
    }

    // Authenticate user's socket channel & load notifications
    if (socket && api.user.id) {
      socket.emit('authenticate_user', api.user.id);
    }
    loadUserNotifications();
  } else {
    loggedInElems.forEach(el => el.classList.add('hidden'));
    loggedOutElems.forEach(el => el.classList.remove('hidden'));
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.add('hidden'));
  }
}

// ==========================================
// TOURNAMENT CARDS & LISTING
// ==========================================

async function loadTournaments() {
  const container = document.getElementById('tournaments-container');
  if (!container) return;

  try {
    const res = await api.getTournaments({ status: currentStatusTab });
    allTournaments = res.tournaments || [];
    renderTournaments();
  } catch (err) {
    container.innerHTML = `
      <div style="text-align:center; padding: 40px; color:#EF4444;">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem; margin-bottom:10px;"></i>
        <p>Failed to load tournaments. Please check connection.</p>
      </div>
    `;
  }
}

function setTournamentStatusTab(tabName) {
  currentStatusTab = tabName;
  document.querySelectorAll('.status-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-status') === tabName) {
      btn.className = 'status-tab-btn active px-4 py-2 rounded-lg font-bold text-sm bg-orange-600 text-white';
    } else {
      btn.className = 'status-tab-btn px-4 py-2 rounded-lg font-bold text-sm text-gray-400 hover:text-white bg-slate-800/60';
    }
  });
  loadTournaments();
}

function filterTournamentsByType(type) {
  currentFilterType = type;
  document.querySelectorAll('.filter-type-btn').forEach(btn => {
    if (btn.getAttribute('data-type') === type) {
      btn.classList.add('bg-orange-500/20', 'text-orange-400', 'border-orange-500');
      btn.classList.remove('text-gray-400', 'border-transparent');
    } else {
      btn.classList.remove('bg-orange-500/20', 'text-orange-400', 'border-orange-500');
      btn.classList.add('text-gray-400', 'border-transparent');
    }
  });
  renderTournaments();
}

function renderTournaments() {
  const container = document.getElementById('tournaments-container');
  if (!container) return;

  let filtered = allTournaments;
  if (currentFilterType !== 'ALL') {
    filtered = allTournaments.filter(t => t.match_type === currentFilterType);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: rgba(18,24,34,0.5); border-radius: 12px; border: 1px dashed #263347;">
        <i class="fas fa-gamepad" style="font-size: 3rem; color: #475569; margin-bottom: 12px;"></i>
        <h3 style="font-size: 1.25rem; color: #F1F5F9;">No ${currentStatusTab} ${currentFilterType !== 'ALL' ? currentFilterType : ''} matches</h3>
        <p style="color: #64748B; font-size: 0.88rem; margin-top: 6px;">Check back soon for new tournaments scheduled daily!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const slotsFilledPercent = Math.min(100, Math.round((t.slots_joined / t.max_slots) * 100));
    const isFull = t.slots_joined >= t.max_slots;
    const isJoined = Boolean(t.user_joined);
    const hasRoomDetails = Boolean(t.room_id && t.room_id !== 'PROTECTED_ROOM_ID');

    let statusBadge = '';
    if (t.status === 'live' || t.status === 'room_ready') {
      statusBadge = `<span class="live-pulse"><span class="live-dot"></span> LIVE NOW</span>`;
    } else if (t.status === 'completed') {
      statusBadge = `<span style="background: rgba(16,185,129,0.2); color:#10B981; border:1px solid rgba(16,185,129,0.4);" class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase">COMPLETED</span>`;
    } else {
      statusBadge = `<span style="background: rgba(255,165,0,0.2); color:#FFA500; border:1px solid rgba(255,165,0,0.4);" class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase">UPCOMING</span>`;
    }

    const mapImages = {
      'Bermuda': '/assets/images/bermuda.jpg',
      'Purgatory': '/assets/images/purgatory.jpg',
      'Kalahari': '/assets/images/kalahari.jpg',
      'Alpine': '/assets/images/alpine.jpg',
      'Nexterra': '/assets/images/bermuda.jpg'
    };
    const bannerUrl = t.banner_url || mapImages[t.map] || '/assets/images/bermuda.jpg';

    // Format schedule time
    const schedDate = new Date(t.schedule_time);
    const formattedDate = schedDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    const formattedTime = schedDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    let actionButton = '';
    if (t.status === 'completed') {
      actionButton = `
        <button onclick="viewTournamentResults('${t.id}')" class="btn-ff-outline w-full text-center">
          <i class="fas fa-trophy text-yellow-400"></i> View Results
        </button>
      `;
    } else if (isJoined) {
      const slotActionButtons = `
        <div style="display: flex; gap: 6px; margin-top: 8px;">
          <button onclick="openSlotSelectModal('${t.id}')" class="btn-ff-outline flex-1 py-1.5 text-xs text-center text-purple-300 border-purple-500/40 hover:bg-purple-500/10 flex items-center justify-center gap-1 font-bold">
            <i class="fas fa-th text-purple-400"></i> ${t.my_slot ? 'Slot #' + t.my_slot : 'Select Slot'}
          </button>
          <button onclick="openEditPlayerInfoModal('${t.id}')" class="btn-ff-outline flex-1 py-1.5 text-xs text-center text-orange-300 border-orange-500/40 hover:bg-orange-500/10 flex items-center justify-center gap-1 font-bold">
            <i class="fas fa-user-edit text-orange-400"></i> Edit FF Info
          </button>
        </div>
      `;

      if (hasRoomDetails) {
        actionButton = `
          <button onclick="openRoomCredentialsModal('${t.id}')" class="btn-ff-success w-full text-center">
            <i class="fas fa-key"></i> View Room ID & Pass
          </button>
          ${slotActionButtons}
        `;
      } else {
        actionButton = `
          <div style="background: rgba(0, 230, 118, 0.1); border: 1px solid rgba(0, 230, 118, 0.3); color: #00E676; padding: 8px 12px; border-radius: 8px; text-align: center; font-size: 0.85rem; font-weight: 700;">
            <i class="fas fa-check-circle"></i> Joined (Slot #${t.my_slot || 'Assigned'})
          </div>
          ${slotActionButtons}
        `;
      }
    } else if (isFull) {
      actionButton = `
        <button disabled class="w-full py-2.5 bg-gray-800 text-gray-500 rounded-lg font-bold text-center cursor-not-allowed">
          Match Full
        </button>
      `;
    } else {
      actionButton = `
        <button onclick="openJoinModal('${t.id}')" class="btn-ff-primary w-full text-center">
          Join Now • ₹${Number(t.entry_fee).toFixed(0)}
        </button>
      `;
    }

    return `
      <div class="ff-card flex flex-col justify-between">
        <!-- Card Header Banner -->
        <div style="position: relative; height: 140px; background: url('${bannerUrl}') center/cover no-repeat;">
          <div style="position: absolute; inset:0; background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(18,24,34,0.95) 100%);"></div>
          
          <div style="position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; align-items: center;">
            <span style="background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(4px);" class="px-2.5 py-0.5 rounded text-xs font-bold text-white tracking-wider">
              ${t.map} • ${t.match_type}
            </span>
            ${statusBadge}
          </div>

          <div style="position: absolute; bottom: 10px; left: 14px; right: 14px;">
            <h3 style="font-size: 1.15rem; color: #FFF; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${t.title}
            </h3>
            <div style="display: flex; gap: 12px; font-size: 0.75rem; color: #CBD5E1; margin-top: 2px;">
              <span><i class="far fa-calendar-alt text-orange-400"></i> ${formattedDate} at ${formattedTime}</span>
              <span class="countdown-timer text-amber-300 font-semibold" data-target="${t.schedule_time}"></span>
            </div>
          </div>
        </div>

        <!-- Card Body -->
        <div style="padding: 14px;">
          <!-- Prize Pool & Entry Fee Grid -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: rgba(0,0,0,0.3); border: 1px solid #1E293B; border-radius: 8px; padding: 10px; text-align: center;">
            <div>
              <div style="font-size: 0.68rem; color: #94A3B8; text-transform: uppercase;">Prize Pool</div>
              <div style="font-family: 'Rajdhani', sans-serif; font-size: 1.1rem; font-weight: 700; color: #FFD700;">
                ₹${Number(t.total_prize_pool).toFixed(0)}
              </div>
            </div>
            <div>
              <div style="font-size: 0.68rem; color: #94A3B8; text-transform: uppercase;">Per Kill</div>
              <div style="font-family: 'Rajdhani', sans-serif; font-size: 1.1rem; font-weight: 700; color: #FF7700;">
                ₹${Number(t.per_kill_prize).toFixed(0)}
              </div>
            </div>
            <div>
              <div style="font-size: 0.68rem; color: #94A3B8; text-transform: uppercase;">Entry Fee</div>
              <div style="font-family: 'Rajdhani', sans-serif; font-size: 1.1rem; font-weight: 700; color: #00E5FF;">
                ${Number(t.entry_fee) === 0 ? 'FREE' : '₹' + Number(t.entry_fee).toFixed(0)}
              </div>
            </div>
          </div>

          <!-- Slots Progress Bar -->
          <div style="margin: 14px 0 16px 0;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #94A3B8; margin-bottom: 5px;">
              <span>Slots Filled</span>
              <span style="font-weight: 600; color: ${isFull ? '#EF4444' : '#FFF'};">
                ${t.slots_joined} / ${t.max_slots} (${t.max_slots - t.slots_joined} left)
              </span>
            </div>
            <div style="height: 6px; width: 100%; background: #1E293B; border-radius: 9999px; overflow: hidden;">
              <div style="height: 100%; width: ${slotsFilledPercent}%; background: ${isFull ? '#EF4444' : 'linear-gradient(90deg, #FF7700, #FF3D00)'}; transition: width 0.3s ease;"></div>
            </div>
          </div>

          <!-- Action Button -->
          ${actionButton}
        </div>
      </div>
    `;
  }).join('');

  updateCountdowns();
}

// Global Live Countdown Timer (Hours / Min / Sec)
function startGlobalCountdowns() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
  const elements = document.querySelectorAll('.countdown-timer');
  const now = new Date().getTime();

  elements.forEach(el => {
    const targetStr = el.getAttribute('data-target');
    if (!targetStr) return;
    const target = new Date(targetStr).getTime();
    const diff = target - now;

    if (diff <= 0) {
      el.innerHTML = '<span class="inline-flex items-center gap-1.5 font-mono text-red-400 font-bold"><span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span> MATCH TIME / LIVE</span>';
    } else {
      const totalHours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      const mStr = String(mins).padStart(2, '0');
      const sStr = String(secs).padStart(2, '0');

      let timeRemainingText = '';
      if (totalHours >= 24) {
        const days = Math.floor(totalHours / 24);
        const remHours = String(totalHours % 24).padStart(2, '0');
        timeRemainingText = `${days}d ${remHours}h ${mStr}m ${sStr}s`;
      } else {
        const hStr = String(totalHours).padStart(2, '0');
        timeRemainingText = `${hStr}h ${mStr}m ${sStr}s`;
      }

      if (diff <= 15 * 60 * 1000) {
        // Under 15 mins: Glowing pulse indicating room unlock is imminent!
        el.innerHTML = `<span class="inline-flex items-center gap-1.5 font-mono text-yellow-400 font-black animate-pulse"><i class="fas fa-bolt text-orange-400 text-xs"></i> Starts in ${timeRemainingText}</span>`;
      } else {
        el.innerHTML = `<span class="inline-flex items-center gap-1.5 font-mono text-amber-300 font-bold"><i class="far fa-clock text-orange-400 text-xs"></i> Starts in ${timeRemainingText}</span>`;
      }
    }
  });
}

// ==========================================
// JOIN TOURNAMENT MODAL
// ==========================================

async function openJoinModal(tournamentId) {
  if (!api.token) {
    showToast('Please login or signup to join tournaments.', 'info');
    openAuthModal('login');
    return;
  }

  const tournament = allTournaments.find(t => t.id === tournamentId);
  if (!tournament) return;

  activeTournamentToJoin = tournament;

  // Refresh user balance to ensure accurate check
  await loadWalletBalance();

  const modal = document.getElementById('join-modal');
  document.getElementById('join-tourn-title').textContent = tournament.title;
  document.getElementById('join-tourn-map').textContent = `${tournament.map} • ${tournament.match_type}`;
  document.getElementById('join-entry-fee').textContent = `₹${Number(tournament.entry_fee).toFixed(2)}`;
  
  const currentBal = Number(api.user?.wallet_balance || 0);
  document.getElementById('join-user-bal').textContent = `₹${currentBal.toFixed(2)}`;

  // Pre-fill IGN and UID
  document.getElementById('join-ign-input').value = api.user?.ff_ign || '';
  document.getElementById('join-uid-input').value = api.user?.ff_uid || '';

  // Setup team members input if DUO or SQUAD
  const teamContainer = document.getElementById('join-team-members-container');
  teamContainer.innerHTML = '';

  if (tournament.match_type === 'DUO') {
    teamContainer.innerHTML = `
      <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 8px;">
        <label class="text-xs font-semibold text-gray-300">Teammate #2 Free Fire UID & Name</label>
        <div class="grid grid-cols-2 gap-2 mt-1">
          <input type="text" id="team-ign-1" placeholder="Teammate IGN" class="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
          <input type="text" id="team-uid-1" placeholder="Teammate UID" class="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
        </div>
      </div>
    `;
  } else if (tournament.match_type === 'SQUAD') {
    teamContainer.innerHTML = `
      <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 8px;">
        <label class="text-xs font-semibold text-gray-300">Squad Members (3 Teammates)</label>
        ${[1, 2, 3].map(i => `
          <div class="grid grid-cols-2 gap-2 mt-1.5">
            <input type="text" id="team-ign-${i}" placeholder="Member ${i+1} IGN" class="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
            <input type="text" id="team-uid-${i}" placeholder="Member ${i+1} UID" class="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
          </div>
        `).join('')}
      </div>
    `;
  }

  // Check balance vs fee
  const btn = document.getElementById('btn-confirm-join');
  if (currentBal < Number(tournament.entry_fee)) {
    btn.disabled = true;
    btn.className = 'w-full py-2.5 bg-gray-700 text-gray-400 font-bold rounded-lg cursor-not-allowed';
    btn.innerHTML = `<i class="fas fa-wallet"></i> Low Balance (Needs ₹${(Number(tournament.entry_fee) - currentBal).toFixed(2)} more)`;
    document.getElementById('join-add-money-btn')?.classList.remove('hidden');
  } else {
    btn.disabled = false;
    btn.className = 'btn-ff-primary w-full text-center';
    btn.innerHTML = `Confirm & Pay ₹${Number(tournament.entry_fee).toFixed(0)}`;
    document.getElementById('join-add-money-btn')?.classList.add('hidden');
  }

  modal.classList.add('active');
}

function closeJoinModal() {
  document.getElementById('join-modal').classList.remove('active');
}

async function confirmJoinTournament() {
  if (!activeTournamentToJoin) return;

  const ff_ign = document.getElementById('join-ign-input').value.trim();
  const ff_uid = document.getElementById('join-uid-input').value.trim();

  if (!ff_ign || !ff_uid) {
    showToast('Please provide your Free Fire In-Game Name and Character UID.', 'error');
    return;
  }

  // Collect team members if Duo/Squad
  const teamMembers = [];
  if (activeTournamentToJoin.match_type === 'DUO') {
    const ign = document.getElementById('team-ign-1')?.value.trim();
    const uid = document.getElementById('team-uid-1')?.value.trim();
    if (ign || uid) teamMembers.push({ ign, uid });
  } else if (activeTournamentToJoin.match_type === 'SQUAD') {
    for (let i = 1; i <= 3; i++) {
      const ign = document.getElementById(`team-ign-${i}`)?.value.trim();
      const uid = document.getElementById(`team-uid-${i}`)?.value.trim();
      if (ign || uid) teamMembers.push({ ign, uid });
    }
  }

  const btn = document.getElementById('btn-confirm-join');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing Entry...`;

  try {
    const res = await api.joinTournament(activeTournamentToJoin.id, {
      ff_ign,
      ff_uid,
      team_members: teamMembers.length > 0 ? teamMembers : undefined
    });

    showToast(res.message, 'success');
    closeJoinModal();
    await loadWalletBalance();
    await loadTournaments();
  } catch (err) {
    showToast(err.message || 'Failed to join tournament.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Confirm & Pay`;
  }
}

// ==========================================
// ROOM ID & PASSWORD MODAL
// ==========================================

async function openRoomCredentialsModal(tournamentId) {
  try {
    const res = await api.getTournamentDetails(tournamentId);
    const t = res.tournament;

    if (!t.room_id || t.room_id === 'PROTECTED_ROOM_ID') {
      showToast('Room ID and Password have not been published yet. Check back 15 mins before match!', 'info');
      return;
    }

    const modal = document.getElementById('room-modal');
    document.getElementById('room-modal-title').textContent = t.title;
    document.getElementById('room-id-val').textContent = t.room_id;
    document.getElementById('room-pass-val').textContent = t.room_password;

    modal.classList.add('active');
  } catch (err) {
    showToast(err.message || 'Could not fetch room details.', 'error');
  }
}

function closeRoomModal() {
  document.getElementById('room-modal').classList.remove('active');
}

function copyText(elemId, label) {
  const text = document.getElementById(elemId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} copied: ${text}`, 'success');
  }).catch(() => {
    prompt(`Copy ${label}:`, text);
  });
}

// ==========================================
// REAL-TIME SLOT SELECTOR (FOR JOINED USERS)
// ==========================================

let activeSlotSelectTournId = null;
let activeEditPlayerTournId = null;

async function openSlotSelectModal(tournamentId) {
  if (!api.token) {
    showToast('Please login to view and select your slot.', 'info');
    openAuthModal('login');
    return;
  }

  activeSlotSelectTournId = tournamentId;
  const modal = document.getElementById('slot-select-modal');
  const container = document.getElementById('slot-grid-container');
  if (!modal || !container) return;

  container.innerHTML = `
    <div class="col-span-full py-8 text-center text-gray-400 text-xs">
      <i class="fas fa-spinner fa-spin text-orange-500 text-lg mb-2"></i>
      <p>Loading real-time room slots...</p>
    </div>
  `;
  modal.classList.add('active');

  try {
    const res = await api.getTournamentSlots(tournamentId);
    if (!res.success) throw new Error(res.message);

    document.getElementById('slot-modal-tourn-title').textContent = res.title;
    document.getElementById('slot-modal-match-type').textContent = res.matchType || 'SOLO';
    document.getElementById('slot-modal-stats').textContent = `Booked: ${res.slotsJoined} / ${res.maxSlots} Seats`;

    renderSlotGrid(res.slots, tournamentId, res.maxSlots);
  } catch (err) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-rose-400 text-xs">
        <i class="fas fa-exclamation-triangle text-lg mb-1"></i>
        <p>${err.message || 'Could not load slots.'}</p>
      </div>
    `;
  }
}

function closeSlotSelectModal() {
  activeSlotSelectTournId = null;
  const modal = document.getElementById('slot-select-modal');
  if (modal) modal.classList.remove('active');
}

function renderSlotGrid(slots, tournamentId, maxSlots) {
  const container = document.getElementById('slot-grid-container');
  if (!container) return;

  container.innerHTML = slots.map(s => {
    if (s.isMySlot) {
      // User's currently assigned slot
      return `
        <div class="p-2.5 rounded-xl bg-purple-900/40 border-2 border-purple-500 shadow-lg shadow-purple-900/40 text-center flex flex-col justify-between items-center relative overflow-hidden transition" title="Your current slot #${s.slotNumber}">
          <span class="absolute top-1 right-1 w-2 h-2 rounded-full bg-purple-400 animate-ping"></span>
          <div class="font-mono font-black text-sm text-purple-300">#${s.slotNumber}</div>
          <div class="my-1 text-purple-400 text-base"><i class="fas fa-user-check"></i></div>
          <div class="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-500 text-white tracking-wider uppercase">YOU</div>
        </div>
      `;
    } else if (s.status === 'SOLD_OUT') {
      // Taken / Sold out
      return `
        <div class="p-2.5 rounded-xl bg-slate-900/80 border border-rose-500/40 text-center flex flex-col justify-between items-center opacity-70 cursor-not-allowed select-none" title="Slot #${s.slotNumber} is Sold Out (${s.ign || 'Player'})">
          <div class="font-mono font-bold text-xs text-gray-500">#${s.slotNumber}</div>
          <div class="my-1 text-rose-500 text-sm"><i class="fas fa-lock"></i></div>
          <div class="px-1 py-0.5 rounded text-[8px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-tight">SOLD OUT</div>
        </div>
      `;
    } else {
      // Available to click & select
      return `
        <button onclick="handleUserSelectSlot('${tournamentId}', ${s.slotNumber})" class="p-2.5 rounded-xl bg-slate-900 hover:bg-emerald-950/60 border border-slate-700 hover:border-emerald-500 text-center flex flex-col justify-between items-center transition group cursor-pointer active:scale-95" title="Click to choose Slot #${s.slotNumber}">
          <div class="font-mono font-bold text-xs text-gray-300 group-hover:text-emerald-400">#${s.slotNumber}</div>
          <div class="my-1 text-emerald-500/60 group-hover:text-emerald-400 text-sm transition"><i class="fas fa-chair"></i></div>
          <div class="px-1 py-0.5 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase tracking-tight">CHOOSE</div>
        </button>
      `;
    }
  }).join('');
}

async function handleUserSelectSlot(tournamentId, slotNumber) {
  showToast(`Switching to Slot #${slotNumber}...`, 'info');
  try {
    const res = await api.selectTournamentSlot(tournamentId, slotNumber);
    showToast(res.message || `Slot #${slotNumber} confirmed!`, 'success');

    // Live refresh slot grid & views
    await openSlotSelectModal(tournamentId);
    await loadTournaments();
    await loadMyMatches();
  } catch (err) {
    showToast(err.message || 'Failed to select slot. It may have just been booked.', 'error');
    openSlotSelectModal(tournamentId);
  }
}

// ==========================================
// EDIT FREE FIRE PLAYER NAME & UID FOR ROOM
// ==========================================

async function openEditPlayerInfoModal(tournamentId) {
  if (!api.token) {
    showToast('Please login to update your player credentials.', 'info');
    openAuthModal('login');
    return;
  }

  activeEditPlayerTournId = tournamentId;
  const modal = document.getElementById('edit-player-info-modal');
  if (!modal) return;

  document.getElementById('edit-player-tourn-id').value = tournamentId;

  try {
    const res = await api.getTournamentDetails(tournamentId);
    const t = res.tournament;
    document.getElementById('edit-player-tourn-title').textContent = `${t.title} (${t.map} • ${t.match_type})`;

    const participant = t.participant_details;
    if (participant) {
      document.getElementById('edit-player-current-slot').textContent = `Slot #${participant.slot_number || '--'}`;
      document.getElementById('edit-player-ign').value = participant.ff_ign || api.user?.ff_ign || '';
      document.getElementById('edit-player-uid').value = participant.ff_uid || api.user?.ff_uid || '';

      const teamContainer = document.getElementById('edit-teammates-container');
      teamContainer.innerHTML = '';

      let parsedTeam = [];
      try {
        if (participant.team_members) {
          parsedTeam = typeof participant.team_members === 'string' ? JSON.parse(participant.team_members) : participant.team_members;
        }
      } catch(e) {}

      if (t.match_type === 'DUO') {
        const tm = parsedTeam[0] || {};
        teamContainer.innerHTML = `
          <div class="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800">
            <label class="text-xs font-semibold text-gray-300 block mb-1">Teammate #2 Info</label>
            <div class="grid grid-cols-2 gap-2">
              <input type="text" id="edit-team-ign-1" value="${tm.ign || ''}" placeholder="Teammate IGN" class="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
              <input type="text" id="edit-team-uid-1" value="${tm.uid || ''}" placeholder="Teammate UID" class="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
            </div>
          </div>
        `;
      } else if (t.match_type === 'SQUAD') {
        teamContainer.innerHTML = `
          <div class="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 space-y-2">
            <label class="text-xs font-semibold text-gray-300 block">Squad Members (3 Teammates)</label>
            ${[1, 2, 3].map(i => {
              const tm = parsedTeam[i-1] || {};
              return `
                <div class="grid grid-cols-2 gap-2">
                  <input type="text" id="edit-team-ign-${i}" value="${tm.ign || ''}" placeholder="Member ${i+1} IGN" class="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
                  <input type="text" id="edit-team-uid-${i}" value="${tm.uid || ''}" placeholder="Member ${i+1} UID" class="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white" />
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    } else {
      document.getElementById('edit-player-ign').value = api.user?.ff_ign || '';
      document.getElementById('edit-player-uid').value = api.user?.ff_uid || '';
    }

    modal.classList.add('active');
  } catch (err) {
    showToast(err.message || 'Could not load player details.', 'error');
  }
}

function closeEditPlayerInfoModal() {
  activeEditPlayerTournId = null;
  const modal = document.getElementById('edit-player-info-modal');
  if (modal) modal.classList.remove('active');
}

async function submitEditPlayerInfo(e) {
  if (e) e.preventDefault();
  const tournamentId = document.getElementById('edit-player-tourn-id').value;
  const ff_ign = document.getElementById('edit-player-ign').value.trim();
  const ff_uid = document.getElementById('edit-player-uid').value.trim();

  if (!tournamentId || !ff_ign || !ff_uid) {
    showToast('Please provide your Free Fire In-Game Name and Character UID.', 'error');
    return;
  }

  const teamMembers = [];
  const t1Ign = document.getElementById('edit-team-ign-1')?.value.trim();
  const t1Uid = document.getElementById('edit-team-uid-1')?.value.trim();
  if (t1Ign || t1Uid) teamMembers.push({ ign: t1Ign, uid: t1Uid });

  for (let i = 2; i <= 3; i++) {
    const ign = document.getElementById(`edit-team-ign-${i}`)?.value.trim();
    const uid = document.getElementById(`edit-team-uid-${i}`)?.value.trim();
    if (ign || uid) teamMembers.push({ ign, uid });
  }

  const btn = document.getElementById('btn-save-player-info');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const res = await api.updateTournamentPlayerInfo(tournamentId, {
      ff_ign,
      ff_uid,
      team_members: teamMembers.length > 0 ? teamMembers : undefined
    });

    showToast(res.message || 'Free Fire Player info updated!', 'success');
    closeEditPlayerInfoModal();

    if (api.user) {
      api.user.ff_ign = ff_ign;
      api.user.ff_uid = ff_uid;
      localStorage.setItem('user', JSON.stringify(api.user));
    }

    await loadMyMatches();
    await loadTournaments();
  } catch (err) {
    showToast(err.message || 'Failed to update player information.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// ==========================================
// MY MATCHES VIEW
// ==========================================

async function loadMyMatches() {
  if (!api.token) {
    document.getElementById('matches-logged-out')?.classList.remove('hidden');
    document.getElementById('matches-container')?.classList.add('hidden');
    return;
  }

  document.getElementById('matches-logged-out')?.classList.add('hidden');
  const container = document.getElementById('matches-container');
  container.classList.remove('hidden');

  try {
    const res = await api.getMyMatches();
    const matches = res.matches || [];

    if (matches.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px; background: rgba(18,24,34,0.5); border-radius:12px; border:1px dashed #263347;">
          <i class="fas fa-gamepad" style="font-size:3rem; color:#475569; margin-bottom:12px;"></i>
          <h3 style="font-size:1.25rem; color:#FFF;">You haven't joined any matches yet</h3>
          <p style="color:#94A3B8; font-size:0.88rem; margin: 8px 0 16px 0;">Find upcoming tournaments and book your slot!</p>
          <button onclick="switchView('home')" class="btn-ff-primary">Browse Tournaments</button>
        </div>
      `;
      return;
    }

    container.innerHTML = matches.map(m => {
      const isRoomReady = m.status === 'room_ready' || m.status === 'live';
      const isCompleted = m.status === 'completed';

      return `
        <div class="ff-card" style="padding: 16px; margin-bottom: 14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-800 text-orange-400 border border-slate-700">
                ${m.map} • ${m.match_type}
              </span>
              <h3 style="font-size: 1.15rem; color: #FFF; margin-top: 6px; font-weight: 700;">${m.title}</h3>
              <div style="font-size: 0.8rem; color: #94A3B8; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
                <span><i class="far fa-clock text-orange-400"></i> ${new Date(m.schedule_time).toLocaleString()} • Slot #${m.slot_number}</span>
                ${!isCompleted ? `<span class="countdown-timer text-amber-300 font-semibold" data-target="${m.schedule_time}"></span>` : ''}
              </div>
            </div>
            <div>
              ${isCompleted 
                ? `<span class="px-2.5 py-1 rounded bg-green-500/20 text-green-400 font-bold text-xs">Completed</span>`
                : isRoomReady 
                ? `<span class="live-pulse"><span class="live-dot"></span> Room Ready</span>`
                : `<span class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 font-bold text-xs">Registered</span>`
              }
            </div>
          </div>

          <!-- Player Identity & Real-time Slot Actions -->
          <div style="margin-top: 12px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid #1E293B; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="font-size: 0.78rem;">
              <span style="color: #94A3B8;">Player:</span> <strong style="color: #FFF;">${m.player_ign || 'Player'}</strong>
              <span style="color: #94A3B8; margin-left: 8px;">UID:</span> <code style="color: #00E5FF; font-family: monospace;">${m.player_uid || 'N/A'}</code>
              <span style="margin-left: 8px; background: rgba(168, 85, 247, 0.2); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">Slot #${m.slot_number}</span>
            </div>
            ${!isCompleted ? `
              <div style="display: flex; gap: 6px;">
                <button onclick="openSlotSelectModal('${m.id}')" class="px-2.5 py-1 rounded bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer">
                  <i class="fas fa-th text-purple-400"></i> Change Slot
                </button>
                <button onclick="openEditPlayerInfoModal('${m.id}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-gray-200 border border-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer">
                  <i class="fas fa-user-edit text-orange-400"></i> Edit FF Name & UID
                </button>
              </div>
            ` : ''}
          </div>

          <!-- Room Credentials Box if released -->
          ${isRoomReady && m.room_id ? `
            <div style="margin-top: 14px; background: rgba(0, 230, 118, 0.08); border: 1px solid rgba(0, 230, 118, 0.3); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 0.75rem; color: #00E676; font-weight: 700; text-transform: uppercase;">Room Credentials Unlocked</div>
                <div style="display: flex; gap: 16px; margin-top: 4px; font-family: monospace; font-size: 0.95rem;">
                  <span>ID: <strong class="text-white">${m.room_id}</strong></span>
                  <span>Pass: <strong class="text-white">${m.room_password}</strong></span>
                </div>
              </div>
              <button onclick="openRoomCredentialsModal('${m.id}')" class="btn-ff-success" style="padding: 6px 12px; font-size: 0.8rem;">
                <i class="fas fa-copy"></i> Copy
              </button>
            </div>
          ` : ''}

          <!-- Post match stats if completed -->
          ${isCompleted ? `
            <div style="margin-top: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 8px; text-align: center;">
              <div>
                <div style="font-size: 0.7rem; color: #94A3B8;">Rank</div>
                <div style="font-weight: 700; color: #FFD700;">#${m.rank || 'N/A'}</div>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: #94A3B8;">Kills</div>
                <div style="font-weight: 700; color: #FF7700;">${m.kills || 0}</div>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: #94A3B8;">Prize Won</div>
                <div style="font-weight: 700; color: #00E676;">₹${Number(m.prize_won || 0).toFixed(2)}</div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    updateCountdowns();
  } catch (err) {
    console.error('Error loading my matches:', err);
  }
}

// ==========================================
// RESULTS / LEADERBOARD MODAL
// ==========================================

async function viewTournamentResults(tournamentId) {
  try {
    const res = await api.getTournamentDetails(tournamentId);
    const t = res.tournament;
    const modal = document.getElementById('results-modal');

    document.getElementById('results-modal-title').textContent = t.title;
    const listContainer = document.getElementById('results-participants-list');

    const participants = t.participants || [];
    if (participants.length === 0) {
      listContainer.innerHTML = `<div style="text-align:center; color:#64748B; padding:20px;">Results are being verified by tournament referees.</div>`;
    } else {
      listContainer.innerHTML = participants.map((p, idx) => {
        const isBooyah = p.rank === 1;
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px; border-bottom:1px solid #1E293B; background: ${isBooyah ? 'rgba(255, 215, 0, 0.1)' : 'transparent'};">
            <div style="display:flex; align-items:center; gap: 10px;">
              <span style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; background: ${isBooyah ? '#FFD700' : '#1E293B'}; color: ${isBooyah ? '#000' : '#FFF'};">
                ${p.rank || (idx + 1)}
              </span>
              <div>
                <div style="font-weight: 700; color: #FFF;">${p.ff_ign}</div>
                <div style="font-size: 0.75rem; color: #94A3B8;">Slot #${p.slot_number} • ${p.kills || 0} Kills</div>
              </div>
            </div>
            <div style="font-family: 'Rajdhani', sans-serif; font-size: 1.15rem; font-weight: 700; color: ${p.prize_won > 0 ? '#00E676' : '#64748B'};">
              ${p.prize_won > 0 ? `+₹${Number(p.prize_won).toFixed(2)}` : '₹0'}
            </div>
          </div>
        `;
      }).join('');
    }

    modal.classList.add('active');
  } catch (err) {
    showToast(err.message || 'Could not load results.', 'error');
  }
}

function closeResultsModal() {
  document.getElementById('results-modal').classList.remove('active');
}

// ==========================================
// PROFILE VIEW
// ==========================================

async function loadProfileView() {
  if (!api.token) {
    document.getElementById('profile-logged-out')?.classList.remove('hidden');
    document.getElementById('profile-logged-in')?.classList.add('hidden');
    return;
  }

  document.getElementById('profile-logged-out')?.classList.add('hidden');
  document.getElementById('profile-logged-in')?.classList.remove('hidden');

  try {
    const res = await api.getProfile();
    const u = res.user;

    document.getElementById('profile-name-input').value = u.name;
    document.getElementById('profile-email-display').textContent = u.email;
    document.getElementById('profile-mobile-display').textContent = u.mobile;
    document.getElementById('profile-ign-input').value = u.ff_ign || '';
    document.getElementById('profile-uid-input').value = u.ff_uid || '';

    // Career Stats
    document.getElementById('stat-total-matches').textContent = u.stats?.totalMatches || 0;
    document.getElementById('stat-total-kills').textContent = u.stats?.totalKills || 0;
    document.getElementById('stat-total-winnings').textContent = `₹${(u.stats?.totalWinnings || 0).toFixed(2)}`;
    document.getElementById('stat-booyahs').textContent = u.stats?.booyahs || 0;
  } catch (err) {
    console.error('Error loading profile view:', err);
  }
}

async function saveProfile() {
  const name = document.getElementById('profile-name-input').value.trim();
  const ff_ign = document.getElementById('profile-ign-input').value.trim();
  const ff_uid = document.getElementById('profile-uid-input').value.trim();

  try {
    const res = await api.updateProfile({ name, ff_ign, ff_uid });
    api.setSession(api.token, res.user);
    updateAuthUI();
    showToast('Profile updated successfully!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to update profile.', 'error');
  }
}

// ==========================================
// AUTHENTICATION MODALS (LOGIN / SIGNUP)
// ==========================================

function openAuthModal(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  modal.classList.add('active');
  switchAuthTab(mode);
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('active');
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('login-form-container');
  const signupForm = document.getElementById('signup-form-container');
  const forgotForm = document.getElementById('forgot-form-container');

  loginForm.classList.add('hidden');
  signupForm.classList.add('hidden');
  forgotForm.classList.add('hidden');

  if (tab === 'login') loginForm.classList.remove('hidden');
  else if (tab === 'signup') signupForm.classList.remove('hidden');
  else if (tab === 'forgot') forgotForm.classList.remove('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('login-identifier').value.trim();
  const password = document.getElementById('login-password').value;

  const btn = document.getElementById('btn-submit-login');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Authenticating...`;

  try {
    const res = await api.login({ identifier, password });
    showToast(`Welcome back, ${res.user.name}!`, 'success');
    closeAuthModal();
    updateAuthUI();
    loadTournaments();
  } catch (err) {
    showToast(err.message || 'Login failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Login to Arena`;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const mobile = document.getElementById('signup-mobile').value.trim();
  const ff_ign = document.getElementById('signup-ign').value.trim();
  const ff_uid = document.getElementById('signup-uid').value.trim();
  const password = document.getElementById('signup-password').value;

  const btn = document.getElementById('btn-submit-signup');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Creating Account...`;

  try {
    const res = await api.register({ name, email, mobile, ff_ign, ff_uid, password });
    showToast(res.message, 'success');
    closeAuthModal();
    updateAuthUI();
    loadTournaments();
  } catch (err) {
    showToast(err.message || 'Signup failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Create Account`;
  }
}

let modalTimerInterval = null;
let modalResendInterval = null;

function startModalOtpTimer() {
  clearInterval(modalTimerInterval);
  let totalSeconds = 300;
  const timerEl = document.getElementById('modal-otp-timer-val');
  modalTimerInterval = setInterval(() => {
    totalSeconds--;
    if (totalSeconds <= 0) {
      clearInterval(modalTimerInterval);
      if (timerEl) {
        timerEl.textContent = '00:00 (Expired)';
        timerEl.className = 'text-red-400 font-mono';
      }
      return;
    }
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    if (timerEl) timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function startModalResendCooldown() {
  clearInterval(modalResendInterval);
  let seconds = 60;
  const cooldownBox = document.getElementById('modal-resend-cooldown-box');
  const timerDisplay = document.getElementById('modal-resend-timer-display');
  const secNum = document.getElementById('modal-resend-seconds-num');
  const btn = document.getElementById('btn-modal-resend-otp');

  if (cooldownBox) cooldownBox.classList.remove('hidden');
  if (btn) {
    btn.classList.add('hidden');
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-redo"></i> Send Again OTP`;
  }
  if (timerDisplay) timerDisplay.textContent = '01:00';
  if (secNum) secNum.textContent = '60';

  modalResendInterval = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(modalResendInterval);
      if (cooldownBox) cooldownBox.classList.add('hidden');
      if (btn) {
        btn.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-redo"></i> Send Again OTP`;
      }
      return;
    }
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    if (timerDisplay) timerDisplay.textContent = `${m}:${s}`;
    if (secNum) secNum.textContent = seconds;
  }, 1000);
}

async function resendModalOtp() {
  const email = document.getElementById('forgot-email')?.value.trim();
  if (!email) return;
  const btn = document.getElementById('btn-modal-resend-otp');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Dispatching OTP...`;
  }
  try {
    const res = await api.forgotPassword(email);
    showToast(res.message || 'New verification code sent! Check your email.', 'success');
    startModalOtpTimer();
    startModalResendCooldown();
  } catch (err) {
    showToast(err.message || 'Failed to resend code.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fas fa-redo"></i> Send Again OTP`;
    }
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();

  try {
    const res = await api.forgotPassword(email);
    showToast(res.message, 'info');
    document.getElementById('reset-section').classList.remove('hidden');
    startModalOtpTimer();
    startModalResendCooldown();
  } catch (err) {
    showToast(err.message || 'Failed to request reset.', 'error');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  const resetCode = document.getElementById('reset-code').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;

  try {
    const res = await api.resetPassword({ email, resetCode, newPassword });
    showToast(res.message, 'success');
    switchAuthTab('login');
  } catch (err) {
    showToast(err.message || 'Password reset failed.', 'error');
  }
}

// ==========================================
// USER MATCH & ROOM PUSH NOTIFICATIONS
// ==========================================

let userNotifications = [];

// High-Energy Web Audio API Chime for Room Credentials Push Release
function playRoomAlertChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 triumphant fanfare
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      gain.gain.setValueAtTime(0.2, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.36);
    });
  } catch (e) {}
}

// Request Desktop Web Push Notification permission
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Trigger Desktop Browser Push Notification
function triggerSystemPushNotification(title, roomId, roomPassword) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notif = new Notification(`🎮 ROOM UNLOCKED: ${title}`, {
        body: `Room ID: ${roomId} | Password: ${roomPassword}\nJoin custom room within 10 minutes!`,
        icon: '/assets/images/logo.svg',
        tag: `room_${roomId}`,
        requireInteraction: true
      });
      notif.onclick = () => {
        window.focus();
        const modal = document.getElementById('room-modal');
        if (modal) modal.classList.add('active');
        notif.close();
      };
    }
  } catch (e) {}
}

// Fetch user notifications and update badge
async function loadUserNotifications() {
  if (!api.token || !api.user) return;

  try {
    const res = await api.getNotifications();
    if (res.success) {
      userNotifications = res.notifications || [];
      const unreadCount = Number(res.unreadCount || 0);

      const badge = document.getElementById('header-notif-badge');
      if (badge) {
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        if (unreadCount > 0) {
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      renderNotificationsList();
    }
  } catch (err) {
    console.warn('Failed to load notifications:', err);
  }
}

// Render notification items in dropdown
function renderNotificationsList() {
  const container = document.getElementById('notifications-list');
  if (!container) return;

  if (userNotifications.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-gray-500 text-xs">
        <i class="far fa-bell-slash text-base text-gray-600 mb-1.5 block"></i>
        <span>No match notifications yet</span>
      </div>
    `;
    return;
  }

  container.innerHTML = userNotifications.map(n => {
    let data = {};
    try {
      data = n.data_json ? (typeof n.data_json === 'string' ? JSON.parse(n.data_json) : n.data_json) : {};
    } catch (e) {}

    const isRoomNotif = n.type === 'ROOM_RELEASED';
    const isUnread = !n.is_read;

    let timeStr = '';
    try {
      timeStr = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {}

    return `
      <div class="p-3 ${isUnread ? 'bg-orange-500/10' : 'bg-transparent'} hover:bg-slate-800/60 transition rounded-lg">
        <div class="flex items-start gap-2.5">
          <div class="w-7 h-7 rounded-lg ${isRoomNotif ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-orange-500/20 text-orange-400 border border-orange-500/40'} flex items-center justify-center text-xs shrink-0 mt-0.5">
            <i class="fas ${isRoomNotif ? 'fa-key' : 'fa-bell'}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-xs font-bold text-white font-heading truncate">${escapeHtml(n.title)}</h4>
              <span class="text-[10px] text-gray-500 font-mono shrink-0">${timeStr}</span>
            </div>
            <p class="text-[11px] text-gray-300 mt-0.5 leading-snug">${escapeHtml(n.message)}</p>

            ${isRoomNotif && data.room_id ? `
              <div class="mt-2 p-2 bg-black/60 rounded border border-green-500/30 flex items-center justify-between gap-2">
                <div class="text-[11px] font-mono">
                  <span class="text-gray-400">ID:</span> <strong class="text-white">${escapeHtml(data.room_id)}</strong>
                  <span class="text-gray-400 ml-2">Pass:</span> <strong class="text-yellow-400">${escapeHtml(data.room_password)}</strong>
                </div>
                <button onclick="openRoomCredentialsModal('${data.tournament_id}')" class="btn-ff-success text-[10px] px-2 py-0.5 whitespace-nowrap">
                  <i class="fas fa-eye"></i> View
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Toggle notification dropdown
function toggleNotificationDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('notification-dropdown');
  if (!dropdown) return;

  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    loadUserNotifications();
    requestNotificationPermission();
  } else {
    dropdown.classList.add('hidden');
  }
}

// Close notification dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('notification-dropdown');
  const toggleBtn = document.getElementById('btn-notifications-toggle');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!dropdown.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
      dropdown.classList.add('hidden');
    }
  }
});

// Mark all notifications read
async function markAllNotificationsAsRead() {
  try {
    await api.markNotificationsRead();
    const badge = document.getElementById('header-notif-badge');
    if (badge) badge.classList.add('hidden');
    userNotifications.forEach(n => n.is_read = 1);
    renderNotificationsList();
    showToast('All notifications marked as read', 'info');
  } catch (err) {
    console.warn('Mark read failed:', err);
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
