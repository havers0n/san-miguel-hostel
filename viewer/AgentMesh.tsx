import React, { useRef } from 'react';
import { Agent, AgentRole } from '../types/world';
import { Html } from '@react-three/drei';
import { Vector3 } from 'three';

const ROLE_COLORS: Record<AgentRole, string> = {
  RESIDENT: '#48bb78', // Green
  SOCIAL_WORKER: '#4299e1', // Blue
  GUARD: '#2d3748', // Dark Grey
  NEWCOMER: '#ed8936', // Orange
  TRIGGER: '#f56565', // Red
};

interface AgentMeshProps {
  agent: Agent;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export const AgentMesh: React.FC<AgentMeshProps> = ({ agent, isSelected, onSelect }) => {
  const { position, direction, role, name, state } = agent;
  
  // Convert direction to rotation angle around Y axis
  const angle = Math.atan2(direction.x, direction.z);

  return (
    <group position={[position.x, position.y, position.z]}>
      {/* Name Tag */}
      <Html position={[0, 2.2, 0]} center distanceFactor={10}>
        <div className={`
          px-2 py-1 rounded text-xs font-bold whitespace-nowrap select-none pointer-events-none
          ${isSelected ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white backdrop-blur-sm'}
        `}>
          {name}
          <div className="text-[10px] font-normal opacity-80">{role}</div>
        </div>
      </Html>

      {/* Character Body */}
      <group rotation={[0, angle, 0]} onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}>
        {/* Selection Ring */}
        {isSelected && (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 0.7, 32]} />
            <meshBasicMaterial color="#ecc94b" />
          </mesh>
        )}

        {/* Main Body */}
        <mesh position={[0, 1, 0]} castShadow>
          <capsuleGeometry args={[0.4, 1, 4, 8]} />
          <meshStandardMaterial color={ROLE_COLORS[role]} />
        </mesh>

        {/* Eye/Direction Indicator */}
        <mesh position={[0, 1.5, 0.35]}>
          <boxGeometry args={[0.3, 0.1, 0.2]} />
          <meshStandardMaterial color="white" />
        </mesh>
      </group>
    </group>
  );
};