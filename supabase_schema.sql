-- =========================================================================
-- SC GAMEING - FREE FIRE ESPORTS TOURNAMENT PLATFORM
-- SUPABASE POSTGRESQL SCHEMA WITH ROW LEVEL SECURITY & INDEXES
-- =========================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile VARCHAR(15) UNIQUE NOT NULL,
    ff_ign VARCHAR(100),
    ff_uid VARCHAR(50),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00 CHECK (wallet_balance >= 0),
    winning_balance NUMERIC(12, 2) DEFAULT 0.00 CHECK (winning_balance >= 0),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    reset_token VARCHAR(255),
    reset_token_expiry TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on email and mobile
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. TOURNAMENTS TABLE
CREATE TABLE IF NOT EXISTS tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    game_mode VARCHAR(50) DEFAULT 'BATTLE_ROYALE' CHECK (game_mode IN ('BATTLE_ROYALE', 'CLASH_SQUAD', 'LONE_WOLF')),
    match_type VARCHAR(20) NOT NULL CHECK (match_type IN ('SOLO', 'DUO', 'SQUAD')),
    map VARCHAR(50) NOT NULL CHECK (map IN ('Bermuda', 'Purgatory', 'Kalahari', 'Alpine', 'Nexterra')),
    version VARCHAR(20) DEFAULT 'TPP' CHECK (version IN ('TPP', 'FPP')),
    entry_fee NUMERIC(10, 2) DEFAULT 0.00 CHECK (entry_fee >= 0),
    total_prize_pool NUMERIC(10, 2) DEFAULT 0.00 CHECK (total_prize_pool >= 0),
    prize_1st NUMERIC(10, 2) DEFAULT 0.00,
    prize_2nd NUMERIC(10, 2) DEFAULT 0.00,
    prize_3rd NUMERIC(10, 2) DEFAULT 0.00,
    per_kill_prize NUMERIC(10, 2) DEFAULT 0.00,
    max_slots INTEGER NOT NULL DEFAULT 48,
    slots_joined INTEGER NOT NULL DEFAULT 0,
    schedule_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'registration_closed', 'room_ready', 'live', 'completed', 'cancelled')),
    room_id VARCHAR(50),
    room_password VARCHAR(50),
    room_released_at TIMESTAMPTZ,
    rules TEXT,
    banner_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_schedule ON tournaments(schedule_time);

-- 3. TOURNAMENT PARTICIPANTS
CREATE TABLE IF NOT EXISTS tournament_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_number INTEGER,
    ff_ign VARCHAR(100) NOT NULL,
    ff_uid VARCHAR(50) NOT NULL,
    team_members JSONB,
    kills INTEGER DEFAULT 0,
    rank INTEGER,
    prize_won NUMERIC(10, 2) DEFAULT 0.00,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_tournament_user UNIQUE (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tp_tournament ON tournament_participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tp_user ON tournament_participants(user_id);

-- 4. TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    txn_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'ENTRY_FEE', 'PRIZE', 'REFUND', 'ADMIN_ADJUSTMENT')),
    amount NUMERIC(12, 2) NOT NULL,
    balance_after NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'PENDING', 'REJECTED', 'FAILED')),
    method VARCHAR(30) DEFAULT 'WALLET',
    reference_id VARCHAR(100),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_txn_id ON transactions(txn_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

-- 5. DEPOSITS (AUTOMATED GATEWAY / RAZORPAY)
CREATE TABLE IF NOT EXISTS deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deposit_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) DEFAULT 'RAZORPAY',
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED', 'FAILED')),
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_rzp_order ON deposits(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_deposits_rzp_payment ON deposits(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);

-- 6. PAYMENT SETTINGS
CREATE TABLE IF NOT EXISTS payment_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default_settings',
    razorpay_key_id VARCHAR(255),
    razorpay_key_secret VARCHAR(255),
    gateway_mode VARCHAR(20) DEFAULT 'TEST' CHECK (gateway_mode IN ('TEST', 'LIVE')),
    gateway_status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (gateway_status IN ('ACTIVE', 'MAINTENANCE')),
    min_deposit NUMERIC(10, 2) DEFAULT 10.00,
    max_deposit NUMERIC(10, 2) DEFAULT 50000.00,
    min_withdrawal NUMERIC(10, 2) DEFAULT 50.00,
    max_withdrawal NUMERIC(10, 2) DEFAULT 10000.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. WITHDRAWALS
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    withdrawal_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    upi_id VARCHAR(100) NOT NULL,
    account_holder_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'REJECTED')),
    admin_utr VARCHAR(100),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- 7. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(30) DEFAULT 'INFO' CHECK (type IN ('INFO', 'ALERT', 'UPDATE')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. USER PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT,
    avatar_url TEXT,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. ADMIN ACCOUNTS (Restricted & Monitored)
CREATE TABLE IF NOT EXISTS admin_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    permissions VARCHAR(50) DEFAULT 'SUPER_ADMIN',
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. PASSWORD RESET OTPS (Backend-Only, Hashed)
CREATE TABLE IF NOT EXISTS password_reset_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    otp_hash VARCHAR(255) NOT NULL,
    attempts INTEGER DEFAULT 0,
    resend_after TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON password_reset_otps(email);

-- 11. SESSIONS
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address VARCHAR(50),
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. PRODUCTS
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock INTEGER DEFAULT 0 CHECK (stock >= 0),
    sku VARCHAR(100) UNIQUE,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. INVENTORY LOGS
CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    previous_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    payment_status VARCHAR(30) DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
    order_status VARCHAR(30) DEFAULT 'PLACED' CHECK (order_status IN ('PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
    shipping_address TEXT,
    items_json JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. WALLET ACCOUNTS (INTEGER PAISE ARCHITECTURE)
CREATE TABLE IF NOT EXISTS wallet_accounts (
    id VARCHAR(50) PRIMARY KEY,
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance_paise BIGINT NOT NULL DEFAULT 0,
    winning_balance_paise BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'INR',
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'SUSPENDED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user ON wallet_accounts(user_id);

-- 17. WALLET TRANSACTIONS (PAISE LEDGER)
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id VARCHAR(50) PRIMARY KEY,
    account_id VARCHAR(50) NOT NULL REFERENCES wallet_accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    amount_paise BIGINT NOT NULL,
    balance_before_paise BIGINT NOT NULL,
    balance_after_paise BIGINT NOT NULL,
    reference_id VARCHAR(100) UNIQUE,
    reference_type VARCHAR(50) DEFAULT 'UPI_DEPOSIT',
    status VARCHAR(20) DEFAULT 'SUCCESS',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_user ON wallet_transactions(user_id);

-- 18. PAYMENT ORDERS (UPI ADD MONEY)
CREATE TABLE IF NOT EXISTS payment_orders (
    id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    upi_id VARCHAR(100) DEFAULT '6363440966@apl',
    upi_uri TEXT NOT NULL,
    qr_data_url TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'EXPIRED', 'REJECTED')),
    utr_number VARCHAR(100),
    verification_method VARCHAR(50),
    verified_at TIMESTAMPTZ,
    verified_by VARCHAR(100),
    rejection_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_utr ON payment_orders(utr_number);

-- 19. PAYMENT WEBHOOKS (HMAC-SHA256 LOG)
CREATE TABLE IF NOT EXISTS payment_webhooks (
    id VARCHAR(50) PRIMARY KEY,
    event_id VARCHAR(100) UNIQUE,
    provider VARCHAR(50) DEFAULT 'UPI_GATEWAY',
    order_id VARCHAR(100),
    payload_json TEXT NOT NULL,
    signature TEXT,
    is_valid_signature INTEGER DEFAULT 0,
    status VARCHAR(30) DEFAULT 'PROCESSED',
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 20. ADMIN AUDIT LOGS
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    admin_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    details_json TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_logs(target_type, target_id);

-- 21. SUPPORT CONVERSATIONS (LIVE CHAT)
CREATE TABLE IF NOT EXISTS support_conversations (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(255),
    user_mobile VARCHAR(20),
    status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'CLOSED')),
    subject VARCHAR(255) DEFAULT 'Customer Support',
    last_message TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    unread_user_count INTEGER DEFAULT 0,
    unread_admin_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_conv_user ON support_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_status ON support_conversations(status);

-- 22. SUPPORT MESSAGES
CREATE TABLE IF NOT EXISTS support_messages (
    id VARCHAR(100) PRIMARY KEY,
    conversation_id VARCHAR(100) NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('USER', 'ADMIN', 'BOT')),
    sender_id VARCHAR(100),
    sender_name VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    screenshot_url VARCHAR(500),
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id);

-- 23. USER NOTIFICATIONS (ROOM RELEASES, PAYOUTS, ALERTS)
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'SYSTEM',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

-- Row Level Security (RLS) can be enabled if desired
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
