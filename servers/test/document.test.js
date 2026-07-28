const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

// Set required environment variables for routes to initialize without errors
process.env.SERVICE_TOKEN = 'test-token';
process.env.JWT_SECRET = 'test-jwt';
process.env.SESSION_SECRET = 'test-session';

// Mock middlewares before loading the router
require('../middlewares/auth');
require('../middlewares/csrf');

require.cache[require.resolve('../middlewares/auth')] = {
  exports: {
    verifyToken: (req, res, next) => {
      req.userId = 'user123';
      next();
    },
    ensureActive: (req, res, next) => next()
  }
};

require.cache[require.resolve('../middlewares/csrf')] = {
  exports: {
    verifyCsrf: (req, res, next) => next()
  }
};
const originalNodeFetch = require("node-fetch");
let mockNodeFetchHandler = null;

require.cache[require.resolve('node-fetch')] = {
  exports: function (url, options) {
    if (mockNodeFetchHandler) {
      return mockNodeFetchHandler(url, options);
    }
    return originalNodeFetch(url, options);
  }
};

const Document = require('../models/Document');
const DocChunk = require('../models/DocChunk');
const documentRouter = require('../routes/document');

test('POST /:id/index-state/building route tests', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/document', documentRouter);

  const originalFindOneAndUpdate = Document.findOneAndUpdate;
  const originalFindById = Document.findById;
  const originalCountDocuments = DocChunk.countDocuments;

  t.afterEach(() => {
    Document.findOneAndUpdate = originalFindOneAndUpdate;
    Document.findById = originalFindById;
    DocChunk.countDocuments = originalCountDocuments;
  });

  await t.test('Legacy document with undefined indexState - should succeed and set build state', async () => {
    let capturedQuery, capturedUpdate, capturedOptions;

    Document.findOneAndUpdate = async (query, update, options) => {
      capturedQuery = query;
      capturedUpdate = update;
      capturedOptions = options;

      return {
        _id: query._id,
        indexState: {
          activeVersion: null,
          previousVersion: null,
          activeMetadata: {
            fileHash: null,
            pipelineVersion: null,
            chunkingVersion: null,
            embeddingModel: null
          },
          build: {
            version: update.$set['indexState.build'].version,
            status: 'building',
            fileHash: null,
            pipelineVersion: null,
            chunkingVersion: null,
            embeddingModel: null,
            reason: null
          }
        }
      };
    };

    const server = app.listen(0);
    const { port } = server.address();
    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc_legacy/index-state/building`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': 'test-token'
        },
        body: JSON.stringify({
          indexVersion: 'requested-uuid-123'
        })
      });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.indexState.build.status, 'building');
      assert.strictEqual(data.indexState.build.version, 'requested-uuid-123');

      assert.strictEqual(capturedQuery._id, 'doc_legacy');
      assert.deepStrictEqual(capturedUpdate.$set['indexState.build'], {
        version: 'requested-uuid-123',
        status: 'building',
        fileHash: null,
        pipelineVersion: null,
        chunkingVersion: null,
        embeddingModel: null,
        reason: null
      });
    } finally {
      server.close();
    }
  });

  await t.test('Document with existing activeVersion - should preserve existing active state and update build state', async () => {
    let capturedQuery, capturedUpdate;

    Document.findOneAndUpdate = async (query, update, options) => {
      capturedQuery = query;
      capturedUpdate = update;

      return {
        _id: query._id,
        indexState: {
          activeVersion: 'active-v99',
          previousVersion: null,
          activeMetadata: {
            fileHash: 'hash-99',
            pipelineVersion: '6',
            chunkingVersion: '3',
            embeddingModel: 'gemini'
          },
          build: {
            version: 'new-build-uuid',
            status: 'building',
            fileHash: null,
            pipelineVersion: null,
            chunkingVersion: null,
            embeddingModel: null,
            reason: null
          }
        }
      };
    };

    const server = app.listen(0);
    const { port } = server.address();
    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc_active/index-state/building`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': 'test-token'
        },
        body: JSON.stringify({
          indexVersion: 'new-build-uuid'
        })
      });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.indexState.activeVersion, 'active-v99');
      assert.strictEqual(data.indexState.build.status, 'building');
      assert.strictEqual(data.indexState.build.version, 'new-build-uuid');

      assert.strictEqual(capturedQuery._id, 'doc_active');
      assert.deepStrictEqual(capturedUpdate.$set['indexState.build'], {
        version: 'new-build-uuid',
        status: 'building',
        fileHash: null,
        pipelineVersion: null,
        chunkingVersion: null,
        embeddingModel: null,
        reason: null
      });
    } finally {
      server.close();
    }
  });

  await t.test('Another index build in progress - should return 409 Conflict', async () => {
    Document.findOneAndUpdate = async () => null; // Simulate CAS condition failure
    Document.findById = async (id) => ({ _id: id }); // Document exists

    const server = app.listen(0);
    const { port } = server.address();
    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc_conflict/index-state/building`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': 'test-token'
        },
        body: JSON.stringify({
          indexVersion: 'new-build-uuid'
        })
      });
      assert.strictEqual(response.status, 409);
      const data = await response.json();
      assert.strictEqual(data.message, 'Another index build is already in progress');
    } finally {
      server.close();
    }
  });

  await t.test('GET /:id/chunks/count - should succeed and return count', async () => {
    let capturedQuery;
    DocChunk.countDocuments = async (query) => {
      capturedQuery = query;
      return 42;
    };

    const server = app.listen(0);
    const { port } = server.address();
    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc_count/chunks/count?indexVersion=v_test`, {
        method: 'GET',
        headers: {
          'x-service-token': 'test-token'
        }
      });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.count, 42);
      assert.deepStrictEqual(capturedQuery, { doc: 'doc_count', indexVersion: 'v_test' });
    } finally {
      server.close();
    }
  });

  await t.test('DELETE /:id - should succeed and delete document, chat, and chunks', async () => {
    let docDeleted = false;
    let chatDeleted = false;
    let chunksDeleted = false;
    let tablesDeleted = false;

    Document.findOneAndDelete = async (query) => {
      assert.deepStrictEqual(query, { _id: 'doc123', user: 'user123' });
      docDeleted = true;
      return { _id: 'doc123', user: 'user123', doc_id: 'doc_uuid_123' };
    };

    const Chat = require('../models/Chat');
    const originalChatFindOneAndDelete = Chat.findOneAndDelete;
    Chat.findOneAndDelete = async (query) => {
      assert.deepStrictEqual(query, { user: 'user123', document: 'doc123' });
      chatDeleted = true;
      return { _id: 'chat123', messages: [] };
    };

    const DocChunk = require('../models/DocChunk');
    const originalDocChunkDeleteMany = DocChunk.deleteMany;
    DocChunk.deleteMany = async (query) => {
      assert.deepStrictEqual(query, { doc: 'doc123' });
      chunksDeleted = true;
      return { deletedCount: 5 };
    };

    const DocumentTable = require('../models/DocumentTable');
    const originalDocumentTableDeleteMany = DocumentTable.deleteMany;
    DocumentTable.deleteMany = async (query) => {
      assert.deepStrictEqual(query, { doc_id: 'doc_uuid_123' });
      tablesDeleted = true;
      return { deletedCount: 1 };
    };

    const server = app.listen(0);
    const { port } = server.address();
    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc123`, {
        method: 'DELETE'
      });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.message, 'Document deleted');
      assert.ok(docDeleted);
      assert.ok(chatDeleted);
      assert.ok(chunksDeleted);
      assert.ok(tablesDeleted);
    } finally {
      Chat.findOneAndDelete = originalChatFindOneAndDelete;
      DocChunk.deleteMany = originalDocChunkDeleteMany;
      DocumentTable.deleteMany = originalDocumentTableDeleteMany;
      server.close();
    }
  });

  await t.test('PATCH /:id/table optimistic lock conflict', async () => {
    const DocumentTable = require('../models/DocumentTable');
    
    const originalDocFindOne = Document.findOne;
    const originalTableFindOne = DocumentTable.findOne;
    
    Document.findOne = async () => ({
      _id: 'doc123',
      user: 'user123',
      doc_id: 'doc_uuid_123',
      contentHash: 'old_hash',
      data: Buffer.from('old_bytes'),
      indexState: { activeVersion: 'v1' }
    });

    DocumentTable.findOne = async () => ({
      _id: 'table123',
      doc_id: 'doc_uuid_123',
      headers: ['A', 'B'],
      rows: [['1', '2']],
      __v: 2
    });

    const server = app.listen(0);
    const { port } = server.address();

    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc123/table`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: 'Sheet1',
          __v: 1, // Mismatched version
          mutations: [{ type: 'update', row: 0, column: 1, value: '3' }]
        })
      });

      assert.strictEqual(response.status, 409);
      const data = await response.json();
      assert.ok(data.message.includes('Conflict'));
    } finally {
      Document.findOne = originalDocFindOne;
      DocumentTable.findOne = originalTableFindOne;
      server.close();
    }
  });

  await t.test('PATCH /:id/table successful update', async () => {
    const DocumentTable = require('../models/DocumentTable');
    const EditHistory = require('../models/EditHistory');
    const DocChunk = require('../models/DocChunk');

    const originalDocFindOne = Document.findOne;
    const originalTableFindOne = DocumentTable.findOne;
    const originalEditInsert = EditHistory.insertMany;
    const originalChunkBulk = DocChunk.bulkWrite;
    const originalGlobalFetch = global.fetch;

    let tableSaved = false;
    let docSaved = false;
    let historySaved = false;
    let chunksUpdated = false;

    const mockDoc = {
      _id: 'doc123',
      user: 'user123',
      doc_id: 'doc_uuid_123',
      contentHash: 'old_hash',
      data: Buffer.from('old_bytes'),
      indexState: { activeVersion: 'v1' },
      save: async () => { docSaved = true; }
    };

    Document.findOne = async () => mockDoc;

    const mockTable = {
      _id: 'table123',
      doc_id: 'doc_uuid_123',
      headers: ['A', 'B'],
      rows: [['1', '2']],
      __v: 1,
      markModified: () => {},
      save: async () => { tableSaved = true; }
    };

    DocumentTable.findOne = async () => mockTable;
    EditHistory.insertMany = async () => { historySaved = true; };
    DocChunk.bulkWrite = async () => { chunksUpdated = true; };

    // Set the node-fetch mock handler
    mockNodeFetchHandler = async (url, options) => {
      if (url.includes('/api/internal/document/sync-table')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            file_bytes: Buffer.from('new_bytes').toString('base64'),
            updated_chunks: [{ chunk_id: 'doc_uuid_123:v1:0', chunk_index: 0, text: 'new text' }]
          })
        };
      }
      return originalNodeFetch(url, options);
    };

    const server = app.listen(0);
    const { port } = server.address();

    try {
      const response = await fetch(`http://localhost:${port}/api/document/doc123/table`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: 'Sheet1',
          __v: 1,
          mutations: [{ type: 'update', row: 0, column: 1, value: '3' }]
        })
      });

      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.success, true);
      assert.ok(tableSaved);
      assert.ok(docSaved);
      assert.ok(historySaved);
      assert.ok(chunksUpdated);
    } finally {
      Document.findOne = originalDocFindOne;
      DocumentTable.findOne = originalTableFindOne;
      EditHistory.insertMany = originalEditInsert;
      DocChunk.bulkWrite = originalChunkBulk;
      mockNodeFetchHandler = null;
      server.close();
    }
  });
});
