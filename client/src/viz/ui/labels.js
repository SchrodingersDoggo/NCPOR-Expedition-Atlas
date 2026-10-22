// Display name for a variable without repeating its unit. Headers such as
// "Temperature (°C)" already carry the unit that detection parsed into
// field.unit, which the UI appends again — this avoids "Temperature (°C) (°C)".
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function variableName(field) {
  const name = String(field?.originalName || field?.normalizedName || field?.name || '').trim();
  const unit = String(field?.unit || '').trim();
  if (!name || !unit) return name;
  const pattern = new RegExp(`\\s*[\\(\\[]\\s*${escapeRegExp(unit)}\\s*[\\)\\]]\\s*$`, 'i');
  const stripped = name.replace(pattern, '').trim();
  return stripped || name;
}

export function variableLabel(field, fallback = 'Value') {
  const name = variableName(field) || fallback;
  return field?.unit ? `${name} (${field.unit})` : name;
}
