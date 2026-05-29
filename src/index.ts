interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * opendata.swiss MCP — Switzerland's federal open-data portal (CKAN catalogue).
 *
 * Auth: none (keyless CKAN action API). Docs: https://docs.ckan.org/en/latest/api/
 *
 * Multilingual quirk: opendata.swiss is a four-language portal, so most
 * human-readable fields (dataset `title`/`notes`, resource `title`, and
 * organization/group `title`/`description`) are objects keyed by language —
 * { de, fr, it, en } — and individual languages are frequently empty strings.
 * Raw CKAN results are returned untouched, but search/dataset/org/group tools
 * also include a flattened `*_en` (falling back to de → fr → it) plus a `*_i18n`
 * object so an LLM can read English where present without parsing the raw map.
 *
 * Datastore quirk: the portal does NOT enable the CKAN datastore (no
 * datastore_active resources exist), so there is no `datastore_search`. To get
 * the actual data, read a dataset's `resources[].download_url` / `url` from
 * dataset_details and fetch the file directly.
 */


const BASE = 'https://ckan.opendata.swiss/api/3/action';
const UA = 'pipeworx-mcp-opendata-swiss/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_datasets',
    description:
      'Search the opendata.swiss catalogue (CKAN package_search). Returns matching Swiss federal/cantonal datasets. Titles/descriptions are multilingual {de,fr,it,en}; each result is annotated with English-preferred `title_en`/`notes_en`.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query, e.g. "energy", "population", "ÖV".' },
        fq: { type: 'string', description: 'Solr filter query, e.g. "organization:bundesamt-fur-statistik-bfs" or "groups:health".' },
        rows: { type: 'number', description: '1-1000 (default 25).' },
        start: { type: 'number', description: '0-based offset for paging.' },
        sort: { type: 'string', description: 'e.g. "metadata_modified desc", "score desc".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'dataset_details',
    description:
      'Full metadata for one dataset (CKAN package_show) including its resources/distributions with download URLs. Use a dataset `name` (slug) or id from search_datasets. There is no datastore, so fetch `resources[].download_url`/`url` for the underlying data.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Dataset slug or id, e.g. "energie1".' } },
      required: ['id'],
    },
  },
  {
    name: 'list_organizations',
    description:
      'List publishing organizations (federal offices, cantons, etc.). Multilingual titles flattened to `title_en`. Use a returned `name` as `organization:<name>` in search_datasets `fq`.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '1-1000 (default 100).' } },
    },
  },
  {
    name: 'list_groups',
    description:
      'List thematic categories (CKAN groups / themes, e.g. health, education, energy). Multilingual titles flattened to `title_en`. Use a returned `name` as `groups:<name>` in search_datasets `fq`.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '1-1000 (default 100).' } },
    },
  },
  {
    name: 'list_tags',
    description: 'List or search keyword tags used across the catalogue (CKAN tag_list). Useful for discovering facet values.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional substring to filter tags.' },
        limit: { type: 'number', description: 'Cap returned tags client-side (default 200).' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_datasets': {
      const params = new URLSearchParams({
        q: reqStr(args, 'query', '"energy"'),
        rows: String(Math.min(1000, Math.max(1, (args.rows as number) ?? 25))),
        start: String(Math.max(0, (args.start as number) ?? 0)),
      });
      if (args.fq) params.set('fq', String(args.fq));
      if (args.sort) params.set('sort', String(args.sort));
      const result = (await ckanGet(`/package_search?${params}`)) as {
        count?: number;
        results?: Array<Record<string, unknown>>;
      };
      return {
        count: result.count,
        results: (result.results ?? []).map(annotateDataset),
      };
    }
    case 'dataset_details': {
      const result = (await ckanGet(
        `/package_show?id=${encodeURIComponent(reqStr(args, 'id', '"energie1"'))}`,
      )) as Record<string, unknown>;
      return annotateDataset(result);
    }
    case 'list_organizations': {
      const limit = Math.min(1000, Math.max(1, (args.limit as number) ?? 100));
      const result = (await ckanGet(`/organization_list?all_fields=true&limit=${limit}`)) as Array<
        Record<string, unknown>
      >;
      return result.map(annotateFacet);
    }
    case 'list_groups': {
      const limit = Math.min(1000, Math.max(1, (args.limit as number) ?? 100));
      const result = (await ckanGet(`/group_list?all_fields=true&limit=${limit}`)) as Array<
        Record<string, unknown>
      >;
      return result.map(annotateFacet);
    }
    case 'list_tags': {
      const result = (await ckanGet(`/tag_list`)) as string[];
      const q = (args.query as string | undefined)?.toLowerCase();
      const limit = Math.min(5000, Math.max(1, (args.limit as number) ?? 200));
      const filtered = q ? result.filter((t) => t.toLowerCase().includes(q)) : result;
      return { count: filtered.length, tags: filtered.slice(0, limit) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function ckanGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`opendata.swiss: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { success?: boolean; error?: { message?: string }; result?: unknown };
  if (json.success === false) throw new Error(`opendata.swiss: ${json.error?.message ?? 'unknown error'}`);
  return json.result ?? json;
}

/** Pick English, falling back de → fr → it → any non-empty, from a CKAN multilingual map. */
function pickEn(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined;
  if (v && typeof v === 'object') {
    const m = v as Record<string, unknown>;
    for (const lang of ['en', 'de', 'fr', 'it']) {
      const s = m[lang];
      if (typeof s === 'string' && s.trim()) return s;
    }
    for (const s of Object.values(m)) {
      if (typeof s === 'string' && s.trim()) return s;
    }
  }
  return undefined;
}

/** Flatten a dataset's multilingual title/notes and its resource titles. */
function annotateDataset(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p, title_en: pickEn(p.title), notes_en: pickEn(p.notes) };
  if (Array.isArray(p.resources)) {
    out.resources = (p.resources as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      title_en: pickEn(r.title),
      description_en: pickEn(r.description),
    }));
  }
  return out;
}

/** Flatten a multilingual title/description on an organization or group. */
function annotateFacet(f: Record<string, unknown>): Record<string, unknown> {
  return { ...f, title_en: pickEn(f.title), description_en: pickEn(f.description) };
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
