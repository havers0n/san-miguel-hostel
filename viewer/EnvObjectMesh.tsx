import React from 'react';
import { EnvObject, EnvObjectKind } from '../types/world';

const COLORS: Record<EnvObjectKind, string> = {
  BED: '#4a5568',
  TABLE: '#8b4513',
  DOOR: '#2d3748',
  WINDOW: '#63b3ed',
  SOFA: '#2c5282',
  KITCHEN: '#718096',
  BATH: '#e2e8f0',
  LOCKER: '#744210',
};

interface EnvObjectMeshProps {
  data: EnvObject;
}

export const EnvObjectMesh: React.FC<EnvObjectMeshProps> = ({ data }) => {
  const { position, size, kind } = data;
  
  return (
    <mesh
      position={[position.x, position.y, position.z]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshStandardMaterial color={COLORS[kind]} />
    </mesh>
  );
};