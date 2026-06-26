(function initSpyGameUiState(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SpyGameUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function buildSpyGameUiState() {
  const playerScreens = {
    description: 'screen-description',
    summary: 'screen-summary',
    voting: 'screen-vote',
    result: 'screen-result',
    gameOver: 'screen-podium',
  };

  const phaseLabels = {
    setup: 'Chưa tạo phòng',
    lobby: 'Phòng chờ',
    description: 'Đang mô tả',
    summary: 'Bảng mô tả',
    voting: 'Đang vote',
    result: 'Kết quả',
    gameOver: 'Tổng kết',
  };

  function getPlayerScreenId(playerState) {
    if (!playerState?.player) return 'screen-lobby';
    return playerScreens[playerState.phase] || 'screen-waiting';
  }

  function getVoteStatus({ selectedCount = 0, requiredCount = 0, voted = false } = {}) {
    const selected = Number(selectedCount) || 0;
    const required = Number(requiredCount) || 0;

    if (voted) {
      return {
        canSubmit: false,
        label: 'Đã gửi',
        message: 'Bình chọn của bạn đã được ghi nhận.',
        tone: 'done',
      };
    }

    if (required <= 0) {
      return {
        canSubmit: false,
        label: 'Chưa mở',
        message: 'Chờ quản trò mở danh sách bình chọn.',
        tone: 'neutral',
      };
    }

    if (selected === required) {
      return {
        canSubmit: true,
        label: `Đã chọn ${selected}/${required}`,
        message: 'Sẵn sàng gửi bình chọn.',
        tone: 'ready',
      };
    }

    if (selected > required) {
      return {
        canSubmit: false,
        label: `Đã chọn ${selected}/${required}`,
        message: `Bỏ bớt ${selected - required} người.`,
        tone: 'warning',
      };
    }

    return {
      canSubmit: false,
      label: `Đã chọn ${selected}/${required}`,
      message: selected === 0 ? `Chọn đúng ${required} người nghi là Gián điệp.` : `Cần chọn thêm ${required - selected} người.`,
      tone: selected === 0 ? 'neutral' : 'warning',
    };
  }

  function getAdminPrimaryAction(state = {}) {
    const phase = state.phase || 'setup';
    const hasRoom = Boolean(state.roomCode);
    const playerCount = Number(state.playerCount) || 0;
    const spyPoolRemaining = Number(state.spyPoolRemaining) || 0;

    if (!hasRoom || phase === 'setup') {
      return {
        action: 'create-room',
        buttonId: null,
        enabled: true,
        hint: 'Tạo mã phòng để người chơi bắt đầu tham gia.',
        label: 'Tạo phòng',
        tone: 'primary',
      };
    }

    if (phase === 'lobby') {
      return {
        action: 'start-round',
        buttonId: 'start-round-button',
        enabled: playerCount > 0 && spyPoolRemaining > 0,
        hint: playerCount > 0 ? 'Kiểm tra số Gián điệp và từ khóa trước khi bắt đầu.' : 'Chờ người chơi vào phòng.',
        label: 'Bắt đầu vòng',
        tone: 'primary',
      };
    }

    if (phase === 'description') {
      return {
        action: 'force-description-end',
        buttonId: 'force-description-button',
        enabled: true,
        hint: 'Khóa mô tả khi đã đủ lượt hoặc hết thời gian thảo luận.',
        label: 'Khóa mô tả',
        tone: 'warning',
      };
    }

    if (phase === 'summary') {
      return {
        action: 'open-vote',
        buttonId: 'open-vote-button',
        enabled: true,
        hint: 'Mọi mô tả đã khóa. Mở bình chọn khi cả nhóm đã đọc xong.',
        label: 'Mở vote',
        tone: 'primary',
      };
    }

    if (phase === 'voting') {
      return {
        action: 'force-vote-end',
        buttonId: 'force-vote-button',
        enabled: true,
        hint: 'Khóa vote khi mọi người đã gửi bình chọn hoặc hết thời gian.',
        label: 'Khóa vote',
        tone: 'warning',
      };
    }

    if (phase === 'result') {
      const canContinue = spyPoolRemaining > 0;
      return {
        action: canContinue ? 'next-round' : 'end-game',
        buttonId: canContinue ? 'next-round-button' : 'end-game-button',
        enabled: true,
        hint: canContinue ? 'Xem xong kết quả thì chuyển sang vòng mới.' : 'Pool Gián điệp đã hết. Tổng kết để xem bục vinh danh.',
        label: canContinue ? 'Sang vòng mới' : 'Tổng kết game',
        tone: canContinue ? 'primary' : 'success',
      };
    }

    return {
      action: 'reset-game',
      buttonId: 'reset-button',
      enabled: true,
      hint: 'Game đã tổng kết. Reset khi muốn tạo lượt chơi mới.',
      label: 'Reset game',
      tone: 'danger',
    };
  }

  function getPhaseLabel(phase) {
    return phaseLabels[phase] || phase || '--';
  }

  function getPhaseSteps(activePhase) {
    const order = ['lobby', 'description', 'summary', 'voting', 'result'];
    const activeIndex = order.indexOf(activePhase);
    return order.map((phase, index) => ({
      active: phase === activePhase,
      complete: activeIndex > index,
      key: phase,
      label: getPhaseLabel(phase),
    }));
  }

  return {
    getAdminPrimaryAction,
    getPhaseLabel,
    getPhaseSteps,
    getPlayerScreenId,
    getVoteStatus,
  };
});
