/**
 * SC GAMEING - API Client & Global Helpers
 */

// Base API endpoint - works out-of-the-box on localhost, LAN, full-stack Render, and Vercel rewrites
const API_BASE = window.SCG_API_BASE || 
                 document.querySelector('meta[name="api-base"]')?.getAttribute('content') || 
                 localStorage.getItem('scg_api_base') || 
                 '/api';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('scg_token') || null;
    this.user = JSON.parse(localStorage.getItem('scg_user') || 'null');
  }

  setSession(token, user) {
    this.token = token;
    this.user = user;
    if (token) localStorage.setItem('scg_token', token);
    else localStorage.removeItem('scg_token');

    if (user) localStorage.setItem('scg_user', JSON.stringify(user));
    else localStorage.removeItem('scg_user');
  }

  logout() {
    this.setSession(null, null);
    window.location.reload();
  }

  async request(endpoint, options = {}, extraBody = null) {
    if (typeof options === 'string') {
      options = {
        method: options,
        body: extraBody ? (typeof extraBody === 'string' ? extraBody : JSON.stringify(extraBody)) : undefined
      };
    }

    const headers = options.headers || {};

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, config);
      const text = await response.text();
      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        if (!response.ok) {
          throw new Error(`Server request failed (${response.status}: ${response.statusText})`);
        }
        throw new Error('Server returned an unexpected non-JSON response.');
      }

      if (!response.ok) {
        if (response.status === 401 && this.token) {
          // Token expired
          this.logout();
        }
        throw new Error(data.message || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  // Auth methods
  async register(payload) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data.token) this.setSession(data.token, data.user);
    return data;
  }

  async login(payload) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data.token) this.setSession(data.token, data.user);
    return data;
  }

  async getProfile() {
    return this.request('/auth/profile');
  }

  async updateProfile(payload) {
    return this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  async forgotPassword(email) {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  async resetPassword(payload) {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // Tournaments
  async getTournaments(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/tournaments${qs ? '?' + qs : ''}`);
  }

  async getTournamentDetails(id) {
    return this.request(`/tournaments/${id}`);
  }

  async joinTournament(id, payload) {
    return this.request(`/tournaments/${id}/join`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async getTournamentSlots(id) {
    return this.request(`/tournaments/${id}/slots`);
  }

  async selectTournamentSlot(id, slotNumber) {
    return this.request(`/tournaments/${id}/select-slot`, {
      method: 'POST',
      body: JSON.stringify({ slot_number: slotNumber })
    });
  }

  async updateTournamentPlayerInfo(id, payload) {
    return this.request(`/tournaments/${id}/player-info`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  async editTournamentSchedule(id, payload) {
    return this.request(`/admin/tournaments/${id}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  async getMyMatches() {
    return this.request('/tournaments/user/my-matches');
  }

  // Wallet & Payments
  async getBalance() {
    return this.request('/wallet/balance');
  }

  async getUpiConfig() {
    return this.request('/wallet/upi/config');
  }

  async createUpiOrder(amount) {
    return this.request('/wallet/upi/create-order', {
      method: 'POST',
      body: JSON.stringify({ amount: Number(amount) })
    });
  }

  async submitOrderUtr(orderId, utrNumber) {
    return this.request('/wallet/upi/submit-utr', {
      method: 'POST',
      body: JSON.stringify({ orderId, utrNumber })
    });
  }

  async getOrderStatus(orderId) {
    return this.request(`/wallet/upi/order-status/${encodeURIComponent(orderId)}`);
  }

  async initiateDeposit(amount) {
    return this.createUpiOrder(amount);
  }

  async submitUtr(formData) {
    return this.request('/wallet/deposit/submit-utr', {
      method: 'POST',
      body: formData
    });
  }

  async getTransactions() {
    return this.request('/wallet/transactions');
  }

  async getReceipt(txnId) {
    return this.request(`/wallet/receipt/${txnId}`);
  }

  // Withdrawals
  async requestWithdrawal(payload) {
    return this.request('/withdrawals/request', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async getWithdrawalsHistory() {
    return this.request('/withdrawals/history');
  }

  // Admin Auth
  async adminLogin(payload) {
    const data = await this.request('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data.token) this.setSession(data.token, data.user);
    return data;
  }

  async verifyOtp(payload) {
    return this.request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async adminForgotPassword(email) {
    return this.request('/auth/admin/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  async adminVerifyOtp(payload) {
    return this.request('/auth/admin/verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async adminResetPassword(payload) {
    return this.request('/auth/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // Store & Orders
  async getProducts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/products${qs ? '?' + qs : ''}`);
  }

  async getMyOrders() {
    return this.request('/orders/my-orders');
  }

  async createOrder(payload) {
    return this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // Customer Support Live Chat API Methods
  async getSupportConversation(guestId = null, guestName = null) {
    const params = new URLSearchParams();
    if (guestId) params.append('guest_id', guestId);
    if (guestName) params.append('guest_name', guestName);
    const qs = params.toString();
    return this.request(`/support/conversation${qs ? '?' + qs : ''}`);
  }

  async sendSupportMessage(payload) {
    return this.request('/support/message', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async markSupportRead(conversationId) {
    return this.request('/support/mark-read', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId })
    });
  }

  async getSupportQuickTopics() {
    return this.request('/support/quick-topics');
  }

  async uploadSupportScreenshot(file) {
    const formData = new FormData();
    formData.append('screenshot', file);
    return this.request('/support/upload', {
      method: 'POST',
      body: formData
    });
  }

  // User Push Notifications API Methods
  async getNotifications() {
    return this.request('/notifications');
  }

  async markNotificationsRead(notificationId = null) {
    return this.request('/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notification_id: notificationId })
    });
  }

  async deleteNotification(notificationId) {
    return this.request(`/notifications/${notificationId}`, {
      method: 'DELETE'
    });
  }

  // Admin Support Workstation Methods
  async adminGetSupportConversations(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/support/admin/conversations${qs ? '?' + qs : ''}`);
  }

  async adminGetSupportConversation(id) {
    return this.request(`/support/admin/conversations/${id}`);
  }

  async adminSendSupportReply(id, payload) {
    const body = typeof payload === 'string' ? { message: payload } : payload;
    return this.request(`/support/admin/conversations/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async adminUpdateSupportStatus(id, status) {
    return this.request(`/support/admin/conversations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }
}

const api = new ApiService();

// Toast Notifications Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'exclamation-circle';

  toast.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <i class="fas fa-${icon}" style="font-size:1.1rem;"></i>
      <span>${message}</span>
    </div>
    <button style="background:none; border:none; color:#888; cursor:pointer;" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}
