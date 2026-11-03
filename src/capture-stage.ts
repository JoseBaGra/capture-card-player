/**
 * Initializes the capture stage controls and media-device listeners.
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
    isConnecting: boolean;
    connectionRequestId: number;
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
  const VOLUME_STEP = 5;
  const DEFAULT_UNMUTE_VOLUME = 20;

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
   * Finds a required element within a parent node.
   * @throws {Error} If no element matches the selector.
   */
  function queryElement<T extends HTMLElement = HTMLElement>(selector: string, context: ParentNode = document): T {
    const el = context.querySelector(selector);
    if (!el) {
      throw new Error(`Required element missing for selector: "${selector}"`);
    }
    return el as T;
  }

  /**
   * Synchronizes a dropdown's open styling and accessibility state.
   */
  function setDropdownOpen(dropdown: HTMLElement, isOpen: boolean): void {
    dropdown.classList.toggle('dropdown--open', isOpen);
    dropdown.setAttribute('aria-expanded', String(isOpen));
  }

  /**
   * Creates and appends a dropdown option.
   */
  function addDropdownOption(
    list: HTMLUListElement,
    label: string,
    options: { value?: string; id?: string; disabled?: boolean; selected?: boolean; className?: string } = {},
  ): HTMLButtonElement {
    const listItem = document.createElement('li');
    listItem.className = 'dropdown__item';

    const option = document.createElement('button');
    option.type = 'button';
    option.className = `dropdown__option${options.className ? ` ${options.className}` : ''}`;
    option.textContent = label;
    option.disabled = options.disabled ?? false;
    if (options.value !== undefined) option.dataset.value = options.value;
    if (options.id !== undefined) option.dataset.id = options.id;
    option.classList.toggle('dropdown__option--selected', options.selected ?? false);
    option.setAttribute('aria-selected', String(options.selected ?? false));

    listItem.appendChild(option);
    list.appendChild(listItem);
    return option;
  }

  /**
   * Updates selected styling and ARIA state for the options in a dropdown.
   */
  function setSelectedDropdownOption(list: HTMLUListElement, selected: HTMLButtonElement | null): void {
    list.querySelectorAll<HTMLButtonElement>('.dropdown__option').forEach((option) => {
      const isSelected = option === selected;
      option.classList.toggle('dropdown__option--selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
  }

  /**
   * Reads a slot's current slider volume as a safe non-negative integer.
   */
  function getSliderVolume(slot: SlotInstance): number {
    return Number.parseInt(slot.volumeSlider.value, 10) || 0;
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
    slotRegistry.forEach((slot) => slot.applyVolume(getSliderVolume(slot)));
  }

  // ============================================================================
  // Slot Focus Resolution (keyboard shortcuts must target the focused player)
  // ============================================================================

  /**
   * Resolves which capture slot (of the two players) currently owns keyboard focus.
   * don't hijack keystrokes meant for other controls on the page.
   */
  function slotFromFocus(): SlotInstance | undefined {
    const active = document.activeElement;
    if (!(active instanceof Node)) return undefined;
    return slotRegistry.find((s) => s.playerEl.contains(active));
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

    // Make the player focusable so keyboard shortcuts (f/m/arrows) can be
    // scoped to "whichever of the two players the user is currently on".
    if (!playerEl.hasAttribute('tabindex')) {
      playerEl.tabIndex = 0;
    }

    const slot: SlotInstance = {
      number: slotNumber,
      playerEl,
      video: queryElement<HTMLVideoElement>('.player__video', playerEl),
      noSignal: queryElement('.player__no-signal', playerEl),
      controls: queryElement('.player__controls', playerEl),
      playBtn,
      muteBtn,
      volumeSlider: queryElement<HTMLInputElement>('[data-role="volume-slider"]', playerEl),
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
      isConnecting: false,
      connectionRequestId: 0,
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

    /**
     * Updates the mute icon to reflect the current volume and mute state.
     */
    function updateVolumeIcon(level: number, muted: boolean): void {
      if (!slot.muteIconWrap) return;
      if (muted) {
        slot.muteIconWrap.innerHTML = SVG_ICONS.volumeOff;
      } else if (level < 40) {
        slot.muteIconWrap.innerHTML = SVG_ICONS.volume2;
      } else {
        slot.muteIconWrap.innerHTML = SVG_ICONS.volume;
      }
    }

    /**
     * Applies a slider level to the video element and refreshes its volume UI.
     */
    function applyVolume(level: number): void {
      slot.video.volume = (level / 100) * loudnessFactor();
      slot.volumeSlider.value = level.toString();
      updateVolumeIcon(level, slot.video.muted);
    }
    slot.applyVolume = applyVolume;

    const savedVolume = Number.parseInt(localStorage.getItem(storageKey) ?? '100', 10);
    if (savedVolume === 0) slot.video.muted = true;
    applyVolume(savedVolume);

    slot.volumeSlider.addEventListener(
      'input',
      () => {
        const level = getSliderVolume(slot);
        slot.video.muted = level === 0;
        applyVolume(level);
        localStorage.setItem(storageKey, level.toString());
      },
      { signal },
    );

    slot.muteBtn.addEventListener(
      'click',
      () => {
        slot.video.muted = !slot.video.muted;
        const level = getSliderVolume(slot);
        if (!slot.video.muted && level === 0) {
          applyVolume(DEFAULT_UNMUTE_VOLUME);
        } else {
          updateVolumeIcon(level, slot.video.muted);
        }
        applyLoudnessCompensation();
      },
      { signal },
    );

    /**
     * Makes the player controls visible and restores the cursor.
     */
    function showControls(): void {
      slot.controls.classList.add('player__controls--visible');
      slot.playerEl.classList.remove('player--cursor-hidden');
    }

    /**
     * Hides controls while playback is active.
     */
    function hideControls(): void {
      if (slot.playerEl.classList.contains('player--paused')) return;
      slot.controls.classList.remove('player__controls--visible');
      slot.playerEl.classList.add('player--cursor-hidden');
    }

    /**
     * Shows controls and schedules them to hide after the configured delay.
     */
    function resetHideTimer(): void {
      showControls();
      if (slot.hideTimer) clearTimeout(slot.hideTimer);
      slot.hideTimer = setTimeout(hideControls, HIDE_DELAY_MS);
    }

    slot.playerEl.addEventListener('mousemove', resetHideTimer, { signal });
    slot.controls.addEventListener(
      'mouseenter',
      () => {
        if (slot.hideTimer) clearTimeout(slot.hideTimer);
      },
      { signal },
    );
    slot.controls.addEventListener('mouseleave', resetHideTimer, { signal });
    slot.playerEl.addEventListener(
      'mouseleave',
      () => {
        if (slot.hideTimer) clearTimeout(slot.hideTimer);
        slot.hideTimer = setTimeout(hideControls, HIDE_DELAY_MS);
      },
      { signal },
    );

    slot.playerEl.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, input, a, [role="button"]')) return;
        slot.playerEl.focus();
      },
      { signal },
    );

    slot.playBtn.addEventListener(
      'click',
      () => {
        if (!slot.video.srcObject) return;
        if (slot.video.paused) {
          slot.video.play().catch(console.error);
        } else {
          slot.video.pause();
        }
      },
      { signal },
    );

    slot.video.addEventListener(
      'play',
      () => {
        if (slot.playIconWrap) slot.playIconWrap.innerHTML = SVG_ICONS.playerPause;
        slot.playerEl.classList.remove('player--paused');
        resetHideTimer();
      },
      { signal },
    );

    slot.video.addEventListener(
      'pause',
      () => {
        if (slot.playIconWrap) slot.playIconWrap.innerHTML = SVG_ICONS.playerPlay;
        slot.playerEl.classList.add('player--paused');
        showControls();
        if (slot.hideTimer) clearTimeout(slot.hideTimer);
      },
      { signal },
    );

    /**
     * Requests fullscreen for this player and updates its fullscreen state.
     */
    function enterFullscreen(): void {
      const player = slot.playerEl;
      const requestFullscreen =
        player.requestFullscreen?.bind(player) ??
        (player as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(player);

      if (!requestFullscreen) return;

      requestFullscreen()
        .then(() => {
          slot.isFullscreen = true;
          slot.playerEl.classList.add('player--fullscreen');
          if (slot.fullscreenIconWrap) slot.fullscreenIconWrap.innerHTML = SVG_ICONS.fullscreenExit;
        })
        .catch(console.error);
    }

    /**
     * Exits fullscreen and restores this player's fullscreen state.
     */
    function exitFullscreen(): void {
      const exitFullscreen =
        document.exitFullscreen?.bind(document) ??
        (document as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen?.bind(document);

      if (!exitFullscreen) return;

      exitFullscreen()
        .then(() => {
          slot.isFullscreen = false;
          slot.playerEl.classList.remove('player--fullscreen');
          if (slot.fullscreenIconWrap) slot.fullscreenIconWrap.innerHTML = SVG_ICONS.fullscreenEnter;
        })
        .catch(console.error);
    }

    /**
     * Toggles this player between fullscreen and windowed mode.
     */
    function toggleFullscreen(): void {
      slot.isFullscreen ? exitFullscreen() : enterFullscreen();
    }
    slot.toggleFullscreen = toggleFullscreen;

    slot.fullscreenBtn.addEventListener('click', toggleFullscreen, { signal });
    slot.playerEl.addEventListener(
      'dblclick',
      function (event: MouseEvent) {
        const allowedNodes = ['VIDEO', 'DIV'];
        const target = event.target as Node | null;
        if (!target || !allowedNodes.includes(target.nodeName)) {
          return;
        }
        toggleFullscreen();
      },
      { signal },
    );

    /**
     * Opens the slot's source dropdown.
     */
    function openDropdown(): void {
      setDropdownOpen(slot.dropdownWrap, true);
    }

    /**
     * Closes the slot's source dropdown.
     */
    function closeDropdown(): void {
      setDropdownOpen(slot.dropdownWrap, false);
    }

    /**
     * Toggles the slot's source dropdown.
     */
    function toggleDropdown(): void {
      slot.dropdownWrap.classList.contains('dropdown--open') ? closeDropdown() : openDropdown();
    }

    slot.dropdownTrigger.addEventListener('click', toggleDropdown, { signal });

    slot.dropdownWrap.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeDropdown();
          slot.dropdownTrigger.focus();
        }
      },
      { signal },
    );

    /**
     * Selects a source and synchronizes the dropdown and connect button.
     */
    function selectDropdownOption(option: HTMLButtonElement): void {
      const value = option.dataset.value ?? '';
      const label = option.textContent ?? '';

      setSelectedDropdownOption(slot.dropdownList, option);

      slot.dropdownLabel.textContent = label;
      slot.dropdownWrap.dataset.value = value;
      closeDropdown();
      slot.dropdownTrigger.focus();

      setConnectBtnMode(slot.activeDeviceId ? (value === slot.activeDeviceId ? 'disconnect' : 'connect') : 'connect');
    }
    slot.selectDropdownOption = selectDropdownOption;

    /**
     * Sets the connect button label and icon for the requested mode.
     */
    function setConnectBtnMode(mode: 'connect' | 'disconnect'): void {
      const label = slot.connectBtn.querySelector('.connect-btn__label');
      if (slot.connectIconWrap) slot.connectIconWrap.innerHTML = mode === 'disconnect' ? SVG_ICONS.plugX : SVG_ICONS.plug;
      if (label) label.textContent = mode === 'disconnect' ? 'Disconnect' : 'Connect';
    }
    slot.setConnectBtnMode = setConnectBtnMode;

    /**
     * Connects this slot to its selected capture device.
     */
    async function connectDevice(): Promise<void> {
      const deviceId = slot.dropdownWrap.dataset.value ?? '';
      if (!deviceId || slot.isConnecting) return;

      if (deviceId === slot.activeDeviceId) {
        disconnectDevice();
        return;
      }

      slot.isConnecting = true;
      const requestId = ++slot.connectionRequestId;

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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
          audio: audioConstraints,
        });

        if (requestId !== slot.connectionRequestId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        slot.activeStream = stream;
        slot.video.srcObject = slot.activeStream;
        applyVolume(getSliderVolume(slot));
        await slot.video.play();

        if (requestId !== slot.connectionRequestId) return;
        slot.activeDeviceId = deviceId;
        slot.noSignal.style.display = 'none';
        setConnectBtnMode('disconnect');
        applyLoudnessCompensation();
      } catch (error) {
        if (requestId !== slot.connectionRequestId) return;

        if (slot.activeStream) {
          slot.activeStream.getTracks().forEach((track) => track.stop());
          slot.activeStream = null;
        }
        slot.video.srcObject = null;
        slot.activeDeviceId = null;
        slot.noSignal.style.display = 'flex';
        slot.playerEl.classList.add('player--paused');
        setConnectBtnMode('connect');

        const msg = error instanceof Error ? error.message : String(error);
        alert(`Could not connect (slot ${slot.number}): ${msg}`);
        console.error(error);
      } finally {
        if (requestId === slot.connectionRequestId) slot.isConnecting = false;
      }
    }

    /**
     * Stops this slot's capture tracks and restores its disconnected UI.
     */
    function disconnectDevice(): void {
      slot.connectionRequestId += 1;
      slot.isConnecting = false;

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
    slot.connectBtn.addEventListener(
      'click',
      () => {
        connectDevice().catch(console.error);
      },
      { signal },
    );

    slotRegistry.push(slot);
    return slot;
  }

  const slot1 = createSlot(1);
  const slot2 = createSlot(2);
  const slots = slotRegistry;
  let deviceEnumerationPromise: Promise<void> | null = null;
  let deviceEnumerationQueued = false;

  // ============================================================================
  // Device Enumeration Setup Engine
  // ============================================================================

  /**
   * Shows a disabled loading option while device enumeration is in progress.
   */
  function setSlotDropdownLoading(slot: SlotInstance): void {
    slot.dropdownList.innerHTML = '';
    addDropdownOption(slot.dropdownList, 'Loading devices…', {
      disabled: true,
      className: 'dropdown__option--empty dropdown__option--loading',
    });
  }

  /**
   * Shows a disabled message option in a slot's device dropdown.
   */
  function setSlotDropdownEmpty(slot: SlotInstance, message: string): void {
    slot.dropdownList.innerHTML = '';
    addDropdownOption(slot.dropdownList, message, { disabled: true, className: 'dropdown__option--empty' });
  }

  /**
   * Queues a device refresh, coalescing repeated requests into one refresh cycle.
   */
  function enumerateDevices(): Promise<void> {
    if (deviceEnumerationPromise) {
      deviceEnumerationQueued = true;
      return deviceEnumerationPromise;
    }

    deviceEnumerationPromise = (async () => {
      do {
        deviceEnumerationQueued = false;
        await loadDevices();
      } while (deviceEnumerationQueued && !signal.aborted);
    })().finally(() => {
      deviceEnumerationPromise = null;
    });
    return deviceEnumerationPromise;
  }

  /**
   * Enumerates media devices and updates source-to-audio mappings and dropdowns.
   */
  async function loadDevices(): Promise<void> {
    if (signal.aborted) return;
    slots.forEach(setSlotDropdownLoading);

    try {
      let allDevices = await navigator.mediaDevices.enumerateDevices();
      if (signal.aborted) return;
      const labelsAreHidden = allDevices.some((device) => !device.label);
      const alreadyCapturing = slots.some((slot) => slot.activeStream?.getTracks().some((track) => track.readyState === 'live'));

      if (labelsAreHidden && !alreadyCapturing) {
        let tempStream: MediaStream | null = null;
        try {
          tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (permissionError) {
          const msg = permissionError instanceof Error ? permissionError.message : String(permissionError);
          console.info('Camera/microphone permission denied or unavailable:', msg);
        } finally {
          tempStream?.getTracks().forEach((track) => track.stop());
        }

        if (signal.aborted) return;
        allDevices = await navigator.mediaDevices.enumerateDevices();
      }

      if (signal.aborted) return;
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
    } catch (error) {
      if (signal.aborted) return;
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Could not enumerate capture devices:', msg);
      slots.forEach((slot) => setSlotDropdownEmpty(slot, 'Unable to load devices'));
    }
  }

  /**
   * Rebuilds a slot's dropdown with available devices matching configured sources.
   */
  function rebuildSlotDropdown(slot: SlotInstance, videoInputs: MediaDeviceInfo[]): void {
    const previousValue = slot.dropdownWrap.dataset.value ?? '';
    slot.dropdownList.innerHTML = '';
    let foundAny = false;

    ALLOWED_SOURCES.forEach(({ match, name }) => {
      const found = videoInputs.find((v) => match.test(v.label));
      if (!found) return;

      foundAny = true;
      const isSelected = found.deviceId === previousValue;
      const option = addDropdownOption(slot.dropdownList, name, {
        value: found.deviceId,
        selected: isSelected,
      });

      if (isSelected) {
        slot.dropdownLabel.textContent = name;
        slot.dropdownWrap.dataset.value = found.deviceId;
      }

      option.addEventListener('click', () => slot.selectDropdownOption(option), { signal });
    });

    if (!foundAny) {
      setSlotDropdownEmpty(slot, 'No capture devices found');
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
  const swapButton = queryElement('[data-role="swap-sources"]');

  const STAGE_GAP_PX = 8;
  const VERTICAL_CHROME = 140;

  /**
   * Sizes player viewports to fit the available stage dimensions and layout ratio.
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
  /**
   * Applies a layout's visibility, width, connection, and viewport sizing.
   */
  function applyLayout(layoutId: string): void {
    const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0];

    stage.dataset.layout = layout.id;
    layoutTriggerLabel.textContent = layout.label;

    const dualSlots = layout.slots === 2;
    slot2Row.classList.toggle('toolbar__source-row--hidden', !dualSlots);
    slot2.playerEl.classList.toggle('player--hidden', !dualSlots);

    slot1.playerEl.classList.toggle('player--narrow', layout.id === '30-70');
    slot2.playerEl.classList.toggle('player--narrow', layout.id === '70-30');

    if (layout.slots === 1 && slot2.activeDeviceId) {
      slot2.disconnectDevice();
    }

    fitStageHeight(layout);
  }

  /**
   * Opens the layout selector dropdown.
   */
  function openLayoutDropdown(): void {
    setDropdownOpen(layoutDropdownWrap, true);
  }

  /**
   * Closes the layout selector dropdown.
   */
  function closeLayoutDropdown(): void {
    setDropdownOpen(layoutDropdownWrap, false);
  }

  /**
   * Toggles the layout selector dropdown.
   */
  function toggleLayoutDropdown(): void {
    layoutDropdownWrap.classList.contains('dropdown--open') ? closeLayoutDropdown() : openLayoutDropdown();
  }

  /**
   * Builds layout selector options and binds their selection handlers.
   */
  function buildLayoutList(): void {
    layoutList.innerHTML = '';
    LAYOUTS.forEach((layout) => {
      const isSelected = layout.id === stage.dataset.layout;
      const option = addDropdownOption(layoutList, layout.label, {
        id: layout.id,
        selected: isSelected,
      });

      option.addEventListener(
        'click',
        () => {
          setSelectedDropdownOption(layoutList, option);

          swapButton.classList.toggle('hidden', layout.id === 'single');

          applyLayout(layout.id);
          closeLayoutDropdown();
          layoutTrigger.focus();
        },
        { signal },
      );
    });
  }

  layoutTrigger.addEventListener('click', toggleLayoutDropdown, { signal });

  /**
   * Swaps active streams and device selections between the two slots.
   */
  function swapSlotDevices(): void {
    const stream1 = slot1.activeStream;
    const stream2 = slot2.activeStream;
    const deviceId1 = slot1.activeDeviceId;
    const deviceId2 = slot2.activeDeviceId;

    slot1.activeStream = stream2;
    slot2.activeStream = stream1;
    slot1.activeDeviceId = deviceId2;
    slot2.activeDeviceId = deviceId1;

    // Swap the rendered video by reassigning srcObject from the swapped streams
    slot1.video.srcObject = slot1.activeStream;
    slot2.video.srcObject = slot2.activeStream;

    [slot1, slot2].forEach((slot) => {
      if (slot.activeStream) {
        slot.noSignal.style.display = 'none';
        slot.setConnectBtnMode('disconnect');
        slot.video.play().catch(console.error);
      } else {
        slot.noSignal.style.display = 'flex';
        slot.setConnectBtnMode('connect');
      }

      // Re-apply this slot's own volume to whatever stream it now holds
      slot.applyVolume(getSliderVolume(slot));

      // Sync the device dropdown selection to reflect the swapped assignment
      const value = slot.activeDeviceId ?? '';
      slot.dropdownWrap.dataset.value = value;
      const selectedOption =
        Array.from(slot.dropdownList.querySelectorAll<HTMLButtonElement>('.dropdown__option')).find(
          (option) => value !== '' && option.dataset.value === value,
        ) ?? null;
      setSelectedDropdownOption(slot.dropdownList, selectedOption);
      if (selectedOption) slot.dropdownLabel.textContent = selectedOption.textContent ?? '';
    });

    applyLoudnessCompensation();
  }

  swapButton.addEventListener('click', swapSlotDevices, { signal });

  layoutDropdownWrap.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLayoutDropdown();
        layoutTrigger.focus();
      }
    },
    { signal },
  );

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
          setDropdownOpen(slot.dropdownWrap, false);
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
        const isActive = currentFullscreenElement === slot.playerEl;
        slot.isFullscreen = isActive;
        slot.playerEl.classList.toggle('player--fullscreen', isActive);
        if (slot.fullscreenIconWrap) {
          slot.fullscreenIconWrap.innerHTML = isActive ? SVG_ICONS.fullscreenExit : SVG_ICONS.fullscreenEnter;
        }
      });
    },
    { signal },
  );

  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const slot = slotFromFocus() ?? slots.find((s) => s.isFullscreen);
      if (!slot) return;
      const keyLower = e.key.toLowerCase();

      if (keyLower === 'f') {
        e.preventDefault();
        slot.toggleFullscreen();
      } else if (keyLower === 'm') {
        e.preventDefault();
        slot.muteBtn.click();
      } else if (keyLower === 'arrowup') {
        e.preventDefault();
        const newVolume = Math.min(100, getSliderVolume(slot) + VOLUME_STEP);
        if (newVolume > 0 && slot.video.muted) slot.video.muted = false;
        slot.applyVolume(newVolume);
      } else if (keyLower === 'arrowdown') {
        e.preventDefault();
        const newVolume = Math.max(0, getSliderVolume(slot) - VOLUME_STEP);
        if (newVolume === 0) slot.video.muted = true;
        slot.applyVolume(newVolume);
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
        slot.connectionRequestId += 1;
        slot.isConnecting = false;
        if (slot.hideTimer) clearTimeout(slot.hideTimer);
        if (slot.activeStream) {
          slot.activeStream.getTracks().forEach((track) => track.stop());
        }
      });
      slotRegistry.length = 0;
    },
  };
}
