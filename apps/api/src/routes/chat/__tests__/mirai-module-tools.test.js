import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiraiService } from '../mirai-service.js';

test('module tool execution reuses MirAI transport without invoking Chat tools or persistence', async () => {
  const requests = [], executed = [];
  const service = createMiraiService({ prisma: {}, env: { GROQ_API_KEY: 'test-key' },
    fetchImpl: async (_, options) => {
      requests.push(JSON.parse(options.body));
      const message = requests.length === 1
        ? { tool_calls: [{ id: 'call1', type: 'function', function: { name: 'inventory_summary', arguments: '{}' } }] }
        : { content: 'Hay 25 equipos.' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
    },
  });
  const definitions = [{ type: 'function', function: { name: 'inventory_summary', parameters: { type: 'object', properties: {} } } }];
  const result = await service.answerWithTools({ actorProfileId: 'actor', messages: [{ role: 'user', content: 'Cuantos hay' }], tools: definitions,
    executeTool: async (name, args) => { executed.push({ name, args }); return { count: 25 }; },
  });
  assert.equal(result.text, 'Hay 25 equipos.'); assert.equal(result.calls, 1);
  assert.deepEqual(requests[0].tools, definitions);
  assert.deepEqual(executed, [{ name: 'inventory_summary', args: {} }]);
  assert.equal(requests[1].messages.at(-1).role, 'tool');
});
test('module execution stops an excessive tool batch before executing the ninth call', async () => {
  let executed = 0;
  const service = createMiraiService({ prisma: {}, env: { GROQ_API_KEY: 'test-key' }, fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ choices: [{ message: { tool_calls: Array.from({ length: 9 }, (_, i) => ({ id: String(i), function: { name: 'inventory_summary', arguments: '{}' } })) } }] }),
  }) });
  await assert.rejects(service.answerWithTools({ actorProfileId: 'actor', messages: [], tools: [], executeTool: async () => { executed++; return {}; } }), e => e.status === 400);
  assert.equal(executed, 8);
});

test('a prepared module proposal can finish without another provider call', async () => {
  let requests = 0, prepared = false;
  const service = createMiraiService({ prisma: {}, env: { GROQ_API_KEY: 'test-key' }, fetchImpl: async () => {
    requests++;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'prepare', function: { name: 'inventory_prepare_create', arguments: '{}' } }] } }] }) };
  } });
  const result = await service.answerWithTools({ actorProfileId: 'actor', messages: [], tools: [],
    executeTool: async () => { prepared = true; return { status: 'pending_confirmation' }; },
    finishAfterTools: () => prepared ? 'Revisa la propuesta.' : null,
  });
  assert.equal(requests, 1); assert.equal(result.text, 'Revisa la propuesta.');
});
