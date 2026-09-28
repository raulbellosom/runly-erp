// Module Builder — next-version suggestion at publish time. Compares the
// draft with the published definition and proposes a semver bump:
//   major: something was removed or a field changed type,
//   minor: entities, fields or views were added,
//   patch: anything else changed (labels, design, rules, menu, icon...).

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(value) {
  const match = SEMVER.exec(String(value ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const a = parseVersion(left) ?? [0, 0, 0];
  const b = parseVersion(right) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function bumpVersion(version, level) {
  const [major, minor, patch] = parseVersion(version) ?? [0, 1, 0];
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const keyed = (items) => new Map((items ?? []).map((item) => [item.key, item]));
const customViews = (definition) => (definition?.views ?? []).filter((view) => !view.generated);

// { level: 'major'|'minor'|'patch'|null, reasons: string[] }
export function describeChanges(published, draft) {
  const reasons = { major: [], minor: [] };
  const before = keyed(published?.entities);
  const after = keyed(draft?.entities);
  const removedEntities = [...before.keys()].filter((key) => !after.has(key));
  const addedEntities = [...after.keys()].filter((key) => !before.has(key));
  let addedFields = 0;
  let removedFields = 0;
  let retyped = 0;
  for (const [key, entity] of after) {
    const previous = before.get(key);
    if (!previous) continue;
    const oldFields = keyed(previous.fields);
    const newFields = keyed(entity.fields);
    for (const [fieldKey, field] of newFields) {
      if (!oldFields.has(fieldKey)) addedFields += 1;
      else if (oldFields.get(fieldKey).type !== field.type) retyped += 1;
    }
    removedFields += [...oldFields.keys()].filter((fieldKey) => !newFields.has(fieldKey)).length;
  }
  const oldViews = new Set(customViews(published).map((view) => view.key));
  const newViews = new Set(customViews(draft).map((view) => view.key));
  const addedViews = [...newViews].filter((key) => !oldViews.has(key)).length;
  const removedViews = [...oldViews].filter((key) => !newViews.has(key)).length;

  if (removedEntities.length) reasons.major.push(`quitaste ${plural(removedEntities.length, "entidad", "entidades")}`);
  if (removedFields) reasons.major.push(`quitaste ${plural(removedFields, "campo", "campos")}`);
  if (retyped) reasons.major.push(`cambiaste el tipo de ${plural(retyped, "campo", "campos")}`);
  if (removedViews) reasons.major.push(`quitaste ${plural(removedViews, "vista", "vistas")}`);
  if (addedEntities.length) reasons.minor.push(`agregaste ${plural(addedEntities.length, "entidad", "entidades")}`);
  if (addedFields) reasons.minor.push(`agregaste ${plural(addedFields, "campo", "campos")}`);
  if (addedViews) reasons.minor.push(`agregaste ${plural(addedViews, "vista", "vistas")}`);

  if (reasons.major.length) return { level: "major", reasons: reasons.major };
  if (reasons.minor.length) return { level: "minor", reasons: reasons.minor };
  const strip = (definition) => JSON.stringify({ ...(definition ?? {}), version: undefined });
  if (strip(published) !== strip(draft)) return { level: "patch", reasons: ["ajustaste textos, diseño, reglas u opciones"] };
  return { level: null, reasons: [] };
}

// Options for the publish dialog. `publishedVersion` null = first publish.
export function versionOptions({ publishedVersion, publishedDefinition, definition }) {
  if (!publishedVersion) return { first: true, suggested: definition?.version ?? "0.1.0", options: [], changes: { level: null, reasons: [] } };
  const changes = describeChanges(publishedDefinition, definition);
  const suggestedLevel = changes.level ?? "patch";
  const options = [
    { level: "patch", label: "Corrección", help: "Textos, diseño, condiciones u opciones." },
    { level: "minor", label: "Mejora", help: "Entidades, campos o vistas nuevas." },
    { level: "major", label: "Cambio mayor", help: "Quitaste algo o cambiaste un tipo de campo." },
  ].map((option) => ({ ...option, version: bumpVersion(publishedVersion, option.level), recommended: option.level === suggestedLevel }));
  return { first: false, suggested: bumpVersion(publishedVersion, suggestedLevel), options, changes };
}
