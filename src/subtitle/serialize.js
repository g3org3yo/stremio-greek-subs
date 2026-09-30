// Γράφουμε πάντα UTF-8 με BOM και LF: ορισμένοι players, βλέποντας bytes χωρίς BOM,
// μαντεύουν Windows-1253 και εμφανίζουν σκουπίδια αντί για ελληνικά.
export function serializeSrt(cues, opts = {}) {
  const bom = opts.bom !== false;
  const blocks = cues.map((cue) => `${cue.id}\n${cue.start} --> ${cue.end}\n${cue.text}\n`);
  return (bom ? '\uFEFF' : '') + blocks.join('\n');
}
