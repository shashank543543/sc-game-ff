/**
 * SC GAMEING - Comprehensive Feature & Security Verification Suite
 * Tests:
 * 1. Zero Admin Information Leak Principle
 * 2. Tournament / Custom Match Schedule Time Edit & Reschedule Notification
 * 3. Customer Support Screenshot Uploading & Message Attachment
 * 4. Razorpay Automated Payment Order Creation & Verification
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '5120';
process.env.ADMIN_EMAIL = 'shas86728@gmail.com';
process.env.ADMIN_PASSWORD = 'Admin@SC123';

const app = require('../server');
const db = require('../server/db');

const TEST_PORT = 5120;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;

let testServer = null;

function apiCall(endpoint, method = 'GET', body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    const headers = { ...extraHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let reqBody = null;
    if (body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
    } else if (body) {
      reqBody = body;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    });

    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

function uploadMultipart(endpoint, fieldName, filename, fileBuffer, mimeType, token = null) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const url = new URL(BASE_URL + endpoint);

    const postData = [];
    postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
    postData.push(fileBuffer);
    postData.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const fullBody = Buffer.concat(postData);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

async function runFeatureAndSecurityTests() {
  console.log('================================================================');
  console.log('🛡️ RUNNING SC GAMEING FEATURE & SECURITY SUITE');
  console.log('================================================================');

  await new Promise((res) => {
    testServer = app.server.listen(TEST_PORT, () => {
      console.log(`✅ Test server running on port ${TEST_PORT}`);
      res();
    });
  });

  try {
    // -------------------------------------------------------------
    // PART 1: ZERO ADMIN INFORMATION LEAK SECURITY VERIFICATION
    // -------------------------------------------------------------
    console.log('\n[1/4] Testing Security: Zero Admin Information Leak...');

    // 1a: Admin registration probing
    const regProbe = await apiCall('/auth/register', 'POST', {
      name: 'Attacker Probe',
      email: 'shas86728@gmail.com',
      mobile: '9888877777',
      password: 'AttackerPassword123'
    });
    assert.strictEqual(regProbe.status, 403, 'Admin registration probe must be blocked with 403');
    assert.strictEqual(regProbe.raw.includes('shas86728'), false, 'Registration response MUST NOT leak admin email');
    assert.strictEqual(regProbe.raw.includes('administrative'), false, 'Registration response MUST NOT reveal administrative status');
    console.log('   ✅ Public registration probe blocked with zero admin email leak');

    // 1b: Admin unauthorized login probe
    const adminLoginProbe = await apiCall('/auth/admin/login', 'POST', {
      identifier: 'unauthorized_hacker@darkweb.org',
      password: 'HackerPassword123'
    });
    assert.strictEqual(adminLoginProbe.status, 403, 'Unauthorized admin login must be 403');
    assert.strictEqual(adminLoginProbe.raw.includes('shas86728'), false, 'Admin login rejection MUST NOT leak authorized admin email');
    console.log('   ✅ Unauthorized admin login blocked with zero email disclosure');

    // 1c: Admin forgot password probe
    const forgotProbe = await apiCall('/auth/admin/forgot-password', 'POST', {
      email: 'intruder@yahoo.com'
    });
    assert.strictEqual(forgotProbe.status, 403, 'Admin forgot password must reject non-authorized email with 403');
    assert.strictEqual(forgotProbe.raw.includes('shas86728'), false, 'Forgot password response MUST NOT leak authorized admin email');
    console.log('   ✅ Admin forgot password endpoint blocked with zero email disclosure');

    // 1d: Normal player login & token creation
    const userEmail = `player_sec_${Date.now()}@test.com`;
    const userMobile = `98${Math.floor(10000000 + Math.random() * 90000000)}`.substring(0, 10);
    const userReg = await apiCall('/auth/register', 'POST', {
      name: 'Security Test Player',
      email: userEmail,
      mobile: userMobile,
      password: 'PlayerPassword@123'
    });
    assert.strictEqual(userReg.status, 201, 'User registration must succeed');
    const userToken = userReg.data.token;
    const userId = userReg.data.user.id;

    // 1e: Normal user attempting to access admin route
    const adminAccessProbe = await apiCall('/admin/stats', 'GET', null, userToken);
    assert.strictEqual(adminAccessProbe.status, 403, 'User access to admin endpoints must be rejected with 403');
    assert.strictEqual(adminAccessProbe.raw.includes('shas86728'), false, 'Admin middleware rejection MUST NOT leak admin email');
    console.log('   ✅ Admin middleware authorization enforcement passed with zero email leak');

    // 1f: Public health and UPI config leak checks
    const healthRes = await apiCall('/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.raw.includes('shas86728'), false, 'Health check MUST NOT contain admin email');

    const configRes = await apiCall('/wallet/config');
    assert.strictEqual(configRes.status, 200);
    assert.strictEqual(configRes.raw.includes('shas86728'), false, 'Wallet config MUST NOT contain admin email');
    console.log('   ✅ Public APIs verified clean of admin credentials');

    // -------------------------------------------------------------
    // PART 2: TOURNAMENT SCHEDULE TIME EDIT & RESCHEDULE NOTIFICATION
    // -------------------------------------------------------------
    console.log('\n[2/4] Testing Tournament Schedule Time Edit & Notifications...');

    // Login as Admin
    const adminLogin = await apiCall('/auth/admin/login', 'POST', {
      identifier: 'shas86728@gmail.com',
      password: 'Admin@SC123'
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login should succeed');
    const adminToken = adminLogin.data.token;

    // Create Tournament
    const initialSchedule = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const newTournRes = await apiCall('/admin/tournaments', 'POST', {
      title: 'Kalahari Reschedule Championship',
      game_mode: 'BATTLE_ROYALE',
      match_type: 'SOLO',
      map: 'KALAHARI',
      version: 'MOBILE_ONLY',
      entry_fee: 10,
      total_prize_pool: 400,
      prize_1st: 250,
      prize_2nd: 100,
      prize_3rd: 50,
      per_kill_prize: 10,
      max_slots: 48,
      schedule_time: initialSchedule,
      rules: 'Standard Rules'
    }, adminToken);
    assert.strictEqual(newTournRes.status, 201, 'Tournament creation should succeed');
    const tournamentId = newTournRes.data.tournamentId;

    // User joins tournament
    const joinRes = await apiCall(`/tournaments/${tournamentId}/join`, 'POST', {
      ff_ign: 'SecBooyahMaster',
      ff_uid: '8877665544'
    }, userToken);
    assert.strictEqual(joinRes.status, 200, 'User should join tournament');

    // Admin edits schedule time
    const newScheduleTime = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    const editTimeRes = await apiCall(`/admin/tournaments/${tournamentId}/schedule`, 'PATCH', {
      schedule_time: newScheduleTime,
      notify_players: true
    }, adminToken);
    assert.strictEqual(editTimeRes.status, 200, 'Editing schedule time should succeed');
    assert.strictEqual(editTimeRes.data.success, true);
    assert.strictEqual(editTimeRes.data.notifiedCount >= 1, true, 'Joined player should be counted in notifications');

    // Check database updated
    const updatedTourn = await db.get('SELECT schedule_time FROM tournaments WHERE id = ?', [tournamentId]);
    assert.strictEqual(updatedTourn.schedule_time, newScheduleTime, 'Database schedule_time must match updated value');

    // Check user received in-app reschedule push notification
    const userNotifs = await apiCall('/notifications', 'GET', null, userToken);
    assert.strictEqual(userNotifs.status, 200);
    const rescheduleNotif = userNotifs.data.notifications.find(n => n.type === 'TOURNAMENT_SCHEDULE_CHANGED');
    assert.ok(rescheduleNotif, 'User should receive a TOURNAMENT_SCHEDULE_CHANGED notification');
    assert.strictEqual(rescheduleNotif.title, '⏰ Match Rescheduled');
    console.log('   ✅ Match reschedule time saved & push notification delivered to participant');

    // -------------------------------------------------------------
    // PART 2b: REAL-TIME USER SLOT SELECTION & FREE FIRE ID EDIT
    // -------------------------------------------------------------
    console.log('\n[2b/4] Testing User Slot Selection & Free Fire ID Editing...');

    // 1. Fetch slots map
    const slotsRes = await apiCall(`/tournaments/${tournamentId}/slots`, 'GET', null, userToken);
    assert.strictEqual(slotsRes.status, 200, 'Slots fetch should return 200');
    assert.strictEqual(slotsRes.data.success, true);
    assert.strictEqual(slotsRes.data.maxSlots, 48);
    const myCurrentSlotObj = slotsRes.data.slots.find(s => s.isMySlot);
    assert.ok(myCurrentSlotObj, 'User current slot should be identified in slots map');

    // 2. Select a new available slot (e.g. Slot #15)
    const selectSlotRes = await apiCall(`/tournaments/${tournamentId}/select-slot`, 'POST', {
      slot_number: 15
    }, userToken);
    assert.strictEqual(selectSlotRes.status, 200, 'Slot selection should succeed');
    assert.strictEqual(selectSlotRes.data.slotNumber, 15);

    // Verify slot is now SOLD OUT in slots map
    const afterSelectSlots = await apiCall(`/tournaments/${tournamentId}/slots`, 'GET');
    const slot15 = afterSelectSlots.data.slots.find(s => s.slotNumber === 15);
    assert.strictEqual(slot15.status, 'SOLD_OUT', 'Slot #15 must now be SOLD_OUT');

    // 3. User edits Free Fire In-Game Name & Character UID
    const editPlayerRes = await apiCall(`/tournaments/${tournamentId}/player-info`, 'PATCH', {
      ff_ign: 'SC_GOD_SNIPER',
      ff_uid: '9988776655'
    }, userToken);
    assert.strictEqual(editPlayerRes.status, 200, 'Player info edit should return 200');
    assert.strictEqual(editPlayerRes.data.ff_ign, 'SC_GOD_SNIPER');
    assert.strictEqual(editPlayerRes.data.ff_uid, '9988776655');

    // Verify in database
    const updatedParticipant = await db.get(
      'SELECT slot_number, ff_ign, ff_uid FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
      [tournamentId, userId]
    );
    assert.strictEqual(updatedParticipant.slot_number, 15, 'Participant slot must be updated to 15');
    assert.strictEqual(updatedParticipant.ff_ign, 'SC_GOD_SNIPER', 'Participant IGN must match new name');
    assert.strictEqual(updatedParticipant.ff_uid, '9988776655', 'Participant UID must match new UID');
    console.log('   ✅ User slot selection, real-time sold-out state & Free Fire IGN/UID updates verified');

    // -------------------------------------------------------------
    // PART 3: CUSTOMER SUPPORT SCREENSHOT UPLOAD & ATTACHMENT
    // -------------------------------------------------------------
    console.log('\n[3/4] Testing Customer Support Screenshot Uploading...');

    // 1x1 transparent PNG buffer
    const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d400000000049454e44ae426082', 'hex');

    // Upload screenshot
    const uploadRes = await uploadMultipart('/support/upload', 'screenshot', 'payment_proof.png', pngBuffer, 'image/png', userToken);
    assert.strictEqual(uploadRes.status, 200, 'Screenshot upload must return 200');
    assert.strictEqual(uploadRes.data.success, true);
    assert.ok(uploadRes.data.url.startsWith('/uploads/support/'), 'Returned URL must be in /uploads/support/');
    const screenshotUrl = uploadRes.data.url;
    console.log(`   ✅ Screenshot uploaded successfully to: ${screenshotUrl}`);

    // Send customer message with screenshot
    const userMsgRes = await apiCall('/support/message', 'POST', {
      message: 'Here is my payment UTR confirmation screenshot.',
      screenshot_url: screenshotUrl
    }, userToken);
    assert.strictEqual(userMsgRes.status, 201, 'Sending support message with screenshot must succeed');
    assert.strictEqual(userMsgRes.data.success, true);
    assert.strictEqual(userMsgRes.data.message.screenshot_url, screenshotUrl, 'Message object must include screenshot_url');

    const convId = userMsgRes.data.message.conversation_id;

    // Verify stored in DB
    const dbMsg = await db.get('SELECT * FROM support_messages WHERE id = ?', [userMsgRes.data.message.id]);
    assert.strictEqual(dbMsg.screenshot_url, screenshotUrl, 'DB record must store screenshot_url');

    // Admin replies with screenshot
    const adminUpload = await uploadMultipart('/support/upload', 'screenshot', 'receipt.png', pngBuffer, 'image/png', adminToken);
    assert.strictEqual(adminUpload.status, 200);
    const adminScreenshotUrl = adminUpload.data.url;

    const adminReplyRes = await apiCall(`/support/admin/conversations/${convId}/reply`, 'POST', {
      message: 'We have verified your screenshot and credited your balance.',
      screenshot_url: adminScreenshotUrl
    }, adminToken);
    assert.ok([200, 201].includes(adminReplyRes.status), 'Admin reply with screenshot must succeed');
    assert.strictEqual(adminReplyRes.data.message.screenshot_url, adminScreenshotUrl);
    console.log('   ✅ 2-way screenshot support validated (user upload + admin reply)');

    // -------------------------------------------------------------
    // PART 4: RAZORPAY AUTOMATED PAYMENT FLOW & ADMIN CONTROLS
    // -------------------------------------------------------------
    console.log('\n[4/4] Testing Razorpay Automated Payment Flow & Admin Key Control...');

    // 4a. Admin updates Razorpay keys and settings in database
    const updateGwRes = await apiCall('/admin/payment-settings', 'PUT', {
      gateway_status: 'ACTIVE',
      gateway_mode: 'LIVE',
      razorpay_key_id: 'rzp_live_TEST_CONTROL_KEY',
      razorpay_key_secret: 'rzp_secret_control_key_9988',
      min_deposit: 10,
      max_deposit: 50000,
      min_withdrawal: 50,
      max_withdrawal: 10000
    }, adminToken);
    assert.strictEqual(updateGwRes.status, 200, 'Admin payment settings update should return 200');

    // Verify database stored the updated keys
    const savedGw = await db.get('SELECT * FROM payment_settings WHERE id = ?', ['default_settings']);
    assert.strictEqual(savedGw.razorpay_key_id, 'rzp_live_TEST_CONTROL_KEY');
    assert.strictEqual(savedGw.razorpay_key_secret, 'rzp_secret_control_key_9988');
    assert.strictEqual(savedGw.gateway_status, 'ACTIVE');

    // 4b. Create Razorpay order - verify it dynamically uses admin configured key
    const rzpOrderRes = await apiCall('/wallet/razorpay/create-order', 'POST', {
      amount: 150
    }, userToken);
    assert.strictEqual(rzpOrderRes.status, 200, 'Razorpay order creation should succeed');
    assert.strictEqual(rzpOrderRes.data.success, true);
    assert.strictEqual(rzpOrderRes.data.amount, 150);
    assert.strictEqual(rzpOrderRes.data.keyId, 'rzp_live_TEST_CONTROL_KEY', 'Razorpay checkout must use admin configured Key ID');
    assert.ok(rzpOrderRes.data.orderId, 'Order must contain orderId');
    const rzpOrderId = rzpOrderRes.data.orderId;
    console.log(`   ✅ Razorpay payment order generated with dynamic admin Key ID: ${rzpOrderId}`);

    // Initial balance
    const initBalRes = await apiCall('/wallet/balance', 'GET', null, userToken);
    const initialBalance = Number(initBalRes.data.wallet_balance);

    // 4c. Verify tampered Razorpay HMAC signature is rejected
    const mockPaymentId = 'pay_' + Date.now();
    const badSigRes = await apiCall('/wallet/razorpay/verify', 'POST', {
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: mockPaymentId,
      razorpay_signature: 'invalid_tampered_signature_hex',
      depositId: rzpOrderId
    }, userToken);
    assert.strictEqual(badSigRes.status, 400, 'Tampered Razorpay signature must be strictly rejected with HTTP 400');
    console.log('   ✅ Tampered Razorpay payment signature rejected (Anti-Tamper & Security enforced)');

    // 4d. Verify valid HMAC-SHA256 signature passes verification
    const crypto = require('crypto');
    const validSignature = crypto
      .createHmac('sha256', 'rzp_secret_control_key_9988')
      .update(rzpOrderId + '|' + mockPaymentId)
      .digest('hex');

    const verifyRes = await apiCall('/wallet/razorpay/verify', 'POST', {
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: mockPaymentId,
      razorpay_signature: validSignature,
      depositId: rzpOrderId
    }, userToken);

    assert.strictEqual(verifyRes.status, 200, 'Razorpay verify should return 200 with valid signature');
    assert.strictEqual(verifyRes.data.success, true);
    assert.strictEqual(Number(verifyRes.data.newBalance), initialBalance + 150, 'Balance must be credited with exact ₹150');

    // 4e. Verify transaction recorded in database
    const txn = await db.get("SELECT * FROM transactions WHERE user_id = ? AND type = 'DEPOSIT' ORDER BY id DESC LIMIT 1", [userId]);
    assert.ok(txn, 'Deposit transaction must exist');
    assert.strictEqual(Number(txn.amount), 150, 'Transaction amount must match ₹150');

    // 4f. Verify order cannot be credited twice (idempotency protection)
    const duplicateRes = await apiCall('/wallet/razorpay/verify', 'POST', {
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: mockPaymentId,
      razorpay_signature: validSignature,
      depositId: rzpOrderId
    }, userToken);
    assert.strictEqual(duplicateRes.status, 200);

    const afterDupBal = await apiCall('/wallet/balance', 'GET', null, userToken);
    assert.strictEqual(Number(afterDupBal.data.wallet_balance), initialBalance + 150, 'Balance must remain identical without double crediting');
    console.log('   ✅ Razorpay instant credit & idempotency protection verified');

    // -------------------------------------------------------------
    // PART 5: FRONTEND PAYMENT ZERO ADMIN DETAILS LEAK & UPI ENHANCEMENTS
    // -------------------------------------------------------------
    console.log('\n[5/5] Testing Frontend Payment: Zero Admin Details Leak & Direct UPI Flow...');
    const indexHtmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const walletJsContent = fs.readFileSync(path.join(__dirname, '../public/js/wallet.js'), 'utf8');

    // 1. Zero admin leak assertions
    assert.ok(!indexHtmlContent.includes('6363440966@apl'), 'Frontend index.html must not contain admin UPI ID (6363440966@apl)');
    assert.ok(!indexHtmlContent.includes('VPA: 6363440966'), 'Frontend index.html must not contain admin VPA text');
    assert.ok(!walletJsContent.includes('6363440966@apl'), 'Frontend wallet.js must not contain admin UPI ID');

    // 2. Razorpay removed from player UI assertions
    assert.ok(!indexHtmlContent.includes('btn-razorpay-checkout'), 'Frontend index.html must not show Razorpay checkout button');
    assert.ok(!indexHtmlContent.includes('Instant Razorpay Automated Checkout'), 'Frontend index.html must not show Razorpay option text');

    // 3. Direct UPI app redirect buttons present
    assert.ok(indexHtmlContent.includes('btn-open-phonepe'), 'PhonePe redirect button must exist');
    assert.ok(indexHtmlContent.includes('btn-open-paytm'), 'Paytm redirect button must exist');
    assert.ok(indexHtmlContent.includes('btn-open-gpay'), 'Google Pay redirect button must exist');

    // 4. UTR Help Guide and 30-Second Admin Verification Notice present
    assert.ok(indexHtmlContent.includes('utr-help-guide'), 'Interactive UTR help guide must exist');
    assert.ok(indexHtmlContent.includes('utr-verification-notice'), '30-second UTR verification notice modal must exist');
    assert.ok(indexHtmlContent.includes('Admin Verifying Payment'), 'Verification notice must state Admin Verifying Payment');
    assert.ok(indexHtmlContent.includes('Please allow up to 5 minutes'), 'Verification notice must mention 5 minutes');

    // 5. Test support bot response
    const botRes = require('../server/services/supportBotService').getBotResponse('how to deposit upi money', 'PlayerOne');
    assert.ok(!botRes.message.includes('6363440966@apl'), 'Support bot must not leak admin UPI ID');
    assert.ok(!botRes.message.includes('Automated Razorpay'), 'Support bot must not mention Razorpay');
    console.log('   ✅ Zero admin UPI / personal details on frontend & customer support verified');
    console.log('   ✅ Razorpay removed from player UI; PhonePe/Paytm/GPay redirects & 30s UTR notice verified');

    console.log('\n================================================================');
    console.log('🎉 ALL FEATURE & SECURITY VERIFICATION TESTS PASSED (100%)!');
    console.log('================================================================');

  } finally {
    if (testServer) {
      testServer.close();
    }
  }
}

runFeatureAndSecurityTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  if (testServer) testServer.close();
  process.exit(1);
});
