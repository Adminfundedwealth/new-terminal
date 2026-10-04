export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const headers = lines.shift()?.split(",").map((header) => header.trim()) ?? [];
  return lines.map((line) => {
    const values: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        values.push(value);
        value = "";
      } else {
        value += char;
      }
    }
    values.push(value);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}
