import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSharesService } from '../shares-service.js'
import { createNotesService } from '../notes-service.js'

test('hidden collaborators are not fetched or returned to anonymous readers', async () => {
  let calls = 0
  const prisma = { $queryRaw: async () => {
    calls++
    if (calls > 1) assert.fail('must not query hidden collaborators')
    return [{ id: 'note', show_public_collaborators: false, title: 'Public' }]
  } }
  const note = await createSharesService({ prisma }).getPublicNote('public-slug')
  assert.equal(note.show_public_collaborators, false)
  assert.deepEqual(note.collaborators, [])
})

test('collaborators are shown by default and when explicitly enabled', async () => {
  for (const enabled of [undefined, true]) {
    let calls = 0
    const collaborators = [{ display_name: 'Ana', is_owner: true, permission: null }]
    const prisma = { $queryRaw: async () => ++calls === 1
      ? [{ id: 'note', show_public_collaborators: enabled }]
      : collaborators }
    assert.deepEqual((await createSharesService({ prisma }).getPublicNote('public-slug')).collaborators, collaborators)
  }
})

test('public collaborator visibility rejects non-booleans before writing', async () => {
  for (const value of [null, 'false', 0, {}]) {
    let calls = 0
    const prisma = { $queryRaw: async () => {
      if (++calls > 1) assert.fail('invalid setting must not be persisted')
      return [{ id: 'note', owner_user_id: 'owner' }]
    } }
    await assert.rejects(
      createNotesService({ prisma }).updateNote('note', 'owner', { showPublicCollaborators: value }),
      { status: 400 },
    )
  }
})

test('read-only collaborators cannot change public visibility', async () => {
  const prisma = { $queryRaw: async () => [{ id: 'note', owner_user_id: 'owner', share_permission: 'read' }] }
  await assert.rejects(
    createNotesService({ prisma }).updateNote('note', 'guest', { showPublicCollaborators: false }),
    { status: 403 },
  )
})
