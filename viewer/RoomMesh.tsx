import React from 'react';
import { Room } from '../types/world';
import { Text } from '@react-three/drei';

interface RoomMeshProps {
  room: Room;
}

export const RoomMesh: React.FC<RoomMeshProps> = ({ room }) => {
  const { position, size, name } = room;
  const wallThickness = 0.2;
  const wallHeight = size.y;

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Floor Area */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size.x, size.z]} />
        <meshStandardMaterial color="#cbd5e0" roughness={0.8} />
      </mesh>

      {/* Room Label on Floor */}
      <Text
        position={[0, 0.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.8}
        color="#a0aec0"
        fillOpacity={0.5}
      >
        {name}
      </Text>

      {/* Walls (Visual only, non-colliding for viewer) */}
      <group position={[0, wallHeight / 2, 0]}>
        {/* Top Wall (-Z) */}
        <mesh position={[0, 0, -size.z / 2]}>
          <boxGeometry args={[size.x, wallHeight, wallThickness]} />
          <meshStandardMaterial color="#718096" opacity={0.3} transparent />
        </mesh>
        {/* Bottom Wall (+Z) */}
        <mesh position={[0, 0, size.z / 2]}>
          <boxGeometry args={[size.x, wallHeight, wallThickness]} />
          <meshStandardMaterial color="#718096" opacity={0.3} transparent />
        </mesh>
        {/* Left Wall (-X) */}
        <mesh position={[-size.x / 2, 0, 0]}>
          <boxGeometry args={[wallThickness, wallHeight, size.z]} />
          <meshStandardMaterial color="#718096" opacity={0.3} transparent />
        </mesh>
        {/* Right Wall (+X) */}
        <mesh position={[size.x / 2, 0, 0]}>
          <boxGeometry args={[wallThickness, wallHeight, size.z]} />
          <meshStandardMaterial color="#718096" opacity={0.3} transparent />
        </mesh>
      </group>
    </group>
  );
};