# San Miguel Hostel - 3D AI Agent Simulation

A deterministic 3D simulation of a hostel environment with AI-powered agents. Built with React, Three.js, and Google Gemini AI.



## Overview

This project simulates a hostel environment where AI agents interact with each other and their surroundings. Agents make decisions based on their traits, needs (energy, hunger, anxiety, aggression), and relationships with other agents. The simulation is fully deterministic, enabling reproducible runs and testing.

### Key Features

- **3D Visualization**: Interactive 3D scene built with React Three Fiber
- **AI-Powered Agents**: Agents use Google Gemini AI to make contextual decisions
- **Deterministic Simulation**: Fixed timestep engine ensures reproducible results
- **Record/Replay System**: Cloud Run proxy enables recording and replaying agent decisions
- **Headless Testing**: Run simulations without UI for testing and validation
- **Real-time UI**: Live visualization with agent panels and event logs

## Architecture

The project follows a strict architectural contract to ensure determinism and correctness:

- **WorldState**: Domain state (agents, rooms, objects, events)
- **EngineRuntime**: Transport/runtime state (buffers, locks, metrics)
- **Transactional Engine Tick**: The only legal way to evolve the world state
- **Separation of Concerns**: React handles visualization, engine handles simulation, workers handle async AI decisions

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architectural documentation.

## Prerequisites

- **Node.js** (v18.0.0 or higher required)
- **npm** (v8.0.0 or higher)
- **Google Gemini API Key** (optional, for AI-powered decisions)
  - Get your API key from: https://aistudio.google.com/app/apikey
- **Git** (for cloning repository)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd san-miguel-hostel
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Create a `.env.local` file in the root directory
   - Add your Gemini API key:
     ```
     GEMINI_API_KEY=your_api_key_here
     ```

### Environment Variables

The application uses the following environment variables:

- `GEMINI_API_KEY`: Your Google Gemini API key for AI-powered agent decisions
- `VITE_ENGINE_MODE`: Engine mode (`local` or `live`, default: `local`)
- `VITE_PROXY_URL`: URL for Cloud Run proxy service (required for live mode)
- `VITE_API_KEY`: Alternative API key variable (automatically set from `GEMINI_API_KEY`)

**Note**: Environment variables prefixed with `VITE_` are exposed to the client-side code.

## Running the Application

### Development Mode (Local AI)

Run the app with local L0 brain (deterministic fallback):

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Live Mode (Cloud AI)

To use the Cloud Run proxy for AI decisions:

1. Set environment variables:
   ```bash
   $env:VITE_ENGINE_MODE="live"
   $env:VITE_PROXY_URL="https://your-proxy-url.run.app"
   ```

2. Run the app:
   ```bash
   npm run dev
   ```

3. Open with deterministic parameters:
   ```
   http://localhost:3000/?seed=123&agents=6
   ```

### URL Parameters

- `seed`: Random seed for deterministic initialization (required in live mode)
- `agents`: Number of agents to simulate (default: 6)
- `ticks`: Stop simulation at specific tick (for testing)

Example:
```
http://localhost:3000/?seed=123&agents=6&ticks=1800
```

## Project Structure

```
san-miguel-hostel/
├── src/
│   ├── core/
│   │   ├── engine/          # Simulation engine
│   │   │   ├── tick.ts      # Transactional tick pipeline
│   │   │   ├── scheduler.ts # Decision scheduling
│   │   │   ├── loop.ts      # Fixed timestep loop
│   │   │   ├── runtime.ts   # Engine runtime state
│   │   │   ├── decisions.ts # Decision processing & filtering
│   │   │   ├── queue.ts     # Fair backpressure queue
│   │   │   ├── drain.ts     # Atomic buffer drains
│   │   │   ├── ttl.ts       # TTL set for exactly-once
│   │   │   └── ...
│   │   └── world/           # World state operations
│   │       ├── index.ts     # World operations adapter
│   │       ├── ops.ts       # Domain operations
│   │       └── signature.ts # World state signatures
│   ├── types/               # TypeScript type definitions
│   │   └── world.ts         # World state types
│   └── utils/               # Utility functions
│       └── NavSystem.ts     # Navigation system
├── viewer/                  # 3D visualization components
│   ├── Hostel3DScene.tsx    # Main 3D scene
│   ├── AgentMesh.tsx        # Agent 3D representation
│   ├── RoomMesh.tsx         # Room 3D representation
│   ├── CameraRig.tsx        # Camera controls
│   ├── EnvObjectMesh.tsx    # Environment objects
│   └── ...
├── ui/                      # UI components
│   ├── AgentPanel.tsx       # Agent information panel
│   └── EventLog.tsx         # Simulation events log
├── services/                # External services
│   └── geminiService.ts     # Gemini AI integration
├── mock/                    # Mock data for testing
│   └── worldMock.ts         # World state mocks
├── cloudrun-proxy/          # Cloud Run proxy service
│   ├── server.ts            # Proxy server
│   ├── gcsStore.ts          # GCS record/replay storage
│   ├── rateLimit.ts         # Rate limiting
│   ├── validate.ts          # Request validation
│   └── ...
├── App.tsx                  # Main application component
├── index.tsx                # Entry point
├── headless-run.ts          # Headless testing runner
├── headless.golden.json     # Golden test file
├── replay_golden.json       # Replay test file
├── metadata.json            # Application metadata
├── referense.md             # Technical reference
├── CHANGELOG.md             # Project changelog
└── ARCHITECTURE.md          # Architecture documentation
```

## Testing

### Headless Testing

The project includes comprehensive headless testing to ensure determinism and correctness:

```bash
npm run test:headless
```

**What it does:**
- Runs the simulation without UI in a deterministic environment
- Uses injected clock instead of `Date.now()` for reproducible results
- Compares output against golden files (`headless.golden.json`, `replay_golden.json`)
- Verifies that identical inputs produce identical outputs
- Tests record/replay functionality for AI decisions

**Test files:**
- `headless-run.ts`: Main headless test runner
- `headless.golden.json`: Expected output for headless runs
- `replay_golden.json`: Expected output for replay mode

**Deterministic Clock:**
In headless mode, time is injected manually to ensure reproducibility:
- No `Date.now()` usage in simulation code
- Manual clock advances deterministically
- Identical seed + identical input = identical output

### Cloud Run Proxy Testing

See [cloudrun-proxy/README.md](./cloudrun-proxy/README.md) for proxy testing instructions.

## Cloud Run Proxy

The Cloud Run proxy service provides record/replay functionality for AI decisions:

- **Replay Mode**: Read-only from GCS, returns 404 on cache miss
- **Record Mode**: Write-once to GCS, subsequent reads from cache
- **Live Mode**: Compute decisions with rate limiting and in-memory cache

### Setting Up the Proxy

1. Navigate to the proxy directory:
   ```bash
   cd cloudrun-proxy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   $env:PROXY_MODE="replay"  # or "record" or "live"
   $env:DECISION_STORE_GCS_BUCKET="your-bucket-name"
   $env:DECISION_STORE_PREFIX="records"
   ```

4. Run locally:
   ```bash
   npm run dev
   ```

See [cloudrun-proxy/README.md](./cloudrun-proxy/README.md) for detailed setup and GCS IAM configuration.

## Available Scripts

- `npm run dev` - Start development server on port 3000
- `npm run build` - Build production bundle to `dist/` directory
- `npm run preview` - Preview production build locally
- `npm run test:headless` - Run deterministic headless tests with golden file verification

## Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

Preview the production build:

```bash
npm run preview
```

## Application Metadata

The `metadata.json` file contains application metadata used for deployment and configuration:

```json
{
  "name": "San Miguel Hostel 3D Viewer",
  "description": "A pure WebGL visualization module for the San Miguel Hostel simulation",
  "requestFramePermissions": []
}
```

## Agent Actions

Agents can perform the following actions:

- `IDLE`: Do nothing
- `GO_TO_ROOM`: Move to a specific room
- `EAT_IN_KITCHEN`: Eat in the kitchen (requires being in kitchen)
- `REST_IN_DORM`: Rest in a dorm room (requires being in a room with beds)
- `TALK_TO_AGENT`: Interact with another agent
- `CALM_SOMEONE`: Calm down another agent
- `START_CONFLICT`: Start a conflict with another agent
- `REPORT_TO_GUARD`: Report an incident
- `WANDER`: Move randomly in current room

## Determinism

The simulation is fully deterministic to ensure reproducible results:

**Core Principles:**
- Fixed timestep: `SIM_DT = 1/30` seconds
- Deterministic random seed initialization
- Manual clock injection in headless mode (no `Date.now()`)
- Atomic buffer operations prevent race conditions
- Transactional tick pipeline ensures consistency

**Deterministic Clock:**
In headless/test environments:
- Time is injected manually via `WorldOps.getNowMs()`
- Clock advances deterministically per tick
- Eliminates system time dependencies
- Ensures identical runs produce identical outputs

**Fixed Timestep Loop:**
- Accumulator collects real time between frames
- `MAX_TICKS_PER_FRAME = 5` prevents spiral-of-death
- `MAX_ACCUM = SIM_DT * MAX_TICKS_PER_FRAME` clamps accumulator
- Excess time produces `SIM_DROPPED_TICKS` events

**Benefits:**
- Reproducible testing across different machines
- Record/replay functionality for AI decisions
- Golden file verification for regression testing
- Deterministic debugging and analysis

## Development

### Key Concepts

1. **WorldState is write-only via engine**: Only the engine tick can mutate world state
2. **Async never knows about the world**: Workers only handle transport, not world state
3. **React is not the source of truth**: React handles visualization, not simulation
4. **All side effects go through EngineRuntime**: Command buffer, queue, and decision buffer

### Adding New Features

When adding features:

1. Ensure determinism is preserved
2. Follow the engine contract (see ARCHITECTURE.md)
3. Add appropriate engine events for diagnostics
4. Update headless tests if behavior changes

## License

See [LICENSE](./LICENSE) file for details.

## Contributing

1. Ensure all tests pass: `npm run test:headless`
2. Follow the architectural contract in ARCHITECTURE.md
3. Maintain determinism for all simulation logic
4. Add appropriate documentation for new features

## Troubleshooting

### Installation Issues

**Node.js version problems:**
```bash
node --version  # Should be v18.0.0 or higher
npm --version   # Should be v8.0.0 or higher
```

**Dependencies installation fails:**
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Development Issues

**Application won't start:**
- Check if port 3000 is available
- Verify `.env.local` file exists with correct API key
- Check console for TypeScript compilation errors

**3D scene not rendering:**
- Verify WebGL support in browser
- Check browser console for Three.js errors
- Ensure all React Three Fiber dependencies are installed

### Proxy Issues

If the Cloud Run proxy isn't working:

1. **GCS Permissions:** Check IAM permissions (see cloudrun-proxy/README.md)
2. **Authentication:** Verify ADC is configured:
   ```bash
   gcloud auth application-default login
   ```
3. **Environment Variables:** Ensure proxy URL is correct:
   ```bash
   $env:VITE_PROXY_URL="https://your-proxy-url.run.app"
   ```
4. **Proxy Logs:** Check Cloud Run logs for errors
5. **CORS Issues:** Verify proxy allows requests from your domain

### Determinism Issues

If headless tests fail:

1. **Time Dependencies:** Check for `Date.now()` usage in simulation code
2. **Random Seed:** Verify random number generation uses the provided seed
3. **Async Operations:** Ensure all async operations are deterministic
4. **Buffer Operations:** Check that atomic drains work correctly
5. **Context Hash:** Verify context hash stability for decision filtering

### Performance Issues

**Simulation running slow:**
- Check `SIM_DROPPED_TICKS` events in the event log
- Reduce number of agents (`?agents=3` instead of `?agents=6`)
- Ensure browser tab is active (simulation pauses when tab is hidden)

**UI freezing:**
- Check browser developer tools for memory leaks
- Verify React components aren't causing excessive re-renders
- Monitor engine tick rate in the UI

### UI Not Updating

- **Console Errors:** Check browser console for JavaScript errors
- **Engine Status:** Verify engine loop is running (check tick counter in UI)
- **React State:** Ensure React state updates are happening
- **WebSocket:** If using live mode, check proxy connection status
- **Deterministic Mode:** In headless mode, UI updates may be throttled

### AI Decision Issues

**Agents not making decisions:**
- Verify Gemini API key is configured correctly
- Check API quota limits
- Monitor decision worker logs
- Ensure proxy is in correct mode (live/record/replay)

**Inconsistent decisions:**
- Check context hash stability
- Verify decision filtering (duplicate/stale detection)
- Monitor TTL set for expired decisions

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architectural documentation and engine contract
- [cloudrun-proxy/README.md](./cloudrun-proxy/README.md) - Cloud Run proxy service documentation
- [CHANGELOG.md](./CHANGELOG.md) - Project changelog and release history
- [referense.md](./referense.md) - Technical reference with TypeScript interfaces and contracts
