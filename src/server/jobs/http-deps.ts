import 'server-only';

import { getDb } from '@/server/db/client';
import { getAnalysisRuntime } from '@/server/n8n/runtime';

import type { JobsHttpDeps } from './http';

export const jobsHttpDeps: JobsHttpDeps = { getDb, getRuntime: getAnalysisRuntime };
