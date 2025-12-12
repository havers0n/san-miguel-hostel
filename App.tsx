
import React, { useEffect, useState, useRef } from 'react';
import { WorldState, AgentDecision } from './types/world';
import { createInitialWorldState, stepMockWorld, commandMoveAgent, moveAgentToRoom, applyAgentDecision, applyMemoryUpdate } from './mock/worldMock';
import { Hostel3DScene } from './viewer/Hostel3DScene';
import { AgentPanel } from './ui/AgentPanel';
import { EventLog } from './ui/EventLog';
import { requestAgentDecision } from './services/geminiService';
import * as THREE from 'three';

function App() {
  const [world, setWorld] = useState<WorldState>(createInitialWorldState());
  const worldRef = useRef(world); // Ref for async access
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<'TOP_DOWN' | 'THIRD_PERSON'>('TOP_DOWN');
  const [debugMode, setDebugMode] = useState<boolean>(false);

  // Sync ref
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  // Simulation Loop - 30 FPS
  useEffect(() => {
    const interval = setInterval(() => {
      setWorld((prev) => stepMockWorld(prev, 0.033));
    }, 33); 

    return () => clearInterval(interval);
  }, []);

  // AI Brain Loop (runs independently from physics)
  useEffect(() => {
    let cancelled = false;

    async function processAI() {
      if (cancelled) return;

      // 1. Check if anyone needs a decision
      const currentWorld = worldRef.current;
      const ids = currentWorld.agentsNeedingDecision || [];
      
      if (ids.length === 0) {
        // Nothing to do, wait a bit
        setTimeout(processAI, 500);
        return;
      }

      // 2. Pick the first one
      const agentId = ids[0];
      const agent = currentWorld.agents.find(a => a.id === agentId);

      // Remove from queue immediately to prevent double processing
      setWorld(prev => ({
         ...prev,
         agentsNeedingDecision: prev.agentsNeedingDecision?.filter(id => id !== agentId)
      }));

      if (agent) {
        // 3. Ask Gemini
        const { decision, memoryUpdate } = await requestAgentDecision(currentWorld, agent);
        
        if (!cancelled && decision) {
           // 4. Inject Result
           setWorld(prev => {
             // a. Apply memory updates
             let nextState = applyMemoryUpdate(prev, decision.agentId, memoryUpdate);
             
             // b. Queue the physical decision for the next simulation tick
             nextState = {
                ...nextState,
                pendingDecisions: [...(nextState.pendingDecisions || []), decision]
             };
             
             // c. Update Last Think Tick so they don't spam
             nextState.agents = nextState.agents.map(a => 
               a.id === decision.agentId 
               ? { ...a, ai: { ...a.ai, lastThinkTick: nextState.tick } }
               : a
             );

             return nextState;
           });
        }
      }

      // Loop
      setTimeout(processAI, 200); // 200ms delay between decisions to be gentle on API
    }

    processAI();

    return () => { cancelled = true; };
  }, []);

  const selectedAgent = world.agents.find(a => a.id === selectedAgentId) || null;

  const handleFloorClick = (point: THREE.Vector3) => {
    if (selectedAgentId) {
      setWorld(prev => {
        const newAgents = commandMoveAgent(selectedAgentId, point.x, point.z, prev);
        return { ...prev, agents: newAgents };
      });
    }
  };

  const handleMoveToRoom = (roomId: string) => {
    if (selectedAgentId) {
        setWorld(prev => moveAgentToRoom(selectedAgentId, roomId, prev));
    }
  };

  return (
    <div className="flex w-full h-screen bg-black overflow-hidden relative">
      
      {/* 3D Viewport */}
      <div className="flex-1 h-full relative z-0">
        <Hostel3DScene 
          world={world}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
          cameraMode={cameraMode}
          debugMode={debugMode}
          onFloorClick={handleFloorClick}
        />
        
        {/* Overlay Controls */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
           <div className="flex gap-2">
            <div className="bg-black/80 backdrop-blur text-white px-3 py-1 rounded border border-gray-700 text-xs font-mono">
                TICK: {world.tick}
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
            rooms={world.rooms} 
            onMoveToRoom={handleMoveToRoom}
          />
        </div>
        <div className="h-1/2">
          <EventLog events={world.events} />
        </div>
      </div>
    </div>
  );
}

export default App;
