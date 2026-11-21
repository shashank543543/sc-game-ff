/**
 * SC GAMEING - Customer Service Live Chat Verification Tests
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

async function runSupportTests() {
  console.log('\n================================================================');
  console.log('🎧 TESTING CUSTOMER SERVICE LIVE CHAT & SUPPORT DESK');
  console.log('================================================================\n');

  try {
    // 1. Admin login to get adminToken
    console.log('1. Authenticating Admin for Support Console...');
    const adminRes = await apiCall('/api/auth/login', 'POST', {
      identifier: 'shas86728@gmail.com',
      password: 'Admin@SC123'
    });
    const adminToken = adminRes.token;
    assert(adminToken, 'Admin token not received');
    console.log('   ✅ Admin Authenticated');

    // 2. Register a test player
    console.log('2. Registering Test Player...');
    const randomSuffix = Date.now().toString().slice(-6);
    const testEmail = `player_chat_${randomSuffix}@test.com`;
    const testMobile = `98${randomSuffix}12`;
    const userRes = await apiCall('/api/auth/register', 'POST', {
      name: 'Pro FF Gamer',
      email: testEmail,
      mobile: testMobile,
      password: 'Pass@123Chat',
      ff_ign: '⚡BooyahKing⚡',
      ff_uid: 'FF998877'
    });
    const userToken = userRes.token;
    assert(userToken, 'User token not received');
    console.log('   ✅ Player Registered & Authenticated');

    // 3. User initializes support conversation
    console.log('3. Testing User Support Conversation Initialization...');
    const convRes = await apiCall('/api/support/conversation', 'GET', null, userToken);
    assert(convRes.success === true, 'Failed to get conversation');
    assert(convRes.conversation && convRes.conversation.id, 'Conversation ID missing');
    assert(convRes.messages && convRes.messages.length > 0, 'Welcome message missing');
    const userConvId = convRes.conversation.id;
    console.log(`   ✅ User Conversation Created: ${userConvId} with Welcome Bot Message`);

    // 4. Guest user initializes support conversation
    console.log('4. Testing Guest User Support Conversation Initialization...');
    const guestRes = await apiCall('/api/support/conversation?guest_name=GuestSniper', 'GET', null, null);
    assert(guestRes.success === true, 'Guest conversation failed');
    assert(guestRes.conversation && guestRes.conversation.id.startsWith('conv-guest-'), 'Guest conversation ID format invalid');
    const guestConvId = guestRes.conversation.id;
    console.log(`   ✅ Guest Conversation Created: ${guestConvId}`);

    // 5. User sends message matching deposit intent (triggers auto-bot response)
    console.log('5. Testing User Message Dispatch & Automated Bot Guidance...');
    const msgRes = await apiCall('/api/support/message', 'POST', {
      conversation_id: userConvId,
      message: 'I made a UPI deposit. Where do I submit my 12 digit UTR?'
    }, userToken);
    assert(msgRes.success === true, 'Failed to post message');
    assert(msgRes.message && msgRes.message.sender_type === 'USER', 'User message not returned');
    assert(msgRes.botMessage && msgRes.botMessage.sender_type === 'BOT', 'Bot automated response missing');
    assert(msgRes.botMessage.message.includes('UTR'), 'Bot response did not contain expected guidance');
    console.log('   ✅ User Message & 24/7 Automated Bot Resolution Received');

    // 6. Security: Verify non-admin is blocked from admin support endpoints
    console.log('6. Testing Role Separation on Admin Support Endpoints...');
    let blocked = false;
    try {
      await apiCall('/api/support/admin/conversations', 'GET', null, userToken);
    } catch (err) {
      if (err.status === 403) blocked = true;
    }
    assert(blocked, 'Normal user was not blocked from admin support endpoints!');
    console.log('   ✅ Access Control: Player access to admin support strictly rejected with HTTP 403');

    // 7. Admin lists all conversations
    console.log('7. Testing Admin Support Workstation Listing & Unread Tracking...');
    const adminListRes = await apiCall('/api/support/admin/conversations?status=OPEN', 'GET', null, adminToken);
    assert(adminListRes.success === true, 'Admin list failed');
    assert(Array.isArray(adminListRes.conversations), 'Conversations array missing');
    const foundConv = adminListRes.conversations.find(c => c.id === userConvId);
    assert(foundConv, 'User conversation not found in admin list');
    assert(foundConv.ff_ign === '⚡BooyahKing⚡', 'Player FF IGN not populated in join');
    console.log(`   ✅ Admin Support Desk: Found ${adminListRes.conversations.length} conversation(s), unread count tracked`);

    // 8. Admin fetches single conversation details & auto mark-read
    console.log('8. Testing Admin Fetching Conversation Transcript...');
    const adminConvRes = await apiCall(`/api/support/admin/conversations/${userConvId}`, 'GET', null, adminToken);
    assert(adminConvRes.success === true, 'Admin fetch single conversation failed');
    assert(adminConvRes.messages && adminConvRes.messages.length >= 3, 'Transcript messages missing');
    assert(adminConvRes.conversation.unread_admin_count === 0, 'Unread count not reset to 0');
    console.log(`   ✅ Admin Retrieved ${adminConvRes.messages.length} Transcript Messages`);

    // 9. Admin sends live support reply
    console.log('9. Testing Admin Live Support Reply...');
    const replyRes = await apiCall(`/api/support/admin/conversations/${userConvId}/reply`, 'POST', {
      message: 'Hello! I checked our gateway logs and verified your UTR. Your ₹100 deposit is approved!'
    }, adminToken);
    assert(replyRes.success === true, 'Admin reply failed');
    assert(replyRes.message && replyRes.message.sender_type === 'ADMIN', 'Sender type was not ADMIN');
    console.log('   ✅ Admin Reply Dispatched');

    // 10. User reads conversation and sees admin reply
    console.log('10. Testing User Receiving Admin Reply & Marking Read...');
    const updatedUserConv = await apiCall('/api/support/conversation', 'GET', null, userToken);
    const adminMsg = updatedUserConv.messages.find(m => m.sender_type === 'ADMIN');
    assert(adminMsg, 'Admin message not found in user conversation');
    assert(adminMsg.message.includes('verified your UTR'), 'Admin message content mismatch');

    // Mark read
    await apiCall('/api/support/mark-read', 'POST', { conversation_id: userConvId }, userToken);
    console.log('   ✅ User Received Admin Reply in Real Time & Marked Read');

    // 11. Admin marks ticket as RESOLVED
    console.log('11. Testing Admin Ticket Status Resolution...');
    const statusRes = await apiCall(`/api/support/admin/conversations/${userConvId}/status`, 'PATCH', {
      status: 'RESOLVED'
    }, adminToken);
    assert(statusRes.success === true, 'Status update failed');
    assert(statusRes.status === 'RESOLVED', 'Status was not RESOLVED');
    console.log('   ✅ Ticket Status Successfully Marked as RESOLVED');

    console.log('\n================================================================');
    console.log('🎉 ALL CUSTOMER SERVICE LIVE CHAT TESTS PASSED (100%)!');
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ LIVE CHAT TEST FAILED:', err.message);
    if (err.response) console.error(err.response);
    process.exit(1);
  }
}

// Start test
const checkReq = http.get('http://127.0.0.1:5000/api/health', (res) => {
  setTimeout(runSupportTests, 200);
});
checkReq.on('error', () => {
  server.listen(5000, () => {
    setTimeout(runSupportTests, 500);
  });
});
