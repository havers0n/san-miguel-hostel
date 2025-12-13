
import React, { useEffect, useRef, useState } from 'react';
import { WorldState, AgentDecision } from './types/world';
import { createInitialWorldState } from './mock/worldMock';
import { Hostel3DScene } from './viewer/Hostel3DScene';
import { AgentPanel } from './ui/AgentPanel';
import { EventLog } from './ui/EventLog';
import * as THREE from 'three';

import { EngineRuntime } from './src/core/engine/runtime';
import { EngineLoop } from './src/core/engine/loop';
import { createWorldOps } from './src/core/world/ops';
import { createScheduler } from './src/core/engine/scheduler';
import { createEngineTick } from './src/core/engine/tick';
import { startDecisionWorker, type ExecuteDecision } from './src/core/engine/decision_worker';
import type { DecisionRequest, DecisionResult } from './src/core/engine/types';
import { makeProxyExecutor } from './src/core/engine/execute_proxy';

const SceneViewport = React.memo(function SceneViewport(props: {
  worldRef: React.RefObject<WorldState>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  cameraMode: 'TOP_DOWN' | 'THIRD_PERSON';
  debugMode: boolean;
  onFloorClick: (point: THREE.Vector3) => void;
}) {
  const [sceneWorld, setSceneWorld] = useState<WorldState>(props.worldRef.current);

  // 3D snapshot at ~30 FPS, isolated to scene subtree (does not re-render sidebar UI).
  useEffect(() => {
    const id = setInterval(() => {
      setSceneWorld(props.worldRef.current);
    }, 33);
    return () => clearInterval(id);
  }, [props.worldRef]);

  return (
    <Hostel3DScene
      world={sceneWorld}
      selectedAgentId={props.selectedAgentId}
      onSelectAgent={props.onSelectAgent}
      cameraMode={props.cameraMode}
      debugMode={props.debugMode}
      onFloorClick={props.onFloorClick}
    />
  );
});

function App() {
  // Source of truth (mutated only by transactional tick)
  const worldRef = useRef<WorldState>(createInitialWorldState());

  // UI snapshots (bounded refresh rates; no 30 FPS setState for whole app)
  const [uiWorld, setUiWorld] = useState<WorldState>(worldRef.current);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<'TOP_DOWN' | 'THIRD_PERSON'>('TOP_DOWN');
  const [debugMode, setDebugMode] = useState<boolean>(false);

  const runtimeRef = useRef<EngineRuntime | null>(null);
  const loopRef = useRef<EngineLoop | null>(null);
  const workerStopRef = useRef<(() => void) | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastRafMsRef = useRef<number | null>(null);

  const makeId = () => {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };

  // Engine init (once)
  useEffect(() => {
    if (runtimeRef.current) return;

    const runtime = new EngineRuntime();
    const worldOps = createWorldOps();
    const scheduler = createScheduler(worldOps, {
      promptVersion: 'iter11-local',
      ttlMs: 20_000,
      cooldownMs: 2_000,
      allowlistActions: [
        'IDLE',
        'GO_TO_ROOM',
        'EAT_IN_KITCHEN',
        'REST_IN_DORM',
        'TALK_TO_AGENT',
        'CALM_SOMEONE',
        'START_CONFLICT',
        'REPORT_TO_GUARD',
        'WANDER',
      ],
    });
    const engineTick = createEngineTick(runtime, worldOps, scheduler);

    let loop: EngineLoop;
    loop = new EngineLoop(runtime, (simDt) => {
      const res = engineTick.tick(worldRef.current, simDt, loop.engineTick);
      worldRef.current = res.world;
    });

    const engineMode = (import.meta as any).env?.VITE_ENGINE_MODE ?? 'local';
    const proxyUrl = (import.meta as any).env?.VITE_PROXY_URL as string | undefined;

    const localExecute: ExecuteDecision = async (req: DecisionRequest): Promise<DecisionResult> => {
      const decision: AgentDecision = {
        agentId: req.agentId,
        tickPlanned: 0,
        action: 'WANDER',
        reason: 'local_worker',
      };
      return {
        requestId: req.requestId,
        agentId: req.agentId,
        intentId: req.intentId,
        contextHash: req.contextHash,
        createdAtMs: worldOps.getNowMs(),
        decisionSchemaVersion: 1,
        decision,
      };
    };

    const execute =
      engineMode === 'live'
        ? (() => {
            if (!proxyUrl) {
              // Misconfigured live mode: disable scheduling to avoid inflight buildup/timeouts.
              runtime.maxConcurrentRequestsTotal = 0;
              runtime.pushEngineEvents([
                {
                  type: 'AI_REQUEST_FAILED',
                  tick: 0,
                  agentId: 'engine',
                  requestId: 'proxy_url_missing',
                  reason: 'VITE_PROXY_URL missing (VITE_ENGINE_MODE=live)',
                },
              ]);
              return localExecute;
            }
            return makeProxyExecutor({ baseUrl: proxyUrl });
          })()
        : localExecute;

    const worker = startDecisionWorker(runtime, execute, {
      intervalMs: 50,
      getTick: () => loop.engineTick,
    });

    runtimeRef.current = runtime;
    loopRef.current = loop;
    workerStopRef.current = worker.stop;

    return () => {
      workerStopRef.current?.();
      workerStopRef.current = null;

      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      lastRafMsRef.current = null;

      loopRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  // Engine loop (RAF)
  useEffect(() => {
    let cancelled = false;

    const frame = (nowMs: number) => {
      if (cancelled) return;
      const loop = loopRef.current;
      if (!loop) {
        rafIdRef.current = requestAnimationFrame(frame);
        return;
      }

      const last = lastRafMsRef.current ?? nowMs;
      lastRafMsRef.current = nowMs;
      const realDtSec = (nowMs - last) / 1000;
      loop.frame(realDtSec);

      rafIdRef.current = requestAnimationFrame(frame);
    };

    rafIdRef.current = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };
  }, []);

  // UI snapshot (5–10 FPS)
  useEffect(() => {
    const id = setInterval(() => {
      setUiWorld(worldRef.current);
    }, 150);
    return () => clearInterval(id);
  }, []);

  const selectedAgent = uiWorld.agents.find(a => a.id === selectedAgentId) || null;

  const handleFloorClick = (point: THREE.Vector3) => {
    if (selectedAgentId) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.commandBuffer.push({
        id: makeId(),
        type: 'MOVE_TO_POINT',
        createdAtMs: Date.now(),
        actorId: selectedAgentId,
        payload: { agentId: selectedAgentId, x: point.x, z: point.z },
      });
    }
  };

  const handleMoveToRoom = (roomId: string) => {
    if (selectedAgentId) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.commandBuffer.push({
        id: makeId(),
        type: 'MOVE_TO_ROOM',
        createdAtMs: Date.now(),
        actorId: selectedAgentId,
        payload: { agentId: selectedAgentId, roomId },
      });
    }
  };

  const roomsSnapshot = uiWorld.rooms;
  const eventsSnapshot = uiWorld.events;

  return (
    <div className="flex w-full h-screen bg-black overflow-hidden relative">
      
      {/* 3D Viewport */}
      <div className="flex-1 h-full relative z-0">
        <SceneViewport
          worldRef={worldRef}
          selectedAgentId={selectedAgentId}
          onSelectAgent={(id) => setSelectedAgentId(id ? id : null)}
          cameraMode={cameraMode}
          debugMode={debugMode}
          onFloorClick={handleFloorClick}
        />
        
        {/* Overlay Controls */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
           <div className="flex gap-2">
            <div className="bg-black/80 backdrop-blur text-white px-3 py-1 rounded border border-gray-700 text-xs font-mono">
                TICK: {uiWorld.tick}
            </div>
            <button 
                onClick={() => setCameraMode(prev => prev === 'TOP_DOWN' ? 'THIRD_PERSON' : 'TOP_DOWN')}
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold transition-colors shadow-lg"
            >
                CAM: {cameraMode}
            </button>
            <button 
                onClick={() => setDebugMode(!debugMode)}
                className={`px-3 py-1 rounded text-xs font-bold transition-colors shadow-lg ${debugMode ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}
            >
                DEBUG: {debugMode ? 'ON' : 'OFF'}
            </button>
           </div>
           
           {selectedAgent && (
             <div className="bg-black/60 backdrop-blur text-green-300 px-3 py-1 rounded text-xs font-mono border border-green-900/50">
               Click floor to move {selectedAgent.name}
             </div>
           )}
        </div>
      </div>

      {/* UI Sidebar */}
      <div className="w-80 flex flex-col gap-2 p-2 bg-gray-900 border-l border-gray-800 z-10">
        <div className="h-1/2">
          <AgentPanel 
            agent={selectedAgent} 
            rooms={roomsSnapshot} 
            onMoveToRoom={handleMoveToRoom}
          />
        </div>
        <div className="h-1/2">
          <EventLog events={eventsSnapshot} />
        </div>
      </div>
    </div>
  );
}

export default App;
