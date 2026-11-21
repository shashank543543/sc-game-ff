/**
 * SC GAMEING - Customer Service Live Chat Client Controller
 * Provides real-time 2-way chat with esports managers and automated 24/7 bot support.
 */

let currentConversation = null;
let chatSocket = null;
let isChatOpen = false;
let unreadChatCount = 0;
let typingTimeout = null;
let currentAttachedScreenshot = null;

document.addEventListener('DOMContentLoaded', () => {
  initLiveChat();
});

// Play subtle dual-tone notification chime using Web Audio API
function playChatChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
    osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (e) {
    // Audio autoplay restrictions
  }
}

// Format message text with safe markdown support
function formatChatMessage(text) {
  if (!text) return '';
  // 1. HTML Escape
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Bold **text**
  safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 3. Code `code`
  safe = safe.replace(/`([^`]+)`/g, '<code class="bg-black/40 px-1 py-0.5 rounded text-orange-300 font-mono text-[11px]">$1</code>');

  // 4. Bullet points
  safe = safe.replace(/^• (.*$)/gim, '<li class="ml-3 list-disc">$1</li>');

  // 5. Line breaks
  safe = safe.replace(/\n/g, '<br/>');

  return safe;
}

// Initialize chat connection and history
async function initLiveChat() {
  const guestId = localStorage.getItem('scg_chat_guest_id');
  const guestName = localStorage.getItem('scg_chat_guest_name');

  try {
    const data = await api.getSupportConversation(guestId, guestName);
    if (data.success && data.conversation) {
      currentConversation = data.conversation;

      // Save guest ID if guest
      if (!currentConversation.user_id && currentConversation.id) {
        localStorage.setItem('scg_chat_guest_id', currentConversation.id);
        const guestBar = document.getElementById('chat-guest-info-bar');
        if (guestBar && !localStorage.getItem('scg_chat_guest_name')) {
          guestBar.classList.remove('hidden');
        }
      }

      // Update header label
      updateChatHeaderLabel();

      // Render messages
      renderChatMessages(data.messages || []);

      // Setup Socket listeners
      setupChatSocket();

      // Check unread count
      unreadChatCount = Number(currentConversation.unread_user_count || 0);
      updateUnreadBadge();
    }
  } catch (err) {
    console.warn('Live chat initialization error:', err);
    const container = document.getElementById('chat-messages-container');
    if (container) {
      container.innerHTML = `
        <div class="text-center py-6 text-gray-400 text-xs">
          <p class="text-orange-400 font-bold mb-1">Live Support Desk</p>
          <p>Send a message below to connect with an esports agent.</p>
        </div>
      `;
    }
  }
}

// Update user label in chat header
function updateChatHeaderLabel() {
  const label = document.getElementById('chat-user-label');
  if (!label) return;

  if (api.user) {
    label.textContent = `${api.user.name} (${api.user.ff_ign || 'Player'})`;
    label.className = 'text-[10px] text-green-400 font-mono font-semibold';
  } else {
    const savedName = localStorage.getItem('scg_chat_guest_name') || 'Guest';
    label.textContent = savedName;
    label.className = 'text-[10px] text-gray-400 font-mono';
  }
}

// Socket.io handlers for live conversation updates
function setupChatSocket() {
  // Use existing global socket instance or create one
  if (typeof io === 'undefined') return;
  chatSocket = window.socket || (typeof socket !== 'undefined' ? socket : io());

  if (!chatSocket || !currentConversation) return;

  // Join this specific conversation room
  chatSocket.emit('join_support_conversation', currentConversation.id);

  // Incoming message event
  chatSocket.off('chat_message');
  chatSocket.on('chat_message', (msg) => {
    if (msg.conversation_id === currentConversation.id) {
      appendChatMessage(msg);
      
      // If message is from admin or bot and chat is closed, alert user
      if (msg.sender_type !== 'USER') {
        playChatChime();
        if (!isChatOpen) {
          unreadChatCount++;
          updateUnreadBadge();
          showToast(`💬 Support reply: "${msg.message.substring(0, 45)}..."`, 'info');
        } else {
          // If chat is open, immediately mark as read
          api.markSupportRead(currentConversation.id);
        }
      }
    }
  });

  // Typing indicator
  chatSocket.off('typing_indicator');
  chatSocket.on('typing_indicator', (data) => {
    if (data.conversationId === currentConversation.id) {
      const indicator = document.getElementById('chat-typing-indicator');
      const typingText = document.getElementById('chat-typing-text');
      if (indicator && typingText) {
        if (data.isTyping && data.senderType !== 'USER') {
          typingText.textContent = `${data.senderName || 'Support agent'} is typing`;
          indicator.classList.remove('hidden');
        } else {
          indicator.classList.add('hidden');
        }
      }
    }
  });

  // Status changed event
  chatSocket.off('conversation_status_changed');
  chatSocket.on('conversation_status_changed', (data) => {
    if (data.conversationId === currentConversation.id) {
      if (data.status === 'RESOLVED') {
        appendChatMessage({
          sender_type: 'BOT',
          sender_name: 'SC Support Bot',
          message: '✅ This support inquiry has been marked as **RESOLVED** by the agent. If you need any more help, simply send another message to reopen it anytime!',
          created_at: new Date().toISOString()
        });
      }
    }
  });

  // Typing emitter on user input
  const input = document.getElementById('chat-message-input');
  if (input) {
    input.addEventListener('input', () => {
      if (!currentConversation) return;
      chatSocket.emit('typing_start', {
        conversationId: currentConversation.id,
        senderName: api.user ? api.user.name : (localStorage.getItem('scg_chat_guest_name') || 'Player'),
        senderType: 'USER'
      });

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        chatSocket.emit('typing_stop', { conversationId: currentConversation.id });
      }, 1500);
    });
  }
}

// Toggle Live Chat Widget open / close
async function toggleLiveChat() {
  const widget = document.getElementById('live-chat-widget');
  if (!widget) return;

  isChatOpen = !isChatOpen;
  if (isChatOpen) {
    widget.classList.add('active');
    unreadChatCount = 0;
    updateUnreadBadge();
    scrollChatToBottom();
    const input = document.getElementById('chat-message-input');
    if (input) setTimeout(() => input.focus(), 150);

    // Mark messages as read on server
    if (currentConversation) {
      try {
        await api.markSupportRead(currentConversation.id);
      } catch (e) {}
    }
  } else {
    widget.classList.remove('active');
  }
}

function openLiveChat() {
  if (!isChatOpen) {
    toggleLiveChat();
  }
}

// Update unread count badge
function updateUnreadBadge() {
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;

  if (unreadChatCount > 0) {
    badge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// Render all messages
function renderChatMessages(messages) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500 text-xs">
        <i class="fas fa-headset text-orange-500 text-2xl mb-2"></i>
        <p class="font-bold text-gray-300">Welcome to SC GAMEING Support</p>
        <p class="text-[11px] text-gray-500 mt-1">Ask questions about UPI deposits, Custom Room IDs, or cash withdrawals.</p>
      </div>
    `;
    return;
  }

  messages.forEach(msg => appendChatMessage(msg, false));
  scrollChatToBottom();
}

// Append single message to transcript
function appendChatMessage(msg, scroll = true) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  // Deduplicate by message ID
  if (msg.id && container.querySelector(`[data-msg-id="${msg.id}"]`)) {
    return;
  }

  // Format time (e.g. 15:42)
  let timeStr = '';
  try {
    const d = msg.created_at ? new Date(msg.created_at) : new Date();
    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    timeStr = '';
  }

  const el = document.createElement('div');
  if (msg.id) el.setAttribute('data-msg-id', msg.id);

  const formattedBody = formatChatMessage(msg.message);

  let screenshotHtml = '';
  if (msg.screenshot_url) {
    screenshotHtml = `
      <div class="chat-attachment mt-2">
        <a href="${msg.screenshot_url}" target="_blank" rel="noopener noreferrer" title="Click to view full screenshot" class="inline-block">
          <img src="${msg.screenshot_url}" alt="Screenshot Attachment" class="max-w-[220px] max-h-[180px] rounded-lg border border-slate-700/80 shadow object-cover hover:opacity-90 transition cursor-zoom-in" loading="lazy" />
        </a>
      </div>
    `;
  }

  if (msg.sender_type === 'USER') {
    el.className = 'chat-msg-user';
    el.innerHTML = `
      <div>${formattedBody}</div>
      ${screenshotHtml}
      <div class="text-[10px] text-orange-200/70 text-right mt-1 flex items-center justify-end gap-1 font-mono">
        <span>${timeStr}</span>
        <i class="fas fa-check-double text-[9px]"></i>
      </div>
    `;
  } else if (msg.sender_type === 'ADMIN') {
    el.className = 'chat-msg-admin';
    el.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <span class="w-4 h-4 rounded-full bg-orange-600 text-[9px] font-bold text-white flex items-center justify-center">
          <i class="fas fa-shield-alt"></i>
        </span>
        <span class="text-[11px] font-bold text-orange-400 font-heading tracking-wide">${msg.sender_name || 'Support Agent'}</span>
        <span class="text-[10px] text-gray-500 font-mono ml-auto">${timeStr}</span>
      </div>
      <div class="text-gray-100">${formattedBody}</div>
      ${screenshotHtml}
    `;
  } else {
    // BOT MESSAGE
    el.className = 'chat-msg-bot';
    el.innerHTML = `
      <div class="flex items-center gap-2 mb-1.5 pb-1 border-b border-cyan-500/20">
        <span class="w-4 h-4 rounded-full bg-cyan-600 text-[9px] font-bold text-white flex items-center justify-center">
          <i class="fas fa-robot"></i>
        </span>
        <span class="text-[11px] font-bold text-cyan-400 font-heading tracking-wide">SC Support Assistant</span>
        <span class="text-[9px] px-1.5 py-0.2 bg-cyan-500/10 text-cyan-300 rounded border border-cyan-500/30">Auto Reply</span>
        <span class="text-[10px] text-gray-500 font-mono ml-auto">${timeStr}</span>
      </div>
      <div class="text-gray-200 leading-relaxed">${formattedBody}</div>
    `;
  }

  container.appendChild(el);
  if (scroll) scrollChatToBottom();
}

// Scroll chat container to bottom
function scrollChatToBottom() {
  const container = document.getElementById('chat-messages-container');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// Handle user selecting screenshot file for chat
async function handleChatScreenshotSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.match(/^image\/(jpeg|jpg|png|webp|gif)$/i)) {
    showToast('Please select an image file (JPG, PNG, WEBP, GIF).', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Screenshot must be 10MB or smaller.', 'error');
    return;
  }

  showToast('Uploading screenshot...', 'info');
  try {
    const data = await api.uploadSupportScreenshot(file);
    currentAttachedScreenshot = data.url;

    // Show preview container
    const previewBar = document.getElementById('chat-attachment-preview');
    const previewImg = document.getElementById('chat-preview-img');
    const previewFilename = document.getElementById('chat-preview-filename');
    if (previewBar && previewImg) {
      previewImg.src = data.url;
      if (previewFilename) previewFilename.textContent = file.name;
      previewBar.classList.remove('hidden');
    }
    showToast('Screenshot attached! Press send to post.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to upload screenshot.', 'error');
  }
}

function clearChatAttachment() {
  currentAttachedScreenshot = null;
  const fileInput = document.getElementById('chat-screenshot-input');
  if (fileInput) fileInput.value = '';
  const previewBar = document.getElementById('chat-attachment-preview');
  if (previewBar) previewBar.classList.add('hidden');
}

// Send chat message form handler
async function handleSendChatMessage(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('chat-message-input');
  const text = input ? input.value.trim() : '';

  const hasText = !!text;
  const hasScreenshot = !!currentAttachedScreenshot;

  if (!hasText && !hasScreenshot) return;

  const outgoingScreenshot = currentAttachedScreenshot;
  clearChatAttachment();

  if (input) {
    input.value = '';
    input.focus();
  }

  // Clear typing indicator
  if (chatSocket && currentConversation) {
    chatSocket.emit('typing_stop', { conversationId: currentConversation.id });
  }

  const guestName = localStorage.getItem('scg_chat_guest_name') || null;

  try {
    const payload = {
      conversation_id: currentConversation ? currentConversation.id : null,
      message: text,
      screenshot_url: outgoingScreenshot,
      guest_name: guestName
    };

    const res = await api.sendSupportMessage(payload);
    if (res.success) {
      if (!currentConversation && res.message && res.message.conversation_id) {
        currentConversation = { id: res.message.conversation_id };
        localStorage.setItem('scg_chat_guest_id', res.message.conversation_id);
        setupChatSocket();
      }
    }
  } catch (err) {
    showToast(err.message || 'Failed to send message.', 'error');
  }
}

// Quick Topic click handler
function sendQuickTopic(topicLabel) {
  const input = document.getElementById('chat-message-input');
  if (input) {
    input.value = topicLabel;
    handleSendChatMessage();
  }
}

// Save Guest Name in local storage
function saveGuestName() {
  const input = document.getElementById('chat-guest-name-input');
  if (!input) return;
  const val = input.value.trim();
  if (val) {
    localStorage.setItem('scg_chat_guest_name', val);
    const guestBar = document.getElementById('chat-guest-info-bar');
    if (guestBar) guestBar.classList.add('hidden');
    updateChatHeaderLabel();
    showToast(`Saved name as "${val}"`, 'success');
  }
}

// Refresh Live Chat
async function refreshLiveChat() {
  const container = document.getElementById('chat-messages-container');
  if (container) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500 text-xs">
        <i class="fas fa-spinner fa-spin text-orange-500 text-lg mb-2"></i>
        <p>Refreshing chat history...</p>
      </div>
    `;
  }
  await initLiveChat();
}
