# Phase 6: Web Dashboard - Research

**Researched:** 2026-02-28
**Domain:** React SPA, PWA, task dashboard (kanban + list views), Cloudflare Pages deployment
**Confidence:** HIGH

## Summary

Phase 6 builds a supplementary web dashboard as a React SPA deployed to Cloudflare Pages. The dashboard reads from the same PostgreSQL database as the Telegram bot (via REST API endpoints added to the NestJS backend on Fly.io) and provides two views: a kanban board (tasks as cards in status columns) and a sortable list/table view. Users can filter by workspace, status, and deadline range. The dashboard is a PWA (installable, app-like experience) but offline-first with IndexedDB sync is explicitly deferred to v2 (DASH-03).

The standard stack is React 19 + Vite 6 + TypeScript for the SPA, Tailwind CSS v4 + shadcn/ui for the component system, TanStack Query v5 for server state management, TanStack Router for type-safe client-side routing, TanStack Table v8 for the list view, and @dnd-kit/react for kanban drag-and-drop. The NestJS backend needs new REST controllers (TaskController, WorkspaceController) that expose the existing services over HTTP with CORS configured for the Cloudflare Pages domain. Deployment uses Cloudflare Pages with `wrangler deploy` or git-connected auto-deploys.

The project already decided "React on Cloudflare Pages" (PROJECT.md). The existing backend has TaskService and WorkspaceService with full CRUD but no HTTP controllers -- only NestJS module-level DI consumers (Telegram handlers). Phase 6 depends only on Phase 1 (core task/workspace services), not on Phases 3-5.

**Primary recommendation:** Create the dashboard as a separate `dashboard/` directory in the monorepo root (not a separate repo) with its own `package.json`, Vite config, and Tailwind setup. Add REST controllers to the NestJS backend that wrap existing services. Use shadcn/ui Data Table for list view and build kanban with @dnd-kit/react + shadcn/ui Card components. Use TanStack Query for all data fetching with automatic refetching.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | User can access web dashboard PWA to view and manage tasks | React 19 + Vite 6 SPA deployed to Cloudflare Pages (free tier). PWA via vite-plugin-pwa with web manifest and basic service worker for installability. NestJS REST controllers expose TaskService/WorkspaceService over HTTP. CORS configured for dashboard domain. Single-user auth via shared secret or API key header (no login UI needed). |
| DASH-02 | Dashboard provides kanban view, list view, and filters by workspace/status/deadline | Kanban: @dnd-kit/react for drag-and-drop between status columns, shadcn/ui Card for task cards. List: TanStack Table v8 with shadcn/ui Data Table pattern for sortable columns. View toggle: single state variable switches between components. Filters: TanStack Table column filtering for list view, manual filter state for kanban, synced via shared filter context. Workspace filter via TanStack Query parameterized queries. Status and deadline filters via client-side filtering on cached data. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19 | UI framework | Locked decision in PROJECT.md ("React on Cloudflare Pages"). Latest stable. |
| Vite | 6 | Build tool and dev server | Standard build tool for React SPAs. First-class Cloudflare Pages support. HMR, TypeScript, fast builds. |
| TypeScript | ~5.5+ | Type safety | Already used in backend. Consistent across monorepo. |
| Tailwind CSS | 4 | Utility-first CSS | v4 has first-party Vite plugin (@tailwindcss/vite), zero-config setup, 5x faster builds. Standard pairing with shadcn/ui. |
| shadcn/ui | latest | Component library (copy-paste, not dependency) | De facto standard for React + Tailwind. Provides Data Table, Card, Button, Select, Popover, Calendar -- all needed for dashboard. Full source ownership. |
| TanStack Query | 5 | Server state management | Caching, deduplication, background refetch, optimistic updates. Standard for React apps fetching REST APIs. |
| TanStack Router | latest | Client-side routing | Type-safe routing for SPAs with Vite. Better type safety than React Router v7 in SPA mode. File-based route generation optional. |
| TanStack Table | 8 | Headless table logic | Powers shadcn/ui Data Table. Sorting, filtering, pagination, column visibility -- all client-side. |
| @dnd-kit/react | ~0.3 | Drag-and-drop for kanban | New React-specific package (successor to @dnd-kit/core). Actively maintained. Lightweight, accessible, supports sortable columns. |
| vite-plugin-pwa | ~0.21+ | PWA manifest + service worker | Zero-config PWA for Vite. Generates web manifest, registers service worker, handles caching strategy. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @dnd-kit/helpers | latest | Utilities for dnd-kit | Used alongside @dnd-kit/react for sortable, collision detection algorithms |
| date-fns | 4 | Date formatting/comparison | Deadline display, date range filtering, relative time ("due in 3 days") |
| lucide-react | latest | Icons | shadcn/ui's icon system. Consistent iconography. |
| class-variance-authority | latest | Variant styling | Required by shadcn/ui components |
| clsx + tailwind-merge | latest | Class merging | Required by shadcn/ui's `cn()` utility |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TanStack Router | React Router v7 | React Router v7 SPA mode lacks the type safety TanStack Router provides. TanStack Router has better search param handling for filter state in URL. |
| @dnd-kit/react | @hello-pangea/dnd | hello-pangea/dnd is higher-level (easier kanban out of box) but less flexible and heavier. dnd-kit is more actively maintained with the new React-specific package. |
| shadcn/ui Data Table | AG Grid / react-table standalone | AG Grid is overkill and adds bundle size. shadcn/ui Data Table wraps TanStack Table with styled components -- exactly right for this scale (<1000 tasks). |
| Separate dashboard repo | Monorepo subfolder | Separate repo adds complexity for shared types and deployment coordination. Subfolder in same repo allows sharing Prisma-generated types and simpler CI. |
| Kibo UI Kanban | Custom with dnd-kit | Kibo UI provides a pre-built kanban component for shadcn/ui but adds a dependency. For a simple 6-column kanban, building with dnd-kit + shadcn Card gives more control and fewer dependencies. |

**Installation (dashboard directory):**
```bash
# Scaffold
npm create vite@latest dashboard -- --template react-ts
cd dashboard

# Core dependencies
npm install @tanstack/react-query @tanstack/react-router @tanstack/react-table
npm install @dnd-kit/react @dnd-kit/helpers
npm install date-fns lucide-react

# Tailwind CSS v4
npm install tailwindcss @tailwindcss/vite

# PWA
npm install -D vite-plugin-pwa

# shadcn/ui init (after Tailwind setup)
npx shadcn@latest init
npx shadcn@latest add button card table data-table select popover calendar badge input tabs
```

## Architecture Patterns

### Recommended Project Structure
```
cortex/                          # Existing monorepo root
├── src/                         # Existing NestJS backend
│   ├── task/
│   │   ├── task.controller.ts   # NEW: REST endpoints for tasks
│   │   └── task.service.ts      # Existing
│   ├── workspace/
│   │   ├── workspace.controller.ts  # NEW: REST endpoints for workspaces
│   │   └── workspace.service.ts     # Existing
│   └── main.ts                  # Add CORS configuration
├── dashboard/                   # NEW: React SPA
│   ├── public/
│   │   └── icons/               # PWA icons (192x192, 512x512)
│   ├── src/
│   │   ├── main.tsx             # App entry point
│   │   ├── App.tsx              # Router provider + QueryClient provider
│   │   ├── api/
│   │   │   ├── client.ts        # Fetch wrapper with base URL + auth header
│   │   │   ├── tasks.ts         # Task API functions (getTasks, updateTask, etc.)
│   │   │   └── workspaces.ts    # Workspace API functions
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui components (auto-generated)
│   │   │   ├── kanban/
│   │   │   │   ├── KanbanBoard.tsx      # DragDropProvider + status columns
│   │   │   │   ├── KanbanColumn.tsx     # Droppable column for a status
│   │   │   │   └── KanbanCard.tsx       # Draggable task card
│   │   │   ├── list/
│   │   │   │   ├── TaskTable.tsx        # TanStack Table + shadcn Data Table
│   │   │   │   └── columns.tsx          # Column definitions with sorting
│   │   │   ├── filters/
│   │   │   │   ├── FilterBar.tsx        # Combined filter controls
│   │   │   │   ├── WorkspaceFilter.tsx  # Workspace selector
│   │   │   │   ├── StatusFilter.tsx     # Multi-select status filter
│   │   │   │   └── DeadlineFilter.tsx   # Date range picker
│   │   │   └── layout/
│   │   │       ├── DashboardLayout.tsx  # Shell with sidebar/header
│   │   │       └── ViewToggle.tsx       # Kanban <-> List switch
│   │   ├── hooks/
│   │   │   ├── useTasks.ts             # TanStack Query hook for tasks
│   │   │   ├── useWorkspaces.ts        # TanStack Query hook for workspaces
│   │   │   └── useFilters.ts           # Filter state management
│   │   ├── lib/
│   │   │   └── utils.ts                # cn() utility from shadcn
│   │   ├── routes/
│   │   │   ├── __root.tsx              # Root route with layout
│   │   │   └── index.tsx               # Dashboard page (kanban/list)
│   │   └── types/
│   │       └── task.ts                 # Shared types (mirroring Prisma types)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── components.json                 # shadcn/ui config
│   └── package.json
├── package.json                 # Backend package.json (existing)
├── prisma/                      # Existing Prisma schema
└── wrangler.toml                # Cloudflare Pages config for dashboard
```

### Pattern 1: NestJS REST Controller (Backend Addition)
**What:** Add HTTP controllers to expose existing TaskService and WorkspaceService over REST
**When to use:** Required for the dashboard to communicate with the backend

```typescript
// src/task/task.controller.ts
import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { TaskService } from './task.service';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('api/tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  async findAll(@Query('workspaceId') workspaceId?: string) {
    // If no workspace specified, return tasks from all workspaces
    if (workspaceId) {
      return this.taskService.findAll(workspaceId);
    }
    // Need to add a findAllAcrossWorkspaces method to TaskService
    return this.taskService.findAllAcrossWorkspaces();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Query('workspaceId') workspaceId: string) {
    return this.taskService.findOne(id, workspaceId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.taskService.update(id, workspaceId, dto);
  }
}
```

### Pattern 2: CORS Configuration (Backend Addition)
**What:** Enable CORS on the NestJS backend for the Cloudflare Pages domain
**When to use:** Required for cross-origin requests from dashboard

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
    methods: ['GET', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

### Pattern 3: API Client with Auth (Dashboard)
**What:** Fetch wrapper that adds base URL and API key header for single-user auth
**When to use:** All API calls from the dashboard

```typescript
// dashboard/src/api/client.ts
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const API_KEY = import.meta.env.VITE_API_KEY;

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
```

### Pattern 4: TanStack Query Hook for Tasks
**What:** Custom hook wrapping useQuery for task data with workspace/filter parameters
**When to use:** In both kanban and list view components

```typescript
// dashboard/src/hooks/useTasks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { Task } from '../types/task';

export function useTasks(workspaceId?: string) {
  return useQuery({
    queryKey: ['tasks', { workspaceId }],
    queryFn: () =>
      apiClient<Task[]>(
        workspaceId ? `/api/tasks?workspaceId=${workspaceId}` : '/api/tasks',
      ),
    staleTime: 30_000, // 30 seconds before refetch
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      workspaceId,
      data,
    }: {
      id: string;
      workspaceId: string;
      data: Partial<Task>;
    }) =>
      apiClient<Task>(`/api/tasks/${id}?workspaceId=${workspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
```

### Pattern 5: Kanban Board with dnd-kit
**What:** Drag-and-drop kanban board using @dnd-kit/react with status columns
**When to use:** Kanban view of the dashboard

```typescript
// dashboard/src/components/kanban/KanbanBoard.tsx
import { DragDropProvider } from '@dnd-kit/react';
import { move } from '@dnd-kit/helpers';
import { KanbanColumn } from './KanbanColumn';
import type { Task } from '../../types/task';

const STATUS_COLUMNS = ['captured', 'active', 'in_progress', 'done', 'blocked', 'deferred'] as const;

interface KanbanBoardProps {
  tasks: Task[];
  onStatusChange: (taskId: string, newStatus: string) => void;
}

export function KanbanBoard({ tasks, onStatusChange }: KanbanBoardProps) {
  // Group tasks by status
  const columns = STATUS_COLUMNS.reduce((acc, status) => {
    acc[status] = tasks.filter((t) => t.status === status);
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        const { source, target } = event.operation;
        if (target && source) {
          const taskId = source.id as string;
          const newStatus = target.id as string;
          onStatusChange(taskId, newStatus);
        }
      }}
    >
      <div className="flex gap-4 overflow-x-auto p-4">
        {STATUS_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={columns[status] ?? []}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}
```

### Pattern 6: List View with TanStack Table + shadcn
**What:** Sortable, filterable data table using TanStack Table v8 with shadcn/ui styling
**When to use:** List view of the dashboard

```typescript
// dashboard/src/components/list/columns.tsx
import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '../ui/badge';
import type { Task } from '../../types/task';

export const columns: ColumnDef<Task>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue('title')}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <Badge variant="outline">{row.getValue('status')}</Badge>,
    filterFn: 'arrIncludesSome', // Multi-select filter
  },
  {
    accessorKey: 'priority',
    header: 'Priority',
  },
  {
    accessorKey: 'deadline',
    header: 'Deadline',
    cell: ({ row }) => {
      const deadline = row.getValue('deadline') as string | null;
      return deadline ? formatDate(deadline) : '--';
    },
  },
  {
    accessorKey: 'workspace',
    header: 'Workspace',
    accessorFn: (row) => row.workspace?.name ?? 'Unknown',
  },
];
```

### Pattern 7: View Toggle with URL State
**What:** Switch between kanban and list view, persisted in URL search params
**When to use:** Dashboard page component

```typescript
// dashboard/src/components/layout/ViewToggle.tsx
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { LayoutGrid, List } from 'lucide-react';

interface ViewToggleProps {
  view: 'kanban' | 'list';
  onViewChange: (view: 'kanban' | 'list') => void;
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as 'kanban' | 'list')}>
      <TabsList>
        <TabsTrigger value="kanban">
          <LayoutGrid className="mr-2 h-4 w-4" />
          Kanban
        </TabsTrigger>
        <TabsTrigger value="list">
          <List className="mr-2 h-4 w-4" />
          List
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
```

### Pattern 8: PWA Configuration with vite-plugin-pwa
**What:** Minimal PWA setup for installability (not offline-first, that is DASH-03 / v2)
**When to use:** Vite config

```typescript
// dashboard/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Cortex Dashboard',
        short_name: 'Cortex',
        description: 'Task management dashboard',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Pattern 9: Cloudflare Pages Deployment
**What:** Deploy static SPA to Cloudflare Pages
**When to use:** Production deployment

```toml
# dashboard/wrangler.toml (or wrangler.json)
name = "cortex-dashboard"
compatibility_date = "2025-01-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

Deploy with:
```bash
cd dashboard && npm run build && npx wrangler pages deploy dist
```

Or connect the GitHub repo for automatic deploys on push.

### Anti-Patterns to Avoid
- **Sharing node_modules between backend and dashboard:** Keep separate `package.json` files. The backend uses CommonJS modules (NestJS), the dashboard uses ESM (Vite). Mixing them causes resolution issues.
- **Fetching data in every component:** Use TanStack Query's caching. Fetch once in the page component, pass data down or let child components use the same query key (deduplicated automatically).
- **Server-side rendering on Cloudflare Pages for this use case:** This is a simple SPA with a single user. SSR adds complexity with no benefit. Use plain client-side rendering.
- **Building offline-first in Phase 6:** DASH-03 (IndexedDB + service worker sync) is explicitly a v2 requirement. Do not build it now. The PWA setup here is for installability only.
- **Custom auth system:** This is a single-user app. A simple API key in an environment variable (checked via NestJS guard) is sufficient. Do not build login/session/JWT infrastructure.
- **Polling for real-time updates:** TanStack Query's `staleTime` + `refetchInterval` provides "good enough" freshness for a solo user. WebSockets are overkill.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Data table with sorting/filtering | Custom table with sort handlers | TanStack Table v8 + shadcn Data Table | Handles column resize, sort indicators, filter UIs, pagination, virtual scrolling for large datasets |
| Drag-and-drop kanban | Custom mouse/touch event handlers | @dnd-kit/react | Handles collision detection, keyboard accessibility, touch support, animation, scroll during drag |
| Server state management | Custom fetch + useState + useEffect | TanStack Query v5 | Caching, deduplication, background refetch, optimistic updates, retry, abort signals -- all solved |
| Component styling system | Custom CSS or styled-components | Tailwind CSS v4 + shadcn/ui | Consistent design system with accessible components. Copy-paste ownership means no dependency lock-in. |
| PWA manifest + service worker | Manual manifest.json + custom SW | vite-plugin-pwa | Auto-generates manifest, handles SW registration, workbox integration, update prompts |
| Client-side routing | Custom history API wrapper | TanStack Router | Type-safe routes, search param management (for filter state in URL), code splitting |
| Date formatting | Custom date string manipulation | date-fns | Locale-aware formatting, relative time, date range comparison, timezone handling |

**Key insight:** The dashboard is a read-heavy, single-user app with well-understood UI patterns (kanban + table). Every component of this stack is a solved problem. The value is in correct assembly and integration with the existing backend, not in novel solutions.

## Common Pitfalls

### Pitfall 1: CORS Misconfiguration Between Fly.io and Cloudflare Pages
**What goes wrong:** Dashboard fetches fail with "No 'Access-Control-Allow-Origin' header" errors in the browser console.
**Why it happens:** The NestJS backend on Fly.io doesn't have CORS configured, or the allowed origin doesn't match the Cloudflare Pages domain exactly (including protocol and lack of trailing slash).
**How to avoid:** Configure CORS in `main.ts` with the exact Cloudflare Pages URL as the origin. Use environment variable for the URL. Test with `curl -H "Origin: https://cortex-dashboard.pages.dev" -I` to verify headers.
**Warning signs:** 403 or missing Access-Control headers in network tab; API calls work in Postman but fail in browser.

### Pitfall 2: Stale Kanban After Drag-and-Drop
**What goes wrong:** User drags a task to a new status column, but the card snaps back to its original position after a moment.
**Why it happens:** The mutation to update task status on the server fails or is slow, and TanStack Query refetches the stale data before the mutation completes.
**How to avoid:** Use optimistic updates in TanStack Query. On drag end, immediately update the local cache (move the task in the query data), then mutate the server. If the server call fails, the `onError` callback rolls back the optimistic update.
**Warning signs:** Tasks "bouncing" back to original columns after drag; brief flicker on status change.

### Pitfall 3: Type Drift Between Backend and Dashboard
**What goes wrong:** Dashboard TypeScript types don't match the actual API response shape, causing runtime errors or silent data loss.
**Why it happens:** Prisma schema changes in the backend aren't reflected in dashboard type definitions. There's no shared type source.
**How to avoid:** Export Prisma-generated types from the backend or maintain a shared `types/` package. At minimum, generate types from the API response (or use Zod schemas shared between backend DTOs and dashboard). For this single-dev project, manually mirroring the Task type is acceptable if kept in sync.
**Warning signs:** `undefined` values where data is expected; TypeScript errors that don't match API behavior.

### Pitfall 4: Cloudflare Pages SPA Routing 404s
**What goes wrong:** Direct URL navigation to dashboard routes (e.g., `/tasks?view=kanban`) returns a 404 error.
**Why it happens:** Cloudflare Pages serves static files. Without SPA routing configuration, any path that doesn't match a file returns 404.
**How to avoid:** Set `not_found_handling = "single-page-application"` in wrangler.toml `[assets]` section. This makes all unmatched routes serve `index.html`, letting TanStack Router handle client-side routing.
**Warning signs:** Refresh on any non-root URL gives 404; only the homepage works.

### Pitfall 5: Bundle Size Bloat from shadcn/ui
**What goes wrong:** The dashboard bundle becomes larger than expected (>500KB gzipped).
**Why it happens:** Importing all shadcn/ui components even when not used, or importing heavy date picker libraries.
**How to avoid:** Only add shadcn/ui components you actually use (`npx shadcn add` is selective). shadcn/ui copies source files, not library imports, so tree-shaking isn't the concern -- it's about not generating unused component files. Keep the component list minimal.
**Warning signs:** `vite build --report` shows large chunks from unused components.

### Pitfall 6: Filter State Lost on Navigation
**What goes wrong:** User applies filters (workspace: Work, status: active), switches views or refreshes, and filters reset to defaults.
**Why it happens:** Filter state is stored in React component state (useState) which doesn't survive navigation or refresh.
**How to avoid:** Store filter state in URL search parameters using TanStack Router's `searchParams`. This persists across navigation and page refreshes, and makes filtered views shareable/bookmarkable.
**Warning signs:** Filters reset on view toggle (kanban <-> list) or on browser refresh.

## Code Examples

### Cloudflare Pages SPA Config
```toml
# dashboard/wrangler.toml
# Source: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
name = "cortex-dashboard"
compatibility_date = "2025-01-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

### TanStack Query Provider Setup
```typescript
// dashboard/src/App.tsx
// Source: https://tanstack.com/query/v5/docs/framework/react/overview
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s before data considered stale
      refetchInterval: 60_000, // Refetch every 60s for freshness
    },
  },
});

const router = createRouter({ routeTree });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

### Optimistic Kanban Drag Update
```typescript
// Source: https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useOptimisticStatusUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, workspaceId, newStatus }: {
      taskId: string;
      workspaceId: string;
      newStatus: string;
    }) =>
      apiClient(`/api/tasks/${taskId}?workspaceId=${workspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      }),

    onMutate: async ({ taskId, newStatus }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] });

      // Snapshot previous value
      const previousTasks = queryClient.getQueryData(['tasks']);

      // Optimistically update the cache
      queryClient.setQueryData(['tasks'], (old: Task[]) =>
        old?.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
      );

      return { previousTasks };
    },

    onError: (_err, _vars, context) => {
      // Roll back on error
      queryClient.setQueryData(['tasks'], context?.previousTasks);
    },

    onSettled: () => {
      // Always refetch after mutation
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
```

### NestJS API Key Guard (Simple Single-User Auth)
```typescript
// src/guards/api-key.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    const expected = this.config.get<string>('DASHBOARD_API_KEY');

    if (!expected) return true; // No key configured = open (dev mode)
    if (apiKey !== expected) throw new UnauthorizedException();
    return true;
  }
}
```

### Filter State in URL Search Params
```typescript
// dashboard/src/routes/index.tsx
// Source: TanStack Router search params
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const searchSchema = z.object({
  view: z.enum(['kanban', 'list']).default('kanban'),
  workspace: z.string().optional(),
  status: z.array(z.string()).optional(),
  deadlineFrom: z.string().optional(),
  deadlineTo: z.string().optional(),
});

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  component: DashboardPage,
});

function DashboardPage() {
  const { view, workspace, status, deadlineFrom, deadlineTo } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Filter state is in URL -- survives refresh and view toggle
  const setView = (v: 'kanban' | 'list') =>
    navigate({ search: (prev) => ({ ...prev, view: v }) });

  // ... render kanban or list based on `view`
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Create React App (CRA) | Vite 6 | 2023-2024 (CRA deprecated) | Vite is the standard React SPA build tool. CRA is unmaintained. |
| Tailwind CSS v3 (config file) | Tailwind CSS v4 (@tailwindcss/vite plugin) | Jan 2025 | Zero-config setup with Vite plugin. No tailwind.config.js needed. `@import "tailwindcss"` replaces directives. |
| @dnd-kit/core + @dnd-kit/sortable | @dnd-kit/react + @dnd-kit/helpers | 2025-2026 | New React-specific package with simpler API. Migration guide available. |
| React Router v6 | TanStack Router (or React Router v7) | 2024-2025 | TanStack Router provides superior type safety for SPAs, especially for search param handling. |
| useEffect + fetch | TanStack Query v5 | 2023 (v5 stable) | Eliminates manual loading/error states, caching, deduplication. Standard in production React apps. |
| shadcn/ui v1 (Tailwind v3) | shadcn/ui latest (Tailwind v4) | 2025 | Use `npx shadcn@latest init` with Tailwind v4. Do NOT use `shadcn@2.3.0` which targets v3. |
| Manual PWA setup | vite-plugin-pwa | 2022+ | Zero-config PWA with Workbox integration. Handles manifest, SW registration, update flow. |

**Deprecated/outdated:**
- Create React App (CRA): Deprecated, do not use. Use Vite.
- `@dnd-kit/core` v6: Being superseded by `@dnd-kit/react` v0.3+. Use the new package.
- `tailwind.config.js`: Eliminated in Tailwind v4. Configuration via CSS `@theme` directive.
- `@tailwind base; @tailwind components; @tailwind utilities;`: Replaced by `@import "tailwindcss"` in v4.

## Open Questions

1. **Dashboard subdirectory vs. separate package.json**
   - What we know: The dashboard needs its own `package.json` because it uses ESM/Vite while the backend uses CommonJS/NestJS. Both can live in the same git repository.
   - What's unclear: Whether to use a workspace manager (pnpm workspaces, npm workspaces) or simply a standalone `dashboard/` directory with its own independent `npm install`.
   - Recommendation: Use a standalone `dashboard/` directory with its own `package.json` and `node_modules`. This project is single-developer -- the overhead of workspace tooling (Turborepo, pnpm workspaces) is not justified. Keep it simple. Types can be manually mirrored since the data model is small and stable.

2. **Authentication for dashboard API access**
   - What we know: This is a single-user system. The Telegram bot uses chat_id for auth. The dashboard needs some auth mechanism for the REST API.
   - What's unclear: Whether a simple API key is sufficient or if a more robust mechanism is needed.
   - Recommendation: Use a simple API key (environment variable) passed as `X-API-Key` header from the dashboard. The NestJS backend validates it with a guard. No login page needed. The API key is set in Cloudflare Pages environment variables. This is sufficient for a single-user app where the dashboard URL itself is not publicly known.

3. **Sub-task display in kanban vs. list view**
   - What we know: Tasks can have one level of sub-tasks. The list view can show them as expandable rows. The kanban view needs a compact representation.
   - What's unclear: Whether to show sub-tasks as separate cards in the kanban or as a count/progress bar on the parent card.
   - Recommendation: In kanban view, show only parent tasks as cards with a sub-task progress indicator (e.g., "3/5 done"). In list view, show sub-tasks as expandable child rows. This keeps the kanban clean while allowing detailed inspection in the list view.

4. **Shared types between backend and dashboard**
   - What we know: The Prisma schema defines the data model. The dashboard needs TypeScript types matching the API response.
   - What's unclear: Whether to generate types from the Prisma schema or manually define them.
   - Recommendation: For v1, manually define a `Task` and `Workspace` type in `dashboard/src/types/` that mirrors the Prisma model. The data model is small (3 models) and stable. Automated type sharing can be added later if the models grow.

## Sources

### Primary (HIGH confidence)
- [Cloudflare Workers Docs - React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) - Wrangler config, SPA routing, Vite plugin
- [Cloudflare Workers Docs - SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) - `not_found_handling = "single-page-application"`
- [TanStack Query v5 Docs](https://tanstack.com/query/v5/docs/framework/react/overview) - useQuery, useMutation, optimistic updates
- [TanStack Table v8 Docs](https://tanstack.com/table/v8/docs/guide/column-filtering) - Column filtering, sorting, visibility
- [TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/comparison) - Type-safe routing, search params
- [shadcn/ui Vite Installation](https://ui.shadcn.com/docs/installation/vite) - Setup with Tailwind v4
- [shadcn/ui Data Table](https://ui.shadcn.com/docs/components/radix/data-table) - TanStack Table integration
- [Tailwind CSS v4 Announcement](https://tailwindcss.com/blog/tailwindcss-v4) - Vite plugin, zero-config
- [vite-plugin-pwa GitHub](https://github.com/vite-pwa/vite-plugin-pwa) - PWA setup, Workbox integration
- [dnd-kit Migration Guide](https://dndkit.com/react/guides/migration) - @dnd-kit/react new API
- [NestJS CORS Docs](https://docs.nestjs.com/security/cors) - enableCors configuration
- Existing codebase analysis - TaskService, WorkspaceService, Prisma schema, module structure

### Secondary (MEDIUM confidence)
- [Marmelab - Kanban Board with shadcn](https://marmelab.com/blog/2026/01/15/building-a-kanban-board-with-shadcn.html) - Jan 2026, kanban with dnd-kit + shadcn pattern
- [LogRocket - Kanban with dnd-kit](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) - dnd-kit kanban implementation pattern
- [TanStack Router vs React Router v7](https://medium.com/ekino-france/tanstack-router-vs-react-router-v7-32dddc4fcd58) - Jan 2026 comparison
- [Kibo UI](https://www.kibo-ui.com/) - shadcn/ui extension with Kanban component
- [DEV.to - Tailwind CSS v4 with Vite + React](https://dev.to/imamifti056/how-to-setup-tailwind-css-v415-with-vite-react-2025-updated-guide-3koc) - Setup guide verified against official docs
- [NestJS CORS Production Guide](https://felixastner.com/articles/enabling-cors-in-nestjs) - Origin whitelisting pattern

### Tertiary (LOW confidence)
- @dnd-kit/react v0.3.2 API stability: Package is at 0.x version (pre-1.0). API may change. If stability is a concern, @dnd-kit/core v6.3.1 (stable) with @dnd-kit/sortable is a fallback. Verified that migration guide exists.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React + Vite + Tailwind + shadcn/ui is the dominant SPA stack in 2026. All libraries verified via official docs. Cloudflare Pages deployment well-documented.
- Architecture: HIGH - Patterns sourced from official TanStack, shadcn/ui, and Cloudflare docs. REST controller pattern is standard NestJS. CORS configuration well-documented.
- Pitfalls: HIGH - Common issues sourced from official docs (CORS, SPA routing) and verified community patterns (optimistic updates, filter state persistence).
- dnd-kit/react version: MEDIUM - Package is 0.x, actively developed but pre-stable. Migration guide exists. Fallback to @dnd-kit/core v6 is straightforward.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable ecosystem, no major breaking changes expected)
