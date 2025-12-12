
import React from 'react';
import { Agent } from '../types/world';

interface AgentPanelProps {
  agent: Agent | null;
  rooms: {id: string, name: string}[];
  onMoveToRoom?: (roomId: string) => void;
}

const ProgressBar = ({ label, value, colorClass }: { label: string, value: number, colorClass: string }) => (
  <div className="mb-2">
    <div className="flex justify-between text-xs mb-1 uppercase tracking-wide text-gray-400">
      <span>{label}</span>
      <span>{(value * 100).toFixed(0)}%</span>
    </div>
    <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
      <div 
        className={`h-full ${colorClass} transition-all duration-300`} 
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} 
      />
    </div>
  </div>
);

export const AgentPanel: React.FC<AgentPanelProps> = ({ agent, rooms, onMoveToRoom }) => {
  if (!agent) {
    return (
      <div className="bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700 h-full flex items-center justify-center text-gray-500">
        <p>Select an agent to view details</p>
      </div>
    );
  }

  const roomName = rooms.find(r => r.id === agent.roomId)?.name || 'Unknown';
  const intent = agent.ai.currentIntent;
  const isThinking = !intent; // Simplified check, actually depends on queue

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700 h-full overflow-y-auto">
      <div className="mb-4 border-b border-gray-700 pb-4">
        <h2 className="text-2xl font-bold text-white mb-1">{agent.name}</h2>
        <div className="flex items-center gap-2 mb-2">
           <span className="px-2 py-0.5 rounded bg-blue-900 text-blue-200 text-xs font-bold">{agent.role}</span>
           <span className="text-sm text-gray-400">in {roomName}</span>
        </div>
        
        {/* Personality Traits */}
        <div className="flex gap-1 flex-wrap">
          {agent.ai.memory.traits.map(t => (
            <span key={t.key} className="px-1.5 py-0.5 bg-gray-700 text-gray-300 text-[10px] rounded border border-gray-600">
              {t.key} ({t.level})
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4 bg-black/40 p-3 rounded border border-gray-700/50">
        <div className="text-xs text-blue-400 uppercase font-bold mb-1">Current Intent</div>
        {intent ? (
          <>
            <div className="text-sm text-white font-mono mb-1">{intent.action}</div>
            <div className="text-xs text-gray-400 italic">"{intent.reason}"</div>
          </>
        ) : (
          <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
             <div className="text-sm text-gray-500 italic">Deciding next move...</div>
          </div>
        )}
      </div>

      <div className="space-y-4 mb-6">
        <ProgressBar label="Energy" value={agent.energy} colorClass="bg-green-500" />
        <ProgressBar label="Hunger" value={agent.hunger} colorClass="bg-orange-500" />
        <ProgressBar label="Anxiety" value={agent.anxiety} colorClass="bg-purple-500" />
        <ProgressBar label="Aggression" value={agent.aggression} colorClass="bg-red-500" />
      </div>

      {/* Manual Actions Override */}
      <div className="mb-6">
        <div className="text-xs text-gray-500 uppercase mb-2">Override Command</div>
        <div className="grid grid-cols-3 gap-1">
          {rooms.map(r => (
             <button 
               key={r.id}
               onClick={() => onMoveToRoom?.(r.id)}
               className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-[10px] text-white py-1 px-1 rounded transition-colors truncate"
               title={`Send to ${r.name}`}
             >
               {r.name}
             </button>
          ))}
        </div>
      </div>
    </div>
  );
};
