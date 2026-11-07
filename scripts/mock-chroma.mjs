import http from 'node:http';

const collections = [
  {
    id: 'col-products',
    name: 'products',
    metadata: { source: 'mock' },
    dimension: 3,
    version: 1,
    configuration_json: {
      hnsw: {
        space: 'cosine',
        ef_construction: 200,
        ef_search: 100,
        max_neighbors: 16,
        resize_factor: 1.2,
        sync_threshold: 1000,
      },
    },
  },
];

const documents = new Map([
  [
    'col-products',
    [
      {
        id: 'doc-1',
        document: '机械键盘 87 键',
        metadata: { category: 'hardware', stock: 42 },
        embedding: [0.1, 0.2, 0.3],
      },
      {
        id: 'doc-2',
        document: '无线鼠标 2.4G',
        metadata: { category: 'hardware', stock: 18 },
        embedding: [0.2, 0.1, 0.25],
      },
      {
        id: 'doc-3',
        document: '显示器支架',
        metadata: { category: 'accessory', stock: 7 },
        embedding: [0.05, 0.9, 0.15],
      },
    ],
  ],
]);

let counter = 1;

function send(res, status, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function findCollection(key) {
  return collections.find((item) => item.id === key || item.name === key);
}

function withTenant(collection) {
  return {
    ...collection,
    tenant: 'default_tenant',
    database: 'default_database',
  };
}

function toColumns(records) {
  return {
    ids: records.map((item) => item.id),
    documents: records.map((item) => item.document),
    metadatas: records.map((item) => item.metadata),
    embeddings: records.map((item) => item.embedding),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/api/v2/heartbeat') {
      return send(res, 200, { nanosecond_heartbeat: Date.now() * 1_000_000 });
    }
    if (req.method === 'GET' && path === '/api/v2/version') {
      return send(res, 200, '1.0.0-mock');
    }
    if (req.method === 'GET' && path === '/api/v1/heartbeat') {
      return send(res, 200, { nanosecond_heartbeat: Date.now() * 1_000_000 });
    }
    if (req.method === 'GET' && path === '/api/v1/version') {
      return send(res, 200, '0.6.0-mock');
    }

    const match = path.match(/^\/api\/v2\/tenants\/([^/]+)\/databases\/([^/]+)\/collections(?:\/([^/]+)(\/.*)?)?$/);
    if (!match) {
      return send(res, 404, { error: `未实现的路径 ${path}` });
    }
    const [, tenant, database, key, rest = ''] = match;
    if (tenant !== 'default_tenant' || database !== 'default_database') {
      return send(res, 404, { error: '租户或数据库不存在' });
    }

    if (!key) {
      if (req.method === 'GET') {
        return send(res, 200, collections.map(withTenant));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return send(res, 400, { error: 'name required' });
        if (findCollection(body.name)) return send(res, 400, { error: 'collection already exists' });
        const collection = {
          id: `col-${counter++}`,
          name: body.name,
          metadata: body.metadata ?? {},
          dimension: 0,
          version: 1,
          configuration_json: {
            hnsw: {
              space: body.metadata?.['hnsw:space'] ?? 'l2',
              ef_construction: 200,
              ef_search: 100,
              max_neighbors: 16,
              resize_factor: 1.2,
              sync_threshold: 1000,
            },
          },
        };
        collections.push(collection);
        documents.set(collection.id, []);
        return send(res, 200, withTenant(collection));
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    const collection = findCollection(key);
    if (!collection) {
      return send(res, 404, { error: `collection ${key} not found` });
    }
    const records = documents.get(collection.id) ?? [];

    if (!rest) {
      if (req.method === 'GET') return send(res, 200, withTenant(collection));
      if (req.method === 'DELETE') {
        const index = collections.indexOf(collection);
        if (index >= 0) collections.splice(index, 1);
        documents.delete(collection.id);
        return send(res, 200, {});
      }
    }
    if (rest === '/count' && req.method === 'GET') {
      return send(res, 200, records.length);
    }
    if (rest === '/get' && req.method === 'POST') {
      const body = await readBody(req);
      const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 10;
      const offset = Number.isFinite(Number(body.offset)) ? Number(body.offset) : 0;
      let filtered = records;
      if (body.where && typeof body.where === 'object') {
        filtered = records.filter((record) => {
          return Object.entries(body.where).every(([field, condition]) => {
            const value = record.metadata?.[field];
            if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
              const [operator, expected] = Object.entries(condition)[0] ?? [];
              if (operator === '$gt') return Number(value) > Number(expected);
              if (operator === '$gte') return Number(value) >= Number(expected);
              if (operator === '$lt') return Number(value) < Number(expected);
              if (operator === '$lte') return Number(value) <= Number(expected);
              if (operator === '$eq') return value === expected;
            }
            return value === condition;
          });
        });
      }
      const page = filtered.slice(offset, offset + limit);
      const columns = toColumns(page);
      if (body.where) columns.distances = page.map((_, index) => index * 0.1);
      return send(res, 200, columns);
    }
    if (rest === '/query' && req.method === 'POST') {
      const body = await readBody(req);
      const n = Math.max(1, Math.min(1000, Number(body.n_results) || 10));
      let candidates = records;
      if (body.where && typeof body.where === 'object') {
        candidates = records.filter((record) =>
          Object.entries(body.where).every(([field, value]) => record.metadata?.[field] === value),
        );
      }
      const ranked = candidates
        .slice(0, n)
        .map((record, index) => ({ ...record, distance: Number((0.05 + index * 0.07).toFixed(4)) }));
      return send(res, 200, {
        ids: [ranked.map((item) => item.id)],
        documents: [ranked.map((item) => item.document)],
        metadatas: [ranked.map((item) => item.metadata)],
        embeddings: [ranked.map((item) => item.embedding)],
        distances: [ranked.map((item) => item.distance)],
      });
    }
    if (rest === '/add' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = body.ids ?? [];
      ids.forEach((id, index) => {
        if (records.some((record) => record.id === id)) {
          throw new Error(`document ${id} already exists`);
        }
        records.push({
          id,
          document: body.documents?.[index] ?? '',
          metadata: body.metadatas?.[index] ?? {},
          embedding: body.embeddings?.[index] ?? [],
        });
      });
      documents.set(collection.id, records);
      return send(res, 200, {});
    }
    if (rest === '/update' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = body.ids ?? [];
      ids.forEach((id, index) => {
        const record = records.find((item) => item.id === id);
        if (!record) throw new Error(`document ${id} not found`);
        if (body.documents?.[index] !== undefined) record.document = body.documents[index];
        if (body.metadatas?.[index] !== undefined) record.metadata = body.metadatas[index];
        if (body.embeddings?.[index] !== undefined) record.embedding = body.embeddings[index];
      });
      return send(res, 200, {});
    }
    if (rest === '/delete' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = new Set(body.ids ?? []);
      documents.set(
        collection.id,
        records.filter((record) => !ids.has(record.id)),
      );
      return send(res, 200, {});
    }
    return send(res, 404, { error: `未实现的路径 ${path}` });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(8000, '127.0.0.1', () => {
  console.log('mock Chroma listening on http://127.0.0.1:8000');
});