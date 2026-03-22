import {
  createMcpServer,
  type Tool,
  type ToolCallCallback,
} from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import { getChartResources } from './chart-resource.js';
import { createContentApiClient } from './content-api/index.js';
import type { SupabasePlatform } from './platform/types.js';
import { getAccountTools } from './tools/account-tools.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getDocsTools } from './tools/docs-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getStorageTools } from './tools/storage-tools.js';
import type { FeatureGroup } from './types.js';
import { parseFeatureGroups } from './util.js';

const { version } = packageJson;

export type SupabaseMcpServerOptions = {
  platform: SupabasePlatform;
  contentApiUrl?: string;
  projectId?: string;
  readOnly?: boolean;
  features?: string[];
  allowedTools?: string[];
  allowedSchemas?: string[];
  onToolCall?: ToolCallCallback;
};

const DEFAULT_FEATURES: FeatureGroup[] = [
  'docs',
  'account',
  'database',
  'debugging',
  'development',
  'functions',
  'branching',
];

export const PLATFORM_INDEPENDENT_FEATURES: FeatureGroup[] = ['docs'];

export function createSupabaseMcpServer(options: SupabaseMcpServerOptions) {
  const {
    platform,
    projectId,
    readOnly,
    features,
    allowedTools,
    allowedSchemas,
    contentApiUrl = 'https://supabase.com/docs/api/graphql',
    onToolCall,
  } = options;

  const contentApiClientPromise = createContentApiClient(contentApiUrl, {
    'User-Agent': `supabase-mcp/${version}`,
  });

  const allowedToolSet =
    allowedTools && allowedTools.length > 0 ? new Set(allowedTools) : null;

  const availableDefaultFeatures = DEFAULT_FEATURES.filter(
    (key) =>
      PLATFORM_INDEPENDENT_FEATURES.includes(key) ||
      Object.keys(platform).includes(key)
  );

  const enabledFeatures = parseFeatureGroups(
    platform,
    features ?? availableDefaultFeatures
  );

  const server = createMcpServer({
    name: 'supabase',
    title: 'Supabase',
    version,
    async onInitialize(info) {
      const { clientInfo } = info;
      const userAgent = `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`;

      await Promise.all([
        platform.init?.(info),
        contentApiClientPromise.then((client) =>
          client.setUserAgent(userAgent)
        ),
      ]);
    },
    onToolCall,
    resources: getChartResources(),
    tools: async () => {
      const contentApiClient = await contentApiClientPromise;
      const tools: Record<string, Tool> = {};

      const {
        account,
        database,
        functions,
        debugging,
        development,
        storage,
        branching,
      } = platform;

      if (enabledFeatures.has('docs')) {
        Object.assign(tools, getDocsTools({ contentApiClient }));
      }

      if (!projectId && account && enabledFeatures.has('account')) {
        Object.assign(tools, getAccountTools({ account, readOnly }));
      }

      if (database && enabledFeatures.has('database')) {
        Object.assign(
          tools,
          getDatabaseTools({
            database,
            projectId,
            readOnly,
            allowedSchemas,
          })
        );
      }

      if (debugging && enabledFeatures.has('debugging')) {
        Object.assign(tools, getDebuggingTools({ debugging, projectId }));
      }

      if (development && enabledFeatures.has('development')) {
        Object.assign(tools, getDevelopmentTools({ development, projectId }));
      }

      if (functions && enabledFeatures.has('functions')) {
        Object.assign(
          tools,
          getEdgeFunctionTools({ functions, projectId, readOnly })
        );
      }

      if (branching && enabledFeatures.has('branching')) {
        Object.assign(
          tools,
          getBranchingTools({ branching, projectId, readOnly })
        );
      }

      if (storage && enabledFeatures.has('storage')) {
        Object.assign(tools, getStorageTools({ storage, projectId, readOnly }));
      }

      if (!allowedToolSet) {
        return tools;
      }

      return Object.fromEntries(
        Object.entries(tools).filter(([name]) => allowedToolSet.has(name))
      );
    },
  });

  return server;
}
