import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { Agent } from '../types/world';

interface CameraRigProps {
  mode: 'TOP_DOWN' | 'THIRD_PERSON';
  selectedAgent: Agent | undefined;
}

export const CameraRig: React.FC<CameraRigProps> = ({ mode, selectedAgent }) => {
  const { camera } = useThree();
  const targetPos = useRef(new Vector3(0, 0, 0));
  const cameraOffset = useRef(new Vector3(0, 0, 0));

  useFrame((state, delta) => {
    // Determine target based on mode
    if (mode === 'THIRD_PERSON' && selectedAgent) {
      // Focus on agent
      const agentPos = new Vector3(
        selectedAgent.position.x,
        selectedAgent.position.y,
        selectedAgent.position.z
      );
      
      const dir = new Vector3(
        selectedAgent.direction.x,
        0, // Keep camera level-ish
        selectedAgent.direction.z
      ).normalize();

      // Camera behind agent: AgentPos - Direction * distance + Up
      const camTargetPos = agentPos.clone()
        .sub(dir.clone().multiplyScalar(5)) // 5 units behind
        .add(new Vector3(0, 4, 0)); // 4 units up

      // Lerp camera position
      state.camera.position.lerp(camTargetPos, 4 * delta);
      
      // Look at agent (slightly above center)
      targetPos.current.lerp(agentPos.clone().add(new Vector3(0, 1, 0)), 5 * delta);
      state.camera.lookAt(targetPos.current);

    } else {
      // TOP_DOWN Mode (Tactical View)
      const center = new Vector3(2, 0, 0); // Roughly center of our mock map
      const overheadPos = new Vector3(2, 18, 12); // High up, slightly angled

      state.camera.position.lerp(overheadPos, 2 * delta);
      targetPos.current.lerp(center, 2 * delta);
      state.camera.lookAt(targetPos.current);
    }
  });

  return null;
};