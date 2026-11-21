/**
 * SC GAMEING - Admin Password Reset Utility
 * 
 * Usage:
 *   node scripts/reset-admin.js
 *   node scripts/reset-admin.js NewPassword123
 *   node scripts/reset-admin.js NewPassword123 shas86728@gmail.com
 */

const bcrypt = require('bcryptjs');
const db = require('../server/db');
const config = require('../server/config');

async function resetAdminPassword() {
  const newPassword = process.argv[2] || 'Admin@SC123';
  const targetEmail = (process.argv[3] || config.admin.email || 'shas86728@gmail.com').toLowerCase().trim();

  console.log('=======================================================');
  console.log('👑 SC GAMEING - ADMIN PASSWORD RESET UTILITY');
  console.log('=======================================================');

  try {
    db.initDatabase();

    // Check if admin user exists
    let admin = await db.get(
      'SELECT id, name, email, mobile, role FROM users WHERE role = ? OR email = ?',
      ['admin', targetEmail]
    );

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);

    if (admin) {
      // Update existing admin
      await db.run(
        `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL, updated_at = datetime('now') WHERE id = ?`,
        [hash, admin.id]
      );
      console.log(`\n✅ SUCCESS: Admin password has been updated!`);
      console.log(`👤 Admin Name:     ${admin.name}`);
      console.log(`📧 Login Email:    ${admin.email}`);
      console.log(`📱 Login Mobile:   ${admin.mobile}`);
      console.log(`🔑 New Password:   ${newPassword}`);
    } else {
      // Create admin if not found
      const adminId = 'admin-' + Date.now();
      await db.run(
        `INSERT INTO users (id, name, email, mobile, ff_ign, ff_uid, password_hash, role, wallet_balance, winning_balance, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminId,
          config.admin.name || 'SC GAMEING Admin',
          targetEmail,
          '6363440966',
          'SC_LEADER',
          '1000000001',
          hash,
          'admin',
          50000.00,
          50000.00,
          'active'
        ]
      );
      console.log(`\n✅ SUCCESS: Master Admin account created with new credentials!`);
      console.log(`📧 Login Email:    ${targetEmail}`);
      console.log(`🔑 Password:       ${newPassword}`);
    }

    console.log('\n🚀 You can now log in at: http://localhost:5000/admin');
    console.log('=======================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error resetting admin password:', error.message);
    process.exit(1);
  }
}

resetAdminPassword();
