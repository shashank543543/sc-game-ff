const fs = require('fs');
const path = require('path');
const config = require('../config');
const bcrypt = require('bcryptjs');

let dbDriver = null;
let dbType = 'sqlite'; // 'postgres' or 'sqlite'

// Initialize Database connection
function initDatabase() {
  if (config.db.url || (config.db.supabaseUrl && config.db.supabaseKey)) {
    try {
      if (config.db.url) {
        const { Pool } = require('pg');
        const isSupabase = config.db.url.includes('supabase.co') || config.db.url.includes('supabase.com') || config.db.url.includes('pooler.supabase');
        const pool = new Pool({
          connectionString: config.db.url,
          ssl: (process.env.NODE_ENV === 'production' || isSupabase) ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 8000,
          idleTimeoutMillis: 30000,
          max: 10
        });
        pool.on('error', (err) => {
          console.warn('⚠️ Non-fatal PostgreSQL pool client notice:', err.message);
        });
        dbDriver = pool;
        dbType = 'postgres';
        console.log('✅ Connected to PostgreSQL / Supabase Database via Pool.');
        initPostgresSchema();
        return;
      }
    } catch (err) {
      console.warn('⚠️ Could not connect to PostgreSQL, falling back to local SQLite:', err.message);
    }
  }

  // Use Node.js built-in SQLite engine
  const { DatabaseSync } = require('node:sqlite');
  const os = require('os');
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const dbDir = isServerless ? os.tmpdir() : path.join(__dirname, '..', '..', 'data');
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (e) {}
  const dbPath = path.join(dbDir, 'sc_gameing.sqlite');
  dbDriver = new DatabaseSync(dbPath);
  dbType = 'sqlite';
  console.log(`✅ Connected to SQLite database at ${dbPath}`);

  // High-performance Pragmas for concurrency & high traffic (50k+ users)
  try {
    dbDriver.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 10000;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA foreign_keys = ON;
    `);
  } catch (e) {
    console.warn('⚠️ SQLite PRAGMA initialization notice:', e.message);
  }

  initSqliteSchema();
}

function initSqliteSchema() {
  dbDriver.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      mobile TEXT UNIQUE NOT NULL,
      ff_ign TEXT,
      ff_uid TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      wallet_balance REAL DEFAULT 0.00,
      winning_balance REAL DEFAULT 0.00,
      status TEXT DEFAULT 'active',
      reset_token TEXT,
      reset_token_expiry TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      game_mode TEXT DEFAULT 'BATTLE_ROYALE',
      match_type TEXT NOT NULL,
      map TEXT NOT NULL,
      version TEXT DEFAULT 'TPP',
      entry_fee REAL DEFAULT 0.00,
      total_prize_pool REAL DEFAULT 0.00,
      prize_1st REAL DEFAULT 0.00,
      prize_2nd REAL DEFAULT 0.00,
      prize_3rd REAL DEFAULT 0.00,
      per_kill_prize REAL DEFAULT 0.00,
      max_slots INTEGER NOT NULL DEFAULT 48,
      slots_joined INTEGER NOT NULL DEFAULT 0,
      schedule_time TEXT NOT NULL,
      status TEXT DEFAULT 'upcoming',
      room_id TEXT,
      room_password TEXT,
      room_released_at TEXT,
      rules TEXT,
      banner_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournament_participants (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      slot_number INTEGER,
      ff_ign TEXT NOT NULL,
      ff_uid TEXT NOT NULL,
      team_members TEXT,
      kills INTEGER DEFAULT 0,
      rank INTEGER,
      prize_won REAL DEFAULT 0.00,
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tournament_id, user_id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      txn_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      status TEXT DEFAULT 'SUCCESS',
      method TEXT DEFAULT 'WALLET',
      reference_id TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      deposit_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      upi_id TEXT NOT NULL DEFAULT '6363440966@apl',
      utr_number TEXT,
      screenshot_url TEXT,
      status TEXT DEFAULT 'PENDING',
      verified_by TEXT,
      rejection_reason TEXT,
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      withdrawal_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      upi_id TEXT NOT NULL,
      account_holder_name TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      admin_utr TEXT,
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'INFO',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_settings (
      id TEXT PRIMARY KEY,
      razorpay_key_id TEXT,
      razorpay_key_secret TEXT,
      gateway_mode TEXT DEFAULT 'TEST',
      gateway_status TEXT DEFAULT 'ACTIVE',
      min_deposit REAL DEFAULT 10,
      max_deposit REAL DEFAULT 50000,
      min_withdrawal REAL DEFAULT 50,
      max_withdrawal REAL DEFAULT 10000,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      permissions TEXT DEFAULT 'SUPER_ADMIN',
      is_active INTEGER DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_otps (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      otp_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      resend_after TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      is_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 0,
      sku TEXT UNIQUE,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'PENDING',
      order_status TEXT DEFAULT 'PLACED',
      shipping_address TEXT,
      items_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      balance_paise INTEGER NOT NULL DEFAULT 0,
      winning_balance_paise INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      balance_before_paise INTEGER NOT NULL,
      balance_after_paise INTEGER NOT NULL,
      reference_id TEXT UNIQUE,
      reference_type TEXT DEFAULT 'UPI_DEPOSIT',
      status TEXT NOT NULL DEFAULT 'SUCCESS',
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      upi_id TEXT NOT NULL DEFAULT '6363440966@apl',
      upi_uri TEXT NOT NULL,
      qr_data_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      utr_number TEXT,
      verification_method TEXT,
      verified_at TEXT,
      verified_by TEXT,
      rejection_reason TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_webhooks (
      id TEXT PRIMARY KEY,
      event_id TEXT UNIQUE,
      provider TEXT NOT NULL DEFAULT 'UPI_GATEWAY',
      order_id TEXT,
      payload_json TEXT NOT NULL,
      signature TEXT,
      is_valid_signature INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PROCESSED',
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_name TEXT NOT NULL,
      user_email TEXT,
      user_mobile TEXT,
      status TEXT DEFAULT 'OPEN',
      subject TEXT DEFAULT 'Customer Support',
      last_message TEXT,
      last_message_at TEXT DEFAULT (datetime('now')),
      unread_user_count INTEGER DEFAULT 0,
      unread_admin_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      screenshot_url TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'SYSTEM',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user ON wallet_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_txns_user ON wallet_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_utr ON payment_orders(utr_number);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_logs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_support_conv_user ON support_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_conv_status ON support_conversations(status);
    CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

    -- High-throughput indexes for 50k users scale
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
    CREATE INDEX IF NOT EXISTS idx_tournaments_schedule ON tournaments(schedule_time);
    CREATE INDEX IF NOT EXISTS idx_tourn_part_tourn_user ON tournament_participants(tournament_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_tourn_part_user ON tournament_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
    CREATE INDEX IF NOT EXISTS idx_txns_user ON transactions(user_id);
  `);

  // Migrate columns if needed
  try { dbDriver.exec(`ALTER TABLE deposits ADD COLUMN razorpay_order_id TEXT;`); } catch(e){}
  try { dbDriver.exec(`ALTER TABLE deposits ADD COLUMN razorpay_payment_id TEXT;`); } catch(e){}
  try { dbDriver.exec(`ALTER TABLE deposits ADD COLUMN payment_method TEXT DEFAULT 'RAZORPAY';`); } catch(e){}
  try { dbDriver.exec(`ALTER TABLE support_messages ADD COLUMN screenshot_url TEXT;`); } catch(e){}

  // Remove UNIQUE constraint from utr_number in payment_orders and deposits if present
  try {
    const pOrdersSchema = dbDriver.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_orders'").get();
    if (pOrdersSchema && pOrdersSchema.sql && pOrdersSchema.sql.includes('utr_number TEXT UNIQUE')) {
      dbDriver.exec(`
        CREATE TABLE payment_orders_mig (
          id TEXT PRIMARY KEY,
          order_id TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          amount_paise INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'INR',
          upi_id TEXT NOT NULL DEFAULT '6363440966@apl',
          upi_uri TEXT NOT NULL,
          qr_data_url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          utr_number TEXT,
          verification_method TEXT,
          verified_at TEXT,
          verified_by TEXT,
          rejection_reason TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT OR IGNORE INTO payment_orders_mig SELECT * FROM payment_orders;
        DROP TABLE payment_orders;
        ALTER TABLE payment_orders_mig RENAME TO payment_orders;
      `);
    }
  } catch(e) {}

  try {
    const depSchema = dbDriver.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='deposits'").get();
    if (depSchema && depSchema.sql && depSchema.sql.includes('utr_number TEXT UNIQUE')) {
      dbDriver.exec(`
        CREATE TABLE deposits_mig (
          id TEXT PRIMARY KEY,
          deposit_id TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          amount REAL NOT NULL,
          upi_id TEXT NOT NULL DEFAULT '6363440966@apl',
          utr_number TEXT,
          screenshot_url TEXT,
          status TEXT DEFAULT 'PENDING',
          verified_by TEXT,
          rejection_reason TEXT,
          verified_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          payment_method TEXT DEFAULT 'RAZORPAY',
          razorpay_order_id TEXT,
          razorpay_payment_id TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT OR IGNORE INTO deposits_mig SELECT id, deposit_id, user_id, amount, upi_id, utr_number, screenshot_url, status, verified_by, rejection_reason, verified_at, created_at, payment_method, razorpay_order_id, razorpay_payment_id FROM deposits;
        DROP TABLE deposits;
        ALTER TABLE deposits_mig RENAME TO deposits;
      `);
    }
  } catch(e) {}

  seedDefaultData();
}

let schemaInitialized = false;
async function initPostgresSchema() {
  if (schemaInitialized) return;
  schemaInitialized = true;

  try {
    const tableCheck = await dbDriver.query("SELECT to_regclass('public.users') as exists;");
    if (tableCheck.rows[0] && tableCheck.rows[0].exists) {
      console.log('✅ PostgreSQL / Supabase Schema already synchronized.');
      await seedDefaultData();
      return;
    }
  } catch (e) {}

  const schemaPath = path.join(__dirname, '..', '..', 'supabase_schema.sql');
  if (fs.existsSync(schemaPath)) {
    try {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await dbDriver.query(sql);
      console.log('✅ PostgreSQL / Supabase Schema synchronized successfully.');
      await seedDefaultData();
    } catch (err) {
      console.error('Error running postgres schema:', err.message);
    }
  }
}

// Seed admin and default data if empty
async function seedDefaultData() {
  try {
    const adminCheck = await get('SELECT id FROM users WHERE email = ?', [config.admin.email]);
    if (!adminCheck) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(config.admin.password, salt);
      const adminId = 'admin-' + Date.now();
      await run(
        `INSERT INTO users (id, name, email, mobile, ff_ign, ff_uid, password_hash, role, wallet_balance, winning_balance, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [adminId, config.admin.name, config.admin.email, '6363440966', 'SC_LEADER', '1000000001', hash, 'admin', 50000.00, 50000.00, 'active']
      );
      console.log(`👑 Admin account created: ${config.admin.email} (Password: ${config.admin.password})`);
    }

    // Check if tournaments exist
    const tournCount = await get('SELECT COUNT(*) as count FROM tournaments');
    const count = tournCount?.count || tournCount?.['count'] || 0;
    if (Number(count) === 0) {
      const now = Date.now();
      const in2Hours = new Date(now + 2 * 60 * 60 * 1000).toISOString();
      const in5Hours = new Date(now + 5 * 60 * 60 * 1000).toISOString();
      const inTomorrow = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      const liveTime = new Date(now - 15 * 60 * 1000).toISOString();

      const sampleTournaments = [
        {
          id: 'tourn-101',
          title: '🔥 Bermuda Clash - Solo Rush #101',
          game_mode: 'BATTLE_ROYALE',
          match_type: 'SOLO',
          map: 'Bermuda',
          version: 'TPP',
          entry_fee: 20.00,
          total_prize_pool: 800.00,
          prize_1st: 350.00,
          prize_2nd: 200.00,
          prize_3rd: 100.00,
          per_kill_prize: 10.00,
          max_slots: 48,
          slots_joined: 32,
          schedule_time: in2Hours,
          status: 'upcoming',
          rules: '1. No emulators or PC allowed (Mobile only).\n2. Gun attributes are OFF.\n3. Teaming up will result in immediate ban and forfeiture of funds.\n4. Room ID & Password will be revealed 15 minutes before match start.',
          banner_url: '/assets/images/bermuda.jpg'
        },
        {
          id: 'tourn-102',
          title: '⚡ Purgatory Squad Carnage #102',
          game_mode: 'BATTLE_ROYALE',
          match_type: 'SQUAD',
          map: 'Purgatory',
          version: 'TPP',
          entry_fee: 100.00,
          total_prize_pool: 2000.00,
          prize_1st: 1000.00,
          prize_2nd: 500.00,
          prize_3rd: 250.00,
          per_kill_prize: 15.00,
          max_slots: 12, // 12 squads = 48 players
          slots_joined: 8,
          schedule_time: in5Hours,
          status: 'upcoming',
          rules: '1. Squad mode. Leader pays ₹100 for the entire squad.\n2. All 4 members must enter valid Free Fire UIDs.\n3. No hacking or third-party config files.\n4. Official referee will spectate in room.',
          banner_url: '/assets/images/purgatory.jpg'
        },
        {
          id: 'tourn-103',
          title: '💀 Kalahari Duo Showdown #103',
          game_mode: 'BATTLE_ROYALE',
          match_type: 'DUO',
          map: 'Kalahari',
          version: 'TPP',
          entry_fee: 40.00,
          total_prize_pool: 1200.00,
          prize_1st: 600.00,
          prize_2nd: 300.00,
          prize_3rd: 150.00,
          per_kill_prize: 10.00,
          max_slots: 24,
          slots_joined: 24, // Full, ready to start
          schedule_time: liveTime,
          status: 'room_ready',
          room_id: '98451203',
          room_password: 'SCG@FREEFIRE',
          rules: '1. Duo mode.\n2. Room ID and password unlocked for registered players.\n3. Join room within 10 minutes.\n4. Take screenshot of your victory screen with kills for verification.',
          banner_url: '/assets/images/kalahari.jpg'
        },
        {
          id: 'tourn-104',
          title: '🏆 Mega Sunday Championship #104',
          game_mode: 'BATTLE_ROYALE',
          match_type: 'SOLO',
          map: 'Alpine',
          version: 'TPP',
          entry_fee: 50.00,
          total_prize_pool: 3000.00,
          prize_1st: 1500.00,
          prize_2nd: 800.00,
          prize_3rd: 400.00,
          per_kill_prize: 20.00,
          max_slots: 48,
          slots_joined: 14,
          schedule_time: inTomorrow,
          status: 'upcoming',
          rules: '1. High stakes tournament!\n2. Booyah winner gets ₹1500 cash credited directly to wallet.\n3. Per Kill bounty ₹20.\n4. Live streaming on YouTube / Discord.',
          banner_url: '/assets/images/alpine.jpg'
        }
      ];

      for (const t of sampleTournaments) {
        await run(
          `INSERT INTO tournaments (id, title, game_mode, match_type, map, version, entry_fee, total_prize_pool, prize_1st, prize_2nd, prize_3rd, per_kill_prize, max_slots, slots_joined, schedule_time, status, room_id, room_password, rules, banner_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.title, t.game_mode, t.match_type, t.map, t.version, t.entry_fee, t.total_prize_pool, t.prize_1st, t.prize_2nd, t.prize_3rd, t.per_kill_prize, t.max_slots, t.slots_joined, t.schedule_time, t.status, t.room_id || null, t.room_password || null, t.rules, t.banner_url]
        );
      }
      console.log('🎮 Seeded sample Free Fire tournaments.');
    }

    // Seed default announcement if none
    const annCount = await get('SELECT COUNT(*) as count FROM announcements');
    const aCount = annCount?.count || annCount?.['count'] || 0;
    if (Number(aCount) === 0) {
      await run(
        `INSERT INTO announcements (id, title, message, type, is_active)
         VALUES (?, ?, ?, ?, ?)`,
        ['ann-1', '🎉 Welcome to SC GAMEING!', 'Daily Free Fire Cash Tournaments with automated Razorpay deposits & fast withdrawals! Join now to showcase your skills and win real cash.', 'ALERT', 1]
      );
    }

    // Seed default payment settings
    const paymentSettings = await get('SELECT id FROM payment_settings WHERE id = ?', ['default_settings']);
    if (!paymentSettings) {
      await run(
        `INSERT INTO payment_settings (id, razorpay_key_id, razorpay_key_secret, gateway_mode, gateway_status, min_deposit, max_deposit, min_withdrawal, max_withdrawal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'default_settings',
          config.payment.razorpayKeyId || 'rzp_test_SCGAMEING_DEMO',
          config.payment.razorpayKeySecret || 'demo_secret_key_scgameing',
          config.payment.razorpayKeyId ? 'LIVE' : 'TEST',
          'ACTIVE',
          config.payment.minDepositAmount || 10,
          config.payment.maxDepositAmount || 50000,
          config.payment.minWithdrawalAmount || 50,
          config.payment.maxWithdrawalAmount || 10000
        ]
      );
    }

    // Seed admin_accounts for authorized admin shas86728@gmail.com
    const adminUser = await get('SELECT id, email FROM users WHERE email = ?', ['shas86728@gmail.com']);
    if (adminUser) {
      const adminAcc = await get('SELECT id FROM admin_accounts WHERE email = ?', ['shas86728@gmail.com']);
      if (!adminAcc) {
        await run(
          `INSERT INTO admin_accounts (id, user_id, email, permissions, is_active)
           VALUES (?, ?, ?, 'SUPER_ADMIN', 1)`,
          ['adm-shas86728', adminUser.id, 'shas86728@gmail.com']
        );
      }

      // Ensure user profile exists
      const prof = await get('SELECT id FROM user_profiles WHERE user_id = ?', [adminUser.id]);
      if (!prof) {
        await run(
          `INSERT INTO user_profiles (id, user_id, bio, city, state)
           VALUES (?, ?, 'Lead Tournament Administrator & Esports Host', 'Bangalore', 'Karnataka')`,
          ['prof-' + adminUser.id, adminUser.id]
        );
      }
    }

    // Seed default categories if empty
    const catCheck = await get('SELECT COUNT(*) as count FROM categories');
    const catCount = catCheck?.count || catCheck?.['count'] || 0;
    if (Number(catCount) === 0) {
      const defaultCategories = [
        { id: 'cat-1', name: 'Esports Apparel', slug: 'esports-apparel', description: 'Official SC GAMEING jerseys, hoodies, and jackets.' },
        { id: 'cat-2', name: 'Gaming Gear', slug: 'gaming-gear', description: 'Finger sleeves, gaming triggers, and cooling fans.' },
        { id: 'cat-3', name: 'Digital Vouchers', slug: 'digital-vouchers', description: 'Free Fire Diamonds & membership top-up cards.' }
      ];
      for (const c of defaultCategories) {
        await run(`INSERT INTO categories (id, name, slug, description) VALUES (?, ?, ?, ?)`, [c.id, c.name, c.slug, c.description]);
      }

      // Seed sample products
      const defaultProducts = [
        { id: 'prod-1', catId: 'cat-1', name: 'SC Elite Pro Gaming Jersey', slug: 'sc-elite-pro-jersey', desc: 'Breathable dry-fit polyester esports jersey with customized ign printing.', price: 799.00, stock: 50, sku: 'SC-JRS-001' },
        { id: 'prod-2', catId: 'cat-2', name: 'Carbon Fiber Pro Finger Sleeves (Pack of 4)', slug: 'carbon-finger-sleeves', desc: 'Zero latency high-sensitivity breathable thumb sleeves for competitive Free Fire.', price: 249.00, stock: 200, sku: 'SC-SLV-002' },
        { id: 'prod-3', catId: 'cat-3', name: '1080 Free Fire Diamonds Instant Voucher', slug: '1080-ff-diamonds', desc: 'Direct Garena Free Fire top-up voucher delivered to your email instantly.', price: 780.00, stock: 100, sku: 'SC-DIA-003' }
      ];

      for (const p of defaultProducts) {
        await run(
          `INSERT INTO products (id, category_id, name, slug, description, price, stock, sku, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.id, p.catId, p.name, p.slug, p.desc, p.price, p.stock, p.sku]
        );

        // Record initial inventory
        await run(
          `INSERT INTO inventory (id, product_id, change_type, quantity, previous_stock, new_stock, notes)
           VALUES (?, ?, 'INITIAL', ?, 0, ?, 'Initial inventory stock load')`,
          ['inv-' + p.id, p.id, p.stock, p.stock]
        );
      }
    }

    // Auto-sync wallet_accounts in integer paise for all existing users
    const allUsers = await query('SELECT id, wallet_balance, winning_balance FROM users');
    for (const u of allUsers) {
      const existingAcc = await get('SELECT id FROM wallet_accounts WHERE user_id = ?', [u.id]);
      if (!existingAcc) {
        const balPaise = Math.round(Number(u.wallet_balance || 0) * 100);
        const winPaise = Math.round(Number(u.winning_balance || 0) * 100);
        await run(
          `INSERT INTO wallet_accounts (id, user_id, balance_paise, winning_balance_paise, currency, status)
           VALUES (?, ?, ?, ?, 'INR', 'ACTIVE')`,
          ['wacc-' + u.id, u.id, balPaise, winPaise]
        );
      }
    }
  } catch (err) {
    console.error('Error during seed:', err);
  }
}

// Unified query methods
async function query(sql, params = []) {
  if (dbType === 'postgres') {
    // Convert ? to $1, $2, etc. for PostgreSQL
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const res = await dbDriver.query(pgSql, params);
    return res.rows;
  } else {
    const stmt = dbDriver.prepare(sql);
    return stmt.all(...params);
  }
}

async function get(sql, params = []) {
  if (dbType === 'postgres') {
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const res = await dbDriver.query(pgSql, params);
    return res.rows[0] || null;
  } else {
    const stmt = dbDriver.prepare(sql);
    return stmt.get(...params) || null;
  }
}

async function run(sql, params = []) {
  if (dbType === 'postgres') {
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const res = await dbDriver.query(pgSql, params);
    return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id || null };
  } else {
    const stmt = dbDriver.prepare(sql);
    const info = stmt.run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
}

module.exports = {
  initDatabase,
  query,
  get,
  run,
  getDbType: () => dbType
};
