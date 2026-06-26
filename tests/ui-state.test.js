const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getAdminPrimaryAction,
  getPlayerScreenId,
  getVoteStatus,
} = require('../public/ui-state');

test('player screen mapping follows the current phase', () => {
  assert.equal(getPlayerScreenId({ player: null, phase: 'lobby' }), 'screen-lobby');
  assert.equal(getPlayerScreenId({ player: { id: 'p1' }, phase: 'description' }), 'screen-description');
  assert.equal(getPlayerScreenId({ player: { id: 'p1' }, phase: 'summary' }), 'screen-summary');
  assert.equal(getPlayerScreenId({ player: { id: 'p1' }, phase: 'voting' }), 'screen-vote');
  assert.equal(getPlayerScreenId({ player: { id: 'p1' }, phase: 'result' }), 'screen-result');
  assert.equal(getPlayerScreenId({ player: { id: 'p1' }, phase: 'gameOver' }), 'screen-podium');
  assert.equal(getPlayerScreenId({ player: { id: 'p1' }, phase: 'lobby' }), 'screen-waiting');
});

test('vote status requires the exact number of targets before submit', () => {
  assert.deepEqual(getVoteStatus({ selectedCount: 0, requiredCount: 2, voted: false }), {
    canSubmit: false,
    label: 'Đã chọn 0/2',
    message: 'Chọn đúng 2 người nghi là Gián điệp.',
    tone: 'neutral',
  });

  assert.deepEqual(getVoteStatus({ selectedCount: 1, requiredCount: 2, voted: false }), {
    canSubmit: false,
    label: 'Đã chọn 1/2',
    message: 'Cần chọn thêm 1 người.',
    tone: 'warning',
  });

  assert.deepEqual(getVoteStatus({ selectedCount: 2, requiredCount: 2, voted: false }), {
    canSubmit: true,
    label: 'Đã chọn 2/2',
    message: 'Sẵn sàng gửi bình chọn.',
    tone: 'ready',
  });

  assert.deepEqual(getVoteStatus({ selectedCount: 2, requiredCount: 2, voted: true }), {
    canSubmit: false,
    label: 'Đã gửi',
    message: 'Bình chọn của bạn đã được ghi nhận.',
    tone: 'done',
  });
});

test('admin primary action changes with phase and room state', () => {
  assert.deepEqual(getAdminPrimaryAction({ roomCode: null, phase: 'setup', playerCount: 0 }), {
    action: 'create-room',
    buttonId: null,
    enabled: true,
    hint: 'Tạo mã phòng để người chơi bắt đầu tham gia.',
    label: 'Tạo phòng',
    tone: 'primary',
  });

  assert.deepEqual(getAdminPrimaryAction({ roomCode: 'SPY-2026', phase: 'lobby', playerCount: 4, spyPoolRemaining: 4 }), {
    action: 'start-round',
    buttonId: 'start-round-button',
    enabled: true,
    hint: 'Kiểm tra số Gián điệp và từ khóa trước khi bắt đầu.',
    label: 'Bắt đầu vòng',
    tone: 'primary',
  });

  assert.deepEqual(getAdminPrimaryAction({ roomCode: 'SPY-2026', phase: 'summary', playerCount: 4, spyPoolRemaining: 3 }), {
    action: 'open-vote',
    buttonId: 'open-vote-button',
    enabled: true,
    hint: 'Mọi mô tả đã khóa. Mở bình chọn khi cả nhóm đã đọc xong.',
    label: 'Mở vote',
    tone: 'primary',
  });

  assert.deepEqual(getAdminPrimaryAction({ roomCode: 'SPY-2026', phase: 'result', playerCount: 4, spyPoolRemaining: 0 }), {
    action: 'end-game',
    buttonId: 'end-game-button',
    enabled: true,
    hint: 'Pool Gián điệp đã hết. Tổng kết để xem bục vinh danh.',
    label: 'Tổng kết game',
    tone: 'success',
  });
});
