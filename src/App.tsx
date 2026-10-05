import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioTrack,
  LiveKitRoom,
  StartAudio,
  VideoTrack,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import {
  ConnectionState,
  Participant,
  ParticipantEvent,
  RemoteTrackPublication,
  RoomEvent,
  ScreenSharePresets,
  Track,
} from 'livekit-client';
import { playSound, preloadSounds } from './sounds';

type Channel = { id: string; name: string; participants: number; maxParticipants: number };
type Server = { id: string; name: string; participants: number; protected: boolean };
type ShareQuality = 'economy' | 'sharp' | 'smooth';
type Role = 'presidente' | 'rico' | 'pobre';
type Auth = { username: string; role: Role; canShareQualities: ShareQuality[] };
type Session = {
  token: string;
  serverUrl: string;
  name: string;
  serverId: string;
  serverName: string;
  roomId: string;
  roomName: string;
  serverPassword: string;
  canShareQualities: ShareQuality[];
};

const ROLE_LABEL: Record<Role, string> = { presidente: 'Presidente', rico: 'Rico', pobre: 'Pobre' };
const CAN_CREATE_SERVER: Role[] = ['presidente', 'rico'];

// Canal de dados usado só para avisar os demais que alguém entrou em tela cheia.
const dataEncoder = new TextEncoder();
const dataDecoder = new TextDecoder();
const FULLSCREEN_MESSAGE = JSON.stringify({ t: 'fullscreen' });

function roleFromMetadata(metadata?: string): Role | undefined {
  try {
    const parsed = JSON.parse(metadata || '{}') as { role?: Role };
    return parsed.role && parsed.role in ROLE_LABEL ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_CHANNEL: Channel = { id: 'geral', name: 'Geral', participants: 0, maxParticipants: 4 };
// Chave PIX do widget "Apoie o Jonjo". Vem do build (VITE_PIX_KEY); vazia = widget oculto.
const PIX_KEY = (import.meta.env.VITE_PIX_KEY || '').trim();
const API_BASE = import.meta.env.BASE_URL;
const SHARE_QUALITIES = {
  economy: { label: 'Leve', detail: '720p · 15 FPS · 1,5 Mbps', preset: ScreenSharePresets.h720fps15, contentHint: 'detail' as const },
  sharp: { label: 'Texto nítido', detail: '1080p · 15 FPS · 2,5 Mbps', preset: ScreenSharePresets.h1080fps15, contentHint: 'text' as const },
  smooth: { label: 'Movimento suave', detail: '1080p · 30 FPS · 5 Mbps', preset: ScreenSharePresets.h1080fps30, contentHint: 'motion' as const },
};
const audioCaptureOptions = {
  autoGainControl: true,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function ParticipantCard({
  participant,
  isLocal,
  locallyMuted,
  onToggleLocalMute,
}: {
  participant: Participant;
  isLocal: boolean;
  locallyMuted: boolean;
  onToggleLocalMute: () => void;
}) {
  const [speaking, setSpeaking] = useState(participant.isSpeaking);
  const [, refreshTrackState] = useState(0);

  useEffect(() => {
    const handleSpeaking = () => setSpeaking(participant.isSpeaking);
    const handleTrackState = () => refreshTrackState((value) => value + 1);
    participant.on(ParticipantEvent.IsSpeakingChanged, handleSpeaking);
    participant.on(ParticipantEvent.TrackMuted, handleTrackState);
    participant.on(ParticipantEvent.TrackUnmuted, handleTrackState);
    participant.on(ParticipantEvent.TrackPublished, handleTrackState);
    participant.on(ParticipantEvent.TrackUnpublished, handleTrackState);
    participant.on(ParticipantEvent.ParticipantMetadataChanged, handleTrackState);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, handleSpeaking);
      participant.off(ParticipantEvent.TrackMuted, handleTrackState);
      participant.off(ParticipantEvent.TrackUnmuted, handleTrackState);
      participant.off(ParticipantEvent.TrackPublished, handleTrackState);
      participant.off(ParticipantEvent.TrackUnpublished, handleTrackState);
      participant.off(ParticipantEvent.ParticipantMetadataChanged, handleTrackState);
    };
  }, [participant]);

  const micPublication = participant.getTrackPublication(Track.Source.Microphone);
  const muted = !micPublication || micPublication.isMuted;
  const displayName = participant.name || participant.identity;
  const role = roleFromMetadata(participant.metadata);

  return (
    <article className={`participant ${speaking && !muted ? 'participant--speaking' : ''}`}>
      <div className="avatar" aria-hidden="true">{initials(displayName)}</div>
      <div className="participant__identity">
        <strong className="participant__name">
          <span>{displayName}{isLocal ? ' (você)' : ''}</span>
          {role && <span className={`role-badge role-badge--${role} role-badge--sm`}>{ROLE_LABEL[role]}</span>}
        </strong>
        <span>{locallyMuted ? 'O Jonjo silenciou só pra você' : muted ? 'Fazendo voto de silêncio' : speaking ? 'Contando uma história' : 'Curtindo o silêncio do Jonjo'}</span>
      </div>
      <span className={`mic-status ${muted ? 'mic-status--muted' : ''}`} aria-label={muted ? 'Microfone fechado' : 'Microfone aberto'}>
        {muted ? <MicOffIcon /> : <MicIcon />}
      </span>
      {!isLocal && (
        <button
          className={`local-mute ${locallyMuted ? 'local-mute--active' : ''}`}
          type="button"
          onClick={onToggleLocalMute}
          aria-pressed={locallyMuted}
          aria-label={locallyMuted ? `Voltar a ouvir ${displayName}` : `Silenciar ${displayName} só para você`}
          title={locallyMuted ? `O Jonjo devolve a voz de ${displayName}` : `O Jonjo silencia ${displayName} só para você`}
        >
          {locallyMuted ? <SoundOffIcon /> : <SoundIcon />}
        </button>
      )}
    </article>
  );
}

function RemoteMicrophoneAudio({ locallyMuted }: { locallyMuted: Set<string> }) {
  const microphoneTracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });

  return (
    <div className="audio-tracks" aria-hidden="true">
      {microphoneTracks.filter((track) => !track.participant.isLocal).map((track) => (
        <AudioTrack
          key={`${track.participant.identity}-microphone`}
          trackRef={track}
          volume={locallyMuted.has(track.participant.identity) ? 0 : 1}
        />
      ))}
    </div>
  );
}

function ScreenShareStage({ volume, onVolumeChange }: { volume: number; onVolumeChange: (volume: number) => void }) {
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const screenAudioTracks = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: true });
  const { localParticipant } = useLocalParticipant();
  const activeShare = screenTracks[0];
  const stageRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  if (!activeShare) return null;

  const presenterName = activeShare.participant.name || activeShare.participant.identity;
  const activeAudio = screenAudioTracks.find(
    (track) => track.participant.identity === activeShare.participant.identity && !track.participant.isLocal,
  );

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await stageRef.current?.requestFullscreen();
      // Entrou em tela cheia: toca aqui e avisa os demais para tocarem também.
      playSound('fullscreen');
      void localParticipant.publishData(dataEncoder.encode(FULLSCREEN_MESSAGE), { reliable: true }).catch(() => undefined);
    }
  }

  return (
    <section ref={stageRef} className="screen-stage" aria-label={`Tela compartilhada por ${presenterName}`}>
      <div className="screen-stage__header">
        <div>
          <span className="live-badge"><span /> AO VIVO</span>
          <strong>{activeShare.participant.isLocal ? 'O Jonjo está mostrando a sua tela' : `O Jonjo está mostrando a tela de ${presenterName}`}</strong>
        </div>
        <div className="screen-stage__actions">
          {!activeShare.participant.isLocal && (
            <label className={`share-volume ${activeAudio ? '' : 'share-volume--disabled'}`} title={activeAudio ? 'Volume do áudio compartilhado' : 'Essa tela veio sem áudio'}>
              {volume === 0 ? <SoundOffIcon /> : <SoundIcon />}
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={volume}
                disabled={!activeAudio}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                aria-label="Volume do compartilhamento de tela"
              />
              <span>{activeAudio ? `${volume}%` : 'Sem áudio'}</span>
            </label>
          )}
          <button className="stage-button" type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Sair da tela cheia' : 'Ver em tela cheia'} title={isFullscreen ? 'O Jonjo quer voltar' : 'O Jonjo ocupa a tela toda'}>
            {isFullscreen ? <MinimizeIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>
      <div className="screen-stage__video-wrap">
        <VideoTrack trackRef={activeShare} autoPlay playsInline />
      </div>
      {activeAudio && <AudioTrack trackRef={activeAudio} volume={volume / 100} />}
    </section>
  );
}

function VoiceRoom({
  currentRoom,
  serverId,
  serverName,
  allowedQualities,
  onLeave,
  onLeaveServer,
  onSwitchChannel,
}: {
  currentRoom: Pick<Channel, 'id' | 'name'>;
  serverId: string;
  serverName: string;
  allowedQualities: ShareQuality[];
  onLeave: () => void;
  onLeaveServer: () => void;
  onSwitchChannel: (channel: Channel) => Promise<void>;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const connectionState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('default');
  const [actionError, setActionError] = useState('');
  const [locallyMuted, setLocallyMuted] = useState<Set<string>>(() => new Set());
  const [screenShareVolume, setScreenShareVolume] = useState(100);
  const qualityOptions = useMemo(
    () => (Object.keys(SHARE_QUALITIES) as ShareQuality[]).filter((id) => allowedQualities.includes(id)),
    [allowedQualities],
  );
  const [shareQuality, setShareQuality] = useState<ShareQuality>(
    () => (allowedQualities.includes('sharp') ? 'sharp' : allowedQualities[0]) ?? 'economy',
  );
  const [shareAudio, setShareAudio] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Se o cargo mudou e a qualidade atual não é mais permitida, recua para a permitida.
    if (!allowedQualities.includes(shareQuality)) {
      setShareQuality((allowedQualities.includes('sharp') ? 'sharp' : allowedQualities[0]) ?? 'economy');
    }
  }, [allowedQualities, shareQuality]);
  useEffect(() => {
    if (!showSettings) return;
    const onClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) setShowSettings(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showSettings]);
  const [channels, setChannels] = useState<Channel[]>([DEFAULT_CHANNEL]);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelCapacity, setNewChannelCapacity] = useState(4);
  const [channelError, setChannelError] = useState('');
  const [switchingChannel, setSwitchingChannel] = useState(false);

  const orderedParticipants = useMemo(
    () => [...participants].sort((a, b) => Number(b.isSpeaking) - Number(a.isSpeaking)),
    [participants],
  );

  useEffect(() => {
    const refreshDevices = async () => {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(allDevices.filter((device) => device.kind === 'audioinput'));
    };

    void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, []);

  useEffect(() => {
    const onMediaDevicesError = (error: Error) => setActionError(`O Jonjo discutiu com seu dispositivo: ${error.message}`);
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
    };
  }, [room]);

  useEffect(() => {
    // Efeitos sonoros que todos na sala devem ouvir.
    const onParticipantConnected = () => playSound('notifica_entrada');
    const onScreenShare = (publication: { source: Track.Source }) => {
      if (publication.source === Track.Source.ScreenShare) playSound('compartilhando_tela');
    };
    const onData = (payload: Uint8Array) => {
      try {
        const message = JSON.parse(dataDecoder.decode(payload)) as { t?: string };
        if (message?.t === 'fullscreen') playSound('fullscreen');
      } catch {
        // Mensagem desconhecida: ignoramos.
      }
    };
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.TrackPublished, onScreenShare as (pub: RemoteTrackPublication) => void);
    room.on(RoomEvent.LocalTrackPublished, onScreenShare);
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.TrackPublished, onScreenShare as (pub: RemoteTrackPublication) => void);
      room.off(RoomEvent.LocalTrackPublished, onScreenShare);
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  useEffect(() => {
    let active = true;
    const refreshChannels = async () => {
      try {
        const response = await fetch(`${API_BASE}api/channels?server=${encodeURIComponent(serverId)}`, { cache: 'no-store', credentials: 'same-origin' });
        const payload = await response.json() as { channels?: Channel[] };
        if (active && response.ok && payload.channels) setChannels(payload.channels);
      } catch {
        // A conversa continua mesmo se a contagem dos canais demorar a chegar.
      }
    };
    void refreshChannels();
    const timer = window.setInterval(() => void refreshChannels(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [currentRoom.id, serverId]);

  async function toggleMicrophone() {
    setActionError('');
    playSound('fun');
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled, audioCaptureOptions);
    } catch (error) {
      setActionError(error instanceof Error ? `O Jonjo não conseguiu acordar seu microfone: ${error.message}` : 'O Jonjo não conseguiu acordar seu microfone.');
    }
  }

  async function changeDevice(deviceId: string) {
    setActionError('');
    try {
      await room.switchActiveDevice('audioinput', deviceId);
      setActiveDeviceId(deviceId);
    } catch (error) {
      setActionError(error instanceof Error ? `O Jonjo se enrolou nos microfones: ${error.message}` : 'O Jonjo se enrolou nos microfones.');
    }
  }

  async function toggleScreenShare() {
    setActionError('');
    try {
      if (isScreenShareEnabled) {
        await localParticipant.setScreenShareEnabled(false);
      } else {
        const quality = SHARE_QUALITIES[shareQuality];
        await localParticipant.setScreenShareEnabled(true, {
          audio: shareAudio,
          contentHint: quality.contentHint,
          resolution: quality.preset.resolution,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: shareAudio ? 'include' : 'exclude',
        }, {
          screenShareEncoding: quality.preset.encoding,
          simulcast: true,
          videoCodec: 'vp8',
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      setActionError(error instanceof Error ? `O Jonjo não achou sua tela: ${error.message}` : 'O Jonjo não achou sua tela.');
    }
  }

  async function switchChannel(channel: Channel) {
    if (channel.id === currentRoom.id || switchingChannel) return;
    setChannelError('');
    setSwitchingChannel(true);
    try {
      await onSwitchChannel(channel);
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : 'O Jonjo errou o corredor do canal.');
      setSwitchingChannel(false);
    }
  }

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    setChannelError('');
    try {
      const response = await fetch(`${API_BASE}api/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: newChannelName, server: serverId, maxParticipants: newChannelCapacity }),
      });
      const payload = await response.json() as { channel?: Channel; error?: string };
      if (!response.ok || !payload.channel) throw new Error(payload.error || 'O Jonjo perdeu a plaquinha do canal.');
      const channel = { ...payload.channel, participants: 0 };
      setNewChannelName('');
      setNewChannelCapacity(4);
      setShowChannelForm(false);
      setChannels((current) => current.some((item) => item.id === channel.id) ? current : [...current, channel]);
      await switchChannel(channel);
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : 'O Jonjo perdeu a plaquinha do canal.');
    }
  }

  function toggleLocalMute(identity: string) {
    setLocallyMuted((current) => {
      const next = new Set(current);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  }

  function leaveRoom() {
    playSound('fun');
    room.disconnect();
    onLeave();
  }

  function leaveServer() {
    playSound('fun');
    room.disconnect();
    onLeaveServer();
  }

  const statusText = connectionState === ConnectionState.Connected
    ? 'Jonjo conectou tudo'
    : connectionState === ConnectionState.Reconnecting
      ? 'Jonjo está remendando…'
      : 'Jonjo tá pensando…';
  const anotherPresenter = screenTracks.find((track) => !track.participant.isLocal);
  const screenShareBlocked = Boolean(anotherPresenter) && !isScreenShareEnabled;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Logo /> <span>Jonjo</span></div>
        <button className="server-switch" type="button" onClick={leaveServer} title="Voltar para a lista de servidores">
          <ArrowIcon /> <span>Servidores</span>
        </button>
        <div className="current-server"><span className="server-avatar">{initials(serverName)}</span><strong>{serverName}</strong></div>
        <div className="sidebar__heading">
          <span className="sidebar__section-label">CANAIS DE VOZ</span>
          <button className="add-channel-button" type="button" onClick={() => setShowChannelForm((value) => !value)} aria-label="Criar canal" title="O Jonjo abre outro cantinho">+</button>
        </div>
        <div className="channel-list">
          {channels.map((channel) => (
            <button
              key={channel.id}
              className={`channel ${channel.id === currentRoom.id ? 'channel--active' : ''}`}
              type="button"
              disabled={switchingChannel}
              onClick={() => void switchChannel(channel)}
            >
              <SpeakerIcon />
              <span>{channel.name}</span>
              <small>{channel.id === currentRoom.id ? participants.length : channel.participants}/{channel.maxParticipants}</small>
            </button>
          ))}
        </div>
        {showChannelForm && (
          <form className="channel-create" onSubmit={(event) => void createChannel(event)}>
            <input autoFocus maxLength={24} placeholder="Nome do canal" value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} aria-label="Nome do novo canal" />
            <label htmlFor="channel-capacity">Limite de pessoas</label>
            <select id="channel-capacity" value={newChannelCapacity} onChange={(event) => setNewChannelCapacity(Number(event.target.value))}>
              {Array.from({ length: 9 }, (_, index) => index + 2).map((capacity) => <option key={capacity} value={capacity}>{capacity} pessoas</option>)}
            </select>
            <div><button type="button" onClick={() => setShowChannelForm(false)}>Agora não</button><button type="submit">Criar</button></div>
          </form>
        )}
        {channelError && <p className="channel-error">{channelError}</p>}
        <div className="sidebar__footer">
          <span className={`connection-dot ${connectionState !== ConnectionState.Connected ? 'connection-dot--pending' : ''}`} />
          <div><strong>{statusText}</strong><small>Jonjo espanta os ruídos</small></div>
        </div>
      </aside>

      <section className="room">
        <header className="room__header">
          <div>
            <p className="eyebrow">CANAL DE VOZ</p>
            <h1>{currentRoom.name}</h1>
            <p>O Jonjo separou este cantinho. Falem mal dos outros canais com moderação.</p>
          </div>
          <div className="room__header-actions">
            <label className="mobile-channel-select">
              <span>Trocar de canal</span>
              <select value={currentRoom.id} disabled={switchingChannel} onChange={(event) => {
                const channel = channels.find((item) => item.id === event.target.value);
                if (channel) void switchChannel(channel);
              }}>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.participants}/{channel.maxParticipants}</option>)}
              </select>
            </label>
            <div className="room__count"><PeopleIcon /> {participants.length} online</div>
          </div>
        </header>

        {connectionState === ConnectionState.Reconnecting && (
          <div className="notice">O Jonjo tropeçou num cabo. Já está voltando…</div>
        )}
        {actionError && <div className="notice notice--error">{actionError}</div>}

        <ScreenShareStage volume={screenShareVolume} onVolumeChange={setScreenShareVolume} />

        <div className="participant-grid">
          {orderedParticipants.map((participant) => (
            <ParticipantCard
              key={participant.identity}
              participant={participant}
              isLocal={participant.identity === localParticipant.identity}
              locallyMuted={locallyMuted.has(participant.identity)}
              onToggleLocalMute={() => toggleLocalMute(participant.identity)}
            />
          ))}
        </div>

        <div className="controls-wrap">
          <div className="noise-state" title="Jonjo espanta eco, ganho e barulheira"><ShieldIcon /></div>

          <div className="controls">
            <div className="settings-anchor" ref={settingsRef}>
              <button
                className={`control-button control-button--ghost ${showSettings ? 'control-button--active' : ''}`}
                type="button"
                onClick={() => setShowSettings((value) => !value)}
                aria-label="Ajustes de microfone e tela"
                aria-expanded={showSettings}
                title="Ajustes"
              >
                <GearIcon />
              </button>
              {showSettings && (
                <div className="settings-popover" role="menu">
                  <div className="device-control">
                    <label htmlFor="microphone">Microfone</label>
                    <select id="microphone" value={activeDeviceId} onChange={(event) => void changeDevice(event.target.value)}>
                      <option value="default">Padrão do sistema</option>
                      {devices.filter((device) => device.deviceId !== 'default').map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="device-control quality-control">
                    <label htmlFor="share-quality">Qualidade da tela</label>
                    <select id="share-quality" value={shareQuality} disabled={isScreenShareEnabled || qualityOptions.length <= 1} onChange={(event) => setShareQuality(event.target.value as ShareQuality)}>
                      {qualityOptions.map((id) => (
                        <option key={id} value={id}>{SHARE_QUALITIES[id].label} · {SHARE_QUALITIES[id].detail}</option>
                      ))}
                    </select>
                    {qualityOptions.length <= 1 && <small className="quality-note">O Jonjo liberou só a qualidade leve para o seu cargo.</small>}
                  </div>
                  <label className="audio-toggle" title="Desligue para evitar que a call apareça duplicada ao compartilhar a tela inteira">
                    <input
                      type="checkbox"
                      checked={shareAudio}
                      disabled={isScreenShareEnabled}
                      onChange={(event) => setShareAudio(event.target.checked)}
                    />
                    <span>Compartilhar áudio</span>
                  </label>
                  <small className="quality-note">
                    {shareAudio
                      ? 'Na tela inteira, o áudio do sistema pode duplicar a call. Compartilhe uma aba, ou desligue o áudio.'
                      : 'Compartilhando sem áudio — nada de eco.'}
                  </small>
                </div>
              )}
            </div>
            <button
              className={`control-button ${!isMicrophoneEnabled ? 'control-button--muted' : ''}`}
              type="button"
              onClick={() => void toggleMicrophone()}
              aria-label={isMicrophoneEnabled ? 'Fechar microfone' : 'Abrir microfone'}
            >
              {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
            </button>
            <button
              className={`control-button control-button--screen ${isScreenShareEnabled ? 'control-button--sharing' : ''}`}
              type="button"
              onClick={() => void toggleScreenShare()}
              disabled={screenShareBlocked}
              aria-label={isScreenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
              title={screenShareBlocked ? `O Jonjo já está mostrando a tela de ${anotherPresenter?.participant.name || 'outra pessoa'}` : 'Pedir para o Jonjo mostrar sua tela'}
            >
              {isScreenShareEnabled ? <StopShareIcon /> : <ScreenShareIcon />}
              <span>{isScreenShareEnabled ? 'Parar' : 'Compartilhar'}</span>
            </button>
            <button className="control-button control-button--leave" type="button" onClick={leaveRoom} aria-label="Sair da sala">
              <HangUpIcon />
            </button>
          </div>

          <div className="controls-spacer" />
        </div>

        <RemoteMicrophoneAudio locallyMuted={locallyMuted} />
        <StartAudio label="O Jonjo precisa de um clique para liberar o áudio" />
      </section>
    </main>
  );
}

function AuthScreen({ onAuthed }: { onAuthed: (auth: Auth) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json() as Partial<Auth> & { error?: string };
      if (!response.ok || !payload.role || !payload.username) {
        throw new Error(payload.error || 'O Jonjo travou na portaria.');
      }
      onAuthed({ username: payload.username, role: payload.role, canShareQualities: payload.canShareQualities || ['economy'] });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'O Jonjo travou na portaria.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lobby">
      <section className="lobby-card">
        <div className="brand brand--large"><Logo /> <span>Jonjo</span></div>
        <div className="lobby-copy">
          <p className="eyebrow">{mode === 'register' ? 'CRIE SEU ACESSO' : 'ENTRE NO JONJO'}</p>
          <h1>{mode === 'register' ? 'Escolha um usuário e uma senha.' : 'Bem-vindo de volta.'}</h1>
          <p>O Jonjo só precisa disso. Nada de e-mail, telefone ou biografia.</p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="username">Usuário</label>
          <input
            id="username"
            autoFocus
            autoComplete="username"
            maxLength={20}
            placeholder="seu_usuario"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="password" style={{ marginTop: 14 }}>Senha</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            maxLength={128}
            placeholder="••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <p className="form-error">{error}</p>}
          <button className="join-button" disabled={busy} type="submit">
            {busy ? 'O Jonjo tá conferindo…' : mode === 'register' ? 'Criar acesso' : 'Entrar'} <ArrowIcon />
          </button>
        </form>
        <button
          className="auth-toggle"
          type="button"
          onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}
        >
          {mode === 'register' ? 'Já tenho acesso — entrar' : 'Não tenho acesso — criar um'}
        </button>
      </section>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
    </main>
  );
}

function AdminPanel({ me, onBack }: { me: Auth; onBack: () => void }) {
  const [users, setUsers] = useState<{ username: string; role: Role }[]>([]);
  const [error, setError] = useState('');
  const [savingUser, setSavingUser] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}api/admin/users`, { credentials: 'same-origin', cache: 'no-store' });
        const payload = await response.json() as { users?: { username: string; role: Role }[]; error?: string };
        if (!response.ok || !payload.users) throw new Error(payload.error || 'erro');
        if (active) setUsers(payload.users);
      } catch {
        if (active) setError('O Jonjo não conseguiu abrir a lista de usuários.');
      }
    })();
    return () => { active = false; };
  }, []);

  async function changeRole(username: string, role: Role) {
    setSavingUser(username);
    setError('');
    try {
      const response = await fetch(`${API_BASE}api/admin/users/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, role }),
      });
      const payload = await response.json() as { username?: string; role?: Role; error?: string };
      if (!response.ok || !payload.role) throw new Error(payload.error || 'O Jonjo não conseguiu mudar o cargo.');
      setUsers((current) => current.map((user) => user.username === username ? { ...user, role: payload.role! } : user));
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'O Jonjo não conseguiu mudar o cargo.');
    } finally {
      setSavingUser('');
    }
  }

  return (
    <main className="lobby">
      <section className="lobby-card admin-card">
        <div className="brand brand--large"><Logo /> <span>Jonjo</span></div>
        <div className="lobby-copy">
          <p className="eyebrow">MESA DO PRESIDENTE</p>
          <h1>Controle de usuários.</h1>
          <p>Defina quem é rico (todas as qualidades) e quem é pobre (só a leve).</p>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="admin-list">
          {users.map((user) => (
            <div className="admin-row" key={user.username}>
              <span className="admin-user">{user.username}{user.username === me.username ? ' (você)' : ''}</span>
              {user.role === 'presidente' ? (
                <span className="role-badge role-badge--presidente">Presidente</span>
              ) : (
                <select
                  className="admin-role-select"
                  value={user.role}
                  disabled={savingUser === user.username}
                  onChange={(event) => void changeRole(user.username, event.target.value as Role)}
                >
                  <option value="rico">Rico</option>
                  <option value="pobre">Pobre</option>
                </select>
              )}
            </div>
          ))}
          {users.length === 0 && !error && <p className="admin-empty">O Jonjo ainda não tem mais ninguém cadastrado.</p>}
        </div>
        <button className="join-button" type="button" onClick={onBack}>Voltar</button>
      </section>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
    </main>
  );
}

function ServerSelect({
  me,
  entering,
  onEnter,
  onManageUsers,
  onLogout,
}: {
  me: Auth;
  entering: string;
  onEnter: (server: Server, password?: string) => void;
  onManageUsers: () => void;
  onLogout: () => void;
}) {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [lockedServer, setLockedServer] = useState<Server | null>(null);
  const [serverPassword, setServerPassword] = useState('');
  const canCreate = CAN_CREATE_SERVER.includes(me.role);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE}api/servers`, { cache: 'no-store', credentials: 'same-origin' });
        const payload = await response.json() as { servers?: Server[]; error?: string };
        if (!active) return;
        if (response.ok && payload.servers) {
          setServers(payload.servers);
          setError('');
        } else if (payload.error) {
          setError(payload.error);
        }
      } catch {
        if (active) setError('O Jonjo não conseguiu listar os servidores.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function createServer(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setCreating(true);
    try {
      const response = await fetch(`${API_BASE}api/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: newName, password: newPassword }),
      });
      const payload = await response.json() as { server?: Server; error?: string };
      if (!response.ok || !payload.server) throw new Error(payload.error || 'O Jonjo perdeu a plaquinha do servidor.');
      const server = { ...payload.server, participants: 0 };
      setNewName('');
      const password = newPassword;
      setNewPassword('');
      setShowForm(false);
      setServers((current) => current.some((item) => item.id === server.id) ? current : [...current, server]);
      onEnter(server, password);
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'O Jonjo perdeu a plaquinha do servidor.');
    } finally {
      setCreating(false);
    }
  }

  function chooseServer(server: Server) {
    setFormError('');
    if (server.protected) {
      setLockedServer(server);
      setServerPassword('');
      return;
    }
    onEnter(server);
  }

  function unlockServer(event: FormEvent) {
    event.preventDefault();
    if (!lockedServer) return;
    onEnter(lockedServer, serverPassword);
  }

  return (
    <main className="lobby">
      <section className="lobby-card servers-card">
        <div className="brand brand--large"><Logo /> <span>Jonjo</span></div>
        <div className="lobby-copy">
          <p className="eyebrow">ESCOLHA UM SERVIDOR</p>
          <h1>Olá, {me.username}.</h1>
          <p>Clique num servidor para entrar. <span className={`role-badge role-badge--${me.role}`}>{ROLE_LABEL[me.role]}</span></p>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="server-grid">
          {servers.map((server) => (
            <button
              key={server.id}
              className="server-card"
              type="button"
              disabled={Boolean(entering)}
              onClick={() => chooseServer(server)}
            >
              <span className="server-card__avatar">{initials(server.name)}</span>
              <strong className="server-card__name">{server.name}</strong>
              <small className="server-card__count"><PeopleIcon /> {server.participants} online</small>
              {server.protected && <small className="server-card__protected"><LockIcon /> Com senha</small>}
              {entering === server.id && <span className="server-card__status">O Jonjo tá abrindo a porta…</span>}
            </button>
          ))}
          {canCreate && !showForm && (
            <button className="server-card server-card--new" type="button" onClick={() => { setShowForm(true); setFormError(''); }}>
              <span className="server-card__avatar server-card__avatar--new">+</span>
              <strong className="server-card__name">Criar servidor</strong>
            </button>
          )}
          {loading && servers.length === 0 && <p className="admin-empty">O Jonjo está juntando os servidores…</p>}
          {!loading && servers.length === 0 && <p className="admin-empty">Nenhum servidor ainda.</p>}
        </div>
        {canCreate && showForm && (
          <form className="server-create" onSubmit={(event) => void createServer(event)}>
            <label htmlFor="server-name">Nome do servidor (até 10 caracteres)</label>
            <input
              id="server-name"
              autoFocus
              maxLength={10}
              placeholder="Ex.: Sala VIP"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <label htmlFor="server-password">Senha do servidor <span className="optional-label">(opcional)</span></label>
            <input
              id="server-password"
              type="password"
              minLength={4}
              maxLength={64}
              autoComplete="new-password"
              placeholder="Deixe vazio para acesso livre"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {formError && <p className="form-error">{formError}</p>}
            <div className="server-create__actions">
              <button type="button" className="ghost-button" onClick={() => { setShowForm(false); setFormError(''); }}>Agora não</button>
              <button type="submit" className="join-button" disabled={creating}>{creating ? 'Criando…' : 'Criar e entrar'}</button>
            </div>
          </form>
        )}
        <div className="lobby-actions">
          {me.role === 'presidente' && (
            <button className="ghost-button" type="button" onClick={onManageUsers}>Gerenciar usuários</button>
          )}
          <button className="ghost-button" type="button" onClick={onLogout}>Sair</button>
        </div>
      </section>
      {lockedServer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLockedServer(null); }}>
          <form className="modal-card" onSubmit={unlockServer}>
            <span className="modal-icon"><LockIcon /></span>
            <p className="eyebrow">SERVIDOR PROTEGIDO</p>
            <h2>{lockedServer.name}</h2>
            <p>Peça a senha para quem criou este servidor.</p>
            <label htmlFor="server-access-password">Senha</label>
            <input id="server-access-password" autoFocus type="password" autoComplete="current-password" maxLength={64} value={serverPassword} onChange={(event) => setServerPassword(event.target.value)} />
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setLockedServer(null)}>Cancelar</button>
              <button className="join-button" type="submit" disabled={!serverPassword || Boolean(entering)}>{entering ? 'Abrindo…' : 'Entrar'}</button>
            </div>
          </form>
        </div>
      )}
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
    </main>
  );
}

function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);

  if (!PIX_KEY) return null;

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(PIX_KEY);
      setPixCopied(true);
      window.setTimeout(() => setPixCopied(false), 1800);
    } catch {
      setPixCopied(false);
    }
  }

  return (
    <>
      <button className="support-widget" type="button" onClick={() => setOpen(true)} aria-label="Apoie o Jonjo com uma contribuição via PIX">
        <span className="support-widget__icon"><HeartIcon /></span>
        <span className="support-widget__copy"><strong>Apoie o Jonjo</strong><small>Ajude a manter no ar</small></span>
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="modal-card support-modal" role="dialog" aria-modal="true" aria-labelledby="support-title">
            <span className="modal-icon modal-icon--heart"><HeartIcon /></span>
            <p className="eyebrow">APOIE O JONJO</p>
            <h2 id="support-title">Curtiu conversar por aqui?</h2>
            <p>Uma contribuição ajuda a manter o servidor, a voz e o compartilhamento de tela no ar.</p>
            <div className="pix-box">
              <span>Chave PIX</span>
              <code>{PIX_KEY}</code>
              <button type="button" onClick={() => void copyPix()}><CopyIcon /> {pixCopied ? 'Copiada!' : 'Copiar chave'}</button>
            </div>
            <button className="ghost-button support-close" type="button" onClick={() => setOpen(false)}>Fechar</button>
          </section>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState<'lobby' | 'admin'>('lobby');
  const [session, setSession] = useState<Session | null>(null);
  const [entering, setEntering] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    preloadSounds();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}api/auth/me`, { credentials: 'same-origin', cache: 'no-store' });
        if (active && response.ok) {
          const payload = await response.json() as Auth;
          setAuth(payload);
        }
      } catch {
        // Sem sessão: a tela de login aparece.
      } finally {
        if (active) setAuthReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  async function requestSession(
    server: Pick<Server, 'id' | 'name'>,
    channel: Pick<Channel, 'id' | 'name'>,
    serverPassword = '',
  ): Promise<Session> {
    const response = await fetch(`${API_BASE}api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ server: server.id, room: channel.id, password: serverPassword }),
    });
    if (response.status === 401) {
      setAuth(null);
      setSession(null);
      throw new Error('O Jonjo pediu para você entrar de novo.');
    }
    const payload = await response.json() as { token?: string; serverUrl?: string; canShareQualities?: ShareQuality[]; role?: Role; error?: string };
    if (!response.ok || !payload.token || !payload.serverUrl) {
      throw new Error(payload.error || 'O Jonjo tentou abrir a porta, mas ela emperrou.');
    }
    if (payload.role && payload.canShareQualities) {
      setAuth((current) => current ? { ...current, role: payload.role!, canShareQualities: payload.canShareQualities! } : current);
    }
    return {
      token: payload.token,
      serverUrl: payload.serverUrl,
      name: auth?.username ?? '',
      serverId: server.id,
      serverName: server.name,
      roomId: channel.id,
      roomName: channel.name,
      serverPassword,
      canShareQualities: payload.canShareQualities || auth?.canShareQualities || ['economy'],
    };
  }

  async function enterServer(server: Server, password = '') {
    setEntering(server.id);
    setError('');
    try {
      setSession(await requestSession(server, DEFAULT_CHANNEL, password));
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'O Jonjo tentou abrir a porta, mas ela emperrou.');
    } finally {
      setEntering('');
    }
  }

  async function logout() {
    try {
      await fetch(`${API_BASE}api/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Ainda assim limpamos o estado local.
    }
    setSession(null);
    setAuth(null);
    setView('lobby');
  }

  if (!authReady) {
    return (
      <>
        <main className="lobby">
          <section className="lobby-card">
            <div className="brand brand--large"><Logo /> <span>Jonjo</span></div>
            <p className="lobby-loading">O Jonjo está conferindo o seu crachá…</p>
          </section>
        </main>
        <SupportWidget />
      </>
    );
  }

  if (!auth) {
    return <><AuthScreen onAuthed={(next) => { setAuth(next); setView('lobby'); playSound('welcome'); }} /><SupportWidget /></>;
  }

  if (session) {
    return (
      <>
        <LiveKitRoom
          key={session.token}
          token={session.token}
          serverUrl={session.serverUrl}
          connect
          audio={audioCaptureOptions}
          video={false}
          onError={(roomError) => setError(`O Jonjo tropeçou: ${roomError.message}`)}
          options={{ disconnectOnPageLeave: true }}
        >
          <VoiceRoom
            currentRoom={{ id: session.roomId, name: session.roomName }}
            serverId={session.serverId}
            serverName={session.serverName}
            allowedQualities={session.canShareQualities}
            onLeave={() => setSession(null)}
            onLeaveServer={() => setSession(null)}
            onSwitchChannel={async (channel) => setSession(await requestSession({ id: session.serverId, name: session.serverName }, channel, session.serverPassword))}
          />
        </LiveKitRoom>
        <SupportWidget />
      </>
    );
  }

  if (view === 'admin' && auth.role === 'presidente') {
    return <><AdminPanel me={auth} onBack={() => setView('lobby')} /><SupportWidget /></>;
  }

  return (
    <>
      {error && (
        <div className="lobby-toast">{error}</div>
      )}
      <ServerSelect
        me={auth}
        entering={entering}
        onEnter={(server, password) => void enterServer(server, password)}
        onManageUsers={() => setView('admin')}
        onLogout={() => void logout()}
      />
      <SupportWidget />
    </>
  );
}

function Logo() { return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 9.5C9.2 6.2 12.6 5 16 5s6.8 1.2 10 4.5l-1.8 14.2-5-2.7-1.1 1.5h-4.2L12.8 21l-5 2.7L6 9.5Z" fill="currentColor"/><circle cx="12" cy="14" r="2" fill="#101116"/><circle cx="20" cy="14" r="2" fill="#101116"/></svg>; }
function MicIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a4 4 0 0 0 4-4V5a4 4 0 1 0-8 0v6a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v3m-3 0h6"/></svg>; }
function MicOffIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M9 9v2a3 3 0 0 0 4.8 2.4M16 11V5a4 4 0 0 0-7.6-1.7M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.9M12 18v3m-3 0h6"/></svg>; }
function HangUpIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 15.4a11.4 11.4 0 0 1 13.6 0l1.4-2.5a2 2 0 0 0-.7-2.7 15.4 15.4 0 0 0-15 0 2 2 0 0 0-.7 2.7l1.4 2.5Z"/></svg>; }
function SpeakerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/></svg>; }
function PeopleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9m0-11.8a4 4 0 0 1 0 7.7"/></svg>; }
function ShieldIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4"/></svg>; }
function BoltIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>; }
function ScreenShareIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-3-9 3-3 3 3m-3-3v6"/></svg>; }
function StopShareIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 8h6v5H9zM8 21h8m-4-4v4"/></svg>; }
function SoundIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/></svg>; }
function SoundOffIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 5m0-5-5 5"/></svg>; }
function FullscreenIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></svg>; }
function GearIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>; }
function MinimizeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H3m5 0V3m8 5h5m-5 0V3M8 16H3m5 0v5m8-5h5m-5 0v5"/></svg>; }
function LockIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>; }
function HeartIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>; }
function CopyIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>; }
