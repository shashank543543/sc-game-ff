/**
 * SC GAMEING - Tournament Starting Remaining Time & Room Push Notification Verification Test
 */

const http = require('http');
const { app, server } = require('../server/index.js');
const db = require('../server/db');

function apiCall(endpoint, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost:5000${endpoint}`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          json._statusCode = res.statusCode;
          if (res.statusCode >= 400) {
            const err = new Error(`[${res.statusCode}] ${json.message || data}`);
            err.status = res.statusCode;
            err.response = json;
            return reject(err);
          }
          resolve(json);
        } catch (e) {
          if (res.statusCode >= 400) {
            const err = new Error(`[${res.statusCode}] ${data}`);
            err.status = res.statusCode;
            return reject(err);
          }
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// Client-side helper function to test remaining time format
function formatRemainingTime(scheduleTimeStr, nowMs) {
  const target = new Date(scheduleTimeStr).getTime();
  const diff = target - nowMs;

  if (diff <= 0) {
    return 'MATCH TIME / LIVE';
  }

  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  const mStr = String(mins).padStart(2, '0');
  const sStr = String(secs).padStart(2, '0');

  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const remHours = String(totalHours % 24).padStart(2, '0');
    return `${days}d ${remHours}h ${mStr}m ${sStr}s`;
  } else {
    const hStr = String(totalHours).padStart(2, '0');
    return `${hStr}h ${mStr}m ${sStr}s`;
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('⏰ TESTING TOURNAMENT REMAINING TIME (HOURS/MIN/SEC) & ROOM PUSH');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // PART 1: TEST TOURNAMENT REMAINING TIME (HOURS/MIN/SEC)
    // -------------------------------------------------------------
    console.log('1. Testing Tournament Starting Remaining Time (Hours/Min/Sec Format)...');
    const now = Date.now();

    // Case A: Starts in 2 hours, 15 minutes, 30 seconds
    const targetA = new Date(now + (2 * 3600 + 15 * 60 + 30) * 1000).toISOString();
    const formattedA = formatRemainingTime(targetA, now);
    assert(formattedA === '02h 15m 30s', `Expected '02h 15m 30s', got '${formattedA}'`);
    console.log(`   ✅ 2-Hour Remaining Countdown: ${formattedA}`);

    // Case B: Starts in 45 minutes, 10 seconds
    const targetB = new Date(now + (45 * 60 + 10) * 1000).toISOString();
    const formattedB = formatRemainingTime(targetB, now);
    assert(formattedB === '00h 45m 10s', `Expected '00h 45m 10s', got '${formattedB}'`);
    console.log(`   ✅ Under-1-Hour Remaining Countdown: ${formattedB}`);

    // Case C: Multi-day tournament (2 days, 4 hours, 30 mins, 5 secs)
    const targetC = new Date(now + (52 * 3600 + 30 * 60 + 5) * 1000).toISOString();
    const formattedC = formatRemainingTime(targetC, now);
    assert(formattedC === '2d 04h 30m 05s', `Expected '2d 04h 30m 05s', got '${formattedC}'`);
    console.log(`   ✅ Multi-Day Remaining Countdown with Hours/Min/Sec: ${formattedC}`);

    // Case D: Match time elapsed
    const targetD = new Date(now - 10000).toISOString();
    const formattedD = formatRemainingTime(targetD, now);
    assert(formattedD.includes('MATCH TIME'), `Expected MATCH TIME, got '${formattedD}'`);
    console.log(`   ✅ Match Started / Live Status: ${formattedD}`);

    // -------------------------------------------------------------
    // PART 2: ADMIN PUBLISHED ROOM ID & PASS PUSH TO JOINED USERS ONLY
    // -------------------------------------------------------------
    console.log('\n2. Setting up Admin, Joined Player, and Non-Joined Spectator...');
    // Admin Login
    const adminRes = await apiCall('/api/auth/login', 'POST', {
      identifier: 'shas86728@gmail.com',
      password: 'Admin@SC123'
    });
    const adminToken = adminRes.token;

    // Player 1 (Joined)
    const randSuffix = Date.now().toString().slice(-6);
    const joinedEmail = `joined_player_${randSuffix}@test.com`;
    const p1Res = await apiCall('/api/auth/register', 'POST', {
      name: 'Registered Contender',
      email: joinedEmail,
      mobile: `97${randSuffix}11`,
      password: 'Pass@123Joined',
      ff_ign: 'KillerSquad_01',
      ff_uid: 'UID99001'
    });
    const p1Token = p1Res.token;
    const p1Id = p1Res.user.id;

    // Player 2 (Not Joined)
    const nonJoinedEmail = `non_joined_user_${randSuffix}@test.com`;
    const p2Res = await apiCall('/api/auth/register', 'POST', {
      name: 'Spectator User',
      email: nonJoinedEmail,
      mobile: `96${randSuffix}22`,
      password: 'Pass@123Spectator',
      ff_ign: 'Spectator_02',
      ff_uid: 'UID99002'
    });
    const p2Token = p2Res.token;
    const p2Id = p2Res.user.id;

    console.log('   ✅ Accounts Initialized');

    // Admin creates an upcoming tournament
    console.log('\n3. Creating New Tournament with Scheduled Remaining Time...');
    const schedTime = new Date(Date.now() + 3600 * 1000).toISOString(); // Starts in 1 hour
    const tournRes = await apiCall('/api/admin/tournaments', 'POST', {
      title: `Bermuda Pro Cup #${randSuffix}`,
      game_mode: 'BATTLE_ROYALE',
      match_type: 'SOLO',
      map: 'Bermuda',
      entry_fee: 10,
      total_prize_pool: 400,
      prize_1st: 250,
      prize_2nd: 100,
      prize_3rd: 50,
      per_kill_prize: 10,
      max_slots: 48,
      schedule_time: schedTime,
      rules: 'Mobile only fair play'
    }, adminToken);
    const tournId = tournRes.tournamentId;
    console.log(`   ✅ Tournament #${tournId} Created`);

    // Player 1 joins the tournament
    console.log('\n4. Player 1 joins Tournament (Player 2 does NOT join)...');
    const joinRes = await apiCall(`/api/tournaments/${tournId}/join`, 'POST', {
      ff_ign: 'KillerSquad_01',
      ff_uid: 'UID99001'
    }, p1Token);
    assert(joinRes.success === true, 'Player 1 joining failed');
    console.log('   ✅ Player 1 Successfully Joined Match');

    // Before room release: verify neither has notifications
    const p1PreNotifs = await apiCall('/api/notifications', 'GET', null, p1Token);
    const p2PreNotifs = await apiCall('/api/notifications', 'GET', null, p2Token);
    assert(p1PreNotifs.notifications.length === 0, 'Player 1 should not have notifications yet');
    assert(p2PreNotifs.notifications.length === 0, 'Player 2 should not have notifications yet');

    // Admin Publishes Room ID and Room Password
    console.log('\n5. Admin Publishes Room ID and Room Password...');
    const publishedRoomId = '87654321';
    const publishedPassword = 'BOOYAH@SECRET';
    const publishRes = await apiCall(`/api/admin/tournaments/${tournId}/room`, 'POST', {
      room_id: publishedRoomId,
      room_password: publishedPassword,
      status: 'room_ready'
    }, adminToken);
    assert(publishRes.success === true, 'Admin publish room failed');
    assert(publishRes.notifiedUsersCount === 1, `Expected 1 notified user, got ${publishRes.notifiedUsersCount}`);
    console.log(`   ✅ Admin Published Credentials: Room ID: ${publishedRoomId} | Pass: ${publishedPassword}`);

    // Verify Player 1 (Joined) RECEIVED the room push notification
    console.log('\n6. Verifying Push Notification Delivered Exclusively to Joined Player 1...');
    const p1PostNotifs = await apiCall('/api/notifications', 'GET', null, p1Token);
    assert(p1PostNotifs.notifications.length === 1, 'Player 1 should have received 1 room push notification');
    const notif = p1PostNotifs.notifications[0];
    assert(notif.type === 'ROOM_RELEASED', `Expected type ROOM_RELEASED, got ${notif.type}`);
    assert(notif.message.includes(publishedRoomId), 'Notification message missing Room ID');
    assert(notif.message.includes(publishedPassword), 'Notification message missing Room Password');
    const parsedData = JSON.parse(notif.data_json);
    assert(parsedData.room_id === publishedRoomId, 'Parsed Room ID mismatch');
    assert(parsedData.room_password === publishedPassword, 'Parsed Room Password mismatch');
    console.log(`   ✅ Player 1 Push Notification Verified: "${notif.title}" (Unread: ${p1PostNotifs.unreadCount})`);

    // Verify Player 2 (NOT Joined) did NOT receive the room push notification!
    console.log('\n7. Verifying Non-Joined Player 2 Did NOT Receive Any Room Notification...');
    const p2PostNotifs = await apiCall('/api/notifications', 'GET', null, p2Token);
    assert(p2PostNotifs.notifications.length === 0, 'Player 2 (unregistered) should NOT have received room credentials!');
    assert(p2PostNotifs.unreadCount === 0, 'Player 2 unread count must be 0');

    // Verify Player 2 accessing tournament details has Room ID PROTECTED
    const p2TournView = await apiCall(`/api/tournaments/${tournId}`, 'GET', null, p2Token);
    assert(p2TournView.tournament.room_id === 'PROTECTED_ROOM_ID', 'Unregistered user was able to read room ID!');
    console.log('   ✅ Security Verified: Non-joined player received ZERO room notifications and room credentials remain strictly masked.');

    // Player 1 marks notification as read
    console.log('\n8. Testing Player 1 Marking Notification As Read...');
    await apiCall('/api/notifications/mark-read', 'POST', { notification_id: notif.id }, p1Token);
    const p1FinalNotifs = await apiCall('/api/notifications', 'GET', null, p1Token);
    assert(p1FinalNotifs.unreadCount === 0, 'Player 1 unread count should be 0 after marking read');
    assert(p1FinalNotifs.notifications[0].is_read === 1, 'Notification is_read flag should be 1');
    console.log('   ✅ Notification Marked As Read Successfully');

    console.log('\n================================================================');
    console.log('🎉 ALL COUNTDOWN & ROOM PUSH NOTIFICATION TESTS PASSED (100%)!');
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    if (err.response) console.error(err.response);
    process.exit(1);
  }
}

// Start test
const checkReq = http.get('http://127.0.0.1:5000/api/health', (res) => {
  setTimeout(runTests, 200);
});
checkReq.on('error', () => {
  server.listen(5000, () => {
    setTimeout(runTests, 500);
  });
});
