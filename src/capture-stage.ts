/**
 * Contextual handle containing configuration and active pipelines for the Stage application context.
 */
export function captureStage(): { destroy: () => void } {
  // ============================================================================
  // Types & Interfaces
  // ============================================================================

  interface SvgIcons {
    readonly playerPlay: string;
    readonly playerPause: string;
    readonly volume: string;
    readonly volume2: string;
    readonly volumeOff: string;
    readonly fullscreenEnter: string;
    readonly fullscreenExit: string;
    readonly plug: string;
    readonly plugX: string;
  }

  interface AllowedSource {
    readonly match: RegExp;
    readonly name: string;
  }

  interface Layout {
    readonly id: string;
    readonly label: string;
    readonly slots: number;
    readonly heightRatio?: readonly [number, number];
  }

  interface DeviceGroupInfo {
    readonly groupId: string;
    readonly audioDevice: MediaDeviceInfo | null;
  }

  interface SlotInstance {
    readonly number: number;
    readonly playerEl: HTMLElement;
    readonly video: HTMLVideoElement;
    readonly noSignal: HTMLElement;
    readonly controls: HTMLElement;
    readonly playBtn: HTMLButtonElement;
    readonly muteBtn: HTMLButtonElement;
    readonly volumeSlider: HTMLInputElement;
    readonly volumeLabel: HTMLElement;
    readonly fullscreenBtn: HTMLButtonElement;
    readonly dropdownWrap: HTMLElement;
    readonly dropdownTrigger: HTMLButtonElement;
    readonly dropdownLabel: HTMLElement;
    readonly dropdownList: HTMLUListElement;
    readonly connectBtn: HTMLButtonElement;
    readonly playIconWrap: HTMLElement | null;
    readonly muteIconWrap: HTMLElement | null;
    readonly connectIconWrap: HTMLElement | null;
    readonly fullscreenIconWrap: HTMLElement | null;
    activeStream: MediaStream | null;
    activeDeviceId: string | null;
    isFullscreen: boolean;
    hideTimer: ReturnType<typeof setTimeout> | null;
    applyVolume: (level: number) => void;
    toggleFullscreen: () => void;
    selectDropdownOption: (option: HTMLButtonElement) => void;
    setConnectBtnMode: (mode: 'connect' | 'disconnect') => void;
    connectDevice: () => Promise<void>;
    disconnectDevice: () => void;
  }

  // ============================================================================
  // Constants & Configuration
  // ============================================================================

  const SVG_ICONS: SvgIcons = {
    playerPlay: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-player-play" />`,
    playerPause: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-player-pause" />`,
    volume: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-volume" />`,
    volume2: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-volume2" />`,
    volumeOff: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-volume-off" />`,
    fullscreenEnter: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-fullscreen-enter" />`,
    fullscreenExit: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-fullscreen-exit" />`,
    plug: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-plug" />`,
    plugX: `<use href="${import.meta.env.BASE_URL}icons.svg#icon-plug-x" />`,
  };

  const ALLOWED_SOURCES: readonly AllowedSource[] = [
    { match: /usb video/i, name: 'Telecable' },
    { match: /live gamer mini/i, name: 'Switch 2' },
  ];

  const LAYOUTS: readonly Layout[] = [
    { id: 'single', label: 'Single source', slots: 1 },
    { id: '50-50', label: 'Side by side — 50/50', slots: 2, heightRatio: [1, 1] },
    { id: '70-30', label: 'Side by side — 70/30', slots: 2, heightRatio: [7, 3] },
    { id: '30-70', label: 'Side by side — 30/70', slots: 2, heightRatio: [3, 7] },
  ];

  const HIDE_DELAY_MS = 2500;
  const SINGLE_SOURCE_FACTOR = 1;
  const DUAL_SOURCE_FACTOR = 0.7;
  const ASPECT_RATIO_FACTOR = 16 / 9;

  // ============================================================================
  // State Registries & Context Listeners Cleaner
  // ============================================================================

  const slotRegistry: SlotInstance[] = [];
  let deviceGroupMap: Record<string, DeviceGroupInfo> = {};
  const abortController = new AbortController();
  const { signal } = abortController;

  // ============================================================================
  // Helper Utilities for Safe DOM Extraction
  // ============================================================================

  /**
   * Securely queries an element from the document object model, crashing cleanly if not matched.
   * @throws {Error} Contextual selector target verification validation failure.
   */
  function queryElement<T extends HTMLElement = HTMLElement>(selector: string, context: ParentNode = document): T {
    const el = context.querySelector(selector);
    if (!el) {
      throw new Error(`Required element missing for selector: "${selector}"`);
    }
    return el as T;
  }

  // ============================================================================
  // Loudness Management Functions
  // ============================================================================

  /**
   * Calculates the target loudness compression dampening coefficient factor based on active outputs.
   */
  function loudnessFactor(): number {
    const activeAudioSlots = slotRegistry.filter((s) => s.activeStream && !s.video.muted).length;
    return activeAudioSlots >= 2 ? DUAL_SOURCE_FACTOR : SINGLE_SOURCE_FACTOR;
  }

  /**
   * Refreshes sound output matrices globally to match target relative volume constraints.
   */
  function applyLoudnessCompensation(): void {
    slotRegistry.forEach((slot) => {
      const level = Number.parseInt(slot.volumeSlider.value, 10) || 0;
      slot.applyVolume(level);
    });
  }

  // ============================================================================
  // Slot Core Factory Engine
  // ============================================================================

  /**
   * Instantiates functional layout control abstractions over a viewport capture slot node tree.
   */
  function createSlot(slotNumber: number): SlotInstance {
    const playerEl = queryElement(`.player[data-slot="${slotNumber}"]`);
    const sourceRow = queryElement(`[data-role="slot-${slotNumber}-row"]`);
    const dropdownWrap = queryElement(`[data-role="device-dropdown"][data-slot="${slotNumber}"]`, sourceRow);
    const connectBtn = queryElement<HTMLButtonElement>(`[data-role="connect-btn"][data-slot="${slotNumber}"]`, sourceRow);

    const playBtn = queryElement<HTMLButtonElement>('[data-role="play-btn"]', playerEl);
    const muteBtn = queryElement<HTMLButtonElement>('[data-role="mute-btn"]', playerEl);
    const fullscreenBtn = queryElement<HTMLButtonElement>('[data-role="fullscreen-btn"]', playerEl);

    const slot: SlotInstance = {
      number: slotNumber,
      playerEl,
      video: queryElement<HTMLVideoElement>('.player__video', playerEl),
      noSignal: queryElement('.player__no-signal', playerEl),
      controls: queryElement('.player__controls', playerEl),
      playBtn,
      muteBtn,
      volumeSlider: queryElement<HTMLInputElement>('[data-role="volume-slider"]', playerEl),
      volumeLabel: queryElement('[data-role="volume-label"]', playerEl),
      fullscreenBtn,

      dropdownWrap,
      dropdownTrigger: queryElement<HTMLButtonElement>('.dropdown__trigger', dropdownWrap),
      dropdownLabel: queryElement('.dropdown__trigger-label', dropdownWrap),
      dropdownList: queryElement<HTMLUListElement>('.dropdown__list', dropdownWrap),
      connectBtn,

      // Cache icon elements to avoid repeated querying inside pathways
      playIconWrap: playBtn.querySelector('.icon'),
      muteIconWrap: muteBtn.querySelector('.icon'),
      connectIconWrap: connectBtn.querySelector('.icon'),
      fullscreenIconWrap: fullscreenBtn.querySelector('.icon'),

      activeStream: null,
      activeDeviceId: null,
      isFullscreen: false,
      hideTimer: null,

      applyVolume: () => {},
      toggleFullscreen: () => {},
      selectDropdownOption: () => {},
      setConnectBtnMode: () => {},
      connectDevice: async () => {},
      disconnectDevice: () => {},
    };

    const storageKey = `captureVol_slot${slotNumber}`;

    function updateVolumeIcon(level: number, muted: boolean): void {
      if (!slot.muteIconWrap) return;
      if (muted || level === 0) {
        slot.muteIconWrap.innerHTML = SVG_ICONS.volumeOff;
      } else if (level < 40) {
        slot.muteIconWrap.innerHTML = SVG_ICONS.volume2;
      } else {
        slot.muteIconWrap.innerHTML = SVG_ICONS.volume;
      }
    }

    function applyVolume(level: number): void {
      slot.video.volume = (level / 100) * loudnessFactor();
      slot.volumeSlider.value = level.toString();
      slot.volumeLabel.textContent = `${level}%`;
      updateVolumeIcon(level, slot.video.muted);
    }
    slot.applyVolume = applyVolume;

    const savedVolume = Number.parseInt(localStorage.getItem(storageKey) ?? '100', 10);
    applyVolume(savedVolume);

    slot.volumeSlider.addEventListener('input', () => {
      const level = Number.parseInt(slot.volumeSlider.value, 10) || 0;
      slot.video.muted = false;
      applyVolume(level);
      localStorage.setItem(storageKey, level.toString());
    });

    slot.muteBtn.addEventListener('click', () => {
      slot.video.muted = !slot.video.muted;
      const level = Number.parseInt(slot.volumeSlider.value, 10) || 0;
      updateVolumeIcon(level, slot.video.muted);
      slot.volumeLabel.textContent = slot.video.muted ? '0%' : `${level}%`;
      applyLoudnessCompensation();
    });

    function showControls(): void {
      slot.controls.classList.add('player__controls--visible');
      slot.playerEl.classList.remove('player--cursor-hidden');
    }

    function hideControls(): void {
      if (slot.playerEl.classList.contains('player--paused')) return;
      slot.controls.classList.remove('player__controls--visible');
      slot.playerEl.classList.add('player--cursor-hidden');
    }

    function resetHideTimer(): void {
      showControls();
      if (slot.hideTimer) clearTimeout(slot.hideTimer);
      slot.hideTimer = setTimeout(hideControls, HIDE_DELAY_MS);
    }

    slot.playerEl.addEventListener('mousemove', resetHideTimer);
    slot.controls.addEventListener('mouseenter', () => {
      if (slot.hideTimer) clearTimeout(slot.hideTimer);
    });
    slot.controls.addEventListener('mouseleave', resetHideTimer);
    slot.playerEl.addEventListener('mouseleave', () => {
      if (slot.hideTimer) clearTimeout(slot.hideTimer);
      slot.hideTimer = setTimeout(hideControls, HIDE_DELAY_MS);
    });

    slot.playBtn.addEventListener('click', () => {
      if (!slot.video.srcObject) return;
      if (slot.video.paused) {
        slot.video.play().catch(console.error);
      } else {
        slot.video.pause();
      }
    });

    slot.video.addEventListener('play', () => {
      if (slot.playIconWrap) slot.playIconWrap.innerHTML = SVG_ICONS.playerPause;
      slot.playerEl.classList.remove('player--paused');
      resetHideTimer();
    });

    slot.video.addEventListener('pause', () => {
      if (slot.playIconWrap) slot.playIconWrap.innerHTML = SVG_ICONS.playerPlay;
      slot.playerEl.classList.add('player--paused');
      showControls();
      if (slot.hideTimer) clearTimeout(slot.hideTimer);
    });

    function enterFullscreen(): void {
      const player = slot.playerEl;
      if (player.requestFullscreen) {
        player.requestFullscreen().catch(console.error);
      } else if ((player as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
        (player as HTMLElement & { webkitRequestFullscreen(): Promise<void> }).webkitRequestFullscreen().catch(console.error);
      }
      slot.isFullscreen = true;
      if (slot.fullscreenIconWrap) slot.fullscreenIconWrap.innerHTML = SVG_ICONS.fullscreenExit;
    }

    function exitFullscreen(): void {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(console.error);
      } else if ((document as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen) {
        (document as Document & { webkitExitFullscreen(): Promise<void> }).webkitExitFullscreen().catch(console.error);
      }
      slot.isFullscreen = false;
      if (slot.fullscreenIconWrap) slot.fullscreenIconWrap.innerHTML = SVG_ICONS.fullscreenEnter;
    }

    function toggleFullscreen(): void {
      slot.isFullscreen ? exitFullscreen() : enterFullscreen();
    }
    slot.toggleFullscreen = toggleFullscreen;

    slot.fullscreenBtn.addEventListener('click', toggleFullscreen);
    slot.playerEl.addEventListener('dblclick', toggleFullscreen);

    function openDropdown(): void {
      slot.dropdownWrap.classList.add('dropdown--open');
      slot.dropdownWrap.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown(): void {
      slot.dropdownWrap.classList.remove('dropdown--open');
      slot.dropdownWrap.setAttribute('aria-expanded', 'false');
    }

    function toggleDropdown(): void {
      slot.dropdownWrap.classList.contains('dropdown--open') ? closeDropdown() : openDropdown();
    }

    slot.dropdownTrigger.addEventListener('click', toggleDropdown);

    slot.dropdownWrap.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDropdown();
        slot.dropdownTrigger.focus();
      }
    });

    function selectDropdownOption(option: HTMLButtonElement): void {
      const value = option.dataset.value ?? '';
      const label = option.textContent ?? '';

      slot.dropdownList.querySelectorAll('.dropdown__option').forEach((opt) => {
        const matching = opt === option;
        opt.classList.toggle('dropdown__option--selected', matching);
        opt.setAttribute('aria-selected', matching ? 'true' : 'false');
      });

      slot.dropdownLabel.textContent = label;
      slot.dropdownWrap.dataset.value = value;
      closeDropdown();
      slot.dropdownTrigger.focus();

      if (slot.activeDeviceId) {
        setConnectBtnMode(value === slot.activeDeviceId ? 'disconnect' : 'connect');
      }
    }
    slot.selectDropdownOption = selectDropdownOption;

    function setConnectBtnMode(mode: 'connect' | 'disconnect'): void {
      const label = slot.connectBtn.querySelector('.connect-btn__label');
      if (slot.connectIconWrap) slot.connectIconWrap.innerHTML = mode === 'disconnect' ? SVG_ICONS.plugX : SVG_ICONS.plug;
      if (label) label.textContent = mode === 'disconnect' ? 'Disconnect' : 'Connect';
    }
    slot.setConnectBtnMode = setConnectBtnMode;

    async function connectDevice(): Promise<void> {
      const deviceId = slot.dropdownWrap.dataset.value ?? '';
      if (!deviceId) return;

      if (deviceId === slot.activeDeviceId) {
        disconnectDevice();
        return;
      }

      if (slot.activeStream) {
        slot.activeStream.getTracks().forEach((track) => track.stop());
        slot.activeStream = null;
      }

      const deviceInfo: DeviceGroupInfo | undefined = deviceGroupMap[deviceId];
      let audioConstraints: MediaTrackConstraints | boolean = true;

      const baseAudioSettings = {
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      if (deviceInfo) {
        if (deviceInfo.audioDevice) {
          audioConstraints = { ...baseAudioSettings, deviceId: { exact: deviceInfo.audioDevice.deviceId } };
        } else if (deviceInfo.groupId) {
          audioConstraints = { ...baseAudioSettings, groupId: deviceInfo.groupId };
        }
      }

      try {
        slot.activeStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
          audio: audioConstraints,
        });

        slot.video.srcObject = slot.activeStream;
        applyVolume(Number.parseInt(slot.volumeSlider.value, 10) || 0);
        await slot.video.play();

        slot.activeDeviceId = deviceId;
        slot.noSignal.style.display = 'none';
        setConnectBtnMode('disconnect');
        applyLoudnessCompensation();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        alert(`Could not connect (slot ${slot.number}): ${msg}`);
        console.error(error);
      }
    }

    function disconnectDevice(): void {
      if (slot.activeStream) {
        slot.activeStream.getTracks().forEach((track) => track.stop());
        slot.activeStream = null;
      }

      slot.video.srcObject = null;
      slot.activeDeviceId = null;
      slot.noSignal.style.display = 'flex';
      slot.playerEl.classList.add('player--paused');
      showControls();
      if (slot.hideTimer) clearTimeout(slot.hideTimer);
      setConnectBtnMode('connect');
      applyLoudnessCompensation();
    }

    slot.connectDevice = connectDevice;
    slot.disconnectDevice = disconnectDevice;
    slot.connectBtn.addEventListener('click', () => {
      connectDevice().catch(console.error);
    });

    slotRegistry.push(slot);
    return slot;
  }

  const slot1 = createSlot(1);
  const slot2 = createSlot(2);
  const slots = slotRegistry;

  // ============================================================================
  // Device Enumeration Setup Engine
  // ============================================================================

  /**
   * Refreshes local peripheral access mappings securely.
   */
  async function enumerateDevices(): Promise<void> {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      tempStream.getTracks().forEach((track) => track.stop());
    } catch (permissionError) {
      const msg = permissionError instanceof Error ? permissionError.message : String(permissionError);
      console.info('Camera/microphone permission denied or unavailable:', msg);
    }

    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
    const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');

    const audioByGroup: Record<string, MediaDeviceInfo> = {};
    audioInputs.forEach((audio) => {
      if (audio.groupId) audioByGroup[audio.groupId] = audio;
    });

    const usbAudioDevice = audioInputs.find((a) => /digital audio interface.*usb digital audio/i.test(a.label));

    deviceGroupMap = {};
    videoInputs.forEach((v) => {
      const isUsbVideo = /usb video/i.test(v.label);
      deviceGroupMap[v.deviceId] = {
        groupId: v.groupId,
        audioDevice: isUsbVideo && usbAudioDevice ? usbAudioDevice : audioByGroup[v.groupId] || null,
      };
    });

    slots.forEach((slot) => rebuildSlotDropdown(slot, videoInputs));
  }

  function rebuildSlotDropdown(slot: SlotInstance, videoInputs: MediaDeviceInfo[]): void {
    const previousValue = slot.dropdownWrap.dataset.value ?? '';
    slot.dropdownList.innerHTML = '';
    let foundAny = false;

    ALLOWED_SOURCES.forEach(({ match, name }) => {
      const found = videoInputs.find((v) => match.test(v.label));
      if (!found) return;

      foundAny = true;

      const listItem = document.createElement('li');
      listItem.className = 'dropdown__item';

      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'dropdown__option';
      option.dataset.value = found.deviceId;
      option.textContent = name;

      if (found.deviceId === previousValue) {
        option.classList.add('dropdown__option--selected');
        option.setAttribute('aria-selected', 'true');
        slot.dropdownLabel.textContent = name;
        slot.dropdownWrap.dataset.value = found.deviceId;
      } else {
        option.setAttribute('aria-selected', 'false');
      }

      option.addEventListener('click', () => slot.selectDropdownOption(option));
      listItem.appendChild(option);
      slot.dropdownList.appendChild(listItem);
    });

    if (!foundAny) {
      const listItem = document.createElement('li');
      listItem.className = 'dropdown__item';

      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'dropdown__option dropdown__option--empty';
      empty.disabled = true;
      empty.textContent = 'No capture devices found';

      listItem.appendChild(empty);
      slot.dropdownList.appendChild(listItem);
    }
  }

  // ============================================================================
  // Layout Management Engine & Sizing Calculations
  // ============================================================================

  const stage = queryElement('[data-role="stage"]');
  const slot2Row = queryElement('[data-role="slot-2-row"]');
  const layoutDropdownWrap = queryElement('[data-role="layout-dropdown"]');
  const layoutTrigger = queryElement<HTMLButtonElement>('[data-role="layout-trigger"]');
  const layoutTriggerLabel = queryElement('[data-role="layout-trigger-label"]');
  const layoutList = queryElement<HTMLUListElement>('[data-role="layout-list"]');

  const STAGE_GAP_PX = 8;
  const VERTICAL_CHROME = 140;

  /**
   * Evaluates layout boundary thresholds dynamically to scale viewport targets smoothly.
   */
  function fitStageHeight(layout: Layout): void {
    const availableHeight = window.innerHeight - VERTICAL_CHROME;
    const parent = stage.parentElement;
    if (!parent) return;
    const availableWidth = parent.clientWidth;

    if (layout.slots === 1) {
      const heightFromWidth = availableWidth / ASPECT_RATIO_FACTOR;
      slot1.playerEl.style.height = `${Math.min(availableHeight, heightFromWidth)}px`;
      return;
    }

    if (layout.heightRatio) {
      const [ratio1, ratio2] = layout.heightRatio;
      const combinedRatio = ratio1 + ratio2;
      const heightFromWidth = (availableWidth - STAGE_GAP_PX) / (combinedRatio * ASPECT_RATIO_FACTOR);

      const heightFromHeight = availableHeight / Math.max(ratio1, ratio2);
      const unitHeight = Math.min(heightFromWidth, heightFromHeight);

      slot1.playerEl.style.height = `${unitHeight * ratio1}px`;
      slot2.playerEl.style.height = `${unitHeight * ratio2}px`;
    }
  }

  /**
   * Applies target viewport arrangements onto elements.
   */
  function applyLayout(layoutId: string): void {
    const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0];

    stage.dataset.layout = layout.id;
    layoutTriggerLabel.textContent = layout.label;

    const dualSlots = layout.slots === 2;
    slot2Row.classList.toggle('toolbar__source-row--hidden', !dualSlots);
    slot2.playerEl.classList.toggle('player--hidden', !dualSlots);

    const isSplit7030 = layout.id === '70-30';
    const isSplit3070 = layout.id === '30-70';

    slot1.playerEl.classList.toggle('player--narrow', isSplit3070);
    slot2.playerEl.classList.toggle('player--narrow', isSplit7030);

    if (!isSplit7030 && !isSplit3070) {
      slot1.playerEl.classList.remove('player--narrow');
      slot2.playerEl.classList.remove('player--narrow');
    }

    if (layout.slots === 1 && slot2.activeDeviceId) {
      slot2.disconnectDevice();
    }

    fitStageHeight(layout);
  }

  function openLayoutDropdown(): void {
    layoutDropdownWrap.classList.add('dropdown--open');
    layoutDropdownWrap.setAttribute('aria-expanded', 'true');
  }

  function closeLayoutDropdown(): void {
    layoutDropdownWrap.classList.remove('dropdown--open');
    layoutDropdownWrap.setAttribute('aria-expanded', 'false');
  }

  function toggleLayoutDropdown(): void {
    layoutDropdownWrap.classList.contains('dropdown--open') ? closeLayoutDropdown() : openLayoutDropdown();
  }

  function buildLayoutList(): void {
    layoutList.innerHTML = '';
    LAYOUTS.forEach((layout) => {
      const listItem = document.createElement('li');
      listItem.className = 'dropdown__item';

      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'dropdown__option';
      option.dataset.id = layout.id;
      option.textContent = layout.label;

      const isSelected = layout.id === stage.dataset.layout;
      option.classList.toggle('dropdown__option--selected', isSelected);
      option.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      option.addEventListener('click', () => {
        layoutList.querySelectorAll('.dropdown__option').forEach((opt) => {
          const matching = opt === option;
          opt.classList.toggle('dropdown__option--selected', matching);
          opt.setAttribute('aria-selected', matching ? 'true' : 'false');
        });
        applyLayout(layout.id);
        closeLayoutDropdown();
        layoutTrigger.focus();
      });

      listItem.appendChild(option);
      layoutList.appendChild(listItem);
    });
  }

  layoutTrigger.addEventListener('click', toggleLayoutDropdown);

  layoutDropdownWrap.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeLayoutDropdown();
      layoutTrigger.focus();
    }
  });

  // ============================================================================
  // Global Shared Observers (Cleanly Bound & Tracked via Signal)
  // ============================================================================

  window.addEventListener(
    'resize',
    () => {
      const current = LAYOUTS.find((l) => l.id === stage.dataset.layout) ?? LAYOUTS[0];
      fitStageHeight(current);
    },
    { signal },
  );

  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!layoutDropdownWrap.contains(target)) closeLayoutDropdown();
      slots.forEach((slot) => {
        if (!slot.dropdownWrap.contains(target)) {
          slot.dropdownWrap.classList.remove('dropdown--open');
          slot.dropdownWrap.setAttribute('aria-expanded', 'false');
        }
      });
    },
    { signal },
  );

  document.addEventListener(
    'fullscreenchange',
    () => {
      const currentFullscreenElement = document.fullscreenElement;
      slots.forEach((slot) => {
        if (!currentFullscreenElement && slot.isFullscreen) {
          slot.isFullscreen = false;
          if (slot.fullscreenIconWrap) slot.fullscreenIconWrap.innerHTML = SVG_ICONS.fullscreenEnter;
        }
      });
    },
    { signal },
  );

  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const slot = slots.find((s) => s.isFullscreen) ?? slot1;
      const keyLower = e.key.toLowerCase();

      if (keyLower === 'f') {
        e.preventDefault();
        slot.toggleFullscreen();
      } else if (keyLower === 'm') {
        e.preventDefault();
        slot.muteBtn.click();
      }
    },
    { signal },
  );

  navigator.mediaDevices.addEventListener(
    'devicechange',
    () => {
      enumerateDevices().catch(console.error);
    },
    { signal },
  );

  // Initialize view states
  buildLayoutList();
  applyLayout('single');
  enumerateDevices().catch(console.error);

  /**
   * Destroys active tracks, clears hardware interfaces, and unbinds event hooks.
   */
  return {
    destroy: () => {
      abortController.abort();
      slots.forEach((slot) => {
        if (slot.hideTimer) clearTimeout(slot.hideTimer);
        if (slot.activeStream) {
          slot.activeStream.getTracks().forEach((track) => track.stop());
        }
      });
      slotRegistry.length = 0;
    },
  };
}
