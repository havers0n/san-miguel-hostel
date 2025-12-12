import React, { useMemo } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { SoftShadows, Grid, Line } from '@react-three/drei';
import { WorldState } from '../types/world';
import { AgentMesh } from './AgentMesh';
import { RoomMesh } from './RoomMesh';
import { EnvObjectMesh } from './EnvObjectMesh';
import { CameraRig } from './CameraRig';
import { NavGrid } from '../utils/NavSystem';
import { navGrid } from '../mock/worldMock';
import * as THREE from 'three';

interface Hostel3DSceneProps {
  world: WorldState;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  cameraMode: 'TOP_DOWN' | 'THIRD_PERSON';
  debugMode: boolean;
  onFloorClick: (point: THREE.Vector3) => void;
}

// Debug Visualizer for Grid Obstacles
const DebugGrid = () => {
  const obstacles = useMemo(() => {
    const boxes: React.ReactElement[] = [];
    for (let x = 0; x < navGrid.width; x++) {
      for (let z = 0; z < navGrid.height; z++) {
        if (!navGrid.cells[x][z]) {
          const pos = navGrid.gridToWorld({ x, z });
          boxes.push(
            <mesh key={`${x}-${z}`} position={[pos.x, 0.05, pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.4, 0.4]} />
              <meshBasicMaterial color="red" opacity={0.3} transparent />
            </mesh>
          );
        }
      }
    }
    return boxes;
  }, []);

  return <group>{obstacles}</group>;
};

// Path Visualizer
const PathLine = ({ points }: { points: {x:number, z:number}[] }) => {
  if (!points || points.length < 2) return null;
  
  const vecPoints = points.map(p => {
    const w = navGrid.gridToWorld({ x: p.x, z: p.z });
    return new THREE.Vector3(w.x, 0.2, w.z);
  });

  return <Line points={vecPoints} color="yellow" lineWidth={2} dashed={false} />;
};

export const Hostel3DScene: React.FC<Hostel3DSceneProps> = ({ 
  world, 
  selectedAgentId, 
  onSelectAgent, 
  cameraMode,
  debugMode,
  onFloorClick
}) => {
  
  const selectedAgent = world.agents.find(a => a.id === selectedAgentId);

  const handlePointerMissed = (e: MouseEvent) => {
    // If clicked on nothing specific (background), deselect
    // But here we rely on the floor click explicitly
  };

  return (
    <div className="w-full h-full bg-gray-900">
      <Canvas shadows camera={{ fov: 50, position: [0, 20, 20] }} onPointerMissed={() => onSelectAgent('')}>
        <fog attach="fog" args={['#1a202c', 10, 50]} />
        
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight 
          position={[10, 20, 10]} 
          intensity={1} 
          castShadow 
          shadow-mapSize={[1024, 1024]} 
        />

        {/* Camera Logic */}
        <CameraRig mode={cameraMode} selectedAgent={selectedAgent} />

        {/* Environment */}
        <group>
          {/* Base Floor - Interaction Layer */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[0, -0.05, 0]} 
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              onFloorClick(e.point);
            }}
          >
            <planeGeometry args={[100, 100]} />
            <meshStandardMaterial color="#2d3748" />
          </mesh>

          {/* Helper Grid Visual */}
          <Grid infiniteGrid sectionColor="#4a5568" cellColor="#2d3748" position={[0, 0.01, 0]} />
          
          {debugMode && <DebugGrid />}

          {/* Rooms */}
          {world.rooms.map(room => (
            <RoomMesh key={room.id} room={room} />
          ))}

          {/* Objects */}
          {world.envObjects.map(obj => (
            <EnvObjectMesh key={obj.id} data={obj} />
          ))}
        </group>

        {/* Agents */}
        {world.agents.map(agent => (
          <group key={agent.id}>
             <AgentMesh 
              agent={agent} 
              isSelected={agent.id === selectedAgentId}
              onSelect={onSelectAgent}
            />
            {/* Draw path for selected agent if moving */}
            {debugMode && agent.id === selectedAgentId && agent.nav.isMoving && (
               <PathLine points={agent.nav.path} />
            )}
          </group>
        ))}

      </Canvas>
    </div>
  );
};