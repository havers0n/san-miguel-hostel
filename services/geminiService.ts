import { 
  Agent, 
  WorldState, 
  AgentTrait, 
  AgentHighLevelAction, 
  AgentDecision, 
  MemoryUpdate 
} from '../types/world';
import { GoogleGenAI } from '@google/genai';

const MODEL_NAME = 'gemini-2.5-flash';

// Use API Key from environment
const apiKey = process.env.API_KEY || '';

const ai = apiKey 
  ? new GoogleGenAI({ apiKey })
  : null;

// Data structure passed to LLM
interface AgentSnapshot {
  id: string;
  name: string;
  role: string;
  currentRoom: string;
  stats: { energy: number; hunger: number; anxiety: number; aggression: number };
  traits: AgentTrait[];
  relationships: { target: string; score: number }[];
}

// Safe JSON parser that handles potential Markdown code blocks
function cleanAndParseJSON(text: string): any {
  let clean = text.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json/, '').replace(/```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```/, '').replace(/```$/, '');
  }
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('Failed to parse JSON from Gemini:', text);
    return null;
  }
}

export async function requestAgentDecision(
  world: WorldState,
  agent: Agent
): Promise<{ decision: AgentDecision | null; memoryUpdate?: MemoryUpdate }> {
  
  if (!ai || !apiKey) {
    return {
      decision: {
        agentId: agent.id,
        tickPlanned: world.tick,
        action: 'WANDER',
        reason: 'No API Key - Wandering randomly',
      }
    };
  }

  // 1. Construct the World Slice (Context)
  const visibleAgents = world.agents
    .filter(a => a.id !== agent.id && a.roomId === agent.roomId)
    .map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      room: a.roomId,
      state: a.state
    }));

  const snapshot: AgentSnapshot = {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    currentRoom: agent.roomId,
    stats: {
      energy: Number(agent.energy.toFixed(2)),
      hunger: Number(agent.hunger.toFixed(2)),
      anxiety: Number(agent.anxiety.toFixed(2)),
      aggression: Number(agent.aggression.toFixed(2)),
    },
    traits: agent.ai.memory.traits,
    relationships: agent.ai.memory.relationships.map(r => ({
      target: r.targetAgentId,
      score: r.score
    })),
  };

  const recentEvents = world.events
    .slice(-3)
    .map(e => ({ type: e.type, description: e.description }));

  const roomsList = world.rooms.map(r => ({ id: r.id, name: r.name }));

  const prompt = `
You are simulating an AI agent named ${agent.name} (${agent.role}) in a Hostel Simulation.

CONTEXT:
- Time: ${world.timeOfDay} (Tick ${world.tick})
- You are in Room: ${agent.roomId}
- Your Stats (0-1): Energy=${snapshot.stats.energy}, Hunger=${snapshot.stats.hunger}, Anxiety=${snapshot.stats.anxiety}, Aggression=${snapshot.stats.aggression}
- Your Traits: ${JSON.stringify(snapshot.traits)}
- Agents in same room: ${JSON.stringify(visibleAgents)}
- Available Rooms: ${JSON.stringify(roomsList)}
- Recent Events: ${JSON.stringify(recentEvents)}

TASK:
Decide your next immediate action based on your traits and needs.
Available Actions: 
- GO_TO_ROOM (requires targetRoomId)
- REST_IN_DORM (if in a room with beds)
- EAT_IN_KITCHEN (if in kitchen)
- TALK_TO_AGENT (requires targetAgentId)
- WANDER (move randomly in current room)
- START_CONFLICT (requires targetAgentId)

INSTRUCTIONS:
1. If Hunger > 0.7, prioritize EAT_IN_KITCHEN.
2. If Energy < 0.2, prioritize REST_IN_DORM.
3. If Anxious or Aggressive, behavior should reflect traits.
4. Provide a very short "reason" for your action (max 10 words).

Return ONLY valid JSON, no markdown fences.
OUTPUT JSON FORMAT:
{
  "action": "GO_TO_ROOM",
  "reason": "Hungry, going to kitchen",
  "targetRoomId": "r4", 
  "targetAgentId": null,
  "memoryUpdates": {
      "longTermNotesToAdd": ["Saw Maria looking sad"],
      "relationshipDeltas": [{"targetAgentId": "agent-1", "delta": 5}]
  }
}
  `.trim();

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        responseMimeType: 'application/json',
      }
    });

    const text = response.text ?? '';
    const parsed = cleanAndParseJSON(text);

    if (!parsed || !parsed.action) {
      throw new Error('Invalid JSON response');
    }

    const decision: AgentDecision = {
      agentId: agent.id,
      tickPlanned: world.tick,
      action: parsed.action as AgentHighLevelAction,
      reason: parsed.reason || 'Decided spontaneously',
      targetRoomId: parsed.targetRoomId ?? undefined,
      targetAgentId: parsed.targetAgentId ?? undefined,
    };

    return { decision, memoryUpdate: parsed.memoryUpdates as MemoryUpdate | undefined };

  } catch (error) {
    console.error('Gemini Error:', error);
    return {
      decision: {
        agentId: agent.id,
        tickPlanned: world.tick,
        action: 'WANDER',
        reason: 'Brain freeze (API Error)',
      }
    };
  }
}
