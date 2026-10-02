// Content-aware search over a Board's name, description, pages, hotspots,
// canvas text and linked records — accent/typo tolerant, mirroring the chat
// search service's use of atlas_unaccent()/pg_trgm (see chat-search-service.js).
import { Prisma } from '@prisma/client'
import { CanvasServiceError } from './canvas-service.js'

const MAX_TERMS = 6
const MIN_TERM_LEN = 2
const FUZZY_MIN_TERM_LEN = 4
const SIMILARITY_THRESHOLD = 0.45
const MAX_RESULTS = 50
const SNIPPET_RADIUS = 20
const SNIPPET_MAX = 60

// name/description/hotspot/page/text/link; a fuzzy hit (word_similarity, not
// an exact substring) counts for half.
const FIELD_WEIGHT = { name: 10, description: 5, hotspot: 4, page: 3, text: 2, link: 2 }

// Lower-case + strip the combining diacritics atlas_unaccent() removes in SQL,
// so a JS-side term already matches what the column transform produces.
function stripAccents(value) {
  return (value ?? '').toString().trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

// Normalises free text into search terms: accent/case folded, whitespace
// split, 1-char tokens dropped unless it is the only token, deduped, capped.
export function searchTerms(q) {
  const norm = stripAccents(q)
  if (!norm) return []
  const parts = norm.split(/\s+/).filter(Boolean)
  const kept = parts.length === 1 ? parts : parts.filter((term) => term.length > 1)
  return [...new Set(kept)].slice(0, MAX_TERMS)
}

function snippetFor(text, term) {
  const value = (text ?? '').toString()
  if (!value) return ''
  if (value.length <= SNIPPET_MAX) return value
  const idx = stripAccents(value).indexOf(term)
  const start = idx === -1 ? 0 : Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(value.length, start + SNIPPET_MAX)
  const slice = value.slice(start, end)
  return `${start > 0 ? '…' : ''}${slice}${end < value.length ? '…' : ''}`
}

// Ranks Board hits: `rows` is one entry per matched (board, field, term) —
// `{ boardId, field, label, text, term, fuzzy? }`. A board only qualifies
// when its hits cover every term; each distinct (field, label) pair scores
// once (its best weight), fuzzy hits count half. Returns boards sorted by
// score desc, each with at most 2 matches (highest weight first).
export function rankBoards(rows, terms) {
  const wantedTerms = [...new Set(terms)]
  const byBoard = new Map()
  for (const row of rows) {
    if (!row?.boardId || !row.field || !wantedTerms.includes(row.term)) continue
    let entry = byBoard.get(row.boardId)
    if (!entry) { entry = { covered: new Set(), pairs: new Map() }; byBoard.set(row.boardId, entry) }
    entry.covered.add(row.term)
    const weight = (FIELD_WEIGHT[row.field] ?? 0) * (row.fuzzy ? 0.5 : 1)
    const pairKey = `${row.field}\u0000${row.label}`
    const existing = entry.pairs.get(pairKey)
    if (!existing || weight > existing.weight) {
      entry.pairs.set(pairKey, { field: row.field, label: row.label, text: row.text, term: row.term, weight })
    }
  }
  const results = []
  for (const [boardId, entry] of byBoard) {
    if (entry.covered.size < wantedTerms.length) continue
    const pairs = [...entry.pairs.values()].sort((a, b) => b.weight - a.weight)
    const score = pairs.reduce((sum, pair) => sum + pair.weight, 0)
    const matches = pairs.slice(0, 2).map((pair) => ({ field: pair.field, label: pair.label, snippet: snippetFor(pair.text, pair.term) }))
    results.push({ boardId, score, matches })
  }
  return results.sort((a, b) => b.score - a.score)
}

// Escapes LIKE metacharacters (`%`, `_`, `\`) so the term is matched literally.
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

// One raw query per term: UNION ALL of every field's substring hits for the
// accessible boards, plus (terms long enough) fuzzy hits on board names and
// hotspot titles that the substring match already missed.
async function queryTerm(prisma, boardIds, term) {
  const escaped = escapeLike(term)
  const fuzzyPart = term.length >= FUZZY_MIN_TERM_LEN ? Prisma.sql`
    UNION ALL
    SELECT b.id AS board_id, 'name'::text AS field, b.name AS label, b.name AS text, true AS fuzzy
    FROM canvas_board b
    WHERE b.id = ANY(${boardIds}::uuid[])
      AND word_similarity(${term}, atlas_unaccent(lower(b.name))) >= ${SIMILARITY_THRESHOLD}
      AND NOT (atlas_unaccent(lower(b.name)) LIKE '%' || ${escaped} || '%' ESCAPE '\\')

    UNION ALL
    SELECT h.board_id, 'hotspot'::text, h.title, h.title, true
    FROM canvas_hotspot h
    WHERE h.board_id = ANY(${boardIds}::uuid[])
      AND h.archived_at IS NULL
      AND word_similarity(${term}, atlas_unaccent(lower(h.title))) >= ${SIMILARITY_THRESHOLD}
      AND NOT (atlas_unaccent(lower(h.title)) LIKE '%' || ${escaped} || '%' ESCAPE '\\')
  ` : Prisma.empty

  return prisma.$queryRaw`
    SELECT board_id, field, label, text, fuzzy FROM (
      SELECT b.id AS board_id, 'name'::text AS field, b.name AS label, b.name AS text, false AS fuzzy
      FROM canvas_board b
      WHERE b.id = ANY(${boardIds}::uuid[])
        AND atlas_unaccent(lower(b.name)) LIKE '%' || ${escaped} || '%' ESCAPE '\\'

      UNION ALL
      SELECT b.id, 'description'::text, b.description, b.description, false
      FROM canvas_board b
      WHERE b.id = ANY(${boardIds}::uuid[])
        AND b.description IS NOT NULL
        AND atlas_unaccent(lower(b.description)) LIKE '%' || ${escaped} || '%' ESCAPE '\\'

      UNION ALL
      SELECT p.board_id, 'page'::text, p.name, p.name, false
      FROM canvas_page p
      WHERE p.board_id = ANY(${boardIds}::uuid[])
        AND atlas_unaccent(lower(p.name)) LIKE '%' || ${escaped} || '%' ESCAPE '\\'

      UNION ALL
      SELECT h.board_id, 'hotspot'::text, h.title, h.title, false
      FROM canvas_hotspot h
      WHERE h.board_id = ANY(${boardIds}::uuid[])
        AND h.archived_at IS NULL
        AND (
          atlas_unaccent(lower(h.title)) LIKE '%' || ${escaped} || '%' ESCAPE '\\'
          OR (h.description IS NOT NULL AND atlas_unaccent(lower(h.description)) LIKE '%' || ${escaped} || '%' ESCAPE '\\')
          OR atlas_unaccent(lower(h.tags::text)) LIKE '%' || ${escaped} || '%' ESCAPE '\\'
        )

      UNION ALL
      SELECT o.board_id, 'text'::text, left(o.properties ->> 'text', 40), o.properties ->> 'text', false
      FROM canvas_object o
      WHERE o.board_id = ANY(${boardIds}::uuid[])
        AND o.deleted_at IS NULL
        AND o.type = 'text'
        AND o.properties ->> 'text' IS NOT NULL
        AND atlas_unaccent(lower(o.properties ->> 'text')) LIKE '%' || ${escaped} || '%' ESCAPE '\\'

      UNION ALL
      SELECT l.board_id, 'link'::text, l.metadata -> 'resolved' ->> 'title', l.metadata -> 'resolved' ->> 'title', false
      FROM canvas_entity_link l
      WHERE l.board_id = ANY(${boardIds}::uuid[])
        AND l.metadata -> 'resolved' ->> 'title' IS NOT NULL
        AND atlas_unaccent(lower(l.metadata -> 'resolved' ->> 'title')) LIKE '%' || ${escaped} || '%' ESCAPE '\\'
      ${fuzzyPart}
    ) hits
  `
}

export function createCanvasSearch({ prisma }) {
  async function search(companyId, actorId, rawQ) {
    const q = (rawQ ?? '').toString()
    if (q.trim().length < 2 || q.length > 120) {
      throw new CanvasServiceError('La búsqueda debe tener entre 2 y 120 caracteres.', 400)
    }
    const terms = searchTerms(q)
    if (!terms.length) throw new CanvasServiceError('La búsqueda debe tener entre 2 y 120 caracteres.', 400)

    const boards = await prisma.canvasBoard.findMany({
      where: { companyId, archivedAt: null, OR: [{ ownerId: actorId }, { collaborators: { some: { userId: actorId } } }] },
      select: { id: true },
    })
    if (!boards.length) return []
    const boardIds = boards.map((board) => board.id)

    const perTerm = await Promise.all(terms.map((term) => queryTerm(prisma, boardIds, term)))
    const rows = []
    perTerm.forEach((termRows, index) => {
      const term = terms[index]
      for (const row of termRows) rows.push({ boardId: row.board_id, field: row.field, label: row.label, text: row.text, fuzzy: row.fuzzy, term })
    })

    return rankBoards(rows, terms).slice(0, MAX_RESULTS)
  }

  return { search }
}
