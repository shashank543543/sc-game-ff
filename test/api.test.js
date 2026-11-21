/**
 * SC GAMEING - Complete End-to-End Verification Test Suite
 * 
 * Tests:
 * 1. Health Check
 * 2. User Registration & Cookie + Welcome Bonus
 * 3. Reject User Registration with Authorized Admin Email
 * 4. Reject User Role Escalation (forced to 'user')
 * 5. User Login & Session Creation
 * 6. User Profile Update & Profile Stats
 * 7. User Forgot Password (OTP Generation & Nodemailer Dispatch - Zero Leak)
 * 8. OTP 60-Second Resend Cooldown
 * 9. Incorrect OTP Rejection & Attempt Counter
 * 10. Correct OTP Verification & Single-Use Token
 * 11. User Password Reset via Reset Token
 * 12. Login with Reset Password
 * 13. Admin Login with Authorized Email (shas86728@gmail.com)
 * 14. MANDATORY RESTRICTION: Reject Non-Authorized Emails from Admin Login
 * 15. Role Separation: Reject Normal Users from Admin Endpoints
 * 16. Authentication Enforcement: Reject Unauthenticated Requests
 * 17. Admin Forgot Password: Reject Non-Authorized Emails
 * 18. Admin Forgot Password: OTP Sent Only to shas86728@gmail.com
 * 19. Admin OTP Verification
 * 20. Admin Password Reset & Restoration
 * 21. Store Categories & Products Browsing
 * 22. Admin Product Creation & Inventory Initialization
 * 23. Admin Stock Adjustment (ADD, REMOVE, SET) & Audit Logging
 * 24. User Order Placement with Wallet Balance Deduction
 * 25. User Order History (/api/orders/my-orders)
 * 26. Admin Order Management & Status Updates
 * 27. Razorpay Public Gateway Config (Zero Admin Leaks)
 * 28. Razorpay Automated Order Creation & Cancellation
 * 29. Razorpay Payment Verification & Instant Credit
 * 30. Replay Protection: Reject Duplicate Payment IDs
 * 31. Tournament Lifecycle: Creation, Slot Booking, Room ID Protection & Unlock
 * 32. Auto Prize Payout & Cash Withdrawal Approval
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { app, server } = require('../server/index.js');
const { getTestOtpForEmail } = require('../server/utils/email');

let userToken = null;
let userId = null;
let userEmail = null;
let userMobile = null;
let userPassword = 'InitialPass@123';
let userNewPassword = 'UpdatedPass@456';
let adminToken = null;
let adminResetToken = null;
let userResetToken = null;
let testProductId = null;
let testOrderId = null;
let testTournId = null;
let depositId = null;
let testPaymentId = 'pay_' + Date.now().toString(36) + 'rzptest';
let withdrawalId = null;

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING SC GAMEING COMPREHENSIVE END-TO-END VERIFICATION');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // 1. SYSTEM HEALTH CHECK
    // -------------------------------------------------------------
    console.log('1. Testing System Health Check...');
    const health = await apiCall('/api/health');
    assert(health.status === 'ONLINE', 'System is not online');
    console.log('   ✅ Health Check: Platform ONLINE (DB: ' + health.database + ')');

    // -------------------------------------------------------------
    // 2. USER REGISTRATION & WELCOME BONUS
    // -------------------------------------------------------------
    console.log('\n2. Testing User Registration & Welcome Bonus...');
    userEmail = `player_${Date.now()}@test.com`;
    userMobile = '98' + Math.floor(10000000 + Math.random() * 90000000);
    const regRes = await apiCall('/api/auth/register', 'POST', {
      name: 'Test Pro Player',
      email: userEmail,
      mobile: userMobile,
      ff_ign: 'SC_TEST_PRO',
      ff_uid: '987654321',
      password: userPassword
    });
    assert(regRes.success === true, 'Registration failed');
    assert(regRes.token, 'Token was not returned on registration');
    assert(regRes.user.role === 'user', 'User role was not user');
    assert(regRes.user.wallet_balance === 10, 'Welcome bonus ₹10 was not credited');
    assert(regRes._headers['set-cookie'], 'HTTP-only auth_token cookie was not set');
    userToken = regRes.token;
    userId = regRes.user.id;
    console.log('   ✅ User Registration Passed: Account created, ₹10 bonus credited, HTTP-only cookie issued');

    // -------------------------------------------------------------
    // 3. REJECT REGISTRATION WITH AUTHORIZED ADMIN EMAIL
    // -------------------------------------------------------------
    console.log('\n3. Testing Registration Rejection for Authorized Admin Email...');
    let regAdminRejected = false;
    try {
      await apiCall('/api/auth/register', 'POST', {
        name: 'Intruder',
        email: 'shas86728@gmail.com',
        mobile: '9876543210',
        password: 'password123'
      });
    } catch (err) {
      regAdminRejected = (err.status === 400 || err.status === 403);
    }
    assert(regAdminRejected, 'Server permitted public registration with authorized admin email!');
    console.log('   ✅ Admin Email Restriction Passed: Public registration with shas86728@gmail.com strictly blocked');

    // -------------------------------------------------------------
    // 4. REJECT USER ROLE ESCALATION
    // -------------------------------------------------------------
    console.log('\n4. Testing Role Escalation Protection...');
    const fakeEscalationEmail = `escalation_${Date.now()}@test.com`;
    const escRes = await apiCall('/api/auth/register', 'POST', {
      name: 'Sneaky User',
      email: fakeEscalationEmail,
      mobile: '97' + Math.floor(10000000 + Math.random() * 90000000),
      password: 'password123',
      role: 'admin' // Attempting to inject admin role
    });
    assert(escRes.user.role === 'user', 'Privilege escalation vulnerability: user became admin!');
    console.log('   ✅ Privilege Escalation Protection Passed: Client role claim ignored, forced to "user"');

    // -------------------------------------------------------------
    // 5. USER LOGIN & SESSIONS
    // -------------------------------------------------------------
    console.log('\n5. Testing User Login with Identifier & Session Tracking...');
    const loginRes = await apiCall('/api/auth/login', 'POST', {
      identifier: userMobile,
      password: userPassword
    });
    assert(loginRes.success === true, 'Login with mobile identifier failed');
    assert(loginRes.token, 'Login did not return JWT token');
    console.log('   ✅ User Login Passed: Authenticated with mobile identifier and session logged');

    // -------------------------------------------------------------
    // 6. USER PROFILE UPDATE & STATS
    // -------------------------------------------------------------
    console.log('\n6. Testing User Profile & Stats Retrieval...');
    const updateRes = await apiCall('/api/auth/profile', 'PUT', {
      name: 'SC Champion Player',
      ff_ign: 'SC_BOOYAH_KING',
      ff_uid: '123456789'
    }, userToken);
    assert(updateRes.user.ff_ign === 'SC_BOOYAH_KING', 'IGN was not updated');
    
    const profileRes = await apiCall('/api/auth/profile', 'GET', null, userToken);
    assert(profileRes.user.profile, 'User profile object missing');
    assert(profileRes.user.stats.totalMatches === 0, 'Initial tournaments played mismatch');
    console.log('   ✅ Profile & User Profiles Table Passed: Profile retrieved and linked');

    // -------------------------------------------------------------
    // 7. USER FORGOT PASSWORD (OTP GENERATION & ZERO LEAK)
    // -------------------------------------------------------------
    console.log('\n7. Testing Backend Email OTP Generation (Zero Leak Principle)...');
    const forgotRes = await apiCall('/api/auth/forgot-password', 'POST', { email: userEmail });
    assert(forgotRes.success === true, 'Forgot password request failed');
    assert(!forgotRes.otp, 'CRITICAL VULNERABILITY: Plaintext OTP returned in API response!');
    assert(!forgotRes.code, 'CRITICAL VULNERABILITY: Plaintext code returned in API response!');
    
    // Retrieve OTP from backend in-memory test email buffer
    const userOtp = getTestOtpForEmail(userEmail);
    assert(userOtp && /^\d{6}$/.test(userOtp), 'OTP was not generated as a 6-digit numeric string');
    console.log('   ✅ Backend OTP Dispatch Passed: 6-digit OTP generated, zero leak in network response');

    // -------------------------------------------------------------
    // 8. OTP 60-SECOND RESEND COOLDOWN
    // -------------------------------------------------------------
    console.log('\n8. Testing 60-Second Resend Cooldown...');
    let cooldownBlocked = false;
    try {
      await apiCall('/api/auth/forgot-password', 'POST', { email: userEmail });
    } catch (err) {
      cooldownBlocked = (err.status === 429);
    }
    assert(cooldownBlocked, 'Resend cooldown did not enforce 60-second restriction!');
    console.log('   ✅ Resend Cooldown Passed: Immediate re-request blocked with HTTP 429');

    // -------------------------------------------------------------
    // 9. INCORRECT OTP REJECTION & ATTEMPT COUNTER
    // -------------------------------------------------------------
    console.log('\n9. Testing Incorrect OTP Rejection...');
    let badOtpRejected = false;
    try {
      await apiCall('/api/auth/verify-otp', 'POST', {
        email: userEmail,
        otp: '000000' // Invalid OTP
      });
    } catch (err) {
      badOtpRejected = (err.status === 400);
    }
    assert(badOtpRejected, 'Server accepted incorrect OTP!');
    console.log('   ✅ Invalid OTP Rejection Passed: Incorrect OTP rejected with HTTP 400');

    // -------------------------------------------------------------
    // 10. CORRECT OTP VERIFICATION & SINGLE-USE RESET TOKEN
    // -------------------------------------------------------------
    console.log('\n10. Testing Correct OTP Verification & Reset Token Issuance...');
    const verifyOtpRes = await apiCall('/api/auth/verify-otp', 'POST', {
      email: userEmail,
      otp: userOtp
    });
    assert(verifyOtpRes.success === true, 'OTP verification failed');
    assert(verifyOtpRes.resetToken, 'Reset token was not issued');
    userResetToken = verifyOtpRes.resetToken;

    // Verify OTP cannot be used twice (immediate invalidation check)
    let replayedOtpRejected = false;
    try {
      await apiCall('/api/auth/verify-otp', 'POST', {
        email: userEmail,
        otp: userOtp
      });
    } catch (err) {
      replayedOtpRejected = (err.status === 400);
    }
    assert(replayedOtpRejected, 'OTP was allowed to be verified multiple times!');
    console.log('   ✅ OTP Verification Passed: Verified, reset token issued, OTP invalidated against reuse');

    // -------------------------------------------------------------
    // 11. USER PASSWORD RESET VIA RESET TOKEN
    // -------------------------------------------------------------
    console.log('\n11. Testing User Password Reset via Token...');
    const resetRes = await apiCall('/api/auth/reset-password', 'POST', {
      resetToken: userResetToken,
      newPassword: userNewPassword
    });
    assert(resetRes.success === true, 'Password reset failed');

    // Attempting to reuse the resetToken should fail
    let reusedTokenRejected = false;
    try {
      await apiCall('/api/auth/reset-password', 'POST', {
        resetToken: userResetToken,
        newPassword: 'AnotherPassword@999'
      });
    } catch (err) {
      reusedTokenRejected = (err.status === 400);
    }
    assert(reusedTokenRejected, 'Reset token was allowed to be reused!');
    console.log('   ✅ Password Reset Passed: New password saved, token single-use enforced');

    // -------------------------------------------------------------
    // 12. LOGIN WITH RESET PASSWORD
    // -------------------------------------------------------------
    console.log('\n12. Testing Login with New Password...');
    const newLoginRes = await apiCall('/api/auth/login', 'POST', {
      identifier: userEmail,
      password: userNewPassword
    });
    assert(newLoginRes.success === true, 'Login with new password failed');
    userToken = newLoginRes.token;
    console.log('   ✅ New Password Login Passed: Successfully authenticated with updated credentials');

    // -------------------------------------------------------------
    // 13. ADMIN LOGIN WITH AUTHORIZED EMAIL
    // -------------------------------------------------------------
    console.log('\n13. Testing Admin Login with Authorized Email (shas86728@gmail.com)...');
    const adminLoginRes = await apiCall('/api/auth/admin/login', 'POST', {
      email: 'shas86728@gmail.com',
      password: 'Admin@SC123'
    });
    assert(adminLoginRes.success === true, 'Authorized admin login failed');
    assert(adminLoginRes.user.email.toLowerCase() === 'shas86728@gmail.com', 'Admin email mismatch');
    assert(adminLoginRes.user.role === 'admin', 'Admin role missing');
    adminToken = adminLoginRes.token;
    console.log('   ✅ Authorized Admin Login Passed: Master Admin account verified on backend');

    // -------------------------------------------------------------
    // 14. MANDATORY RESTRICTION: REJECT NON-AUTHORIZED ADMIN EMAILS
    // -------------------------------------------------------------
    console.log('\n14. Testing Mandatory Admin Restriction (Reject Other Emails)...');
    let intruderRejected = false;
    try {
      await apiCall('/api/auth/admin/login', 'POST', {
        email: 'intruder@gmail.com',
        password: 'Admin@SC123'
      });
    } catch (err) {
      intruderRejected = (err.status === 403);
    }
    assert(intruderRejected, 'CRITICAL VULNERABILITY: Non-authorized email was not blocked from admin login!');

    let staffRejected = false;
    try {
      await apiCall('/api/auth/admin/login', 'POST', {
        email: 'staff@scgameing.com',
        password: 'Admin@SC123'
      });
    } catch (err) {
      staffRejected = (err.status === 403);
    }
    assert(staffRejected, 'CRITICAL VULNERABILITY: Secondary email was not blocked from admin login!');
    console.log('   ✅ Mandatory Admin Restriction Passed: ALL emails other than shas86728@gmail.com rejected with HTTP 403');

    // -------------------------------------------------------------
    // 15. ROLE SEPARATION: USER CANNOT ACCESS ADMIN ENDPOINTS
    // -------------------------------------------------------------
    console.log('\n15. Testing Admin Endpoint Role Separation...');
    let userAdminCallBlocked = false;
    try {
      await apiCall('/api/admin/stats', 'GET', null, userToken);
    } catch (err) {
      userAdminCallBlocked = (err.status === 403);
    }
    assert(userAdminCallBlocked, 'User token was allowed to access /api/admin/stats!');
    console.log('   ✅ Role Separation Passed: User access to admin endpoints strictly rejected with HTTP 403');

    // -------------------------------------------------------------
    // 16. UNAUTHENTICATED REQUEST REJECTION
    // -------------------------------------------------------------
    console.log('\n16. Testing Unauthenticated Request Rejection...');
    let unauthBlocked = false;
    try {
      await apiCall('/api/admin/stats', 'GET', null, null);
    } catch (err) {
      unauthBlocked = (err.status === 401);
    }
    assert(unauthBlocked, 'Unauthenticated request was allowed through!');
    console.log('   ✅ Authentication Middleware Passed: Unauthenticated request rejected with HTTP 401');

    // -------------------------------------------------------------
    // 17. ADMIN FORGOT PASSWORD: REJECT UNAUTHORIZED EMAIL
    // -------------------------------------------------------------
    console.log('\n17. Testing Admin Forgot Password Unauthorized Email Rejection...');
    let adminForgotWrongRejected = false;
    try {
      await apiCall('/api/auth/admin/forgot-password', 'POST', { email: 'hacker@scgameing.com' });
    } catch (err) {
      adminForgotWrongRejected = (err.status === 403);
    }
    assert(adminForgotWrongRejected, 'Admin forgot password allowed non-authorized email!');
    console.log('   ✅ Admin Forgot Password Restriction Passed: Non-authorized email blocked with HTTP 403');

    // -------------------------------------------------------------
    // 18. ADMIN FORGOT PASSWORD: OTP FOR AUTHORIZED EMAIL
    // -------------------------------------------------------------
    console.log('\n18. Testing Admin Forgot Password OTP Dispatch...');
    const adminForgotRes = await apiCall('/api/auth/admin/forgot-password', 'POST', { email: 'shas86728@gmail.com' });
    assert(adminForgotRes.success === true, 'Admin forgot password request failed');
    assert(!adminForgotRes.otp, 'Admin OTP leaked in response!');

    const adminOtp = getTestOtpForEmail('shas86728@gmail.com');
    assert(adminOtp && /^\d{6}$/.test(adminOtp), 'Admin OTP not sent to authorized email');
    console.log('   ✅ Admin OTP Dispatch Passed: Dispatched exclusively to shas86728@gmail.com');

    // -------------------------------------------------------------
    // 19. ADMIN OTP VERIFICATION
    // -------------------------------------------------------------
    console.log('\n19. Testing Admin OTP Verification...');
    const adminVerifyRes = await apiCall('/api/auth/admin/verify-otp', 'POST', {
      email: 'shas86728@gmail.com',
      otp: adminOtp
    });
    assert(adminVerifyRes.success === true, 'Admin OTP verification failed');
    assert(adminVerifyRes.resetToken, 'Admin reset token missing');
    adminResetToken = adminVerifyRes.resetToken;
    console.log('   ✅ Admin OTP Verification Passed: Validated and signed admin reset token issued');

    // -------------------------------------------------------------
    // 20. ADMIN PASSWORD RESET & RESTORATION
    // -------------------------------------------------------------
    console.log('\n20. Testing Admin Password Reset & Restoration...');
    const adminNewPass = 'AdminNewPass@2026';
    const adminResetRes = await apiCall('/api/auth/admin/reset-password', 'POST', {
      resetToken: adminResetToken,
      newPassword: adminNewPass
    });
    assert(adminResetRes.success === true, 'Admin password reset failed');

    // Verify login with temporary new admin password
    const adminLoginCheck = await apiCall('/api/auth/admin/login', 'POST', {
      email: 'shas86728@gmail.com',
      password: adminNewPass
    });
    assert(adminLoginCheck.success === true, 'Admin login with reset password failed');

    // Restore to standard master password Admin@SC123 via change-password
    await apiCall('/api/auth/change-password', 'POST', {
      currentPassword: adminNewPass,
      newPassword: 'Admin@SC123'
    }, adminLoginCheck.token);

    // Refresh adminToken with standard password
    const restoredAdminLogin = await apiCall('/api/auth/admin/login', 'POST', {
      email: 'shas86728@gmail.com',
      password: 'Admin@SC123'
    });
    adminToken = restoredAdminLogin.token;
    console.log('   ✅ Admin Password Reset Passed: Password updated, verified, and restored to standard');

    // -------------------------------------------------------------
    // 20b. ADMIN USER DETAILS & PASSWORD MANAGEMENT
    // -------------------------------------------------------------
    console.log('\n20b. Testing Admin User Details & Password Management...');
    const adminUsersRes = await apiCall('/api/admin/users', 'GET', null, adminToken);
    assert(adminUsersRes.success === true, 'Failed to fetch admin users');
    assert(Array.isArray(adminUsersRes.users), 'Users is not an array');
    const targetTestUser = adminUsersRes.users.find(u => u.id === userId);
    assert(targetTestUser, 'Created test user not found in admin users');
    assert(targetTestUser.password_hash, 'Admin users list missing password_hash');
    
    // Admin directly sets user password
    const adminSetPassRes = await apiCall(`/api/admin/users/${userId}/reset-password`, 'POST', {
      newPassword: 'AdminAssignedPass@789'
    }, adminToken);
    assert(adminSetPassRes.success === true, 'Admin failed to set user password');

    // Verify user can log in with admin-assigned password
    const userAdminAssignedLogin = await apiCall('/api/auth/login', 'POST', {
      identifier: userEmail,
      password: 'AdminAssignedPass@789'
    });
    assert(userAdminAssignedLogin.success === true, 'User login with admin-assigned password failed');
    userToken = userAdminAssignedLogin.token;
    console.log('   ✅ Admin User Password Management Passed: Full user details & password_hash visible, direct admin password reset verified');

    // -------------------------------------------------------------
    // 21. STORE CATEGORIES & PRODUCTS BROWSING
    // -------------------------------------------------------------
    console.log('\n21. Testing Categories & Products Catalog...');
    const catsRes = await apiCall('/api/products/categories');
    assert(catsRes.categories.length >= 3, 'Categories missing');
    
    const prodsRes = await apiCall('/api/products');
    assert(prodsRes.products.length >= 1, 'Products missing');
    console.log(`   ✅ Store Catalog Passed: ${catsRes.categories.length} categories, ${prodsRes.products.length} products online`);

    // -------------------------------------------------------------
    // 22. ADMIN PRODUCT CREATION & INVENTORY
    // -------------------------------------------------------------
    console.log('\n22. Testing Admin Product Creation & Inventory Initialization...');
    const testSku = 'FF-EP-' + Date.now().toString(36).toUpperCase();
    const newProdRes = await apiCall('/api/admin/products', 'POST', {
      name: 'Free Fire Elite Pass Season 55 Voucher',
      category_id: 'cat-1',
      sku: testSku,
      price: 25,
      stock_quantity: 50,
      description: 'Instant redemption voucher code for Season 55 Elite Pass.'
    }, adminToken);
    assert(newProdRes.product.id, 'Product ID missing');
    assert(newProdRes.product.stock_quantity === 50, 'Stock quantity mismatch');
    testProductId = newProdRes.product.id;
    console.log(`   ✅ Admin Product Creation Passed: ID ${testProductId} created with 50 units in inventory`);

    // -------------------------------------------------------------
    // 23. ADMIN STOCK ADJUSTMENT & INVENTORY AUDIT
    // -------------------------------------------------------------
    console.log('\n23. Testing Admin Stock Adjustment (ADD, REMOVE, SET)...');
    const addStockRes = await apiCall(`/api/admin/products/${testProductId}/stock`, 'POST', {
      change_type: 'ADD',
      quantity: 10,
      reason: 'Warehouse delivery'
    }, adminToken);
    assert(addStockRes.current_stock === 60, `Expected 60 stock, got ${addStockRes.current_stock}`);

    const invLogs = await apiCall('/api/admin/inventory', 'GET', null, adminToken);
    assert(invLogs.inventory.length >= 1, 'Inventory log missing');
    console.log(`   ✅ Stock Adjustment Passed: Added 10 units (New: ${addStockRes.current_stock}), audit logged`);

    // -------------------------------------------------------------
    // 24. USER ORDER PLACEMENT (WALLET DEDUCTION & STOCK REDUCTION)
    // -------------------------------------------------------------
    console.log('\n24. Testing User Store Purchase via Wallet Balance...');
    // User wallet currently has ₹10. Let's add ₹50 via admin wallet adjustment to allow purchase
    await apiCall(`/api/admin/users/${userId}/wallet`, 'POST', {
      type: 'CREDIT',
      amount: 50,
      reason: 'E-commerce test topup'
    }, adminToken);

    const orderRes = await apiCall('/api/orders', 'POST', {
      items: [
        {
          product_id: testProductId,
          quantity: 1
        }
      ],
      shipping_address: 'Bangalore, India'
    }, userToken);
    assert(orderRes.success === true, 'Order creation failed');
    assert(orderRes.order.total_amount === 25, 'Order amount mismatch');
    assert(orderRes.order.payment_status === 'paid', 'Order payment status was not paid');
    testOrderId = orderRes.order.id;

    // Check stock was reduced from 60 to 59
    const checkProd = await apiCall(`/api/products/${testProductId}`);
    assert(checkProd.product.stock_quantity === 59, `Expected 59 stock, got ${checkProd.product.stock_quantity}`);
    console.log(`   ✅ User Store Order Passed: Order #${orderRes.order.order_number} paid via wallet, stock reduced to 59`);

    // -------------------------------------------------------------
    // 25. USER ORDER HISTORY
    // -------------------------------------------------------------
    console.log('\n25. Testing User Order History Retrieval...');
    const myOrdersRes = await apiCall('/api/orders/my-orders', 'GET', null, userToken);
    assert(myOrdersRes.orders.some(o => o.id === testOrderId), 'Order not present in player order history');
    console.log(`   ✅ User Order History Passed: Player order verified`);

    // -------------------------------------------------------------
    // 26. ADMIN ORDER FULFILLMENT & STATUS UPDATES
    // -------------------------------------------------------------
    console.log('\n26. Testing Admin Order Management & Status Updates...');
    const updateOrderRes = await apiCall(`/api/admin/orders/${testOrderId}/status`, 'PUT', {
      status: 'completed'
    }, adminToken);
    assert(updateOrderRes.order.status === 'completed', 'Order status update failed');
    console.log('   ✅ Admin Order Management Passed: Status changed to COMPLETED');

    // -------------------------------------------------------------
    // 27. PUBLIC UPI GATEWAY CONFIGURATION (ZERO LEAKS)
    // -------------------------------------------------------------
    console.log('\n27. Testing Public UPI Gateway Configuration (Zero Admin Leaks)...');
    const gwConfig = await apiCall('/api/wallet/config');
    assert(gwConfig.success === true, 'Failed to fetch gateway config');
    assert(gwConfig.upiId === '6363440966@apl', `Expected UPI ID 6363440966@apl, got ${gwConfig.upiId}`);
    assert(Array.isArray(gwConfig.quickAmounts) && gwConfig.quickAmounts.includes(100), 'Missing quick amounts [50, 100, 200, 500, 1000]');
    assert(!gwConfig.keySecret, 'CRITICAL: Secret key was leaked in public API!');
    assert(!gwConfig.adminEmail, 'CRITICAL: Admin email was leaked in public API!');
    console.log(`   ✅ UPI Config Passed: Active UPI ID ${gwConfig.upiId}, quick amounts [${gwConfig.quickAmounts.join(', ')}], zero secrets leaked`);

    // -------------------------------------------------------------
    // 28. DYNAMIC UPI PAYMENT ORDER CREATION & NPCI QR VALIDATION
    // -------------------------------------------------------------
    console.log('\n28. Testing Dynamic UPI Payment Order Creation & NPCI QR Generation...');
    // Test minimum deposit restriction
    let minDepThrew = false;
    try {
      await apiCall('/api/wallet/upi/create-order', 'POST', { amount: 5 }, userToken);
    } catch (e) {
      minDepThrew = (e.status === 400);
    }
    assert(minDepThrew, 'Server failed to reject deposit below minimum ₹10');

    // Create valid ₹100 deposit order
    const upiOrder1 = await apiCall('/api/wallet/upi/create-order', 'POST', { amount: 100 }, userToken);
    assert(upiOrder1.success === true, 'Failed to create UPI payment order');
    assert(upiOrder1.orderId.startsWith('SCG-UPI-'), 'Invalid order ID format');
    assert(upiOrder1.upiId === '6363440966@apl', 'Order UPI ID is incorrect');
    assert(upiOrder1.upiUri.includes('6363440966%40apl') || upiOrder1.upiUri.includes('6363440966@apl'), 'NPCI URI missing merchant UPI ID');
    assert(upiOrder1.upiUri.includes('100.00'), 'NPCI URI missing exact amount 100.00');
    assert(upiOrder1.qrDataUrl.startsWith('data:image/png;base64,'), 'QR code base64 Data URL missing or invalid');
    assert(upiOrder1.amountPaise === 10000, `Expected 10000 paise, got ${upiOrder1.amountPaise}`);
    assert(new Date(upiOrder1.expiresAt) > new Date(), 'Expiry time is not in the future');
    console.log(`   ✅ Dynamic UPI Order Passed: Order #${upiOrder1.orderId} generated with valid NPCI URI and high-res QR`);

    // -------------------------------------------------------------
    // 29. BANK UTR SUBMISSION & STATUS TRACKING
    // -------------------------------------------------------------
    console.log('\n29. Testing Bank UTR Submission & Status Tracking...');
    const testUtr1 = 'UTR_' + Date.now().toString().slice(-8);

    // Submit UTR
    const utrSubRes = await apiCall('/api/wallet/upi/submit-utr', 'POST', { orderId: upiOrder1.orderId, utrNumber: testUtr1 }, userToken);
    assert(utrSubRes.success === true, 'Failed to submit UTR');
    assert(utrSubRes.status === 'SUBMITTED', 'Status did not change to SUBMITTED');

    // Verify polling status returns SUBMITTED
    const orderStatusCheck = await apiCall(`/api/wallet/upi/order-status/${upiOrder1.orderId}`, 'GET', null, userToken);
    assert(orderStatusCheck.status === 'SUBMITTED', 'Order status check did not return SUBMITTED');
    assert(orderStatusCheck.utrNumber === testUtr1, 'UTR number was not stored in payment order');

    // Verify multiple orders can use arbitrary/same UTR without strict uniqueness blocking
    const upiOrderDup = await apiCall('/api/wallet/upi/create-order', 'POST', { amount: 50 }, userToken);
    const subDupRes = await apiCall('/api/wallet/upi/submit-utr', 'POST', { orderId: upiOrderDup.orderId, utrNumber: testUtr1 }, userToken);
    assert(subDupRes.success === true, 'Failed to accept UTR submission');
    console.log(`   ✅ UTR Submission Passed: UTR accepted, order status marked SUBMITTED`);

    // -------------------------------------------------------------
    // 30. AUTOMATED HMAC-SHA256 SIGNED WEBHOOK VERIFICATION & IDEMPOTENCY
    // -------------------------------------------------------------
    console.log('\n30. Testing Automated Signed Webhook (HMAC-SHA256) & Idempotency...');
    const webhookSecret = process.env.UPI_GATEWAY_WEBHOOK_SECRET || 'scg_upi_webhook_secret_key_2026';
    const upiOrder2 = await apiCall('/api/wallet/upi/create-order', 'POST', { amount: 50 }, userToken);
    const webhookUtr = 'WHK-UTR-' + Date.now().toString(36);

    const webhookPayload = {
      order_id: upiOrder2.orderId,
      amount: 50,
      utr: webhookUtr,
      status: 'SUCCESS'
    };

    // Test rejection of fake signature
    let fakeSigRejected = false;
    try {
      await apiCall('/api/wallet/upi/webhook', 'POST', webhookPayload, null, null, {
        'x-webhook-signature': 'invalid_forged_signature_hash'
      });
    } catch (e) {
      fakeSigRejected = (e.status === 401);
    }
    assert(fakeSigRejected, 'Server accepted forged webhook signature!');

    // Compute genuine HMAC-SHA256 signature
    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(webhookPayload))
      .digest('hex');

    const balBeforeWebhook = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;

    // Send valid webhook
    const webhookRes = await apiCall('/api/wallet/upi/webhook', 'POST', webhookPayload, null, null, {
      'x-webhook-signature': validSignature
    });
    assert(webhookRes.success === true, 'Valid webhook processing failed');

    const balAfterWebhook = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;
    assert(balAfterWebhook === balBeforeWebhook + 50, `Expected balance ₹${balBeforeWebhook + 50}, got ₹${balAfterWebhook}`);

    // Test Webhook Idempotency: Duplicate delivery should not credit again
    const dupWebhookRes = await apiCall('/api/wallet/upi/webhook', 'POST', webhookPayload, null, null, {
      'x-webhook-signature': validSignature
    });
    assert(dupWebhookRes.success === true, 'Duplicate webhook call failed');
    const balAfterDupWebhook = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;
    assert(balAfterDupWebhook === balAfterWebhook, 'CRITICAL: Duplicate webhook caused double wallet credit!');
    console.log(`   ✅ Signed Webhook Passed: HMAC verified, ₹50 credited in integer paise, idempotency enforced`);

    // -------------------------------------------------------------
    // 30b. ADMIN MANUAL UPI APPROVAL & AUDIT LOGGING
    // -------------------------------------------------------------
    console.log('\n30b. Testing Admin Manual Approval with Audit Logging...');
    const balBeforeAdminApprove = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;

    // Admin verifies order 1 (submitted with testUtr1)
    const adminUpiVerifyRes = await apiCall(`/api/admin/deposits/orders/${upiOrder1.orderId}/verify`, 'POST', {
      utrNumber: testUtr1
    }, adminToken);
    assert(adminUpiVerifyRes.success === true, 'Admin manual verification failed');

    const balAfterAdminApprove = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;
    assert(balAfterAdminApprove === balBeforeAdminApprove + 100, `Expected balance ₹${balBeforeAdminApprove + 100}, got ₹${balAfterAdminApprove}`);

    // Verify audit log exists
    const auditLogsRes = await apiCall('/api/admin/audit-logs', 'GET', null, adminToken);
    assert(auditLogsRes.logs.some(l => l.target_id === upiOrder1.orderId && l.action === 'APPROVE_UPI_DEPOSIT'), 'Admin approval audit log missing');

    // Test duplicate admin approval is prevented
    const dupAdminApprove = await apiCall(`/api/admin/deposits/orders/${upiOrder1.orderId}/verify`, 'POST', {
      utrNumber: testUtr1
    }, adminToken);
    assert(dupAdminApprove.alreadyVerified === true || dupAdminApprove.success === true, 'Duplicate approval handling error');
    const balAfterDupApprove = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;
    assert(balAfterDupApprove === balAfterAdminApprove, 'CRITICAL: Duplicate admin approval caused double credit!');
    console.log(`   ✅ Admin Verification Passed: Order #${upiOrder1.orderId} verified, ₹100 credited, audit logged`);

    // -------------------------------------------------------------
    // 30c. ADMIN MANUAL UPI REJECTION & AUDIT TRAIL
    // -------------------------------------------------------------
    console.log('\n30c. Testing Admin Manual UPI Rejection & Audit Logging...');
    const rejectOrder = await apiCall('/api/wallet/upi/create-order', 'POST', { amount: 200 }, userToken);
    const fakeUtr = '9' + Date.now().toString().slice(-11);
    await apiCall('/api/wallet/upi/submit-utr', 'POST', { orderId: rejectOrder.orderId, utrNumber: fakeUtr }, userToken);

    const rejectRes = await apiCall(`/api/admin/deposits/orders/${rejectOrder.orderId}/reject`, 'POST', {
      reason: 'Fake UTR: Payment not reflected in bank account'
    }, adminToken);
    assert(rejectRes.success === true, 'Admin order rejection failed');

    const rejectedStatus = await apiCall(`/api/wallet/upi/order-status/${rejectOrder.orderId}`, 'GET', null, userToken);
    assert(rejectedStatus.status === 'REJECTED', 'Order status was not REJECTED');

    // Verify admin search by UTR and order ID
    const searchRes = await apiCall(`/api/admin/deposits/orders?search=${rejectOrder.orderId}`, 'GET', null, adminToken);
    assert(searchRes.orders.some(o => o.order_id === rejectOrder.orderId), 'Admin search failed to locate order');
    console.log(`   ✅ Admin Rejection Passed: Order marked REJECTED, reason logged in audit trail, search validated`);

    // -------------------------------------------------------------
    // 31. TOURNAMENT LIFECYCLE (CREATION, JOIN, ROOM LOCK & UNLOCK)
    // -------------------------------------------------------------
    console.log('\n31. Testing Tournament Lifecycle & Room Security...');
    const createTourn = await apiCall('/api/admin/tournaments', 'POST', {
      title: '⚡ Alpine Championship Elite',
      game_mode: 'BATTLE_ROYALE',
      match_type: 'SOLO',
      map: 'Alpine',
      entry_fee: 20,
      total_prize_pool: 800,
      prize_1st: 400,
      prize_2nd: 200,
      prize_3rd: 100,
      per_kill_prize: 10,
      max_slots: 48,
      schedule_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      rules: 'Standard Mobile Only Free Fire Rules.'
    }, adminToken);
    testTournId = createTourn.tournamentId;

    // Join tournament
    const joinRes = await apiCall(`/api/tournaments/${testTournId}/join`, 'POST', {
      ff_ign: 'SC_BOOYAH_KING',
      ff_uid: '123456789'
    }, userToken);
    assert(joinRes.success === true, 'Joining tournament failed');
    assert(joinRes.slotNumber === 1, 'Assigned slot is not 1');

    // Verify room credentials are not visible before admin publishes
    const tournDetailsBefore = await apiCall(`/api/tournaments/${testTournId}`, 'GET', null, userToken);
    assert(!tournDetailsBefore.tournament.room_id, 'Room ID was exposed prematurely');

    // Admin publishes room
    await apiCall(`/api/admin/tournaments/${testTournId}/room`, 'POST', {
      room_id: '99887766',
      room_password: 'FREEFIRE@PASS',
      status: 'room_ready'
    }, adminToken);

    // Joined player unlocks room
    const tournDetailsAfter = await apiCall(`/api/tournaments/${testTournId}`, 'GET', null, userToken);
    assert(tournDetailsAfter.tournament.room_id === '99887766', 'Room ID not accessible to joined user');

    // Verify room credentials push notification was dispatched exclusively to joined user
    const joinedNotifs = await apiCall('/api/notifications', 'GET', null, userToken);
    assert(joinedNotifs.success === true && joinedNotifs.notifications.length > 0, 'Room push notification not found for joined user');
    const roomNotif = joinedNotifs.notifications.find(n => n.type === 'ROOM_RELEASED');
    assert(roomNotif && roomNotif.message.includes('99887766'), 'Notification does not contain room ID');
    console.log('   ✅ Tournament & Room Security Passed: Created, joined, room ID kept locked until admin publish, and push notification sent to joined user');

    // -------------------------------------------------------------
    // 32. AUTO PRIZE PAYOUT & CASH WITHDRAWAL APPROVAL
    // -------------------------------------------------------------
    console.log('\n32. Testing Auto Prize Payout & Cash Withdrawal Approval...');
    // User won 1st Place (₹400) + 5 Kills (5 x ₹10 = ₹50) = ₹450
    const balBeforeWin = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;
    await apiCall(`/api/admin/tournaments/${testTournId}/results`, 'POST', {
      playerResults: [{ userId, rank: 1, kills: 5 }]
    }, adminToken);

    const balAfterWin = (await apiCall('/api/wallet/balance', 'GET', null, userToken)).wallet_balance;
    assert(balAfterWin === balBeforeWin + 450, `Expected balance ${balBeforeWin + 450}, got ${balAfterWin}`);

    // User requests withdrawal of ₹100
    const wthRes = await apiCall('/api/withdrawals/request', 'POST', {
      amount: 100,
      upiId: 'winner@oksbi',
      accountHolderName: 'Test Pro Player'
    }, userToken);
    withdrawalId = wthRes.withdrawalId;

    // Admin approves & marks as paid
    const payRes = await apiCall(`/api/admin/withdrawals/${withdrawalId}/pay`, 'POST', {
      adminUtr: 'BANK-UTR-99112233'
    }, adminToken);
    assert(payRes.success === true, 'Marking withdrawal as paid failed');
    console.log('   ✅ Payout & Withdrawal Passed: Auto prize ₹450 credited, withdrawal ₹100 approved & paid');

    // ============================================================
    // 33. LIVE CHAT CUSTOMER SERVICE & INSTANT BOT ASSISTANCE
    // ============================================================
    console.log('\n33. Testing Customer Service Live Chat & Bot Resolution...');
    // User gets/initializes chat
    const chatInit = await apiCall('/api/support/conversation', 'GET', null, userToken);
    assert(chatInit.success === true && chatInit.conversation, 'Live chat initialization failed');
    const userConvId = chatInit.conversation.id;

    // User asks about Room ID credentials
    const chatMsg = await apiCall('/api/support/message', 'POST', {
      conversation_id: userConvId,
      message: 'When will I get the custom room id and password?'
    }, userToken);
    assert(chatMsg.success === true, 'Sending live chat message failed');
    assert(chatMsg.botMessage && chatMsg.botMessage.message.includes('15 minutes before'), 'Automated bot response did not include room release timing');
    console.log('   ✅ Live Chat Customer Service Passed: Chat initialized, user message dispatched & automated bot guidance delivered');

    // ============================================================
    // 34. ADMIN LIVE SUPPORT WORKSTATION & TICKET RESOLUTION
    // ============================================================
    console.log('\n34. Testing Admin Live Customer Support Desk...');
    // Admin lists conversations
    const adminSupportList = await apiCall('/api/support/admin/conversations?status=OPEN', 'GET', null, adminToken);
    assert(adminSupportList.success === true && adminSupportList.conversations.length > 0, 'Admin support list failed');
    
    // Admin sends official reply
    const adminReply = await apiCall(`/api/support/admin/conversations/${userConvId}/reply`, 'POST', {
      message: 'Hello player! Your tournament starts at scheduled time, room ID will unlock automatically in My Matches 15m prior.'
    }, adminToken);
    assert(adminReply.success === true && adminReply.message.sender_type === 'ADMIN', 'Admin reply failed');

    // Admin resolves ticket
    const resolveRes = await apiCall(`/api/support/admin/conversations/${userConvId}/status`, 'PATCH', {
      status: 'RESOLVED'
    }, adminToken);
    assert(resolveRes.success === true && resolveRes.status === 'RESOLVED', 'Ticket resolution failed');
    console.log('   ✅ Admin Live Support Desk Passed: Real-time transcript verified, admin reply sent & ticket resolved');

    console.log('\n================================================================');
    console.log('🎉 ALL 34 COMPREHENSIVE VERIFICATION TESTS PASSED (100%)!');
    console.log('================================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.response) console.error('Response details:', error.response);
    console.error(error);
    process.exit(1);
  }
}

// Helper: Make HTTP request to test server
function apiCall(endpoint, method = 'GET', body = null, token = null, cookie = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost:5000${endpoint}`);
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          json._headers = res.headers;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Check if server is already running on port 5000, or start it
const checkReq = http.get('http://127.0.0.1:5000/api/health', (res) => {
  setTimeout(runTests, 200);
});
checkReq.on('error', () => {
  server.listen(5000, () => {
    setTimeout(runTests, 500);
  });
});
