/**
 * SC GAMEING - Customer Service Support Bot Engine
 * Provides instant 24/7 automated resolution for frequent player queries
 * and seamlessly escalates complex requests to human esports managers.
 */

const BOT_NAME = 'SC Support Bot';

const QUICK_TOPICS = [
  { id: 'deposit', label: '💳 Deposit & UTR Help', icon: 'wallet' },
  { id: 'room', label: '🎮 Room ID & Password', icon: 'key' },
  { id: 'withdraw', label: '💸 Cash Withdrawal', icon: 'money-bill-wave' },
  { id: 'rules', label: '⚔️ Rules & Anti-Cheat', icon: 'shield-alt' },
  { id: 'human', label: '👤 Chat with Agent', icon: 'headset' }
];

/**
 * Analyze user message and generate helpful automated resolution
 * @param {string} text - User message content
 * @param {object} context - Player context (name, isLoggedIn, walletBalance, etc.)
 * @returns {object|null} - Bot response text and optional suggested actions
 */
function getBotResponse(text, context = {}) {
  if (!text || typeof text !== 'string') return null;

  const raw = text.toLowerCase().trim();
  const playerName = context.name || 'Player';

  // 1. GREETING / FIRST CONTACT
  if (/^(hi|hello|hey|hola|namaste|good morning|good afternoon|good evening|sup|yo|start)(\b|\s|!|\.)/i.test(raw) || raw === 'hi' || raw === 'hello') {
    return {
      sender_name: BOT_NAME,
      message: `👋 Hello **${playerName}**! Welcome to **SC GAMEING 24/7 Live Customer Service**.\n\nI can help you instantly with:\n• **UPI Deposits & UTR Approval**\n• **Room ID & Password release timings**\n• **Withdrawals & Bank Payouts**\n• **Tournament Rules & Match Registration**\n\nHow can our team help you today? You can select a quick topic below or type your issue directly.`
    };
  }

  // 2. DEPOSIT / PAYMENT / UTR / BALANCE
  if (/(deposit|utr|paytm|phonepe|gpay|upi|add money|recharge|payment|money not added|balance not added|screenshot)/i.test(raw)) {
    return {
      sender_name: BOT_NAME,
      message: `💳 **UPI Deposit & UTR Verification Guidance**:\n\n1. **Dynamic UPI QR**: Under **Wallet → Deposit**, enter amount and tap **Generate Dynamic UPI QR & Pay**.\n2. **Direct Payment Apps**: Tap PhonePe, Paytm, or GPay buttons to pay directly in your UPI app, or scan the QR code.\n3. **12-Digit UTR Submission**: Once paid, copy the 12-digit UTR from your payment receipt and submit it.\n4. **Admin Approval**: Direct UPI payments are reviewed and verified by admin within **5 minutes**!\n\n📍 *Please keep your 12-digit UTR handy. Our team is actively reviewing submissions!*`
    };
  }

  // 3. ROOM ID / PASSWORD / CUSTOM ROOM / MATCH CREDENTIALS
  if (/(room id|room pass|password|custom room|where is room|credentials|room not showing|room lock|join room)/i.test(raw)) {
    return {
      sender_name: BOT_NAME,
      message: `🎮 **Room ID & Password Release System**:\n\n• Custom Room ID & Password are published strictly **15 minutes before the match start time**.\n• Only registered players who joined the tournament can view credentials under the **'My Matches'** tab.\n• Once unlocked, tap **'Copy Room ID'** & **'Copy Password'** and join Free Fire custom room within 10 minutes.\n\n⚠️ *Ensure your in-game name (IGN) matches your profile to avoid being kicked by room moderators!*`
    };
  }

  // 4. WITHDRAWAL / CASH OUT / BANK TRANSFER
  if (/(withdraw|withdrawal|cash out|transfer to bank|payout|upi withdrawal|winning balance|payout pending|when will i get money)/i.test(raw)) {
    return {
      sender_name: BOT_NAME,
      message: `💸 **Cash Withdrawal Guidance**:\n\n• **Minimum Withdrawal**: ₹50 from your Winning Balance.\n• **Payout Destination**: Directly to any valid UPI ID (e.g. \`yourname@okaxis\`, \`yourmobile@paytm\`).\n• **Processing Speed**: Withdrawals are processed by admins within **15 to 45 minutes**.\n• If a withdrawal is rejected due to an incorrect UPI ID, funds are **100% automatically refunded** back to your wallet.\n\n*You can view real-time status in the Wallet → Withdrawals section.*`
    };
  }

  // 5. TOURNAMENT RULES / ANTI-CHEAT / HACKS / EMULATOR
  if (/(rule|rules|emulator|pc player|hack|hacker|ban|cheater|teaming|prize pool|kill point|booyah)/i.test(raw)) {
    return {
      sender_name: BOT_NAME,
      message: `⚔️ **Esports Fair Play & Tournament Rules**:\n\n1. **Strict Mobile Only**: PC emulators (BlueStacks, LDPlayer, etc.) are strictly prohibited to ensure 100% fair mobile competition.\n2. **Anti-Cheat**: Any hacks, headshot scripts, or teaming in Solo matches result in an immediate permanent ban and wallet forfeiture.\n3. **Match Verification**: Winners must take a screenshot of the victory / Booyah screen with final kills for instant prize release.\n4. **Prize Auto-Credit**: Calculated prize money is deposited directly to your Winning Balance right after admin verification!`
    };
  }

  // 6. TALK TO AGENT / HUMAN ESCALATION
  if (/(agent|human|talk to person|admin|executive|representative|manager|contact person|call|help me)/i.test(raw)) {
    return {
      sender_name: BOT_NAME,
      message: `👤 **Connecting you to an SC GAMEING Support Agent**...\n\nA customer service manager has been notified of your chat request. Our typical response time is under 5 minutes during active tournament hours.\n\nPlease describe your question or issue in detail below (along with any Tournament ID or UTR number) so we can resolve it immediately!`
    };
  }

  // 7. STORE / SHOP / DIAMONDS / MERCHANDISE
  if (/(store|shop|diamonds|top up|redeem|order|product|merchandise)/i.test(raw)) {
    return {
      sender_name: BOT_NAME,
      message: `🛍️ **SC Esports Store & Diamond Top-Ups**:\n\nYou can spend your wallet balance to purchase Free Fire Diamonds, battle passes, and gaming accessories in our Store section. Diamond orders are dispatched directly to your Free Fire Character UID within 1-2 hours!`
    };
  }

  // 8. DEFAULT COURTEOUS ESCALATION FOR UNRECOGNIZED MESSAGES
  return {
    sender_name: BOT_NAME,
    message: `🤖 Thank you for your message! Our live customer service team has received your ticket and is reviewing it now.\n\nAn agent will reply directly in this chat thread shortly. Feel free to attach any details or transaction IDs in the meantime!`
  };
}

module.exports = {
  BOT_NAME,
  QUICK_TOPICS,
  getBotResponse
};
