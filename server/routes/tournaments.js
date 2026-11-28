const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');
const { generateTxnId } = require('../utils/helpers');

// 1. GET ALL TOURNAMENTS (WITH FILTERING & PARTICIPATION CHECK)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { status, type, map, search } = req.query;

    let sql = 'SELECT * FROM tournaments WHERE 1=1';
    const params = [];

    if (status) {
      if (status === 'upcoming') {
        sql += " AND status IN ('upcoming', 'registration_closed')";
      } else if (status === 'live') {
        sql += " AND status IN ('room_ready', 'live')";
      } else if (status === 'completed') {
        sql += " AND status = 'completed'";
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    }

    if (type) {
      sql += ' AND match_type = ?';
      params.push(type.toUpperCase());
    }

    if (map) {
      sql += ' AND map = ?';
      params.push(map);
    }

    if (search) {
      sql += ' AND (title LIKE ? OR map LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY schedule_time ASC';

    const tournaments = await db.query(sql, params);

    // If user is logged in, find which tournaments they joined
    let userJoinedMap = {};
    if (req.user) {
      const userParticipations = await db.query(
        'SELECT tournament_id, slot_number, kills, rank, prize_won FROM tournament_participants WHERE user_id = ?',
        [req.user.id]
      );
      for (const p of userParticipations) {
        userJoinedMap[p.tournament_id] = p;
      }
    }

    // Sanitize Room ID & Password: only visible if user joined OR is admin!
    const sanitizedTournaments = tournaments.map(t => {
      const isJoined = Boolean(userJoinedMap[t.id]);
      const isAdmin = req.user && req.user.role === 'admin';
      const canViewRoom = (isJoined || isAdmin) && (t.status === 'room_ready' || t.status === 'live');

      return {
        ...t,
        user_joined: isJoined,
        my_slot: userJoinedMap[t.id]?.slot_number || null,
        my_kills: userJoinedMap[t.id]?.kills || 0,
        my_rank: userJoinedMap[t.id]?.rank || null,
        my_prize: userJoinedMap[t.id]?.prize_won || 0,
        room_id: canViewRoom ? t.room_id : (t.room_id ? 'PROTECTED_ROOM_ID' : null),
        room_password: canViewRoom ? t.room_password : (t.room_password ? 'PROTECTED_PASS' : null),
        is_room_revealed: Boolean(t.room_id && t.room_password)
      };
    });

    return res.json({
      success: true,
      count: sanitizedTournaments.length,
      tournaments: sanitizedTournaments
    });
  } catch (error) {
    console.error('Fetch tournaments error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch tournaments.' });
  }
});

// 2. GET USER'S JOINED MATCHES
router.get('/user/my-matches', authenticateToken, async (req, res) => {
  try {
    const matches = await db.query(
      `SELECT t.*, p.slot_number, p.ff_ign as player_ign, p.ff_uid as player_uid, p.team_members, p.kills, p.rank, p.prize_won, p.joined_at
       FROM tournament_participants p
       JOIN tournaments t ON p.tournament_id = t.id
       WHERE p.user_id = ?
       ORDER BY t.schedule_time DESC`,
      [req.user.id]
    );

    const result = matches.map(m => {
      const canViewRoom = m.status === 'room_ready' || m.status === 'live';
      return {
        ...m,
        room_id: canViewRoom ? m.room_id : (m.room_id ? 'PROTECTED_ROOM_ID' : null),
        room_password: canViewRoom ? m.room_password : (m.room_password ? 'PROTECTED_PASS' : null)
      };
    });

    return res.json({
      success: true,
      matches: result
    });
  } catch (error) {
    console.error('My matches fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load user matches.' });
  }
});

// 3. GET SINGLE TOURNAMENT DETAILS
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const tournament = await db.get('SELECT * FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    let isJoined = false;
    let participantDetails = null;

    if (req.user) {
      participantDetails = await db.get(
        'SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
        [tournament.id, req.user.id]
      );
      isJoined = Boolean(participantDetails);
    }

    const isAdmin = req.user && req.user.role === 'admin';
    const canViewRoom = (isJoined || isAdmin) && (tournament.status === 'room_ready' || tournament.status === 'live');

    // Fetch participants list (user_id, IGNs, ranks, kills)
    const participants = await db.query(
      `SELECT user_id, slot_number, ff_ign, ff_uid, kills, rank, prize_won, joined_at 
       FROM tournament_participants 
       WHERE tournament_id = ? 
       ORDER BY slot_number ASC`,
      [tournament.id]
    );

    return res.json({
      success: true,
      tournament: {
        ...tournament,
        user_joined: isJoined,
        participant_details: participantDetails,
        room_id: canViewRoom ? tournament.room_id : (tournament.room_id ? 'PROTECTED_ROOM_ID' : null),
        room_password: canViewRoom ? tournament.room_password : (tournament.room_password ? 'PROTECTED_PASS' : null),
        participants
      }
    });
  } catch (error) {
    console.error('Tournament detail fetch error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving tournament.' });
  }
});

// 4. JOIN TOURNAMENT (ATOMIC ENTRY FEE DEDUCTION)
router.post('/:id/join', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { ff_ign, ff_uid, team_members } = req.body;

    const tournament = await db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    // Check status
    if (tournament.status !== 'upcoming') {
      return res.status(400).json({ success: false, message: 'Registrations are closed for this tournament.' });
    }

    // Check slots
    if (tournament.slots_joined >= tournament.max_slots) {
      return res.status(400).json({ success: false, message: 'Tournament is full! No slots remaining.' });
    }

    // Check if already registered
    const existing = await db.get(
      'SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
      [tournamentId, req.user.id]
    );
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already joined this tournament.' });
    }

    // Validate In-Game Name and Free Fire UID
    const playerIgn = ff_ign || req.user.ff_ign;
    const playerUid = ff_uid || req.user.ff_uid;

    if (!playerIgn || !playerUid) {
      return res.status(400).json({
        success: false,
        message: 'Free Fire In-Game Name (IGN) and Player UID are required to join tournaments.'
      });
    }

    // Check user wallet balance
    const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [req.user.id]);
    const entryFee = Number(tournament.entry_fee);
    const currentBalance = Number(user.wallet_balance);

    if (currentBalance < entryFee) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance (Current: ₹${currentBalance.toFixed(2)}, Required: ₹${entryFee.toFixed(2)}). Please add money to your wallet.`,
        requiredAmount: entryFee,
        shortfall: entryFee - currentBalance
      });
    }

    // Calculate new balance & slot number
    const newBalance = currentBalance - entryFee;
    const participantId = db.generateId('part');

    // Check requested slot or allocate lowest available slot
    const requestedSlot = req.body.slot_number ? parseInt(req.body.slot_number, 10) : null;
    const existingParticipants = await db.query(
      'SELECT slot_number FROM tournament_participants WHERE tournament_id = ?',
      [tournamentId]
    );
    const takenSlots = new Set(existingParticipants.map(p => Number(p.slot_number)).filter(Boolean));

    let finalSlot = null;
    if (requestedSlot && requestedSlot >= 1 && requestedSlot <= tournament.max_slots) {
      if (takenSlots.has(requestedSlot)) {
        return res.status(400).json({
          success: false,
          message: `Slot #${requestedSlot} is already sold out! Please select another available slot.`
        });
      }
      finalSlot = requestedSlot;
    } else {
      for (let s = 1; s <= tournament.max_slots; s++) {
        if (!takenSlots.has(s)) {
          finalSlot = s;
          break;
        }
      }
    }

    if (!finalSlot) {
      return res.status(400).json({ success: false, message: 'Tournament is full! No slots remaining.' });
    }

    // 1. Deduct balance from user
    await db.run(
      `UPDATE users SET wallet_balance = ?, updated_at = datetime('now') WHERE id = ?`,
      [newBalance, req.user.id]
    );

    // 2. Increment joined slots
    await db.run(
      `UPDATE tournaments SET slots_joined = slots_joined + 1, updated_at = datetime('now') WHERE id = ?`,
      [tournamentId]
    );

    // 3. Insert participant record
    await db.run(
      `INSERT INTO tournament_participants (id, tournament_id, user_id, slot_number, ff_ign, ff_uid, team_members)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        participantId,
        tournamentId,
        req.user.id,
        finalSlot,
        playerIgn.trim(),
        playerUid.trim(),
        team_members ? JSON.stringify(team_members) : null
      ]
    );

    // 4. Create transaction log
    const txnId = generateTxnId('FEE');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        db.generateId('txn'),
        txnId,
        req.user.id,
        'ENTRY_FEE',
        entryFee,
        newBalance,
        'SUCCESS',
        'WALLET',
        tournamentId,
        `Entry fee paid for "${tournament.title}" (Slot #${finalSlot})`
      ]
    );

    // 5. Real-time broadcast for slot sold out
    const io = req.app.get('io');
    if (io) {
      io.emit('tournaments_updated');
      io.emit('slot_updated', {
        tournamentId,
        slotNumber: finalSlot,
        status: 'SOLD_OUT',
        userId: req.user.id,
        ff_ign: playerIgn.trim()
      });
    }

    return res.json({
      success: true,
      message: `🎉 Successfully joined ${tournament.title}! Assigned Slot #${finalSlot}.`,
      slotNumber: finalSlot,
      newBalance,
      tournamentId
    });
  } catch (error) {
    console.error('Join tournament error:', error);
    return res.status(500).json({ success: false, message: 'Failed to join tournament. Please try again.' });
  }
});

// 5. GET TOURNAMENT SLOTS MAP (AVAILABLE VS SOLD OUT)
router.get('/:id/slots', optionalAuth, async (req, res) => {
  try {
    const tournament = await db.get('SELECT id, title, max_slots, slots_joined, match_type, status FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    const participants = await db.query(
      'SELECT slot_number, user_id, ff_ign FROM tournament_participants WHERE tournament_id = ?',
      [tournament.id]
    );

    const slotMap = {};
    for (const p of participants) {
      if (p.slot_number) {
        slotMap[p.slot_number] = {
          userId: p.user_id,
          ign: p.ff_ign
        };
      }
    }

    const currentUserId = req.user ? req.user.id : null;
    const slots = [];
    const maxSlots = tournament.max_slots || 48;

    for (let i = 1; i <= maxSlots; i++) {
      const occupant = slotMap[i];
      if (occupant) {
        const isMySlot = Boolean(currentUserId && occupant.userId === currentUserId);
        slots.push({
          slotNumber: i,
          status: 'SOLD_OUT',
          isMySlot,
          ign: isMySlot ? occupant.ign : (occupant.ign ? occupant.ign.slice(0, 3) + '***' : 'Player')
        });
      } else {
        slots.push({
          slotNumber: i,
          status: 'AVAILABLE',
          isMySlot: false,
          ign: null
        });
      }
    }

    return res.json({
      success: true,
      tournamentId: tournament.id,
      title: tournament.title,
      maxSlots,
      slotsJoined: tournament.slots_joined,
      matchType: tournament.match_type,
      slots
    });
  } catch (error) {
    console.error('Fetch slots error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch tournament slots.' });
  }
});

// 6. SELECT / SWITCH SLOT (JOINED USER ONLY, REAL-TIME UPDATE)
router.post('/:id/select-slot', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { slot_number } = req.body;
    const targetSlot = parseInt(slot_number, 10);

    if (isNaN(targetSlot) || targetSlot < 1) {
      return res.status(400).json({ success: false, message: 'Valid slot number is required.' });
    }

    // 1. Verify tournament exists
    const tournament = await db.get('SELECT id, title, max_slots, status FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (targetSlot > tournament.max_slots) {
      return res.status(400).json({ success: false, message: `Invalid slot number. Maximum slot is #${tournament.max_slots}.` });
    }

    if (tournament.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Tournament has already completed.' });
    }

    // 2. Verify user has JOINED this tournament
    const participant = await db.get(
      'SELECT id, slot_number, ff_ign, ff_uid FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
      [tournamentId, req.user.id]
    );
    if (!participant) {
      return res.status(403).json({
        success: false,
        message: 'Only registered players who have joined this tournament can select a slot. Please join first!'
      });
    }

    const previousSlot = participant.slot_number;
    if (previousSlot === targetSlot) {
      return res.json({
        success: true,
        message: `You are already occupying Slot #${targetSlot}.`,
        slotNumber: targetSlot
      });
    }

    // 3. Check if target slot is already occupied by another user
    const existingOccupant = await db.get(
      'SELECT id, user_id, ff_ign FROM tournament_participants WHERE tournament_id = ? AND slot_number = ? AND user_id != ?',
      [tournamentId, targetSlot, req.user.id]
    );

    if (existingOccupant) {
      return res.status(400).json({
        success: false,
        message: `Slot #${targetSlot} is already SOLD OUT by another player! Please select an available slot.`
      });
    }

    // 4. Update participant slot
    await db.run(
      `UPDATE tournament_participants SET slot_number = ? WHERE tournament_id = ? AND user_id = ?`,
      [targetSlot, tournamentId, req.user.id]
    );

    // 5. Broadcast real-time slot update via Socket.IO
    const io = req.app.get('io');
    if (io) {
      // Notify this tournament room and global listeners
      io.emit('tournaments_updated');
      io.emit('slot_updated', {
        tournamentId,
        newSlot: targetSlot,
        oldSlot: previousSlot,
        status: 'SOLD_OUT',
        userId: req.user.id,
        ff_ign: participant.ff_ign
      });
    }

    return res.json({
      success: true,
      message: `🎯 Successfully switched to Slot #${targetSlot}!`,
      slotNumber: targetSlot,
      oldSlot: previousSlot
    });
  } catch (error) {
    console.error('Select slot error:', error);
    return res.status(500).json({ success: false, message: 'Failed to select slot. Please try again.' });
  }
});

// 7. USER CHANGE FREE FIRE NAME & PLAYER UID FOR JOINED ROOM
router.patch('/:id/player-info', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { ff_ign, ff_uid, team_members } = req.body;

    if (!ff_ign || !ff_uid) {
      return res.status(400).json({
        success: false,
        message: 'Free Fire In-Game Name (IGN) and Player UID are required.'
      });
    }

    // Verify tournament exists and is not completed
    const tournament = await db.get('SELECT id, title, status FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (tournament.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Cannot edit player info for completed tournaments.' });
    }

    // Verify user is a joined participant
    const participant = await db.get(
      'SELECT id, slot_number FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
      [tournamentId, req.user.id]
    );

    if (!participant) {
      return res.status(403).json({
        success: false,
        message: 'You have not joined this tournament. Join first to configure player info.'
      });
    }

    const cleanIgn = ff_ign.trim();
    const cleanUid = ff_uid.trim();

    // Update participant record for this room
    await db.run(
      `UPDATE tournament_participants
       SET ff_ign = ?, ff_uid = ?, team_members = ?
       WHERE tournament_id = ? AND user_id = ?`,
      [
        cleanIgn,
        cleanUid,
        team_members ? JSON.stringify(team_members) : null,
        tournamentId,
        req.user.id
      ]
    );

    // Also update default user profile for future tournaments
    await db.run(
      `UPDATE users SET ff_ign = ?, ff_uid = ?, updated_at = datetime('now') WHERE id = ?`,
      [cleanIgn, cleanUid, req.user.id]
    );

    // Broadcast update via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('participant_updated', {
        tournamentId,
        userId: req.user.id,
        slotNumber: participant.slot_number,
        ff_ign: cleanIgn,
        ff_uid: cleanUid
      });
    }

    return res.json({
      success: true,
      message: '✅ Free Fire Player Name and Character UID updated successfully!',
      ff_ign: cleanIgn,
      ff_uid: cleanUid,
      slotNumber: participant.slot_number
    });
  } catch (error) {
    console.error('Update player info error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update player information.' });
  }
});

// 8. SCHEDULE EDIT HANDLER ON /api/tournaments/:id/schedule (MIRRORS ADMIN ROUTE)
router.all('/:id/schedule', requireAdmin, async (req, res) => {
  try {
    const tournament = await db.get('SELECT id, title, schedule_time, status FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (req.method === 'GET') {
      return res.json({
        success: true,
        tournamentId: tournament.id,
        title: tournament.title,
        schedule_time: tournament.schedule_time
      });
    }

    if (!['PATCH', 'PUT', 'POST'].includes(req.method)) {
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { schedule_time, notify_players } = req.body || {};
    if (!schedule_time) {
      return res.status(400).json({ success: false, message: 'New schedule date and time is required.' });
    }

    let cleanScheduleTime = schedule_time;
    try {
      const parsedDate = new Date(schedule_time);
      if (!isNaN(parsedDate.getTime())) {
        cleanScheduleTime = parsedDate.toISOString();
      }
    } catch (e) {}

    await db.run(
      `UPDATE tournaments SET schedule_time = ?, updated_at = datetime('now') WHERE id = ?`,
      [cleanScheduleTime, req.params.id]
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('tournaments_updated');
      io.emit('tournament_rescheduled', {
        tournamentId: req.params.id,
        title: tournament.title,
        schedule_time: cleanScheduleTime
      });
    }

    let notifiedCount = 0;
    if (notify_players !== false) {
      const participants = await db.query(
        'SELECT DISTINCT user_id FROM tournament_participants WHERE tournament_id = ?',
        [req.params.id]
      );
      if (participants && participants.length > 0) {
        const formattedDate = new Date(cleanScheduleTime).toLocaleString();
        for (const p of participants) {
          const notifId = 'notif-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
          const notifData = JSON.stringify({ tournamentId: req.params.id, schedule_time: cleanScheduleTime });
          await db.run(
            `INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read)
             VALUES (?, ?, 'TOURNAMENT_SCHEDULE_CHANGED', ?, ?, ?, 0)`,
            [
              notifId,
              p.user_id,
              '⏰ Match Rescheduled',
              `"${tournament.title}" has been rescheduled to ${formattedDate}. Check your My Matches schedule!`,
              notifData
            ]
          );
          notifiedCount++;
        }
      }
    }

    return res.json({
      success: true,
      message: `Match schedule time updated to ${new Date(cleanScheduleTime).toLocaleString()}! (${notifiedCount} players notified)`,
      tournamentId: req.params.id,
      schedule_time: cleanScheduleTime,
      notifiedCount
    });
  } catch (error) {
    console.error('Tournament reschedule error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update tournament schedule time.' });
  }
});

module.exports = router;
