import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildBackfillSql, buildConnectionSql, buildDropConnectionSql, buildOrphanCountSql,
  connectionObjectNames, isConnectionConstraint,
} from '../connection-sql.js'

const FIELDS = {
  moduleKey: 'custom.calibraciones', targetType: 'inventory_item', sourceTable: 'calibraciones_calibracion', targetTable: 'inv_item',
  connection: { key: 'calibracion_item', kind: 'fields', targetField: 'articulo', onTargetDelete: 'cascade' },
  offeredColumns: ['certificado', 'fecha'], searchColumns: ['certificado'],
}
const RELATED = (onTargetDelete) => ({
  moduleKey: 'custom.calibraciones', targetType: 'contact', sourceTable: 'calibraciones_prestamo', targetTable: 'contact',
  connection: { key: 'prestamo_contacto', kind: 'related', targetField: 'persona', onTargetDelete },
  offeredColumns: ['estado'], searchColumns: [],
})

describe('connection SQL', () => {
  it('names objects deterministically under the prefix and within 63 chars', () => {
    const names = connectionObjectNames('custom.calibraciones', 'calibracion_item')
    assert.equal(names.fk, 'runly_conn_calibraciones_calibracion_item_fk')
    const long = connectionObjectNames('custom.un_modulo_con_un_nombre_bastante_largo', 'conexion_con_nombre_largo')
    assert.ok(Object.values(long).every((name) => name.length <= 63 && isConnectionConstraint(name)))
  })

  it('fields: unique 1:1 index, cascading FK, trigger upserting the index', () => {
    const sql = buildConnectionSql(FIELDS).join(';\n')
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "runly_conn_calibraciones_calibracion_item_uq" ON public\."calibraciones_calibracion" \("company_id", "articulo"\)/)
    assert.match(sql, /FOREIGN KEY \("articulo"\) REFERENCES public\."inv_item" \("id"\) ON DELETE CASCADE NOT VALID/)
    assert.match(sql, /VALIDATE CONSTRAINT/)
    assert.match(sql, /jsonb_build_object\('certificado', NEW\."certificado", 'fecha', NEW\."fecha"\)/)
    assert.match(sql, /to_tsvector\('simple', concat_ws\(' ', NEW\."certificado"::text\)\)/)
    assert.match(sql, /IF TG_OP = 'DELETE' THEN\s+DELETE FROM public\.connection_record/)
    assert.match(sql, /AFTER INSERT OR UPDATE OR DELETE ON public\."calibraciones_calibracion" FOR EACH ROW/)
  })

  it('related: delete policy maps to the FK action, no unique index', () => {
    assert.match(buildConnectionSql(RELATED('restrict')).join(';'), /ON DELETE RESTRICT NOT VALID/)
    assert.match(buildConnectionSql(RELATED('setNull')).join(';'), /ON DELETE SET NULL NOT VALID/)
    assert.match(buildConnectionSql(RELATED('cascade')).join(';'), /ON DELETE CASCADE NOT VALID/)
    assert.doesNotMatch(buildConnectionSql(RELATED('setNull')).join(';'), /UNIQUE INDEX/)
    // No search columns -> NULL tsvector.
    assert.match(buildConnectionSql(RELATED('setNull')).join(';'), /, NULL, NEW\."updated_at"\)/)
  })

  it('backfill, orphan count and drop', () => {
    assert.match(buildBackfillSql(FIELDS), /SELECT s\."company_id", 'custom\.calibraciones', 'calibracion_item', 'inventory_item', s\."articulo", s\."id"/)
    assert.match(buildBackfillSql(FIELDS), /ON CONFLICT \(module_key, connection_key, source_record_id\) DO UPDATE/)
    assert.match(buildOrphanCountSql(FIELDS), /NOT EXISTS \(SELECT 1 FROM public\."inv_item" t WHERE t\."id" = s\."articulo"\)/)
    const drop = buildDropConnectionSql(FIELDS).join(';')
    assert.match(drop, /DROP TRIGGER IF EXISTS/)
    assert.match(drop, /DELETE FROM public\.connection_record WHERE module_key = 'custom\.calibraciones' AND connection_key = 'calibracion_item'/)
    assert.doesNotMatch(drop, /DROP COLUMN|DROP TABLE/)
  })

  it('rejects injection attempts in identifiers and literals', () => {
    assert.throws(() => buildConnectionSql({ ...FIELDS, sourceTable: 'x"; DROP TABLE contact; --' }), /safe identifier/)
    assert.throws(() => buildConnectionSql({ ...FIELDS, moduleKey: "custom.x'; --" }), /unsafe characters/)
    assert.throws(() => buildConnectionSql({ ...FIELDS, offeredColumns: ['a b'] }), /safe identifier/)
    assert.throws(() => buildConnectionSql(RELATED('drop')), /unknown onTargetDelete/)
  })
})
