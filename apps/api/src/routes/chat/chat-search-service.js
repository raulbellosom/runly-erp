import { Prisma } from "@prisma/client";
import { ChatServiceError } from "./chat-service-error.js";
import { resolveUserProfileId } from "./chat-service.js";

const MAX_TOKENS = 6;
const MIN_TOKEN_LEN = 2;
// word_similarity floor for typo tolerance. 0.3 was too loose in practice —
// e.g. "panel" fuzzily matched messages with no visible relation to it, so
// the result list disagreed with the word-prefix highlight and read as
// "buggy search". Raised so only near-misses (one typo/transposition) pass.
const SIMILARITY_THRESHOLD = 0.45;
// Typo tolerance (word_similarity) only kicks in from this length — on 2-3 char
// tokens it just adds noise ("la" fuzzily matching "le"/"las"), so short
// searches are exact word-prefix only, which is what makes them feel "concrete".
const FUZZY_MIN_TOKEN_LEN = 4;
const MAX_LIMIT = 50;
const MAX_OFFSET = 300;

// JS-side mirror of the SQL atlas_unaccent(lower(x)): lower-case + strip the
// combining diacritics Postgres unaccent removes. NFD/strip/NFC is
// length-preserving for the Latin text this app deals with, which is what lets
// computeMatchRanges' offsets line up with the original body.
export function normalizeForSearch(input) {
  return (input ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase();
}

export function tokenizeQuery(raw) {
  const norm = normalizeForSearch(raw).trim();
  if (!norm) return [];
  const parts = norm.split(/\s+/).filter(Boolean);
  const uniqueLong = [...new Set(parts.filter((t) => t.length >= MIN_TOKEN_LEN))];
  const base = uniqueLong.length ? uniqueLong : parts.slice(0, 1);
  return base.slice(0, MAX_TOKENS);
}

function escapeLike(token) {
  return token.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function escapeRegex(token) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A token matches at the START OF A WORD, not anywhere inside one — "la" hits
// "La cancion" / "las" but not "michael" or "cancion". Keeps short in-chat
// searches concrete instead of lighting up half the conversation. `\m` (SQL) /
// `\b<tok>` (JS) are the equivalent "word-start" anchors on the accent-stripped
// lowercased text.
function wordPrefixSql(column, token) {
  return Prisma.sql`${column} ~ ${"\\m" + escapeRegex(token)}`;
}

// Word-prefix OR typo-similarity (the latter only for tokens long enough to
// make that meaningful) against one normalised column. Shared by the body,
// sender-name and attachment-filename predicates so all three fields use the
// exact same matching rule.
function fieldTokenCond(column, token) {
  const fuzzy = token.length >= FUZZY_MIN_TOKEN_LEN;
  const sim = fuzzy ? Prisma.sql` OR word_similarity(${token}, ${column}) > ${SIMILARITY_THRESHOLD}` : Prisma.empty;
  return Prisma.sql`(${wordPrefixSql(column, token)}${sim})`;
}

// Compute [start,end] match ranges on the ORIGINAL body by scanning its
// normalised form for each token AT WORD STARTS (mirrors the SQL predicate).
// Returns [] if normalisation changed the string length (defensive — see
// normalizeForSearch), so the caller shows the plain snippet instead of a
// mis-aligned highlight.
export function computeMatchRanges(body, tokens) {
  const norm = normalizeForSearch(body);
  if (norm.length !== (body ?? "").length) return [];
  const ranges = [];
  for (const tok of tokens) {
    if (!tok) continue;
    const re = new RegExp("\\b" + escapeRegex(tok), "g");
    let m;
    while ((m = re.exec(norm)) !== null) {
      ranges.push([m.index, m.index + tok.length]);
      if (re.lastIndex === m.index) re.lastIndex += 1; // guard against zero-width
    }
  }
  if (!ranges.length) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0].slice()];
  for (let i = 1; i < ranges.length; i += 1) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i].slice());
  }
  return merged;
}

export function createChatSearchService({ prisma }) {
  async function searchMessages({
    authUserId,
    companyId = null,
    q,
    conversationId = null,
    limit = 30,
    offset = 0,
  }) {
    const tokens = tokenizeQuery(q);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), MAX_LIMIT);
    const safeOffset = Math.min(Math.max(parseInt(offset, 10) || 0, 0), MAX_OFFSET);

    if (!tokens.length) return { data: [], truncated: false };

    const profileId = await resolveUserProfileId(prisma, authUserId);

    // Per-token predicate: word-PREFIX match (not "anywhere inside a word"),
    // plus typo-similarity for tokens long enough to make that meaningful.
    // Matched against body / sender name / any attachment file name. AND across
    // tokens => order-independent.
    const tokenConds = tokens.map((tok) => Prisma.sql`(
        ${fieldTokenCond(Prisma.sql`m.body_norm`, tok)}
        OR ${fieldTokenCond(Prisma.sql`up.name_norm`, tok)}
        OR EXISTS (
          SELECT 1 FROM chat_attachments a
          WHERE a.message_id = m.id
            AND ${fieldTokenCond(Prisma.sql`atlas_unaccent(lower(a.file_name))`, tok)}
        )
      )`);
    const whereTokens = Prisma.join(tokenConds, " AND ");

    // A row can satisfy `whereTokens` purely because the SENDER'S NAME or an
    // ATTACHMENT FILE NAME matched, with the message body itself containing
    // none of the query — e.g. searching "Pu" surfaces a message whose sender
    // is "Publicidad" or that carries "Purchase_order.pdf", even though the
    // body says something unrelated. Previously the API returned sender_name
    // and nothing about the attachment, and the client only ever highlighted
    // matchRanges computed against the BODY — so those rows rendered with no
    // highlight and no visible reason to be there, reading as "buggy search".
    // Surface which attachment (if any) is the likely match reason so the
    // client can highlight it too instead of leaving the result unexplained.
    const attachmentAnyTokenMatch = Prisma.join(
      tokens.map((tok) => fieldTokenCond(Prisma.sql`atlas_unaccent(lower(matched_att.file_name))`, tok)),
      " OR ",
    );

    // score = sum over tokens of GREATEST(word-prefix hit ? 1 : 0, word_similarity)
    // — the fuzzy term only for tokens long enough to use it (matches the WHERE).
    const scoreTerms = tokens.map((tok) => {
      const hit = Prisma.sql`CASE WHEN ${wordPrefixSql(Prisma.sql`m.body_norm`, tok)} THEN 1.0 ELSE 0 END`;
      return tok.length >= FUZZY_MIN_TOKEN_LEN
        ? Prisma.sql`GREATEST(${hit}, word_similarity(${tok}, m.body_norm))`
        : hit;
    });
    const scoreExpr = Prisma.join(scoreTerms, " + ");

    const convFilter = conversationId
      ? Prisma.sql`AND m.conversation_id = ${conversationId}::uuid`
      : Prisma.empty;

    let rows;
    try {
      rows = await prisma.$queryRaw`
      SELECT
        m.id            AS message_id,
        m.conversation_id,
        m.body,
        m.created_at,
        m.sender_user_id,
        up.display_name AS sender_name,
        conv.title      AS conversation_title,
        conv.type       AS conversation_type,
        conv.avatar_url AS conversation_avatar_url,
        conv.avatar_emoji AS conversation_avatar_emoji,
        dm.display_name AS dm_name,
        matched_att.file_name AS matched_attachment_name,
        (${scoreExpr})  AS score
      FROM chat_messages m
      JOIN chat_conversation_members cm
        ON cm.conversation_id = m.conversation_id
       AND cm.user_id = ${profileId}::uuid
       AND cm.left_at IS NULL
      JOIN chat_conversations conv ON conv.id = m.conversation_id
      LEFT JOIN LATERAL (
        SELECT display_name,
               atlas_unaccent(lower(coalesce(display_name, ''))) AS name_norm
        FROM user_profile WHERE id = m.sender_user_id
      ) up ON true
      -- Direct conversations carry no stored title — resolve the other
      -- participant's NAME so results show the person, not "Chat". (No avatar
      -- here: user_profile has avatar_file_id, not a URL, and this service has
      -- no signed-URL helper; the result-list AvatarCircle falls back to
      -- initials from the resolved name, which is fine.)
      LEFT JOIN LATERAL (
        SELECT p.display_name
        FROM chat_conversation_members ocm
        JOIN user_profile p ON p.id = ocm.user_id
        WHERE ocm.conversation_id = m.conversation_id
          AND ocm.user_id <> ${profileId}::uuid
          AND ocm.left_at IS NULL
        ORDER BY ocm.joined_at ASC
        LIMIT 1
      ) dm ON conv.type = 'direct'
      -- Pick whichever attachment on this message best explains the match
      -- (one whose file name actually satisfies a token), falling back to the
      -- oldest attachment so the column is still populated when the real
      -- match reason was the body or sender name instead.
      LEFT JOIN LATERAL (
        SELECT matched_att.file_name
        FROM chat_attachments matched_att
        WHERE matched_att.message_id = m.id
        ORDER BY CASE WHEN (${attachmentAnyTokenMatch}) THEN 0 ELSE 1 END, matched_att.created_at ASC
        LIMIT 1
      ) AS matched_att ON true
      WHERE m.deleted_at IS NULL
        AND public.runly_chat_user_access(conv.id, ${profileId}::uuid)
        AND (conv.company_id = ${companyId}::uuid OR (${conversationId}::uuid IS NOT NULL AND cm.external_access))
        ${convFilter}
        AND (${whereTokens})
      ORDER BY score DESC, m.created_at DESC
      LIMIT ${safeLimit + 1} OFFSET ${safeOffset}
    `;
    } catch (err) {
      // A statement timeout (57014) on a huge conversation is an expected,
      // recoverable outcome — surface it as 503 "try a narrower term" instead
      // of a generic 500 that the client renders as a flat "Error al buscar".
      const code = err?.code ?? err?.meta?.code;
      const msg = String(err?.message ?? "");
      const timedOut = code === "57014" || /canceling statement|statement timeout/i.test(msg);
      console.warn("[runly.chat] message search failed", {
        conversationId: conversationId ?? null,
        tokenCount: tokens.length,
        code: code ?? null,
        timedOut,
        message: msg.slice(0, 200),
      });
      if (timedOut) {
        throw new ChatServiceError(
          "La busqueda tardo demasiado. Intenta con un termino mas especifico.",
          503,
        );
      }
      throw err;
    }

    const truncated = rows.length > safeLimit;
    const page = truncated ? rows.slice(0, safeLimit) : rows;

    const data = page.map((r) => ({
      messageId: r.message_id,
      conversationId: r.conversation_id,
      conversation: {
        id: r.conversation_id,
        title: r.conversation_title ?? r.dm_name ?? null,
        type: r.conversation_type,
        avatarUrl: r.conversation_avatar_url ?? null,
        avatarEmoji: r.conversation_avatar_emoji ?? null,
      },
      sender: {
        id: r.sender_user_id,
        displayName: r.sender_name ?? null,
        // Highlighted independently of the body — a row can match because the
        // SENDER's name hit a token even though the body didn't (see the
        // whereTokens comment above), so the client needs its own ranges to
        // show why that row is here instead of rendering it unexplained.
        matchRanges: computeMatchRanges(r.sender_name ?? "", tokens),
      },
      body: r.body ?? "",
      matchRanges: computeMatchRanges(r.body ?? "", tokens),
      // Same reasoning for an ATTACHMENT FILE NAME match — populated only when
      // this message actually has an attachment; matchRanges is [] when this
      // particular one wasn't the match reason (fallback to oldest attachment).
      attachmentMatch: r.matched_attachment_name
        ? {
            fileName: r.matched_attachment_name,
            matchRanges: computeMatchRanges(r.matched_attachment_name, tokens),
          }
        : null,
      createdAt: r.created_at,
      score: Number(r.score),
    }));

    return { data, truncated };
  }

  return { searchMessages };
}

export { ChatServiceError };
