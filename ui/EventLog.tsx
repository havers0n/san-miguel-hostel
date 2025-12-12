import React, { useEffect, useRef } from 'react';
import { WorldEvent, WorldEventType } from '../types/world';

interface EventLogProps {
  events: WorldEvent[];
}

const TYPE_COLORS: Record<WorldEventType, string> = {
  CONFLICT: 'text-red-400',
  THEFT: 'text-orange-400',
  HELP_REQUEST: 'text-blue-400',
  RULE_BREAK: 'text-yellow-400',
  NIGHT_NOISE: 'text-purple-400',
  RELAPSE: 'text-pink-600',
  CONVERSATION: 'text-green-400',
  MOVEMENT: 'text-gray-500',
};

export const EventLog: React.FC<EventLogProps> = ({ events }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 flex flex-col h-full">
      <div className="p-3 border-b border-gray-700 bg-gray-800/50 backdrop-blur">
        <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">World Log</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-xs">
        {events.length === 0 && <div className="text-gray-600 italic">No events recorded...</div>}
        
        {events.map((evt) => (
          <div key={evt.id} className="flex gap-2">
            <span className="text-gray-500 shrink-0">T:{evt.tick}</span>
            <span className={`${TYPE_COLORS[evt.type]} font-bold shrink-0`}>[{evt.type}]</span>
            <span className="text-gray-300">{evt.description}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};