/**
 * SC GAMEING - Automated Razorpay Wallet & Payment Controller
 */

// Initialize Wallet Tab and Actions
async function initWallet() {
  if (!api.token) {
    document.getElementById('wallet-view-logged-out')?.classList.remove('hidden');
    document.getElementById('wallet-view-logged-in')?.classList.add('hidden');
    return;
  }

  document.getElementById('wallet-view-logged-out')?.classList.add('hidden');
  document.getElementById('wallet-view-logged-in')?.classList.remove('hidden');

  await loadWalletBalance();
  await loadTransactions();
  await loadWithdrawalsHistory();
}

// Refresh Balance from Server
async function loadWalletBalance() {
  try {
    const data = await api.getBalance();
    const balance = Number(data.wallet_balance || 0).toFixed(2);
    const winning = Number(data.winning_balance || 0).toFixed(2);

    document.querySelectorAll('.user-balance-val').forEach(el => el.textContent = `₹${balance}`);
    document.querySelectorAll('.user-winning-val').forEach(el => el.textContent = `₹${winning}`);

    // Update session user balance
    if (api.user) {
      api.user.wallet_balance = data.wallet_balance;
      api.user.winning_balance = data.winning_balance;
      localStorage.setItem('scg_user', JSON.stringify(api.user));
    }
  } catch (err) {
    console.error('Failed to load balance:', err);
  }
}

// ============================================================
// DYNAMIC UPI WALLET DEPOSIT & VERIFICATION CONTROLLER
// ============================================================
let currentUpiOrder = null;
let upiCountdownInterval = null;
let upiPollInterval = null;

// Open Deposit Modal
function openDepositModal(presetAmount = null) {
  if (!api.token) {
    openAuthModal('login');
    return;
  }
  const modal = document.getElementById('deposit-modal');
  modal.classList.add('active');
  backToAmountStage();
  document.getElementById('deposit-amount-input').value = presetAmount || '100';
}

function closeDepositModal() {
  const modal = document.getElementById('deposit-modal');
  if (modal) modal.classList.remove('active');
  clearUpiTimers();
}

function backToAmountStage() {
  clearUpiTimers();
  document.getElementById('upi-stage-amount')?.classList.remove('hidden');
  document.getElementById('upi-stage-payment')?.classList.add('hidden');
}

function clearUpiTimers() {
  if (upiCountdownInterval) {
    clearInterval(upiCountdownInterval);
    upiCountdownInterval = null;
  }
  if (upiPollInterval) {
    clearInterval(upiPollInterval);
    upiPollInterval = null;
  }
}

// Quick Preset Amount Selector (₹50, ₹100, ₹200, ₹500, ₹1000)
function setDepositAmount(amount) {
  const input = document.getElementById('deposit-amount-input');
  if (input) input.value = amount;
}

// ============================================================
// DYNAMIC UPI PAYMENT & UTR VERIFICATION CONTROLLER
// ============================================================
// Legacy compatibility handler: All deposits route cleanly to Dynamic UPI QR
async function initiateRazorpayDeposit() {
  return initiateUpiDeposit();
}

// Initiate Dynamic UPI Order & Render QR Code
async function initiateUpiDeposit() {
  const amountInput = document.getElementById('deposit-amount-input');
  const amount = Number(amountInput?.value);

  if (isNaN(amount) || amount < 10) {
    showToast('Minimum deposit amount is ₹10.', 'error');
    return;
  }

  if (amount > 50000) {
    showToast('Maximum deposit amount is ₹50,000.', 'error');
    return;
  }

  const btn = document.getElementById('btn-generate-upi');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating Dynamic UPI QR...`;

  try {
    const orderData = await api.createUpiOrder(amount);
    if (!orderData.success) {
      throw new Error(orderData.message || 'Failed to create UPI payment order.');
    }

    currentUpiOrder = orderData;

    // Switch to Stage 2: Payment Display
    document.getElementById('upi-stage-amount')?.classList.add('hidden');
    document.getElementById('upi-stage-payment')?.classList.remove('hidden');

    // Populate order details
    document.getElementById('upi-order-id-display').textContent = orderData.orderId;
    document.getElementById('upi-amount-display').textContent = `₹${Number(orderData.amount).toFixed(2)}`;
    document.getElementById('upi-qr-image').src = orderData.qrDataUrl;
    const upiDisplay = document.getElementById('upi-id-display');
    if (upiDisplay) {
      upiDisplay.textContent = 'Official Merchant Gateway';
    }

    // Download QR link
    const dlBtn = document.getElementById('btn-download-qr');
    if (dlBtn) {
      dlBtn.href = orderData.qrDataUrl;
      dlBtn.download = `scgameing-qr-${orderData.orderId}.png`;
    }

    // Direct UPI intent launchers for PhonePe, Paytm, Google Pay, and standard UPI
    const intentBtn = document.getElementById('btn-open-upi-app');
    if (intentBtn) intentBtn.href = orderData.upiUri;

    const phonepeBtn = document.getElementById('btn-open-phonepe');
    if (phonepeBtn) phonepeBtn.href = orderData.upiUri;

    const paytmBtn = document.getElementById('btn-open-paytm');
    if (paytmBtn) paytmBtn.href = orderData.upiUri;

    const gpayBtn = document.getElementById('btn-open-gpay');
    if (gpayBtn) gpayBtn.href = orderData.upiUri;

    // Reset status box & UTR input
    const statusBox = document.getElementById('upi-status-box');
    const statusText = document.getElementById('upi-status-text');
    if (statusBox && statusText) {
      statusBox.className = 'p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-center';
      statusText.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Waiting for payment or UTR submission...';
    }
    const utrInput = document.getElementById('upi-utr-input');
    if (utrInput) utrInput.value = '';

    // Start 15-minute countdown timer
    startUpiCountdown(orderData.expiresAt);

    // Start real-time status polling
    startUpiStatusPolling(orderData.orderId);

  } catch (err) {
    showToast(err.message || 'Could not initiate UPI deposit.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// 15-Minute Expiry Countdown Timer
function startUpiCountdown(expiresAt) {
  if (upiCountdownInterval) clearInterval(upiCountdownInterval);

  const expiryTime = new Date(expiresAt).getTime();
  const timerEl = document.getElementById('upi-countdown-timer');

  function update() {
    const now = Date.now();
    const remainingMs = expiryTime - now;

    if (remainingMs <= 0) {
      clearInterval(upiCountdownInterval);
      if (timerEl) {
        timerEl.textContent = 'EXPIRED';
        timerEl.className = 'font-mono text-sm font-black text-red-500';
      }
      const statusBox = document.getElementById('upi-status-box');
      const statusText = document.getElementById('upi-status-text');
      if (statusBox && statusText) {
        statusBox.className = 'p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-center';
        statusText.innerHTML = '<i class="fas fa-times-circle text-red-400"></i> Payment Order Expired';
      }
      return;
    }

    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    if (timerEl) {
      timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }

  update();
  upiCountdownInterval = setInterval(update, 1000);
}

// Real-Time Order Status Polling (every 3.5 seconds)
function startUpiStatusPolling(orderId) {
  if (upiPollInterval) clearInterval(upiPollInterval);

  upiPollInterval = setInterval(async () => {
    try {
      const res = await api.getOrderStatus(orderId);
      if (res && res.success) {
        if (res.status === 'VERIFIED') {
          clearUpiTimers();
          handleUpiPaymentSuccess(res);
        } else if (res.status === 'REJECTED') {
          clearUpiTimers();
          const statusBox = document.getElementById('upi-status-box');
          const statusText = document.getElementById('upi-status-text');
          if (statusBox && statusText) {
            statusBox.className = 'p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-center';
            statusText.innerHTML = `<i class="fas fa-times-circle text-red-400"></i> Order Rejected: ${res.rejectionReason || 'Invalid UTR'}`;
          }
        }
      }
    } catch (e) {
      // Ignore background network polling blips
    }
  }, 3500);
}

// Successful Verification Handler
async function handleUpiPaymentSuccess(orderData) {
  const statusBox = document.getElementById('upi-status-box');
  const statusText = document.getElementById('upi-status-text');
  if (statusBox && statusText) {
    statusBox.className = 'p-3 rounded-lg bg-green-500/20 border border-green-500/50 text-center animate-pulse';
    statusText.innerHTML = `<i class="fas fa-check-circle text-green-400"></i> 🎉 Payment Verified! ₹${Number(orderData.amount).toFixed(2)} Credited!`;
  }

  showToast(`🎉 Payment of ₹${Number(orderData.amount).toFixed(2)} verified and credited!`, 'success');

  await loadWalletBalance();
  await loadTransactions();

  setTimeout(() => {
    closeDepositModal();
  }, 2200);
}

// Copy Payment Instructions / Order ID Helper
function copyUpiId() {
  if (currentUpiOrder?.orderId) {
    navigator.clipboard.writeText(currentUpiOrder.orderId).then(() => {
      showToast(`Order ID copied: ${currentUpiOrder.orderId}`, 'success');
    }).catch(() => {
      showToast(`Order ID: ${currentUpiOrder.orderId}`, 'info');
    });
  } else {
    showToast('Please scan the QR code using any UPI app', 'info');
  }
}

// Submit 12-Digit Bank Reference (UTR)
async function submitUpiUtr() {
  if (!currentUpiOrder) {
    showToast('No active payment order found.', 'error');
    return;
  }

  const utrInput = document.getElementById('upi-utr-input');
  const utr = utrInput?.value.trim();

  if (!utr) {
    showToast('Please enter your transaction reference / UTR number.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-utr');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Submitting...`;

  try {
    const res = await api.submitOrderUtr(currentUpiOrder.orderId, utr);
    showToast(res.message || 'UTR submitted successfully!', 'success');

    const statusBox = document.getElementById('upi-status-box');
    const statusText = document.getElementById('upi-status-text');
    if (statusBox && statusText) {
      statusBox.className = 'p-3 rounded-lg bg-orange-500/15 border border-orange-500/40 text-center';
      statusText.innerHTML = `<i class="fas fa-clock text-yellow-400"></i> Admin verifying payment (${utr}) • Please allow up to 5 minutes`;
    }

    // Refresh transaction history
    await loadTransactions();

    // Trigger the 30-second on-screen notice requested by the user
    showUtrVerificationNotice(utr);
  } catch (err) {
    showToast(err.message || 'Failed to submit UTR.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ============================================================
// WITHDRAWAL REQUESTS
// ============================================================
function openWithdrawalModal() {
  if (!api.token) {
    openAuthModal('login');
    return;
  }
  const modal = document.getElementById('withdrawal-modal');
  modal.classList.add('active');

  const bal = Number(api.user?.wallet_balance || 0).toFixed(2);
  document.getElementById('wth-available-balance').textContent = `₹${bal}`;
  document.getElementById('wth-amount-input').value = '';
  document.getElementById('wth-upi-input').value = '';
  document.getElementById('wth-name-input').value = api.user?.name || '';
}

function closeWithdrawalModal() {
  document.getElementById('withdrawal-modal').classList.remove('active');
}

async function submitWithdrawalRequest() {
  const amount = Number(document.getElementById('wth-amount-input').value);
  const upiId = document.getElementById('wth-upi-input').value.trim();
  const accountHolderName = document.getElementById('wth-name-input').value.trim();

  if (isNaN(amount) || amount < 50) {
    showToast('Minimum withdrawal amount is ₹50.', 'error');
    return;
  }

  if (!upiId || !upiId.includes('@')) {
    showToast('Please enter a valid UPI ID (e.g., name@okaxis, 9876543210@paytm).', 'error');
    return;
  }

  if (!accountHolderName) {
    showToast('Account Holder Name is required.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-wth');
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing Request...`;

  try {
    const res = await api.request('/withdrawals/request', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        upiId,
        accountHolderName
      })
    });

    showToast(res.message, 'success');
    closeWithdrawalModal();
    await loadWalletBalance();
    await loadTransactions();
    await loadWithdrawalsHistory();
  } catch (err) {
    showToast(err.message || 'Failed to submit withdrawal request.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Submit Withdrawal Request`;
  }
}

// ============================================================
// TRANSACTION HISTORY & OFFICIAL RECEIPTS
// ============================================================
async function loadTransactions() {
  const container = document.getElementById('transactions-list');
  if (!container) return;

  try {
    const res = await api.getTransactions();
    const txns = res.transactions || [];

    if (txns.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color:#64748B;">
          <i class="fas fa-receipt" style="font-size:2.5rem; margin-bottom:12px; opacity:0.4;"></i>
          <p>No transactions yet. Join tournaments or add money to start!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = txns.map(t => {
      const isCredit = ['DEPOSIT', 'PRIZE', 'REFUND'].includes(t.type);
      const sign = isCredit ? '+' : '-';
      const colorClass = isCredit ? 'text-green-400' : 'text-red-400';
      const icon = t.type === 'DEPOSIT' ? 'arrow-down text-green-400' :
                   t.type === 'WITHDRAWAL' ? 'arrow-up text-amber-400' :
                   t.type === 'PRIZE' ? 'trophy text-yellow-400' :
                   t.type === 'ENTRY_FEE' ? 'gamepad text-orange-400' : 'undo text-cyan-400';

      const dateStr = new Date(t.created_at).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      let statusBadge = '';
      if (t.status === 'SUCCESS' || t.status === 'APPROVED' || t.status === 'VERIFIED') {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">VERIFIED</span>`;
      } else if (t.status === 'PENDING' || t.status === 'SUBMITTED') {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">PENDING</span>`;
      } else {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">${t.status || 'FAILED'}</span>`;
      }

      return `
        <div class="ff-card" style="padding: 14px 18px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 42px; height: 42px; border-radius: 10px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center;">
              <i class="fas fa-${icon}"></i>
            </div>
            <div>
              <div style="font-weight: 600; font-size: 0.95rem; color: #FFF;">${t.description || t.type}</div>
              <div style="font-size: 0.75rem; color: #94A3B8;">${dateStr} • Ref: ${t.txn_id}</div>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
              <div style="font-family: 'Rajdhani', sans-serif; font-size: 1.25rem; font-weight: 700;" class="${colorClass}">
                ${sign}₹${Number(t.amount).toFixed(2)}
              </div>
              ${statusBadge}
            </div>
            <button onclick="viewReceipt('${t.txn_id}')" style="background: none; border: none; color: #00E5FF; font-size: 0.75rem; cursor: pointer; text-decoration: underline; margin-top: 2px;">
              View Receipt
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching transactions:', err);
  }
}

async function loadWithdrawalsHistory() {
  const container = document.getElementById('withdrawals-history-list');
  if (!container) return;

  try {
    const res = await api.getWithdrawalsHistory();
    const withdrawals = res.withdrawals || [];

    if (withdrawals.length === 0) {
      container.innerHTML = `<div style="color: #64748B; font-size: 0.85rem; padding: 10px;">No withdrawal requests found.</div>`;
      return;
    }

    container.innerHTML = withdrawals.map(w => {
      let badgeClass = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40';
      if (w.status === 'PAID') badgeClass = 'bg-green-500/20 text-green-400 border-green-500/40';
      if (w.status === 'REJECTED') badgeClass = 'bg-red-500/20 text-red-400 border-red-500/40';

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom: 1px solid #1E293B;">
          <div>
            <div style="font-weight: 600; color: #FFF;">₹${Number(w.amount).toFixed(2)} to ${w.upi_id}</div>
            <div style="font-size: 0.75rem; color: #94A3B8;">${new Date(w.created_at).toLocaleString()} ${w.admin_utr ? `• Ref: ${w.admin_utr}` : ''}</div>
          </div>
          <span style="font-size:0.75rem; padding: 2px 8px; border-radius: 6px; border: 1px solid;" class="${badgeClass}">
            ${w.status}
          </span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading withdrawals:', err);
  }
}

async function viewReceipt(txnId) {
  try {
    const res = await api.getReceipt(txnId);
    const r = res.receipt;
    const modal = document.getElementById('receipt-modal');

    document.getElementById('receipt-id').textContent = r.receiptNumber;
    document.getElementById('receipt-date').textContent = new Date(r.date).toLocaleString('en-IN');
    document.getElementById('receipt-customer').textContent = `${r.customerName} (${r.customerMobile})`;
    document.getElementById('receipt-type').textContent = r.type;
    document.getElementById('receipt-desc').textContent = r.description;
    document.getElementById('receipt-amount').textContent = `₹${Number(r.amount).toFixed(2)}`;
    document.getElementById('receipt-status').textContent = r.status;
    document.getElementById('receipt-ref').textContent = r.referenceId || 'N/A';
    document.getElementById('receipt-balance-after').textContent = `₹${Number(r.balanceAfter).toFixed(2)}`;

    modal.classList.add('active');
  } catch (err) {
    showToast(err.message || 'Could not load receipt.', 'error');
  }
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('active');
}

function printReceipt() {
  window.print();
}

// ============================================================
// UTR HELP & 30-SECOND VERIFICATION NOTICE CONTROLLER
// ============================================================
function toggleUtrHelpGuide() {
  const guide = document.getElementById('utr-help-guide');
  if (guide) {
    guide.classList.toggle('hidden');
  }
}

let utrNoticeInterval = null;

function showUtrVerificationNotice(utr) {
  const noticeModal = document.getElementById('utr-verification-notice');
  if (!noticeModal) return;

  const utrDisplay = document.getElementById('notice-utr-display');
  if (utrDisplay) utrDisplay.textContent = utr;

  noticeModal.classList.remove('hidden');

  let secondsRemaining = 30;
  const timerEl = document.getElementById('notice-timer');
  const progressEl = document.getElementById('notice-progress-bar');

  if (utrNoticeInterval) clearInterval(utrNoticeInterval);

  if (timerEl) timerEl.textContent = '30s';
  if (progressEl) progressEl.style.width = '100%';

  utrNoticeInterval = setInterval(() => {
    secondsRemaining--;
    if (timerEl) timerEl.textContent = `${secondsRemaining}s`;
    if (progressEl) {
      const percent = Math.max(0, (secondsRemaining / 30) * 100);
      progressEl.style.width = `${percent}%`;
    }

    if (secondsRemaining <= 0) {
      clearInterval(utrNoticeInterval);
      utrNoticeInterval = null;
      dismissUtrVerificationNotice();
    }
  }, 1000);
}

function dismissUtrVerificationNotice() {
  if (utrNoticeInterval) {
    clearInterval(utrNoticeInterval);
    utrNoticeInterval = null;
  }
  const noticeModal = document.getElementById('utr-verification-notice');
  if (noticeModal) {
    noticeModal.classList.add('hidden');
  }
  closeDepositModal();
}
