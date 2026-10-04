import { parse, tokenizer } from 'acorn'
import { FIELD_TYPES, BLUEPRINT_KINDS, MODULE_KINDS } from '@runly/module-engine/browser'
import { fail } from './limits.js'

const modules = new Set(['@runly/module-engine', '@atlas/module-engine', '@runly/module-engine/browser', '@atlas/module-engine/browser'])
const declarators = new Set(['defineRunlyModule', 'defineAtlasModule', 'defineModel', 'defineView', 'definePage'])
const enums = { FIELD_TYPES, BLUEPRINT_KINDS, MODULE_KINDS }
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

function boundedAst(source, path, limits) {
  let depth = 0, tokens = 0
  try {
    // Bound nesting BEFORE Acorn's recursive descent and JSON/validator recursion.
    for (const token of tokenizer(source, { ecmaVersion: 2022, sourceType: 'module' })) {
      if (++tokens > limits.tokens) fail('AST_TOKEN_LIMIT', path, 'Demasiados tokens.')
      if (['{', '[', '('].includes(token.type.label) && ++depth > limits.depth) fail('AST_DEPTH_LIMIT', path, 'Declaración demasiado profunda.')
      if (['}', ']', ')'].includes(token.type.label)) depth--
    }
    const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true })
    const pending = [ast]
    let nodes = 0
    while (pending.length) {
      const node = pending.pop()
      if (++nodes > limits.nodes) fail('AST_NODE_LIMIT', path, 'Demasiados nodos AST.')
      for (const value of Object.values(node)) {
        if (value?.type) pending.push(value)
        else if (Array.isArray(value)) for (const child of value) if (child?.type) pending.push(child)
      }
    }
    return ast
  } catch (error) {
    if (error.diagnostic) throw error
    fail('DECLARATION_SYNTAX_INVALID', path, 'Sintaxis no admitida por el parser estático.', { line: error.loc?.line, column: error.loc?.column })
  }
}

function literal(node, bindings, path, limits, depth = 0) {
  const reject = (message = 'Expresión dinámica: solo se admiten literales, arrays, objetos y constantes RME3 aprobadas.') =>
    fail('DYNAMIC_DECLARATION_UNSUPPORTED', path, message, { line: node?.loc?.start.line, column: node?.loc?.start.column, nodeType: node?.type })
  if (depth > limits.depth) fail('AST_DEPTH_LIMIT', path, 'Declaración demasiado profunda.')
  if (node?.type === 'Literal' && !node.regex && !node.bigint && (node.value === null || ['string', 'boolean', 'number'].includes(typeof node.value))) {
    if (typeof node.value === 'number' && !Number.isFinite(node.value)) reject('Número no finito.')
    return node.value
  }
  if (node?.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number' && Number.isFinite(node.argument.value)) return -node.argument.value
  if (node?.type === 'ArrayExpression') return node.elements.map((n) => literal(n, bindings, path, limits, depth + 1))
  if (node?.type === 'ObjectExpression') {
    const result = {}, keys = new Set()
    for (const prop of node.properties) {
      if (prop.type !== 'Property' || prop.computed || prop.method || prop.shorthand || prop.kind !== 'init') reject('Spread, getters, métodos y propiedades computadas no admitidos.')
      const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
      if (typeof key !== 'string' || forbiddenKeys.has(key) || keys.has(key)) reject('Clave duplicada o peligrosa en objeto.')
      keys.add(key)
      result[key] = literal(prop.value, bindings, path, limits, depth + 1)
    }
    return result
  }
  if (node?.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.property.type === 'Identifier') {
    const values = enums[bindings.get(node.object.name)]
    if (values && Object.hasOwn(values, node.property.name)) return values[node.property.name]
  }
  reject()
}

export function parseDeclaration(source, path, allowedDeclarators, limits) {
  const ast = boundedAst(source, path, limits), bindings = new Map()
  let declaration
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' && !declaration && modules.has(node.source.value)) {
      if (!node.specifiers.length) fail('DECLARATION_IMPORT_UNSUPPORTED', path, 'Imports con side effects no admitidos.')
      for (const spec of node.specifiers) {
        const name = spec.imported?.name
        if (spec.type !== 'ImportSpecifier' || (!declarators.has(name) && !Object.hasOwn(enums, name))) fail('DECLARATION_IMPORT_UNSUPPORTED', path, 'Solo imports nombrados de declaradores y enums RME3 aprobados.')
        bindings.set(spec.local.name, name)
      }
    } else if (node.type === 'ExportDefaultDeclaration' && !declaration) {
      const call = node.declaration, name = bindings.get(call.callee?.name)
      if (call.type !== 'CallExpression' || call.optional || call.callee.type !== 'Identifier' || !allowedDeclarators.includes(name) || call.arguments.length !== 1) {
        fail('DYNAMIC_DECLARATION_UNSUPPORTED', path, 'export default debe llamar un declarador RME3 importado con un solo objeto literal.', { line: node.loc.start.line })
      }
      const value = literal(call.arguments[0], bindings, path, limits)
      if (!value || Array.isArray(value) || typeof value !== 'object') fail('DECLARATION_OBJECT_REQUIRED', path, 'El declarador requiere un objeto literal.')
      declaration = { declarator: name, value }
    } else {
      fail('DYNAMIC_DECLARATION_UNSUPPORTED', path, 'Sentencia/import no admitido. No se ejecutará para completar la inspección.', { line: node.loc.start.line, nodeType: node.type })
    }
  }
  if (!declaration) fail('DECLARATION_DEFAULT_REQUIRED', path, 'Falta export default de un declarador RME3.')
  return declaration
}

export function parseDataJson(source, path, limits) {
  const ast = boundedAst(`(${source})`, path, limits)
  try { JSON.parse(source) } catch { fail('JSON_INVALID', path, 'JSON inválido.') }
  return literal(ast.body[0]?.expression, new Map(), path, limits)
}
