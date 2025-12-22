import { Vector3 } from 'three';
import { Agent, EnvObject, Room, PathNode } from '../types/world';

// Grid Configuration
const CELL_SIZE = 0.5;
const GRID_WIDTH = 60; // 30 meters
const GRID_HEIGHT = 50; // 25 meters
const ORIGIN_X = -10;
const ORIGIN_Z = -10;

export interface GridCoord {
  x: number;
  z: number;
}

export class NavGrid {
  cells: boolean[][]; // true = walkable, false = blocked
  width: number;
  height: number;

  constructor() {
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;
    this.cells = Array(this.width).fill(false).map(() => Array(this.height).fill(true));
  }

  // Convert World Vector3 to Grid Coordinate
  worldToGrid(pos: { x: number; z: number }): GridCoord {
    const gx = Math.floor((pos.x - ORIGIN_X) / CELL_SIZE);
    const gz = Math.floor((pos.z - ORIGIN_Z) / CELL_SIZE);
    return { 
      x: Math.max(0, Math.min(this.width - 1, gx)), 
      z: Math.max(0, Math.min(this.height - 1, gz)) 
    };
  }

  // Convert Grid Coordinate to World Vector3 (Center of cell)
  gridToWorld(coord: GridCoord): { x: number; y: number; z: number } {
    return {
      x: ORIGIN_X + coord.x * CELL_SIZE + CELL_SIZE / 2,
      y: 0,
      z: ORIGIN_Z + coord.z * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  markObstacle(pos: { x: number; z: number }, size: { x: number; z: number }) {
    const start = this.worldToGrid({ x: pos.x - size.x / 2, z: pos.z - size.z / 2 });
    const end = this.worldToGrid({ x: pos.x + size.x / 2, z: pos.z + size.z / 2 });

    for (let x = start.x; x <= end.x; x++) {
      for (let z = start.z; z <= end.z; z++) {
        if (x >= 0 && x < this.width && z >= 0 && z < this.height) {
          this.cells[x][z] = false;
        }
      }
    }
  }

  // Explicitly mark area as walkable (for doors)
  markWalkable(pos: { x: number; z: number }, size: { x: number; z: number }) {
    const start = this.worldToGrid({ x: pos.x - size.x / 2, z: pos.z - size.z / 2 });
    const end = this.worldToGrid({ x: pos.x + size.x / 2, z: pos.z + size.z / 2 });

    for (let x = start.x; x <= end.x; x++) {
      for (let z = start.z; z <= end.z; z++) {
        if (x >= 0 && x < this.width && z >= 0 && z < this.height) {
            this.cells[x][z] = true;
        }
      }
    }
  }

  // Helper: Check if two rectangles intersect
  private rectanglesIntersect(
    rect1: { x: number; z: number; sizeX: number; sizeZ: number },
    rect2: { x: number; z: number; sizeX: number; sizeZ: number }
  ): boolean {
    const r1Left = rect1.x - rect1.sizeX / 2;
    const r1Right = rect1.x + rect1.sizeX / 2;
    const r1Top = rect1.z - rect1.sizeZ / 2;
    const r1Bottom = rect1.z + rect1.sizeZ / 2;

    const r2Left = rect2.x - rect2.sizeX / 2;
    const r2Right = rect2.x + rect2.sizeX / 2;
    const r2Top = rect2.z - rect2.sizeZ / 2;
    const r2Bottom = rect2.z + rect2.sizeZ / 2;

    return !(r1Right < r2Left || r1Left > r2Right || r1Bottom < r2Top || r1Top > r2Bottom);
  }

  // Mark obstacle with exclusion zones (for doors)
  markObstacleWithExclusions(
    pos: { x: number; z: number },
    size: { x: number; z: number },
    exclusions: Array<{ x: number; z: number; sizeX: number; sizeZ: number }>
  ) {
    const start = this.worldToGrid({ x: pos.x - size.x / 2, z: pos.z - size.z / 2 });
    const end = this.worldToGrid({ x: pos.x + size.x / 2, z: pos.z + size.z / 2 });

    for (let x = start.x; x <= end.x; x++) {
      for (let z = start.z; z <= end.z; z++) {
        if (x >= 0 && x < this.width && z >= 0 && z < this.height) {
          // Convert grid cell center back to world coords to check exclusion
          const worldPos = this.gridToWorld({ x, z });
          
          // Check if this cell is in any exclusion zone
          let isExcluded = false;
          for (const excl of exclusions) {
            const exclLeft = excl.x - excl.sizeX / 2;
            const exclRight = excl.x + excl.sizeX / 2;
            const exclTop = excl.z - excl.sizeZ / 2;
            const exclBottom = excl.z + excl.sizeZ / 2;
            
            if (worldPos.x >= exclLeft && worldPos.x <= exclRight &&
                worldPos.z >= exclTop && worldPos.z <= exclBottom) {
              isExcluded = true;
              break;
            }
          }
          
          if (!isExcluded) {
            this.cells[x][z] = false;
          }
        }
      }
    }
  }

  // Initialize grid with static geometry
  initialize(rooms: Room[], envObjects: EnvObject[]) {
    // Reset to walkable
    this.cells = Array(this.width).fill(false).map(() => Array(this.height).fill(true));

    // Collect all doors first
    const doors = envObjects.filter(obj => obj.kind === 'DOOR');
    
    // 1. Mark Room Walls (excluding door areas)
    rooms.forEach(room => {
      const halfX = room.size.x / 2;
      const halfZ = room.size.z / 2;
      const thickness = 0.4; // Slightly thicker than visual to ensure blocking

      // Find doors that intersect with each wall
      const topWallExclusions = doors.filter(door => {
        const wallRect = { x: room.position.x, z: room.position.z - halfZ, sizeX: room.size.x, sizeZ: thickness };
        const doorRect = { x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z };
        return this.rectanglesIntersect(wallRect, doorRect);
      }).map(door => ({ x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z }));

      const bottomWallExclusions = doors.filter(door => {
        const wallRect = { x: room.position.x, z: room.position.z + halfZ, sizeX: room.size.x, sizeZ: thickness };
        const doorRect = { x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z };
        return this.rectanglesIntersect(wallRect, doorRect);
      }).map(door => ({ x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z }));

      const leftWallExclusions = doors.filter(door => {
        const wallRect = { x: room.position.x - halfX, z: room.position.z, sizeX: thickness, sizeZ: room.size.z };
        const doorRect = { x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z };
        return this.rectanglesIntersect(wallRect, doorRect);
      }).map(door => ({ x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z }));

      const rightWallExclusions = doors.filter(door => {
        const wallRect = { x: room.position.x + halfX, z: room.position.z, sizeX: thickness, sizeZ: room.size.z };
        const doorRect = { x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z };
        return this.rectanglesIntersect(wallRect, doorRect);
      }).map(door => ({ x: door.position.x, z: door.position.z, sizeX: door.size.x, sizeZ: door.size.z }));

      // Mark walls with exclusions
      this.markObstacleWithExclusions(
        { x: room.position.x, z: room.position.z - halfZ },
        { x: room.size.x, z: thickness },
        topWallExclusions
      );
      this.markObstacleWithExclusions(
        { x: room.position.x, z: room.position.z + halfZ },
        { x: room.size.x, z: thickness },
        bottomWallExclusions
      );
      this.markObstacleWithExclusions(
        { x: room.position.x - halfX, z: room.position.z },
        { x: thickness, z: room.size.z },
        leftWallExclusions
      );
      this.markObstacleWithExclusions(
        { x: room.position.x + halfX, z: room.position.z },
        { x: thickness, z: room.size.z },
        rightWallExclusions
      );
    });

    // 2. Mark EnvObjects (Furniture) - excluding doors
    envObjects.forEach(obj => {
        if (obj.kind === 'DOOR') return; // process doors later
        this.markObstacle(obj.position, obj.size);
    });

    // 3. Ensure Doors are walkable (with extra margin for easier passage)
    doors.forEach(door => {
        // Make door area slightly larger for easier passage
        const doorMargin = 0.3; // Extra margin around door
        this.markWalkable(
          door.position,
          { x: door.size.x + doorMargin, z: door.size.z + doorMargin }
        );
    });
  }

  isWalkable(x: number, z: number): boolean {
    if (x < 0 || x >= this.width || z < 0 || z >= this.height) return false;
    return this.cells[x][z];
  }
}

// Find closest walkable cell to target
export function findNearestWalkable(start: GridCoord, grid: NavGrid, maxRadius: number = 5): GridCoord | null {
  if (grid.isWalkable(start.x, start.z)) return start;

  const queue = [start];
  const visited = new Set<string>();
  visited.add(`${start.x},${start.z}`);

  while (queue.length > 0) {
    const current = queue.shift()!;
    
    // Check if walkable
    if (grid.isWalkable(current.x, current.z)) {
        return current;
    }

    // Neighbors
    const neighbors = [
        { x: 0, z: -1 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 },
        { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: 1, z: 1 }
    ];

    for (const offset of neighbors) {
        const nx = current.x + offset.x;
        const nz = current.z + offset.z;
        const key = `${nx},${nz}`;
        
        if (nx >= 0 && nx < grid.width && nz >= 0 && nz < grid.height && !visited.has(key)) {
            // Check radius logic approximately
            if (Math.abs(nx - start.x) <= maxRadius && Math.abs(nz - start.z) <= maxRadius) {
                visited.add(key);
                queue.push({ x: nx, z: nz });
            }
        }
    }
  }
  return null;
}

// A* Pathfinding
export function findPath(start: GridCoord, end: GridCoord, grid: NavGrid): PathNode[] | null {
  // If end is blocked, try to find nearest walkable
  let target = end;
  if (!grid.isWalkable(end.x, end.z)) {
     const nearest = findNearestWalkable(end, grid);
     if (nearest) target = nearest;
     else return null;
  }

  const openSet: { node: GridCoord, f: number, g: number, parent: any }[] = [];
  const closedSet = new Set<string>();

  openSet.push({ node: start, f: 0, g: 0, parent: null });

  while (openSet.length > 0) {
    // Sort by F score (lowest first)
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;

    if (current.node.x === target.x && current.node.z === target.z) {
      // Reconstruct path
      const path: PathNode[] = [];
      let temp = current;
      while (temp) {
        path.push({ x: temp.node.x, z: temp.node.z });
        temp = temp.parent;
      }
      return path.reverse();
    }

    const key = `${current.node.x},${current.node.z}`;
    closedSet.add(key);

    const neighbors = [
      { x: 0, z: -1 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 },
      // Diagonals
      { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: 1, z: 1 }
    ];

    for (const offset of neighbors) {
      const nx = current.node.x + offset.x;
      const nz = current.node.z + offset.z;

      if (!grid.isWalkable(nx, nz)) continue;
      if (closedSet.has(`${nx},${nz}`)) continue;

      // Diagonal cost = 1.4, Straight = 1
      const isDiag = offset.x !== 0 && offset.z !== 0;
      const cost = isDiag ? 1.414 : 1;

      // Corner cutting check
      if (isDiag) {
        if (!grid.isWalkable(current.node.x + offset.x, current.node.z) || 
            !grid.isWalkable(current.node.x, current.node.z + offset.z)) {
          continue;
        }
      }

      const gScore = current.g + cost;
      const hScore = Math.abs(nx - target.x) + Math.abs(nz - target.z); // Manhattan
      const fScore = gScore + hScore;

      const existing = openSet.find(n => n.node.x === nx && n.node.z === nz);
      if (existing) {
        if (gScore < existing.g) {
          existing.g = gScore;
          existing.f = fScore;
          existing.parent = current;
        }
      } else {
        openSet.push({ node: { x: nx, z: nz }, f: fScore, g: gScore, parent: current });
      }
    }
  }

  return null;
}

// Avoidance / Steering
export function applyAvoidance(
  agent: Agent, 
  allAgents: Agent[], 
  desiredVelocity: Vector3, // This is actually displacement (speed * delta) passed from worldMock
  delta: number
): Vector3 {
  const AVOID_RADIUS = 1.2; // Smoother radius
  const AVOID_FORCE = 2.0;  // Reduced force

  const agentPos = new Vector3(agent.position.x, 0, agent.position.z);
  let steering = new Vector3(0, 0, 0);
  let count = 0;

  allAgents.forEach(other => {
    if (other.id === agent.id) return;

    const otherPos = new Vector3(other.position.x, 0, other.position.z);
    const dist = agentPos.distanceTo(otherPos);

    if (dist > 0 && dist < AVOID_RADIUS) {
      // Vector pointing away from neighbor
      const diff = new Vector3().subVectors(agentPos, otherPos).normalize();
      diff.divideScalar(dist); // Weight by distance
      steering.add(diff);
      count++;
    }
  });

  if (count > 0) {
    steering.divideScalar(count);
    // Multiply by delta so the force scales with time, preventing jitter/teleportation
    steering.multiplyScalar(AVOID_FORCE * delta);
  }

  return desiredVelocity.clone().add(steering);
}